#!/usr/bin/env node
/**
 * 从三九互娱官方专区（3975.com 系列）抓取各游戏最新官方公告
 * 输出 data/official-news.js（const OFFICIAL_NEWS = {...}）
 *
 * 为什么只抓这些游戏：只有这些游戏在官方站点（3975.com）有真实专区，
 * 其余渠道包游戏的"官网"均为推广站 / AI 采集内容站，不属于可查证的官方来源，故不收录。
 *
 * 用法：node scripts/fetch-official-news.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'official-news.js');
const MAX_ITEMS = 8;      // 每款游戏最多收录的公告条数
const MAX_SUMMARY = 160;  // 每条公告的正文摘要字数上限
const DELAY = 250;        // 请求间隔（ms），避免给官方站压力

// gameId → 官方专区（gameId 对应 data/games.js 的 id）
const SOURCES = [
  { gameId: 46, base: 'https://jz.3975.com', official: '三九互娱《机战：钢铁巨舰》官方专区' },
  { gameId: 1,  base: 'https://dn.3975.com', official: '三九互娱《龙之谷：启程》官方专区' },
  { gameId: 2,  base: 'https://mxq.3975.com', official: '三九互娱《墨香情》官方专区' },
  { gameId: 21, base: 'https://wlwz.3975.com', official: '三九互娱《武林外传：十年之约》官方专区' },
  { gameId: 14, base: 'https://jzpx.3975.com', official: '三九互娱《决战破晓》官方专区' },
  { gameId: 42, base: 'https://fgcs.3975.com', official: '三九互娱《复古传世-金装裁决》官方专区' },
  { gameId: 4,  base: 'https://ff.3975.com', official: '三九互娱《飞飞：重逢》官方专区' },
  { gameId: 23, base: 'https://ff.3975.com', official: '三九互娱《飞飞：重逢》官方专区' },
  { gameId: 32, base: 'https://xmsl.3975.com', official: '三九互娱《寻梦丝路》官方专区' },
  { gameId: 7,  base: 'https://qn.3975.com', official: '三九互娱《千年盛世》官方专区' },
  { gameId: 40, base: 'https://qn.3975.com', official: '三九互娱《千年盛世》官方专区' },
  { gameId: 44, base: 'http://rxcs.3975.com', official: '三九互娱《热血传说-复古传奇》官方专区' }
];

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

/** 从列表页解析公告条目（各专区模板不同，日期统一从纯文本里提取） */
function parseList(html, base) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']*\/news\/newsdetail[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (seen.has(href)) continue;
    if (/newsdetailwap/i.test(href)) continue; // 移动版重复项

    let plain = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    // 发布日期：优先「2026-09-12」这种完整格式（标题里的「9月13日」不会误伤）
    let date = '';
    const dm = plain.match(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/);
    if (dm) {
      date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
      plain = plain.split(dm[0]).join(' ').replace(/\s+/g, ' ').trim();
    } else {
      const dm2 = plain.match(/(?:^|\s)(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/);
      if (dm2) {
        const y = new Date().getFullYear();
        date = `${y}-${String(dm2[1]).padStart(2, '0')}-${String(dm2[2]).padStart(2, '0')}`;
        plain = plain.split(dm2[0].trim()).join(' ').replace(/\s+/g, ' ').trim();
      }
    }

    // 分类：优先标题前缀（如「新闻 【语音功能上线】…」），其次开头的【】标记
    let category = '';
    const leadM = plain.match(/^(公告|新闻|活动|赛事|攻略|版本|资讯|前瞻)\s+(\S[\s\S]{3,})$/);
    if (leadM) {
      category = leadM[1];
      plain = leadM[2].trim();
    } else {
      const catM = plain.match(/^[-–—·•\s]*【([^】]{1,10})】\s*/);
      if (catM) {
        category = catM[1].trim();
        plain = plain.slice(catM[0].length).trim();
      }
    }

    const title = plain.replace(/^[-–—·•\s]+/, '').trim();
    if (!title || title.length < 4) continue;

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
  if (/更新公告|版本更新|更新预告|版本前瞻|上新/.test(title)) return '版本更新';
  if (/赛事|比赛|竞技|天梯|争霸|大会|对决|争锋/.test(title)) return '赛事';
  if (/活动|福利|礼包|签到|投稿|招募|征集|竞猜|庆典|节日|回馈|限时/.test(title)) return '活动';
  if (/教师节|中秋节|国庆|春节|端午|元宵|七夕|万圣|圣诞|元旦|周年庆|开学季/.test(title)) return '活动';
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
  const skipRe = /^(首页|新闻资讯|游戏攻略|游戏预约|前往论坛|交易平台|客服中心|游戏资讯|NEWS|您的当前位置|您当前所在位置|当前位置|App Store|下载|安卓下载|请扫码下载体验游戏|上一篇|下一篇|相关阅读|热门推荐|返回列表|分享到|更多|上一篇：|下一篇：)/;
  // 侧栏/推荐位噪音（会混进正文，必须剔除）；只列明确的栏目名，避免误杀正文
  const noiseRe = /职业介绍之|职业攻略之|猜你喜欢|关注公众号|扫码关注|扫码下载/;
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
    // 页脚版权 / 备案信息
    if (/版权所有|ICP备|备案号|网络文化经营|增值电信|健康游戏忠告|抵制不良游戏|适龄提示|举报电话|纠纷处理/.test(l)) continue;
    body.push(l);
    if (body.join('').length > MAX_SUMMARY * 1.8) break;
  }
  let s = body.join(' ').replace(/\s+/g, ' ').trim();
  // 部分专区的侧栏会排在正文之前，以「XX运营团队」署名作为正文起点
  const tm = s.match(/[\u4e00-\u9fa5A-Za-z0-9《》：:]{2,30}运营团队\s*/);
  if (tm && tm.index <= 120) s = s.slice(tm.index + tm[0].length).trim();
  if (s.length > MAX_SUMMARY) s = s.slice(0, MAX_SUMMARY) + '…';
  return s;
}

