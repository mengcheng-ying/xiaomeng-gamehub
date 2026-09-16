#!/usr/bin/env node
/**
 * 三九互娱官方专区公告抓取（近 3 个月窗口 + 每日增量）
 * ------------------------------------------------------------------
 * 数据来源：3975.com 系列官方专区（游戏发行方三九互娱的官方站点）
 * 输出：
 *   data/official-news.js    → const OFFICIAL_NEWS = { generatedAt, sourceNote, archives, games }
 *   data/news-bodies.js      → const NEWS_BODIES = { <key>: [段落, …] }（公告正文，生成站内独立页用）
 *   data/news-history.json   → 每日快照，供日报做趋势对比
 *
 * 设计要点
 * - 翻页参数实测为 ?tid=0&page=N；翻到内容与前页重复即视为末页。
 * - **只收录 KEEP_SINCE 之后的公告**（默认近 3 个月）。列表页按时间倒序，
 *   一旦出现整页都早于 KEEP_SINCE 就停止翻页 —— 比全量翻到底快得多，也不必再担心 MAX_PAGES 截断。
 * - 详情页**只抓没抓过的**：正文按 key 从 data/news-bodies.js 继承，已抓过的不再请求官方站。
 * - 正文来自详情页的 de_contain / artText / newsCon 容器，只取纯文本段落，**不保留图片与任何外站链接**，
 *   使生成的站内公告页完全自包含（用户硬要求：站内不得跳转到任何外部站点）。
 * - 每抓 SAVE_EVERY 条详情就落盘一次，中断也不会白跑。
 * - 某个专区抓取失败时保留其原有数据，绝不用渠道站/AI 站内容补位。
 *
 * 用法：node scripts/fetch-official-news.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'official-news.js');
const HISTORY = path.join(ROOT, 'data', 'news-history.json');
const DATECACHE = path.join(ROOT, 'data', 'news-datecache.json');   // url → 真实日期（或 'ND'）
const BODIES = path.join(ROOT, 'data', 'news-bodies.js');           // key → 正文段落（生成站内独立页用）

const MAX_SUMMARY = 160;      // 每条公告的正文摘要字数上限
const DELAY = 200;            // 请求间隔（ms）
const MAX_PAGES = 30;         // 单专区最多翻页数（防止死循环）
const MAX_DETAIL_PER_RUN = 1500; // 单次运行最多抓多少条详情（防跑飞）
const SAVE_EVERY = 120;       // 每抓 N 条详情落盘一次
const MAX_BODY_CHARS = 20000; // 单条正文硬上限（防某个模板把整页噪声都吞进来）

// 正文容器候选（取文本最长的那个）。实测 3975 系列详情页有三种模板：
//   通用模板 de_contain / 复古传世 fgcs 用 artText / 热血传说 rxcs 用 newsCon
const BODY_SELECTORS = ['de_contain', 'artText', 'newsCon'];

// ── 收录窗口（分阶段上量的第一步）──────────────────────────────
// 只收录这个日期（含）之后的公告。更早的直接不入库、不渲染。
// 理由：公告页是"聚合页"，内容 100% 转载自 3975.com。全量 2236 条一次性放出，
// 会让站点画面上呈现"大量采集内容"的特征，对百度评估站点质量没有好处，
// 而这批旧公告的搜索量近乎为零。先把窗口收到近 3 个月，跑稳了再逐段往前扩。
// 要往前扩：把这个日期改早即可（例如 '2025-09-14' = 12 个月）。
const KEEP_SINCE = '2026-06-14';

// 只有这个日期之后的公告才去抓详情页摘要（当前 KEEP_SINCE 晚于它，等于窗口内全抓）。
const SUMMARY_SINCE = '2025-09-01';

// 专区清单（同一专区被多款游戏共用时，写多个 gameId）
const SOURCES = [
  { slug: 'jz',   base: 'https://jz.3975.com',    gameIds: [46],     name: '机战：钢铁巨舰' },
  { slug: 'dn',   base: 'https://dn.3975.com',    gameIds: [1],      name: '龙之谷：启程' },
  { slug: 'mxq',  base: 'https://mxq.3975.com',   gameIds: [2],      name: '墨香情' },
  { slug: 'wlwz', base: 'https://wlwz.3975.com',  gameIds: [21],     name: '武林外传：十年之约' },
  { slug: 'jzpx', base: 'https://jzpx.3975.com',  gameIds: [14],     name: '决战破晓' },
  { slug: 'fgcs', base: 'https://fgcs.3975.com',  gameIds: [42],     name: '复古传世-金装裁决' },
  { slug: 'ff',   base: 'https://ff.3975.com',    gameIds: [4, 23],  name: '飞飞：重逢' },
  { slug: 'xmsl', base: 'https://xmsl.3975.com',  gameIds: [32],     name: '寻梦丝路' },
  { slug: 'qn',   base: 'https://qn.3975.com',    gameIds: [7, 40],  name: '千年盛世' },
  { slug: 'rxcs', base: 'http://rxcs.3975.com',   gameIds: [44],     name: '热血传说-复古传奇' }
];

const CATEGORY_ORDER = ['开服公告', '合服公告', '维护公告', '版本更新', '活动', '赛事', '攻略', '官方资讯'];

/** 合法日期校验：00 月 / 00 日 / 越界一律判为无效 */
function validDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2015 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  return true;
}

