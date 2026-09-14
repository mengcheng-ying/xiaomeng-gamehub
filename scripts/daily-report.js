#!/usr/bin/env node
/**
 * 每日同步报告生成器
 * ------------------------------------------------------------------
 * 读取 data/official-news.js + data/news-history.json，生成当日同步报告：
 *   D:\腾讯网站部署\每日同步报告.html   ← 永远是最新一份
 *   D:\腾讯网站部署\每日报告\YYYY-MM-DD.html / .txt  ← 按日期归档
 *
 * 用法：
 *   node scripts/daily-report.js
 *   node scripts/daily-report.js --commit=abc1234 --live=ok --note="自由备注"
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = 'D:/腾讯网站部署';
const ARCHIVE_DIR = path.join(OUT_DIR, '每日报告');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (m) args[m[1]] = m[2];
});

function readJsObject(rel, keyword) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    const src = fs.readFileSync(p, 'utf8');
    return new Function(src + '\nreturn ' + keyword + ';')();
  } catch (e) { return null; }
}
function readJsArray(rel, keyword) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return [];
  try {
    const src = fs.readFileSync(p, 'utf8');
    const v = new Function(src + '\nreturn ' + keyword + ';')();
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

const NEWS = readJsObject('data/official-news.js', 'OFFICIAL_NEWS');
const GAMES = readJsArray('data/games.js', 'GAMES_DATA');
const HIST = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/news-history.json'), 'utf8')); } catch (e) { return {}; } })();

const gameById = {};
GAMES.forEach((g) => { gameById[g.id] = g; });

const now = new Date();
const bj = new Date(now.getTime() + 8 * 3600 * 1000); // 展示用北京时间
const today = bj.toISOString().slice(0, 10);
const stamp = bj.toISOString().slice(0, 16).replace('T', ' ');

const CATS = ['开服公告', '合服公告', '维护公告', '版本更新', '活动', '赛事', '攻略', '官方资讯'];

const archives = NEWS && NEWS.archives ? Object.values(NEWS.archives) : [];
const totalItems = archives.reduce((s, a) => s + a.items.length, 0);
const withSummary = archives.reduce((s, a) => s + a.items.filter((i) => i.summary).length, 0);

const catCount = {};
const catRecent = {};   // 近 7 天各分类
const weekAgo = new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10);
archives.forEach((a) => a.items.forEach((it) => {
  const c = CATS.includes(it.category) ? it.category : '官方资讯';
  catCount[c] = (catCount[c] || 0) + 1;
  if (it.date && it.date >= weekAgo) catRecent[c] = (catRecent[c] || 0) + 1;
}));

// 与上一次快照对比
const histDates = Object.keys(HIST).filter((k) => k !== 'updatedAt').sort();
const prevDate = histDates.filter((d) => d < today).pop();
const prev = prevDate ? HIST[prevDate] : null;
const prevTotal = prev ? prev.totalItems : null;
const delta = prevTotal == null ? null : totalItems - prevTotal;

// 各专区明细
const rows = archives.map((a) => {
  const names = [...new Set(a.gameIds.map((id) => (gameById[id] ? gameById[id].name : null)).filter(Boolean))];
  const name = names.join(' / ') || (a.official || '').replace(/^三九互娱《|》官方专区$/g, '');
  const dates = a.items.map((i) => i.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
  return {
    slug: a.slug, name, count: a.items.length,
    newest: a.items[0] ? a.items[0].date || '—' : '—',
    oldest: dates[0] || '—',
    newestTitle: a.items[0] ? a.items[0].title : '',
    site: a.newsUrl,
    recent: a.items.filter((i) => i.date && i.date >= weekAgo).length,
    summarized: a.items.filter((i) => i.summary).length
  };
}).sort((m, n) => n.count - m.count);

// sitemap 统计
let sitemapCount = 0;
try {
  sitemapCount = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>/g)].length;
} catch (e) { /* ignore */ }
// 本地页面文件数
const countFiles = (dir, ext) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).length; } catch (e) { return 0; } };
const nGames = countFiles('game', '.html');
const nArticles = countFiles('article', '.html');
const nNews = countFiles('news', '.html');

const status = {
  commit: args.commit || '',
  live: args.live || '',
  note: args.note || ''
};

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const summaryLine = delta == null
  ? `当前共收录 ${archives.length} 个官方专区、${totalItems} 条公告。这是首份报告，暂无对比基线。`
  : `本次同步：公告总数 ${totalItems} 条（较 ${prevDate} 的 ${prevTotal} 条${delta >= 0 ? ' 增加 ' + delta : ' 减少 ' + -delta} 条）。`;