(async () => {
  console.log('开始抓取三九互娱官方专区公告…\n');
  const result = {};
  let totalItems = 0;

  for (const src of SOURCES) {
    const key = String(src.gameId);
    try {
      const listRes = await fetchUrl(src.base + '/news/index');
      if (listRes.status !== 200) throw new Error('HTTP ' + listRes.status);
      const html = listRes.buf.toString('utf8');
      let items = parseList(html, src.base);

      const byDateDesc = (a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      };

      // 少数专区（如热血传说系）列表页不给日期，只能先抓详情再排序
      const dateFromDetail = items.length > 0 && items.every((it) => !it.date);
      items = dateFromDetail ? items.slice(0, MAX_ITEMS + 4) : items.sort(byDateDesc).slice(0, MAX_ITEMS);

      for (const it of items) {
        it.category = it.category || classify(it.title);
        await sleep(DELAY);
        try {
          const d = await fetchUrl(it.url);
          if (d.status === 200) {
            const dHtml = d.buf.toString('utf8');
            it.summary = extractSummary(dHtml, it.title);
            if (!it.date) {
              // 从详情页全文本兜底提取发布日期
              const plainAll = dHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
              const dm = plainAll.match(/(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
              if (dm) it.date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
            }
          }
        } catch (e) {
          it.summary = '';
        }
      }
      if (dateFromDetail) items = items.sort(byDateDesc).slice(0, MAX_ITEMS);

      if (result[key]) {
        // 同一游戏（同专区）重复配置时合并去重
        const seen = new Set(result[key].items.map((x) => x.url));
        items.forEach((x) => { if (!seen.has(x.url)) result[key].items.push(x); });
        result[key].items.sort((a, b) => (a.date < b.date ? 1 : -1));
      } else {
        result[key] = {
          gameId: src.gameId,
          official: src.official,
          site: src.base,
          newsUrl: src.base + '/news/index',
          items
        };
      }
      totalItems += items.length;
      console.log(`✅ ${src.official}  —— 收录 ${items.length} 条` + (items[0] ? `（最新 ${items[0].date} ${items[0].title.slice(0, 22)}）` : ''));
    } catch (e) {
      console.log(`⚠️  ${src.official} 抓取失败：${e.message}（保留原有数据）`);
      if (!result[key] && fs.existsSync(OUT)) {
        try {
          const oldSrc = fs.readFileSync(OUT, 'utf8');
          const old = new Function(oldSrc + '\nreturn OFFICIAL_NEWS;')();
          if (old && old.games && old.games[key]) result[key] = old.games[key];
        } catch (e2) { /* 旧数据不可用时忽略 */ }
      }
    }
    await sleep(DELAY);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceNote: '数据来源：三九互娱官方专区（3975.com 系列站点）公开公告，自动同步',
    count: Object.keys(result).length,
    games: result
  };

  const banner = [
    '// ⚠️ 本文件由 scripts/fetch-official-news.js 自动生成，请勿手工编辑',
    '// 数据来源：三九互娱官方专区（3975.com 系列站点）公开公告',
    '// 最后同步：' + payload.generatedAt,
    ''
  ].join('\n');

  fs.writeFileSync(OUT, banner + 'const OFFICIAL_NEWS = ' + JSON.stringify(payload, null, 2) + ';\n', 'utf8');

  console.log('\n—— 汇总 ——');
  console.log('覆盖游戏数：' + payload.count);
  console.log('公告总条数：' + totalItems);
  console.log('输出文件：' + OUT);
})().catch((e) => {
  console.error('❌ 抓取脚本异常：' + e.message);
  process.exit(1);
});