/**
 * 分类收敛。
 * 列表页给的分类常常只是「公告 / 新闻 / 资讯」这类泛称（模板前缀），
 * 直接用它会让「9月13日维护公告」全部落进「官方资讯」，归档页的分类就没意义了。
 * 所以：先让标题关键词判断，标题判断不出来时才回退到列表页给的分类。
 */
function refineCategory(cat, title) {
  const byTitle = classify(title);
  if (byTitle !== '官方资讯') return byTitle;
  if (cat === '版本') return '版本更新';
  if (cat === '新闻' || cat === '资讯' || cat === '前瞻') return '官方资讯';
  return CATEGORY_ORDER.includes(cat) ? cat : '官方资讯';
}

// ---------- 网络 ----------
function fetchUrl(url, depth = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('bad url ' + url)); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get({
      host: u.host,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      timeout: 25000
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && depth < 4) {
        resolve(fetchUrl(new URL(res.headers.location, url).href, depth + 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withSpace = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** 从列表页解析公告条目 */
function parseList(html, base) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']*\/news\/newsdetail[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (seen.has(href)) continue;
    if (/newsdetailwap/i.test(href)) continue; // 移动版重复项

    let plain = withSpace(m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&ldquo;|&rdquo;/g, '"'));

    // 发布日期：优先完整格式（标题里的「9月13日」不会被误伤）
    let date = '';
    let mdOnly = false;   // 列表页只给了「月-日」（如 11-25），年份是猜的，必须回详情页核实
    const dm = plain.match(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/);
    if (dm) {
      date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
      plain = withSpace(plain.split(dm[0]).join(' '));
    } else {
      const dm2 = plain.match(/(?:^|\s)(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/);
      if (dm2) {
        // ⚠️ 这里不生成年份。用当前年份猜会同一批去年同月的公告被算成今年的，
        //    归档页就会出现日期错一年的假信息（用户硬底线：站内不得有虚假信息）。
        //    只记录「月-日」，标记 mdOnly，由详情页给出真实年份。
        date = `${String(dm2[1]).padStart(2, '0')}-${String(dm2[2]).padStart(2, '0')}`;
        mdOnly = true;
        plain = withSpace(plain.split(dm2[0].trim()).join(' '));
      }
    }

    // 分类：优先「公告/新闻/活动…」前缀，其次开头的【】
    let category = '';
    const leadM = plain.match(/^(公告|新闻|活动|赛事|攻略|版本|资讯|前瞻)\s+(\S[\s\S]{3,})$/);
    if (leadM) { category = leadM[1]; plain = leadM[2].trim(); }
    else {
      const catM = plain.match(/^[-–—·•\s]*【([^】]{1,10})】\s*/);
      if (catM) { category = catM[1].trim(); plain = plain.slice(catM[0].length).trim(); }
    }

    const title = plain.replace(/^[-–—·•\s]+/, '').trim();
    if (!title || title.length < 4) continue;
    // mdOnly 的日期形如 'MM-DD'，不能过 validDate（那是给完整日期用的）
    if (!mdOnly && !validDate(date)) date = '';
    if (mdOnly && !/^\d{2}-\d{2}$/.test(date)) { date = ''; mdOnly = false; }

    seen.add(href);
    out.push({ date, category, title, url: new URL(href, base).href, mdOnly });
  }
  return out;
}

/** 自动分类（列表页没给分类时按标题判断） */
function classify(title) {
  if (/合服|合区/.test(title)) return '合服公告';
  if (/开服|开区|新区|新服/.test(title)) return '开服公告';
  if (/维护/.test(title)) return '维护公告';
  if (/更新公告|版本更新|更新预告|版本前瞻|上新|版本上线/.test(title)) return '版本更新';
  if (/赛事|比赛|竞技|天梯|争霸|大会|对决|争锋/.test(title)) return '赛事';
  if (/教师节|中秋节|国庆|春节|端午|元宵|七夕|万圣|圣诞|元旦|周年庆|开学季/.test(title)) return '活动';
  if (/活动|福利|礼包|签到|投稿|招募|征集|竞猜|庆典|节日|回馈|限时|返场|抽奖/.test(title)) return '活动';
  if (/攻略|百科|问答|指南|解析|速递|挑战/.test(title)) return '攻略';
  return '官方资讯';
}

/** 从详情页提取正文摘要 */
function extractSummary(html, title) {
  const clean = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr|td)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t\u00a0]+/g, ' ');

  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const skipRe = /^(首页|新闻资讯|游戏攻略|游戏预约|前往论坛|交易平台|客服中心|游戏资讯|NEWS|您的当前位置|您当前所在位置|当前位置|App Store|下载|安卓下载|苹果下载|请扫码下载体验游戏|上一篇|下一篇|相关阅读|热门推荐|返回列表|分享到|更多|上一篇：|下一篇：|最新资讯|推荐阅读|猜你喜欢)/;
  const noiseRe = /职业介绍之|职业攻略之|猜你喜欢|关注公众号|扫码关注|扫码下载|微信公众号|官方QQ群|玩家交流群/;
  const body = [];
  for (const l of lines) {
    if (l.length < 8) continue;
    if (skipRe.test(l)) continue;
    if (noiseRe.test(l)) continue;
    if (title && l === title) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(l)) continue;
    if (/^\/+$/.test(l)) continue;
    if (/^[0-9\s\-:：~至]+$/.test(l)) continue;
    if (/官方专区|3975|客服QQ|微信公众号/.test(l)) continue;
    if (/版权所有|ICP备|备案号|网络文化经营|增值电信|健康游戏忠告|抵制不良游戏|适龄提示|举报电话|纠纷处理|沪网文|京网文|粤网文|苏网文/.test(l)) continue;
    body.push(l);
    if (body.join('').length > MAX_SUMMARY * 1.8) break;
  }
  let s = withSpace(body.join(' '));
  const tm = s.match(/[\u4e00-\u9fa5A-Za-z0-9《》：:]{2,30}运营团队\s*/);
  if (tm && tm.index <= 120) s = s.slice(tm.index + tm[0].length).trim();
  if (s.length > MAX_SUMMARY) s = s.slice(0, MAX_SUMMARY) + '…';
  return s;
}

