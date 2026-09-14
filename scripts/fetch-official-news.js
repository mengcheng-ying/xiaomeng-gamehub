#!/usr/bin/env node
/**
 * 三九互娱官方专区公告抓取（全量历史 + 每日增量）
 * ------------------------------------------------------------------
 * 数据来源：3975.com 系列官方专区（游戏发行方三九互娱的官方站点）
 * 输出：
 *   data/official-news.js    → const OFFICIAL_NEWS = { generatedAt, sourceNote, archives, games }
 *   data/news-history.json   → 每日快照，供日报做趋势对比
 *
 * 设计要点
 * - 翻页参数实测为 ?tid=0&page=N；翻到内容与前页重复即视为末页。
 * - 每个专区全量历史一次抓完（列表页很轻，约 11 条/页）。
 * - 详情页（正文摘要）**只抓没抓过的**：已有摘要从上次的 official-news.js 里继承，
 *   所以首次运行较慢（约 1000 次请求），之后每天只补新增的几条。
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

const MAX_SUMMARY = 160;      // 每条公告的正文摘要字数上限
const DELAY = 200;            // 请求间隔（ms）
const MAX_PAGES = 30;         // 单专区最多翻页数（防止死循环；部分专区历史长于此，会在日报里注明）
const MAX_DETAIL_PER_RUN = 1500; // 单次运行最多抓多少条详情（防跑飞）
const SAVE_EVERY = 120;       // 每抓 N 条详情落盘一次
// 只有这个日期之后的公告才去抓详情页摘要。更早的公告照常收录标题/日期/分类，
// 只是不再逐条请求详情页 —— 目的是把每天对官方站的请求量、以及归档页的重复内容密度压下来。
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
    const dm = plain.match(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/);
    if (dm) {
      date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
      plain = withSpace(plain.split(dm[0]).join(' '));
    } else {
      const dm2 = plain.match(/(?:^|\s)(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/);
      if (dm2) {
        const y = new Date().getFullYear();
        date = `${y}-${String(dm2[1]).padStart(2, '0')}-${String(dm2[2]).padStart(2, '0')}`;
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
    if (!validDate(date)) date = '';

    seen.add(href);
    out.push({ date, category, title, url: new URL(href, base).href });
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

/** 读回上一次的输出（用于继承摘要、判断新增） */
function loadPrev() {
  if (!fs.existsSync(OUT)) return null;
  try {
    const src = fs.readFileSync(OUT, 'utf8');
    const o = new Function(src + '\nreturn OFFICIAL_NEWS;')();
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
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

// ---------- 主流程 ----------
(async () => {
  const started = Date.now();
  console.log('开始抓取三九互娱官方专区公告（全量历史 + 增量补摘要）…\n');

  const prev = loadPrev();
  const prevArchives = (prev && prev.archives) || {};

  // 1) 先只用列表页把全部历史条目收集齐（很快）
  const archives = {};
  const listStats = [];
  for (const src of SOURCES) {
    const seen = new Map();
    let pages = 0;
    let lastSig = '';
    try {
      for (let p = 1; p <= MAX_PAGES; p++) {
        const r = await fetchUrl(`${src.base}/news/index?tid=0&page=${p}`);
        if (r.status !== 200) break;
        const html = r.buf.toString('utf8');
        const list = parseList(html, src.base);
        const sig = list.map((x) => x.url).join('|');
        if (!list.length || sig === lastSig) break;   // 内容重复 = 已到末页
        lastSig = sig;
        pages = p;
        for (const it of list) if (!seen.has(it.url)) seen.set(it.url, it);
        await sleep(DELAY);
      }
    } catch (e) {
      console.log(`⚠️  ${src.name}（${src.slug}）列表抓取失败：${e.message}`);
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

    const items = [...seen.values()].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    items.forEach((it) => { it.category = refineCategory(it.category, it.title); });

    archives[src.slug] = {
      slug: src.slug,
      site: src.base,
      official: `三九互娱《${src.name}》官方专区`,
      gameIds: src.gameIds,
      newsUrl: src.base + '/news/index',
      pages,
      items
    };
    listStats.push({ slug: src.slug, name: src.name, pages, total: items.length });
    console.log(`✅ ${src.name.padEnd(18)} 翻 ${String(pages).padStart(2)} 页 → 共 ${items.length} 条`);
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
        if (o) {
          if (!it.summary && o.summary) { it.summary = o.summary; inherited++; }
          if (!it.date && validDate(o.date)) it.date = o.date;
          if (!it.date && o.nd) it.nd = true;
        }
      }
    }
  }

  // 3) 需要抓详情页的条目：
  //    - 还没有摘要的（新公告）
  //    - 还没有日期的（个别专区列表页完全不给日期，只能从详情页提；抓过一次仍提不到就记 nd 标记，不再重试）
  //    - 已知日期且早于 SUMMARY_SINCE 的，跳过详情页，只保留标题/日期/分类
  const need = [];
  const skippedOld = [];
  for (const arc of Object.values(archives)) {
    for (const it of arc.items) {
      if (it.summary && (it.date || it.nd)) continue;
      if (it.date && it.date < SUMMARY_SINCE) { skippedOld.push(it); continue; }
      need.push(it);
    }
  }
  console.log(`摘要：继承 ${inherited} 条 | 需要新抓 ${need.length} 条 | 早于 ${SUMMARY_SINCE} 的 ${skippedOld.length} 条只收录标题与日期` + (need.length > MAX_DETAIL_PER_RUN ? `（本次上限 ${MAX_DETAIL_PER_RUN}，其余下次运行补齐）` : ''));
  console.log('');

  const todo = need.slice(0, MAX_DETAIL_PER_RUN);
  let fetched = 0, failed = 0;
  const snapshot = () => {
    const snapshotNow = new Date().toISOString();
    const games = {};
    for (const arc of Object.values(archives)) {
      for (const gid of arc.gameIds) {
        games[String(gid)] = { slug: arc.slug, official: arc.official, site: arc.site, newsUrl: arc.newsUrl, gameIds: arc.gameIds };
      }
    }
    writeOut({ generatedAt: snapshotNow, sourceNote: '数据来源：三九互娱官方专区（3975.com 系列站点）公开公告，自动同步', archives, games });
  };

  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    try {
      const d = await fetchUrl(it.url);
      if (d.status === 200) {
        const html = d.buf.toString('utf8');
        it.summary = extractSummary(html, it.title) || '';
        if (!it.date) {
          const dd = dateFromHtml(html);
          if (dd) it.date = dd; else it.nd = true;   // 提不到日期就记标记，不再重复请求
        }
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
    newSummaries: todo.length,
    skippedOld: skippedOld.length,
    pending: Math.max(0, need.length - todo.length)
  };
  hist.updatedAt = new Date().toISOString();
  fs.writeFileSync(HISTORY, JSON.stringify(hist, null, 2), 'utf8');

  console.log('\n—— 汇总 ——');
  console.log('专区数：' + Object.keys(archives).length);
  console.log('公告总条数：' + totalItems);
  console.log('本次新抓摘要：' + fetched + ' 条' + (failed ? '（失败 ' + failed + ' 条）' : ''));
  console.log('剩余待补摘要：' + Math.max(0, need.length - todo.length) + ' 条');
  console.log('耗时：' + Math.round((Date.now() - started) / 1000) + ' 秒');
  console.log('输出：' + OUT);
})().catch((e) => {
  console.error('❌ 抓取脚本异常：' + e.stack);
  process.exit(1);
});