const txt = [
  `小梦怀旧手游 · 每日同步报告（${today}）`,
  '='.repeat(52),
  `生成时间：${stamp}（北京时间）`,
  '',
  '【一句话结论】',
  summaryLine,
  '',
  '【官方公告收录】',
  `  官方专区数：${archives.length}`,
  `  公告总条数：${totalItems}`,
  `  其中带正文摘要：${withSummary} 条`,
  `  近 7 天新增公告：${archives.reduce((s, a) => s + a.items.filter((i) => i.date && i.date >= weekAgo).length, 0)} 条`,
  delta == null ? '  与上次对比：—（首份报告）' : `  与 ${prevDate} 对比：${delta >= 0 ? '+' : ''}${delta} 条`,
  '',
  '【分类分布】',
  ...CATS.filter((c) => catCount[c]).map((c) => `  ${c.padEnd(6)} ${String(catCount[c]).padStart(4)} 条（近 7 天 ${catRecent[c] || 0} 条）`),
  '',
  '【各专区明细】',
  '  ' + ['游戏', '条数', '近7天', '最新', '最早', '官方专区'].join('  |  '),
  ...rows.map((r) => `  ${r.name}  |  ${r.count}  |  ${r.recent}  |  ${r.newest}  |  ${r.oldest}  |  ${r.site}`),
  '',
  '【站点产出】',
  `  游戏独立页：${nGames} 个`,
  `  攻略页：${nArticles} 个`,
  `  公告归档页：${nNews + 1} 个（1 个总览 /news + ${nNews} 个专区页）`,
  `  sitemap 可索引 URL：${sitemapCount} 条`,
  status.commit ? `  本次推送 commit：${status.commit}` : '  本次推送 commit：（未记录）',
  status.live ? `  线上验证：${status.live === 'ok' ? '已生效' : status.live}` : '  线上验证：（未记录）',
  status.note ? `  备注：${status.note}` : '',
  '',
  '【需要你留意的三件事】',
  '  1) 百度主动推送配额很小（用户口径 10 条/天），而站点现有 URL 已有 ' + sitemapCount + ' 条。',
  '     若推送脚本每天固定从 sitemap 第一条开始推，后面的 URL 会长期推不到 —— 这个已单独说明。',
  '  2) 公告内容为「标题 + 日期 + 分类 + 摘要 + 指向官方原文的 nofollow 链接」，不是全文转载；',
  `     其中 ${totalItems - withSummary} 条（较早的历史公告）只有标题与日期，没有摘要。`,
  '  3) 未做核实的事项：百度推送每日配额的具体数值（只能确认"会耗尽"，无法读到总量），',
  '     以及 41 款游戏中 29 款无法查到官方来源的游戏其版号状态。',
  ''
].filter((l) => l !== null).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>每日同步报告 ${today}</title>
<style>
:root{--ink:#16213c;--ink2:#33405f;--muted:#7b879e;--line:#e5eaf3;--brand:#2f6bff;--brand-soft:#eef3ff;--card:#fff;--bg:#f6f8fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:24px;margin:0 0 6px}
.sub{color:var(--muted);font-size:13px;margin-bottom:22px}
h2{font-size:17px;margin:30px 0 12px;padding-bottom:8px;border-bottom:2px solid var(--line)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:14px}
.lead{font-size:16px;font-weight:600;color:var(--ink);margin:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:6px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.kpi .n{font-size:26px;font-weight:700;color:var(--brand);font-variant-numeric:tabular-nums}
.kpi .l{font-size:13px;color:var(--muted);margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
th{background:var(--brand-soft);color:var(--ink2);font-weight:600;font-size:13px}
tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.warn{background:#fff8e6;border:1px solid #ffe1a8;border-radius:12px;padding:16px 20px}
.warn ol{margin:8px 0 0;padding-left:22px}
.warn li{margin-bottom:8px}
.foot{color:var(--muted);font-size:12px;margin-top:30px;text-align:center}
.badge{display:inline-block;font-size:12px;padding:2px 9px;border-radius:99px;background:var(--brand-soft);color:var(--brand);margin-left:8px}
</style></head>
<body><div class="wrap">
<h1>每日同步报告<span class="badge">${today}</span></h1>
<div class="sub">小梦怀旧手游 · fmbly.com &nbsp;|&nbsp; 生成于 ${stamp}（北京时间）</div>

<div class="card"><p class="lead">${esc(summaryLine)}</p></div>

<h2>官方公告收录</h2>
<div class="kpis">
  <div class="kpi"><div class="n">${archives.length}</div><div class="l">官方专区数</div></div>
  <div class="kpi"><div class="n">${totalItems}</div><div class="l">公告总条数</div></div>
  <div class="kpi"><div class="n">${withSummary}</div><div class="l">带正文摘要</div></div>
  <div class="kpi"><div class="n">${archives.reduce((s, a) => s + a.items.filter((i) => i.date && i.date >= weekAgo).length, 0)}</div><div class="l">近 7 天新增</div></div>
  <div class="kpi"><div class="n">${delta == null ? '—' : (delta >= 0 ? '+' + delta : delta)}</div><div class="l">较上次变化</div></div>
</div>

<h2>分类分布</h2>
<table><tr><th>分类</th><th>条数</th><th>近 7 天</th></tr>
${CATS.filter((c) => catCount[c]).map((c) => `<tr><td>${esc(c)}</td><td class="num">${catCount[c]}</td><td class="num">${catRecent[c] || 0}</td></tr>`).join('\n')}
</table>

<h2>各专区明细</h2>
<table><tr><th>游戏</th><th>条数</th><th>近 7 天</th><th>最新</th><th>最早</th><th>官方专区</th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.count}</td><td class="num">${r.recent}</td><td class="num">${esc(r.newest)}</td><td class="num">${esc(r.oldest)}</td><td><a href="${esc(r.site)}" target="_blank" rel="noopener">官方公告列表 ↗</a></td></tr>`).join('\n')}
</table>

<h2>站点产出</h2>
<table>
<tr><th>项目</th><th>数量 / 状态</th></tr>
<tr><td>游戏独立页 <code>/game/N</code></td><td class="num">${nGames} 个</td></tr>
<tr><td>攻略页 <code>/article/N</code></td><td class="num">${nArticles} 个</td></tr>
<tr><td>公告归档页 <code>/news</code> 与 <code>/news/&lt;专区&gt;</code></td><td class="num">${nNews + 1} 个</td></tr>
<tr><td>sitemap 可索引 URL</td><td class="num">${sitemapCount} 条</td></tr>
<tr><td>本次推送 commit</td><td>${esc(status.commit || '（未记录）')}</td></tr>
<tr><td>线上验证</td><td>${esc(status.live === 'ok' ? '已生效' : status.live || '（未记录）')}</td></tr>
${status.note ? `<tr><td>备注</td><td>${esc(status.note)}</td></tr>` : ''}
</table>

<h2>需要你留意</h2>
<div class="warn"><ol>
<li><strong>百度主动推送的配额比站点 URL 数量少一个数量级</strong>（口径 10 条/天，站点已有 ${sitemapCount} 条 URL）。
如果推送脚本每天固定从 sitemap 第一条开始推，位置靠后的 URL 会长期推不到。</li>
<li>公告内容为「标题 + 日期 + 分类 + 摘要 + 指向官方原文的 nofollow 链接」，<strong>不是全文转载</strong>；
其中 ${totalItems - withSummary} 条较早的历史公告只有标题与日期，没有摘要。</li>
<li><strong>未核实事项</strong>：百度推送每日配额的具体数值（能确认会耗尽，读不到总量）；
29 款查不到官方来源的游戏，其版号状态未逐款核实。</li>
</ol></div>

<div class="foot">本报告由 scripts/daily-report.js 自动生成 · 数据来源：三九互娱官方专区（3975.com）公开公告</div>
</div></body></html>`;

// ---------- 输出 ----------
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(OUT_DIR);
ensureDir(ARCHIVE_DIR);

const write = (p, c) => { fs.writeFileSync(p, c, 'utf8'); return p; };
const outs = [];
outs.push(write(path.join(OUT_DIR, '每日同步报告.html'), html));
outs.push(write(path.join(ARCHIVE_DIR, today + '.html'), html));
outs.push(write(path.join(ARCHIVE_DIR, today + '.txt'), txt));
outs.push(write(path.join(OUT_DIR, '每日同步报告.txt'), txt));

console.log('✅ 每日报告已生成：');
outs.forEach((o) => console.log('   ' + o));
console.log('');
console.log(summaryLine);