/** 从详情页兜底提发布日期（部分专区列表页完全不给日期） */
function dateFromHtml(html) {
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  // 同时吃 2026-08-15 / 2026.8.15 / 2026/8/15 / 2026年8月15日
  const dm = plain.match(/(20\d{2})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/);
  if (!dm) return '';
  const s = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
  return validDate(s) ? s : '';
}

/**
 * 官方原文 URL → 站内独立页 key（同一 URL 永远得同一个 key，列表排序变化不会错位）。
 * 用纯 JS 哈希而不是 require('crypto')：本机环境里 crypto.createHash 不可用。
 * 10 位十六进制，600 条量级碰撞概率可忽略。
 */
function keyOf(url) {
  const s = String(url);
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + (h2 >>> 26).toString(16).padStart(2, '0');
}

/** 按 class 名取 <div>，并按 div 深度配对取出完整内容 */
function extractByClass(html, cls) {
  const re = new RegExp('<div[^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>', 'i');
  const m = re.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  const re2 = /<div\b|<\/div>/gi;
  re2.lastIndex = start;
  let t;
  while ((t = re2.exec(html))) {
    if (t[0][1] === '/') { depth--; if (depth === 0) return html.slice(start, t.index); }
    else depth++;
  }
  return html.slice(start);
}

/** 选正文容器：取候选里文本最长的那个（个别模板的 de_contain 只是片段） */
function pickContainer(html) {
  let best = null, bestLen = 0;
  for (const cls of BODY_SELECTORS) {
    const box = extractByClass(html, cls);
    if (!box) continue;
    const len = box.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
    if (len > bestLen) { best = box; bestLen = len; }
  }
  return best;
}

// 与正文无关的行（导航、页脚、备案、扫码下载、上下篇、推荐位……）
const BODY_SKIP_RE = /^(首页|新闻资讯|游戏攻略|游戏预约|前往论坛|交易平台|客服中心|游戏资讯|NEWS|您的当前位置|当前位置|App Store|下载|安卓下载|苹果下载|iOS下载|请扫码下载体验游戏|扫码下载|上一篇|下一篇|相关阅读|热门推荐|返回列表|分享到|更多|最新资讯|推荐阅读|猜你喜欢|上一篇：|下一篇：|返回顶部|top)/;
const BODY_NOISE_RE = /职业介绍之|职业攻略之|猜你喜欢|关注公众号|扫码关注|扫码下载|微信公众号|官方QQ群内|点击右下角|版权所有|Copyright|ICP备|备案号|网络文化经营|增值电信|健康游戏忠告|抑制不良游戏|抵制不良游戏|适龄提示|举报电话|纠纷处理|沪网文|京网文|粤网文|苏网文|浙网文|All Rights Reserved|运营团队\s*$|本页地址|文章地址/;

/** HTML 片段 → 文本行 */
function htmlToLines(html) {
  const clean = String(html)
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<img[^>]*>/gi, '\n')          // 图片位置留断点，保留文本顺序
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr|td|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t\u00a0]+/g, ' ');
  return clean.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** 过滤噪声行 → 干净的正文行 */
function cleanBodyLines(lines, title) {
  const out = [];
  for (const raw of lines) {
    let l = raw.replace(/^[-–—·•\s]+/, '').trim();
    if (!l) continue;
    if (l.length < 2) continue;
    if (BODY_SKIP_RE.test(l)) continue;
    if (BODY_NOISE_RE.test(l)) continue;
    if (title && (l === title || (l.length > 8 && title.startsWith(l) && l.length > title.length * 0.6))) continue;
    if (/^(作者|来源|编辑|时间)\s*[：:]/.test(l)) continue;         // rxcs 模板的「作者：3975 时间：…」
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}([\s:]|$)/.test(l) && l.length < 24) continue;
    if (/^[\d\s\-–—~～:：,.。/、+%]+$/.test(l)) continue;
    if (/^https?:\/\//i.test(l)) continue;                        // 裸链接抽掉
    if (/^[a-z0-9.-]+\.(com|cn|net|org|xyz|vip)(\/\S*)?$/i.test(l)) continue;
    out.push(l);
  }
  return out;
}

/**
 * 行 → 段落：**保留官方原文的换行，一行一段**。
 * 早期版本按句号把多行合并成自然段，结果把「烈焰海洋15区 开服时间：…」这类
 * 逐行信息压成一坨，可读性反而更差 —— 官方模板里的 <br> 本身就是有意义的换行。
 * 这里只做一件事：去掉连续重复的行。
 */
function groupParagraphs(lines) {
  const out = [];
  for (const l of lines) {
    if (out.length && out[out.length - 1] === l) continue;
    out.push(l);
  }
  return out;
}

/** 从详情页提取正文段落；提不到容器时退回全页文本（仍走同一套噪声过滤） */
function extractBody(html, title) {
  const box = pickContainer(html);
  const lines = cleanBodyLines(htmlToLines(box || html), title);
  const paras = groupParagraphs(lines);
  let total = 0;
  const capped = [];
  for (const p of paras) {
    if (total + p.length > MAX_BODY_CHARS) break;
    capped.push(p);
    total += p.length;
  }
  return capped;
}

/** 正文前 160 字作列表摘要 */
function bodyToSummary(body) {
  const s = withSpace((body || []).join(' '));
  if (s.length <= MAX_SUMMARY) return s;
  return s.slice(0, MAX_SUMMARY) + '…';
}

/** 读回上一次的输出（用于继承摘要、判断新增） */
function loadPrev() {
  if (!fs.existsSync(OUT)) return null;
  try {
    const src = fs.readFileSync(OUT, 'utf8');
    const o = new Function(src + '\nreturn OFFICIAL_NEWS;')();
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}

/**
 * 日期缓存：url → 真实日期（'YYYY-MM-DD'）或 'ND'（确认过、官方就是没给日期）。
 * 存在的意义：列表页不给日期的条目，本来只能靠详情感知年份；
 * 而这些条目里可能大量属于窗口之外（例如热血传说专区 130 条是去年的）。
 * 没有缓存时，它们每天都会被重新抓一遍详情页再丢掉 —— 纯浪费对方服务器和我们的时间。
 */
function loadDateCache() {
  try { return JSON.parse(fs.readFileSync(DATECACHE, 'utf8')) || {}; } catch (e) { return {}; }
}
function saveDateCache(c) {
  try { fs.writeFileSync(DATECACHE, JSON.stringify(c), 'utf8'); } catch (e) {}
}

function writeOut(payload) {
  const banner = [
    '// ⚠️ 本文件由 scripts/fetch-official-news.js 自动生成，请勿手工编辑',
    '// 数据来源：三九互娱官方专区（3975.com 系列站点）公开公告',
    '// 最后同步：' + payload.generatedAt,
    ''
  ].join('\n');
  fs.writeFileSync(OUT, banner + 'const OFFICIAL_NEWS = ' + JSON.stringify(payload, null, 2) + ';\n', 'utf8');
}

/** 读回上一次抓到的正文（按 key）：已抓过的不再重复请求官方站 */
function loadBodies() {
  if (!fs.existsSync(BODIES)) return {};
  try {
    const src = fs.readFileSync(BODIES, 'utf8');
    const o = new Function(src + '\nreturn NEWS_BODIES;')();
    return o && typeof o === 'object' ? o : {};
  } catch (e) { return {}; }
}

/** 正文单独存一个文件：official-news.js 保持轻量，正文（体量大、变动少）单独一份 */
function writeBodies(bodies) {
  const banner = [
    '// ⚠️ 本文件由 scripts/fetch-official-news.js 自动生成，请勿手工编辑',
    '// 官方公告正文段落：key = 官方原文 URL 的哈希，value = 段落数组',
    '// 用途：为每条公告生成站内独立页（/news/<专区>/<key>），使站内不再跳转外部站点',
    ''
  ].join('\n');
  const keys = Object.keys(bodies).sort();
  const lines = keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(bodies[k]));
  fs.writeFileSync(BODIES, banner + 'const NEWS_BODIES = {\n' + lines.join(',\n') + '\n};\n', 'utf8');
}

// ---------- 主流程 ----------
// ── 精选模式（2026-09-16 新增）────────────────────────────────
// 用户改为「每天手动喂一点点」后不再需要全量抓取。两个参数：
//   --only=dn,mxq          只处理这些专区（不传 = 全部 10 个专区，即原行为）
//   --pick=2026-09-14,关键词  只入库「日期完全相等」或「标题包含」的条目（不传 = 窗口内全部）
// 合并规则：本次命中条目 + 上次该专区已入库条目（追加式，不会把已入库的冲掉）。
// 例：node scripts/fetch-official-news.js --only=dn --pick=2026-09-14
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PICK = (process.argv.find((a) => a.startsWith('--pick=')) || '').replace('--pick=', '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ACTIVE_SOURCES = ONLY.length ? SOURCES.filter((s) => ONLY.includes(s.slug)) : SOURCES;

async function main() {
  const started = Date.now();
  console.log(`开始抓取三九互娱官方专区公告（窗口 ≥ ${KEEP_SINCE}，增量补正文）…\n`);

  const prev = loadPrev();
  const prevArchives = (prev && prev.archives) || {};
  const dateCache = loadDateCache();
  const bodies = loadBodies();
  const inheritedBodies = Object.keys(bodies).length;

  // 1) 先只用列表页把窗口内的全部条目收集齐（很快）
  //    列表页按时间倒序，因此一旦整页都早于 KEEP_SINCE 就可以停止翻页。
  const archives = {};
  const listStats = [];
  for (const src of ACTIVE_SOURCES) {
    const seen = new Map();
    let pages = 0;
    let lastSig = '';
    let stoppedBy = '';
    try {
      for (let p = 1; p <= MAX_PAGES; p++) {
        const r = await fetchUrl(`${src.base}/news/index?tid=0&page=${p}`);
        if (r.status !== 200) { stoppedBy = 'http-' + r.status; break; }
        const html = r.buf.toString('utf8');
        const list = parseList(html, src.base);
        const sig = list.map((x) => x.url).join('|');
        if (!list.length || sig === lastSig) { stoppedBy = '末页'; break; }   // 内容重复 = 已到末页
        lastSig = sig;
        pages = p;
        let allOlder = true;
        let certain = 0;
        for (const it of list) {
          if (!seen.has(it.url)) seen.set(it.url, it);
          // 判断"这一页是否已经翻到窗口之外"：优先用列表页给的完整日期，
          // 列表页没给年份时用日期缓存里已经核实过的真实日期。
          let d = it.date && !it.mdOnly ? it.date : '';
          if (!d) { const c = dateCache[it.url]; if (c && c !== 'ND') d = c; }
          if (d) {
            certain++;
            if (d >= KEEP_SINCE) allOlder = false;
          } else {
            allOlder = false;                   // 年份未知，保守起见继续翻
          }
        }
        if (allOlder && certain > 0) { stoppedBy = '整页早于 ' + KEEP_SINCE; break; }
        await sleep(DELAY);
      }
      if (pages >= MAX_PAGES && !stoppedBy) stoppedBy = '达翻页上限 ' + MAX_PAGES;
    } catch (e) {
      console.log(`⚠️  ${src.name}（${src.slug}）列表抓取失败：${e.message}`);
      stoppedBy = '异常';
    }

    if (!seen.size) {
      // 整体失败 → 保留上一次的数据，绝不用其他地方的内容补
      if (prevArchives[src.slug]) {
        archives[src.slug] = prevArchives[src.slug];
        console.log(`↩︎  ${src.name}（${src.slug}）本次无数据，沿用上次的 ${prevArchives[src.slug].items.length} 条`);
      } else {
        console.log(`⚠️  ${src.name}（${src.slug}）无数据且无历史可沿用`);
      }
      continue;
    }

    // 先用日期缓存补齐（列表页没给日期 / 只给月-日 的条目）
    let all = [...seen.values()];
    let fromCache = 0;
    for (const it of all) {
      const c = dateCache[it.url];
      if (c && (!it.date || it.mdOnly)) {
        if (c === 'ND') { it.nd = true; }
        else { it.date = c; it.dated = true; delete it.mdOnly; }
        fromCache++;
      }
    }

    // 窗口过滤：完整日期早于 KEEP_SINCE 的直接剔除；
    // mdOnly（年份未知）/ 无日期的先留下，等详情页给出真实年份后再二次过滤。
    const dropped = all.filter((it) => it.date && !it.mdOnly && it.date < KEEP_SINCE).length;
    all = all.filter((it) => !it.date || it.mdOnly || it.date >= KEEP_SINCE);

    const items = all.sort((a, b) => {
      const da = a.date && !a.mdOnly ? a.date : '';
      const db = b.date && !b.mdOnly ? b.date : '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? 1 : da > db ? -1 : 0;
    });
    items.forEach((it) => { it.category = refineCategory(it.category, it.title); });

    // ── 精选模式：只留命中条目 + 上次该专区已入库的条目（追加式，不覆盖）──
    if (PICK.length) {
      const hit = items.filter((it) => PICK.some((k) => (it.date || '') === k || (it.title || '').includes(k)));
      const prevItems = (prevArchives[src.slug] && prevArchives[src.slug].items) || [];
      const hitUrls = new Set(hit.map((x) => x.url));
      const carried = prevItems.filter((x) => !hitUrls.has(x.url));
      const merged = hit.concat(carried);
      merged.sort((a, b) => {
        const da = a.date || '', db = b.date || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da < db ? 1 : da > db ? -1 : 0;
      });
      console.log(`🔎 精选：命中 ${hit.length} 条 + 沿用已入库 ${carried.length} 条 = ${merged.length} 条`);
      if (!hit.length) {
        console.log('   ⚠️ 没有任何条目命中 --pick，本次该专区不新增内容（已入库的照旧保留）');
      }
      items.length = 0;
      merged.forEach((x) => items.push(x));
    }

    archives[src.slug] = {
      slug: src.slug,
      site: src.base,
      official: `三九互娱《${src.name}》官方专区`,
      gameIds: src.gameIds,
      newsUrl: src.base + '/news/index',
      pages,
      since: KEEP_SINCE,
      items
    };
    listStats.push({ slug: src.slug, name: src.name, pages, total: items.length, dropped });
    console.log(`✅ ${src.name.padEnd(18)} 翻 ${String(pages).padStart(2)} 页 → 窗口内 ${items.length} 条（窗口外剔除 ${dropped} 条${fromCache ? '，缓存命中 ' + fromCache : ''}，${stoppedBy}）`);
    await sleep(DELAY);
  }
  console.log('');

  // 2) 继承上次已抓到的摘要（避免重复请求详情页）
  let inherited = 0;
  if (prev && prev.archives) {
    for (const [slug, arc] of Object.entries(archives)) {
      const old = prev.archives[slug];
      if (!old || !Array.isArray(old.items)) continue;
      const map = new Map(old.items.map((x) => [x.url, x]));
      for (const it of arc.items) {
        const o = map.get(it.url);
        if (!o) continue;
        if (it.mdOnly) continue;   // 年份还没确认 → 整条重抓（详情页一次拿日期+摘要）
        if (!it.summary && o.summary) { it.summary = o.summary; inherited++; }
        if (!it.date && validDate(o.date)) it.date = o.date;
        if (!it.date && o.nd) it.nd = true;
        if (o.dated) it.dated = true;
      }
    }
  }

  // 3) 需要抓详情页的条目：
  //    - 还没有正文的（新公告；正文既用于站内独立页，也用于列表摘要）
  //    - mdOnly（列表页只给月-日，年份必须核实）
  //    - 完全没有日期的
  const need = [];
  for (const arc of Object.values(archives)) {
    for (const it of arc.items) {
      it.key = keyOf(it.url);
      const needsBody = !bodies[it.key] || !bodies[it.key].length;
      const needsDate = it.mdOnly || !it.date;
      if (needsBody || needsDate) need.push(it);
    }
  }
  const noBodyYet = Object.values(archives).reduce((s, a) => s + a.items.filter((it) => !bodies[it.key] || !bodies[it.key].length).length, 0);
  const mdCount = need.filter((x) => x.mdOnly).length;
  console.log(`正文：已有 ${inheritedBodies} 条 | 本次需抓 ${need.length} 条（其中 ${mdCount} 条年份待核实） | 抓完后仍缺正文 ${Math.max(0, noBodyYet - need.length)} 条`);
  console.log('');

  const todo = need.slice(0, MAX_DETAIL_PER_RUN);
  let fetched = 0, failed = 0, gotBody = 0;
  const snapshot = () => {
    const snapshotNow = new Date().toISOString();
    const games = {};
    for (const arc of Object.values(archives)) {
      for (const gid of arc.gameIds) {
        games[String(gid)] = { slug: arc.slug, official: arc.official, site: arc.site, newsUrl: arc.newsUrl, gameIds: arc.gameIds };
      }
    }
    writeOut({ generatedAt: snapshotNow, sourceNote: '数据来源：三九互娱官方专区（3975.com 系列站点）公开公告，自动同步', archives, games });
    writeBodies(bodies);
  };

  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    try {
      const d = await fetchUrl(it.url);
      if (d.status === 200) {
        const html = d.buf.toString('utf8');
        if (!bodies[it.key] || !bodies[it.key].length) {
          const body = extractBody(html, it.title);
          if (body.length) { bodies[it.key] = body; gotBody++; }
        }
        if (!it.summary && bodies[it.key]) it.summary = bodyToSummary(bodies[it.key]);
        const dd = dateFromHtml(html);
        if (dd) {
          it.date = dd;
          it.dated = true;
          dateCache[it.url] = dd;          // 记住真实年份，下次不必再抓
        } else if (it.mdOnly) {
          // 连详情页都不给年份 → 无法核实，绝不猜。清掉月-日，标 nd 不再重试。
          it.date = '';
          it.nd = true;
          dateCache[it.url] = 'ND';
        } else if (!it.date) {
          it.nd = true;   // 提不到日期就记标记，不再重复请求
          dateCache[it.url] = 'ND';
        }
        if (it.mdOnly) delete it.mdOnly;
        fetched++;
      } else { failed++; }
    } catch (e) { failed++; }
    await sleep(DELAY);
    if ((i + 1) % SAVE_EVERY === 0) {
      snapshot();
      const pct = Math.round(((i + 1) / todo.length) * 100);
      console.log(`   …进度 ${i + 1}/${todo.length}（${pct}%）已落盘`);
    }
  }
  snapshot();

  // 3.5) 二次窗口过滤：上面用详情页的真实年份确认后，把其实早于 KEEP_SINCE 的剔掉
  let refiltered = 0;
  const refilterDetail = [];
  for (const arc of Object.values(archives)) {
    const before = arc.items.length;
    arc.items = arc.items.filter((it) => !it.date || it.date >= KEEP_SINCE);
    const cut = before - arc.items.length;
    if (cut) { refiltered += cut; refilterDetail.push(`${arc.slug}-${cut}`); }
  }
  if (refiltered) console.log(`\n🔎 按详情页真实年份二次过滤：剔除 ${refiltered} 条（实际早于 ${KEEP_SINCE}）：${refilterDetail.join(' ')}\n`);

  // 3.6) 正文裁剪：只保留当前窗口内条目引用到的正文，避免正文文件随窗口滚动无限膨胀
  const liveKeys = new Set();
  for (const arc of Object.values(archives)) for (const it of arc.items) if (it.key) liveKeys.add(it.key);
  let pruned = 0;
  for (const k of Object.keys(bodies)) if (!liveKeys.has(k)) { delete bodies[k]; pruned++; }
  if (pruned) console.log(`🧹 正文裁剪：移除窗口外正文 ${pruned} 条，保留 ${Object.keys(bodies).length} 条\n`);

  // 缺正文的条目：不生成站内独立页，列表里只显示标题（绝不回退到外站链接）
  const noBodyItems = [];
  for (const arc of Object.values(archives)) {
    for (const it of arc.items) if (!bodies[it.key] || !bodies[it.key].length) noBodyItems.push(`${arc.slug}:${it.title}`);
  }
  if (noBodyItems.length) {
    console.log(`⚠️  ${noBodyItems.length} 条未取到正文（只展示标题，不生成独立页）：`);
    noBodyItems.slice(0, 12).forEach((x) => console.log('     - ' + x));
    if (noBodyItems.length > 12) console.log(`     …另有 ${noBodyItems.length - 12} 条`);
    console.log('');
  }

  // 4) 排序修正（补完日期后重排一次）
  for (const arc of Object.values(archives)) {
    arc.items.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  }
  snapshot();

  const gamesIdx = {};
  let totalItems = 0;
  for (const arc of Object.values(archives)) {
    totalItems += arc.items.length;
    for (const gid of arc.gameIds) gamesIdx[String(gid)] = { slug: arc.slug, official: arc.official, site: arc.site, newsUrl: arc.newsUrl, gameIds: arc.gameIds };
  }

  // 5) 写当日快照，供日报做趋势
  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch (e) { hist = {}; }
  const today = new Date().toISOString().slice(0, 10);
  hist[today] = {
    totalItems,
    archives: Object.keys(archives).length,
    perArchive: Object.fromEntries(Object.entries(archives).map(([k, v]) => [k, v.items.length])),
    categories: (() => {
      const c = {};
      Object.values(archives).forEach((a) => a.items.forEach((it) => { c[it.category || '官方资讯'] = (c[it.category || '官方资讯'] || 0) + 1; }));
      return c;
    })(),
    newBodies: gotBody,
    noBody: noBodyItems.length,
    pending: Math.max(0, need.length - todo.length)
  };
  hist.updatedAt = new Date().toISOString();
  fs.writeFileSync(HISTORY, JSON.stringify(hist, null, 2), 'utf8');
  saveDateCache(dateCache);   // 落盘日期缓存（含被窗口剔除的），下次不再重复请求详情页

  console.log('\n—— 汇总 ——');
  console.log('专区数：' + Object.keys(archives).length);
  console.log('公告总条数：' + totalItems);
  console.log('本次抓取详情页：' + fetched + ' 条' + (failed ? '（失败 ' + failed + ' 条）' : '') + '，其中新得正文 ' + gotBody + ' 条');
  console.log('正文库：' + Object.keys(bodies).length + ' 条' + (noBodyItems.length ? '，缺正文 ' + noBodyItems.length + ' 条（不生成独立页）' : '，全部公告都有正文'));
  console.log('剩余待抓：' + Math.max(0, need.length - todo.length) + ' 条');
  console.log('耗时：' + Math.round((Date.now() - started) / 1000) + ' 秒');
  console.log('输出：' + OUT);
}

main().catch((e) => {
  console.error('❌ 抓取脚本异常：' + e.stack);
  process.exit(1);
});
