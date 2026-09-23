/**
 * 小梦怀旧手游 静态页预渲染构建脚本
 * -------------------------------------------------
 * 目的：解决 SPA + hash 路由导致页面无法被搜索引擎收录的问题。
 * 为 data/articles.js 的每篇攻略、data/games.js 的每款游戏
 * 生成独立的、服务端渲染完成的静态 HTML，正文直接烘焙进 HTML，
 * 爬虫无需执行 JS 即可读取完整内容。
 *
 * 本脚本产出：
 *   1) article/{id}.html  —— 每篇攻略一个静态页（干净简洁版式 + 文末返回首页按钮）
 *   2) game/{id}.html     —— 每款游戏一个独立页（官方信息 / 下载入口 / 相关攻略）
 *   3) guides.html        —— 全站攻略索引（按游戏分组）
 *   4) games.html         —— 全部游戏索引（可进入游戏独立页）
 *   5) 404.html           —— 真正的 404 页面
 *   6) sitemap.xml        —— 只含可索引的真实 URL（去掉 # 锚点）
 *   7) index.html         —— 更新 <!-- SEO-LINKS:START --> 区块
 *
 * ⚠️ 铁律：本脚本【绝不修改】任何推广跳转链接。
 *    游戏下载地址一律直接取自 data/games.js 的 url / androidUrl / iosUrl，
 *    原样输出，不做任何拼接、转码或改写。
 *
 * 用法：node scripts/build-articles.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://fmbly.com';
const OUT_DIR = path.join(ROOT, 'article');
const GAME_DIR = path.join(ROOT, 'game');
const TODAY = new Date().toISOString().slice(0, 10);

// ===== 1. 解析数据文件（自维护数据，使用 Function 取值） =====
function extractBalanced(src, keyword, openCh, closeCh) {
  const start = src.indexOf(keyword);
  if (start === -1) throw new Error('找不到 ' + keyword);
  const open = src.indexOf(openCh, start);
  if (open === -1) throw new Error(keyword + ' 后找不到 ' + openCh);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(keyword + ' 括号未闭合');
  return src.slice(open, end + 1);
}

function loadJsArray(rel, keyword) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function('return (' + extractBalanced(src, keyword, '[', ']') + ');')();
}

// 可选的数据文件：不存在时返回 {}，不影响主流程
function loadJsObjectSafe(rel, keyword) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return {};
  try {
    const src = fs.readFileSync(full, 'utf8');
    // eslint-disable-next-line no-new-func
    return new Function('return (' + extractBalanced(src, keyword, '{', '}') + ');')();
  } catch (e) {
    console.log('⚠️  ' + rel + ' 解析失败，已忽略：' + e.message);
    return {};
  }
}

const articles = loadJsArray('data/articles.js', 'ARTICLES_DATA');
const games = loadJsArray('data/games.js', 'GAMES_DATA');
// 福利礼包/兑换码（可选，活动时效内容；缺失或为空时礼包页降级）
let gifts = [];
try { gifts = loadJsArray('data/gifts.js', 'GIFTS_DATA'); }
catch (e) { console.log('⚠️  data/gifts.js 缺失或解析失败，礼包页跳过：' + e.message); }
// 攻略加厚内容（可选增量文件）：{ 文章id: '<h2>…</h2><p>…</p>' }
const guideExtra = loadJsObjectSafe('data/guide-extra.js', 'GUIDE_EXTRA');
// 攻略进阶问答（可选增量文件，追加在 guide-extra 之后）：{ 文章id: '<h2>…</h2><p>…</p>' }
const guideFaq = loadJsObjectSafe('data/guide-faq.js', 'GUIDE_FAQ');
// 游戏页补充资料（可选）：{ 游戏id: { facts:[{k,v}], intro:'…', highlights:['…'] } }
const gameExtra = loadJsObjectSafe('data/game-extra.js', 'GAME_EXTRA');
// 官方动态（由 scripts/fetch-official-news.js 自动同步，来源：三九互娱官方专区）
// 结构：{ generatedAt, games: { 游戏id: { official, site, newsUrl, items:[{date,category,title,url,key,summary}] } } }
const officialNews = loadJsObjectSafe('data/official-news.js', 'OFFICIAL_NEWS');

// 官方公告正文（由 scripts/fetch-official-news.js 自动同步）：{ <key>: [段落, …] }
// 用途：为每条公告生成站内独立页，使全站不再出现指向外部站点的链接。
// 用整文件 Function 求值 —— 正文里可能出现花括号，靠括号配对解析会失败。
const newsBodies = (() => {
  const full = path.join(ROOT, 'data', 'news-bodies.js');
  if (!fs.existsSync(full)) return {};
  try {
    const src = fs.readFileSync(full, 'utf8');
    // eslint-disable-next-line no-new-func
    const o = new Function(src + '\nreturn NEWS_BODIES;')();
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    console.log('⚠️  data/news-bodies.js 解析失败：' + e.message);
    return {};
  }
})();

// 精选资讯 · 编辑专题（手维护，见 data/editorials.js）：[{ slug, title, date, category, summary, cover, content }]
// 用途：为每条生成 /news/feature/<slug>.html 静态专题页，并在资讯中心置顶展示，供搜索引擎收录。
const editorials = (() => {
  try { return loadJsArray('data/editorials.js', 'FEATURES_DATA'); }
  catch (e) { console.log('⚠️  data/editorials.js 读取失败(忽略)：' + e.message); return []; }
})();

/**
 * 公告条目的站内地址。
 * 有正文 → /news/<专区>/<key>（本站独立页）；没有正文 → 返回 null，
 * 调用方必须渲染成不可点击的纯文本，**绝不回退到官方站外链**。
 */
function newsHref(slug, it) {
  if (!it || !it.key) return null;
  const b = newsBodies[it.key];
  return b && b.length ? '/news/' + slug + '/' + it.key : null;
}
function newsTitleHtml(slug, it) {
  const href = newsHref(slug, it);
  return href ? `<a href="${href}">${esc(it.title)}</a>` : `<span class="nt">${esc(it.title)}</span>`;
}

const gameById = {};
games.forEach(g => { gameById[g.id] = g; });

// 2026-09-21：用户投放的 28 张游戏宣传图（按 slug 归组），落地到对应 /game/<id> 页「精彩图集」。
const ART_GAMES = { longzhigu: 1, xingchenbian: 3, juezhan: 14, wulin: 21, xiuxianjiazu: 36, rxjianghu: 45 };
function artImagesForGame(gid) {
  const slug = Object.keys(ART_GAMES).find(k => ART_GAMES[k] === gid);
  if (!slug) return [];
  const dir = path.join(ROOT, 'assets', 'images', 'art');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(slug + '-') && f.endsWith('.jpg'))
    .sort()
    .map(f => 'assets/images/art/' + f);
}

// ===== 2. 工具 =====
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 正文内相对资源路径从站点根 -> 当前子目录
function fixRel(src, prefix) {
  const p = prefix || '../';
  return String(src || '')
    .replace(/src=["']assets\//g, 'src="' + p + 'assets/')
    .replace(/href=["']assets\//g, 'href="' + p + 'assets/');
}

// 读取图片真实尺寸，用于给 <img> 补 width/height（消除累积布局偏移 CLS）
function imageSize(rootRel) {
  try {
    const clean = String(rootRel).replace(/^\.\.\//, '');
    const buf = fs.readFileSync(path.join(ROOT, clean));
    if (buf[0] === 0xFF && buf[1] === 0xD8) {           // JPEG
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    } else if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fourcc = buf.toString('ascii', 12, 16);
      if (fourcc === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (fourcc === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
      if (fourcc === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 };
      }
    } else if (buf[0] === 0x89 && buf[1] === 0x50) {     // PNG
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
  } catch (e) { /* 图片不存在时忽略 */ }
  return null;
}

function sizeAttrs(rootRel) {
  const d = imageSize(rootRel);
  return d ? ` width="${d.w}" height="${d.h}"` : '';
}

// ===== 3. 全站统一版式（干净简洁） =====
const BASE_CSS = `
  :root{
  /* 2026-09-21：实心按钮专用底色。--brand(#5b8cff) 配白字只有 3.16:1，
     低于 WCAG AA 的 4.5:1；加深到 #3d6fe0 后为 4.69:1，色相不变。 */
  --brand-deep:#3d6fe0;--ink:#eef2f7;--ink2:#c6d0e2;--muted:#9aa7ba;--line:rgba(255,255,255,.1);--brand:#5b8cff;--brand-soft:rgba(91,140,255,.14);--accent:#f5b50a;--bg:#0b101a;--card:#16202f}
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}
  a{text-decoration:none;color:var(--brand)}
  img{max-width:100%}
  .topbar{position:sticky;top:0;z-index:100;background:rgba(11,16,26,.92);backdrop-filter:saturate(180%) blur(8px);
    border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:13px 20px}
  .brand{font-weight:700;color:var(--brand);letter-spacing:.5px;font-size:16px}
  .nav{display:flex;gap:20px}
  .nav a{color:var(--ink2);font-size:14px}
  .nav a:hover{color:var(--brand)}
  .wrap{max-width:46rem;margin:0 auto;padding:34px 20px 64px}
  .wrap.wide{max-width:1040px}
  .crumb{font-size:13px;color:var(--muted);margin-bottom:20px}
  .crumb a{color:var(--muted);padding:8px 6px;margin:-8px -6px;display:inline-block}
  .crumb a:hover{color:var(--brand)}
  .crumb i{font-style:normal;margin:0 7px;opacity:.55}
  .tag{display:inline-block;font-size:12px;font-weight:600;color:#241a00;background:var(--accent);border-radius:99px;padding:3px 12px;margin-bottom:14px}
  h1.ttl{font-size:29px;line-height:1.4;font-weight:700;margin:0 0 14px;letter-spacing:-.2px}
  .meta{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px 18px;padding-bottom:20px;margin-bottom:26px;border-bottom:1px solid var(--line)}
  .cover{width:100%;height:auto;display:block;border-radius:12px;margin:0 0 28px;background:#1a2537;box-shadow:0 6px 22px rgba(0,0,0,.3)}

  /* ===== 正文排版 ===== */
  .body{font-size:16.5px;line-height:1.95;color:var(--ink2);word-break:break-word}
  .body p{margin:0 0 18px}
  .body h2{font-size:21px;line-height:1.5;font-weight:700;color:var(--ink);margin:40px 0 16px;padding-left:13px;border-left:4px solid var(--brand)}
  .body h2:first-child{margin-top:0}
  .body h3{font-size:17.5px;line-height:1.6;font-weight:600;color:var(--ink);margin:28px 0 12px}
  .body h4{font-size:16px;font-weight:600;color:var(--ink2);margin:22px 0 10px}
  .body ul,.body ol{margin:0 0 18px;padding-left:22px}
  .body li{margin-bottom:8px}
  .body strong{color:var(--ink);font-weight:700}
  .body em{font-style:normal;color:var(--brand);font-weight:600}
  .body blockquote{margin:0 0 20px;padding:14px 18px;background:var(--brand-soft);border-left:3px solid var(--brand);border-radius:0 8px 8px 0;color:var(--ink2);font-size:15.5px}
  .body blockquote p:last-child{margin-bottom:0}
  .body table{width:100%;border-collapse:collapse;margin:0 0 22px;font-size:15px;display:block;overflow-x:auto}
  .body th,.body td{border:1px solid var(--line);padding:10px 13px;text-align:left;white-space:nowrap}
  .body th{background:#1c2333;font-weight:600;color:var(--ink)}
  .body tr:nth-child(even) td{background:rgba(255,255,255,.025)}
  .body img{display:block;width:100%;height:auto;border-radius:10px;margin:26px 0;background:#1a2537}
  .body figure{margin:26px 0}
  .body figure img{margin:0}
.body img.wxemoji{display:inline-block;width:1.5em;height:1.5em;vertical-align:-.3em;margin:0 3px;border-radius:5px;background:transparent}
  .body figcaption{font-size:13px;color:var(--muted);text-align:center;margin-top:10px}
  .body hr{border:none;border-top:1px solid var(--line);margin:34px 0}

  /* ===== 文末返回首页按钮 ===== */
  .cta{margin:44px 0 0;padding:26px 22px;text-align:center;background:linear-gradient(135deg,#16223a,#111a2b);
    border:1px solid rgba(91,140,255,.22);border-radius:14px}
  .cta p{margin:0 0 16px;font-size:15px;color:var(--ink2)}
  .cta-btn{display:inline-block;font-size:15px;font-weight:600;color:#fff!important;background:var(--brand-deep);
    padding:12px 30px;border-radius:99px;box-shadow:0 6px 18px rgba(91,140,255,.28);transition:transform .15s,box-shadow .15s}
  .cta-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(91,140,255,.34)}

  /* ===== 文末游戏下载卡（攻略页） ===== */
  .dlcard{display:flex;gap:18px;text-align:left;align-items:center;padding:20px}
  .dlc-pic{flex:0 0 120px;width:120px;height:120px;border-radius:12px;overflow:hidden;display:block;background:#1a2537}
  .dlc-pic img{width:100%;height:100%;object-fit:cover;display:block}
  .dlc-info{flex:1;min-width:0}
  .dlc-t{font-size:17px;font-weight:700;color:var(--ink);margin-bottom:6px}
  .dlc-d{font-size:14px;color:var(--ink2);margin:0 0 14px;line-height:1.6}
  .dlc-info .dl{margin-bottom:12px}
  .dlc-more{font-size:13px;color:var(--brand)}
  .dlc-more:hover{text-decoration:underline}
  .cta-back{margin:12px 0 0;font-size:13px}
  .cta-back a{color:var(--muted)}
  @media(max-width:520px){.dlcard{flex-direction:column;align-items:flex-start}.dlc-pic{flex:none;width:100%;height:auto;aspect-ratio:16/10}}

  /* ===== 福利礼包中心（/gift） ===== */
  .gift-notice{background:rgba(245,181,10,.1);border:1px solid rgba(245,181,10,.25);color:var(--ink2);padding:10px 14px;border-radius:10px;font-size:13px;margin:4px 0 8px}
  .gift-sec{margin-bottom:30px}
  .gift-sec .sec-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .gift-tag{font-size:12px;font-weight:700;color:#f5b50a;background:rgba(245,181,10,.14);padding:2px 9px;border-radius:6px;border:1px solid rgba(245,181,10,.3)}
  .gift-game-link{font-size:13px;font-weight:400;color:var(--brand);margin-left:auto}
  .gift-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
  .gift-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .gift-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
  .gift-name{font-size:15px;font-weight:700;color:var(--ink)}
  .gift-period{font-size:12px;color:var(--muted)}
  .gift-code{font-family:Consolas,Monaco,monospace;font-size:19px;font-weight:700;color:#00d4ff;letter-spacing:1px;background:rgba(0,212,255,.08);border:1px dashed rgba(0,212,255,.35);border-radius:8px;padding:9px 12px;text-align:center;margin-bottom:9px;word-break:break-all;user-select:all}
  .gift-copy{display:block;width:100%;font-size:14px;font-weight:600;color:#fff;background:var(--brand-deep);border:none;border-radius:99px;padding:10px;cursor:pointer;margin-bottom:10px;transition:transform .15s}
  .gift-copy:active{transform:scale(.97)}
  .gift-items{font-size:13px;color:var(--ink2);line-height:1.7}
  @media(max-width:560px){.gift-grid{grid-template-columns:1fr}}

  /* ===== 相关阅读 ===== */
  .sec-h{font-size:19px;font-weight:700;margin:46px 0 16px;color:var(--ink)}
  .rel{display:grid;grid-template-columns:1fr;gap:10px}
  .rel a{display:flex;align-items:center;gap:11px;padding:14px 16px;min-height:48px;border:1px solid var(--line);border-radius:10px;
    background:var(--card);color:var(--ink);transition:box-shadow .18s,border-color .18s}
  .rel a:hover{border-color:rgba(91,140,255,.5);box-shadow:0 4px 16px rgba(0,0,0,.3)}
  .rel .cat{flex:none;font-size:11px;font-weight:600;color:#fff;background:var(--brand-deep);border-radius:5px;padding:2px 9px}
  .rel .nm{font-size:15px;font-weight:600;line-height:1.6}

  /* ===== 游戏页 ===== */
  .ghero{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap;margin-bottom:28px}
  .ghero .pic{flex:none;width:210px;border-radius:12px;overflow:hidden;background:#1a2537;box-shadow:0 6px 22px rgba(0,0,0,.32)}
  .ghero .pic img{display:block;width:100%;height:auto}
  .ghero .info{flex:1;min-width:230px}
  .ghero h1{font-size:27px;margin:0 0 10px}
  .ghero .sub{font-size:14px;color:var(--ink2);margin-bottom:14px}
  .score{font-size:14px;color:var(--accent);font-weight:700;margin-bottom:16px}
  .dl{display:flex;gap:12px;flex-wrap:wrap}
  .dl a{display:inline-block;font-size:15px;font-weight:600;color:#fff!important;padding:11px 26px;border-radius:99px;transition:transform .15s}
  .dl a:hover{transform:translateY(-2px)}
  .dl .and{background:#376ee4;box-shadow:0 6px 16px rgba(61,123,255,.32)}
  .dl .ios{background:#1d2a3d;box-shadow:0 6px 16px rgba(0,0,0,.32)}
  .facts{width:100%;border-collapse:collapse;margin:4px 0 30px;font-size:15px}
  .facts th,.facts td{border:1px solid var(--line);padding:11px 14px;text-align:left}
  .facts th{background:#1c2333;width:118px;font-weight:600;color:var(--ink)}
  .facts td{color:var(--ink2)}
  .prose{font-size:16px;line-height:1.95;color:var(--ink2);margin-bottom:30px}
  .prose p{margin:0 0 16px}
  .hl{margin:0 0 30px;padding:0;list-style:none}
  .news-src{font-size:13px;color:var(--muted);margin:-4px 0 16px;line-height:1.7}
  .news-src a{color:var(--brand)}
  .news{list-style:none;margin:0 0 30px;padding:0}
  .news li{padding:15px 0;border-bottom:1px solid var(--line)}
  .news li:first-child{padding-top:0}
  .news li:last-child{border-bottom:0;padding-bottom:6px}
  .news .nh{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .news .nd{font-size:13px;color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums}
  .news .nc{font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;background:var(--brand-soft);color:var(--brand);flex-shrink:0}
  .news .nh a{font-weight:600;color:var(--ink);font-size:15px;line-height:1.6}
  .news .nh a:hover{color:var(--brand)}
  .news .ns{margin:7px 0 0;font-size:14px;line-height:1.75;color:var(--ink2)}
  .news .nt{font-weight:600;color:var(--ink);font-size:15px;line-height:1.6}
  /* ===== 公告正文页 ===== */
  .nitem .nmeta{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px 18px;padding-bottom:18px;margin-bottom:24px;border-bottom:1px solid var(--line)}
  .nitem .body{font-size:16px;line-height:1.9}
  .nitem .body p{margin:0 0 12px}
  .nitem .body h3{margin:22px 0 10px}
  .src-note{margin:32px 0 0;padding:14px 16px;background:#141d2e;border:1px solid rgba(91,140,255,.16);border-radius:10px;font-size:13px;line-height:1.8;color:var(--ink2)}
  .pn{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0 0}
  .pn a{flex:1;min-width:240px;padding:13px 16px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
  .pn a:hover{border-color:rgba(91,140,255,.5);box-shadow:0 4px 16px rgba(0,0,0,.3)}
  .pn .k{display:block;font-size:11px;color:var(--muted);margin-bottom:5px}
  .pn .v{font-size:14.5px;font-weight:600;line-height:1.6}
  .lst .sm{display:block;font-size:12.5px;color:var(--muted);margin-top:4px}
  /* 公告归档页 */
  .acards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:0 0 30px}
  .acard{border:1px solid var(--line);border-radius:11px;background:var(--card);padding:16px 18px;display:block;color:var(--ink)}
  .acard:hover{box-shadow:0 6px 20px rgba(0,0,0,.34)}
  .acard .an{font-weight:700;font-size:16px;margin-bottom:6px}
  .acard .am{font-size:13px;color:var(--muted)}
  .catnav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
  .catnav a{font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:99px;color:var(--ink2);background:var(--card)}
  .catnav a:hover{border-color:var(--brand);color:var(--brand)}
  .cathd{margin:30px 0 4px;font-size:17px;font-weight:700;padding-bottom:8px;border-bottom:2px solid var(--line)}
  .cathd .cn{font-size:13px;font-weight:400;color:var(--muted);margin-left:8px}
  .hl li{position:relative;padding-left:24px;margin-bottom:10px;font-size:15.5px;color:var(--ink2)}
  .hl li:before{content:"◆";position:absolute;left:0;top:0;color:var(--brand);font-size:12px}
  /* ===== 同类推荐 / 瓦片网格（游戏页「同类怀旧手游推荐」用） ===== */
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}
  .tile{border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--card);display:block;color:var(--ink);text-decoration:none}
  .tile:hover{box-shadow:0 6px 20px rgba(0,0,0,.34)}
  .tile img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#1a2537}
  .tile .bd{padding:11px 13px}
  .tile .nm{font-size:14.5px;font-weight:600;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tile .ds{font-size:12px;color:var(--muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:3.2em}

  /* ===== 索引页 ===== */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;align-items:stretch}
.grid>.card{display:flex;flex-direction:column}
.grid>.card img{flex:0 0 auto}
  .card{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);display:block;color:var(--ink)}
  .card:hover{box-shadow:0 8px 24px rgba(0,0,0,.34)}
  .card img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#1a2537}
  .card .bd{padding:13px 15px;display:flex;flex-direction:column;flex:1;min-width:0}
  .card .nm{font-size:15.5px;font-weight:600;line-height:1.42;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.84em}
  .card .ds{font-size:12.5px;color:var(--muted);line-height:1.65;margin-bottom:11px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:4.95em}
  .card .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}
  .btn{display:inline-block;font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:7px;background:var(--brand-deep);color:#fff!important}
  .btn.ghost{background:var(--brand-soft);color:var(--brand)!important}
  .lead{font-size:15px;color:var(--ink2);margin:0 0 32px}
  .grp-h{font-size:19px;font-weight:700;margin:38px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--line);
    display:flex;align-items:baseline;gap:10px;scroll-margin-top:86px}
  .grp-h .cnt{font-size:12px;font-weight:400;color:var(--muted)}
  .lst{display:grid;grid-template-columns:1fr;gap:10px}
  .lst a{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;min-height:48px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
  .lst a:hover{box-shadow:0 4px 16px rgba(0,0,0,.3)}
  .lst .cat{flex:none;font-size:11px;font-weight:600;color:#fff;background:var(--brand-deep);border-radius:5px;padding:2px 9px;margin-top:2px}
  .lst .nm{font-size:15px;font-weight:600;line-height:1.6;display:block}
  .lst .sm{font-size:13px;color:var(--muted);margin-top:4px;line-height:1.6;display:block}
    /* ===== 站内搜索 / 分类芯片（攻略中心 · 资讯中心） ===== */
  .srchbar{display:flex;gap:12px;align-items:center;margin:0 0 20px}
  .srchbar input{flex:1;min-width:0;height:48px;padding:0 16px;border-radius:12px;border:1px solid var(--line);
    background:var(--card);color:var(--ink);font-size:15px;font-family:inherit;outline:none;transition:border-color .18s,box-shadow .18s}
  .srchbar input:focus{border-color:rgba(91,140,255,.55);box-shadow:0 0 0 4px rgba(91,140,255,.14)}
  .srchbar .srchbtn{display:none;flex:none;width:48px;height:48px;border:none;border-radius:12px;
    background:var(--brand-deep);color:#fff;cursor:pointer;align-items:center;justify-content:center}
  .srchbar .srchbtn:hover{opacity:.9}
  .srchbar .hint{flex:none;font-size:13px;color:var(--muted);white-space:nowrap}
  .srch-res{margin:0 0 26px}
  .srch-res .hd{font-size:13px;color:var(--muted);margin:0 0 10px}
  .srch-res .empty{font-size:14px;color:var(--muted);padding:18px 0;margin:0}
  /* 2026-09-18 修：html hidden 属性会被作者样式 display:grid/block 覆盖（UA 样式优先度最低），
     导致搜索过滤、结果区切换全部失效。这条 !important 是让 hidden 真正生效的唯一办法。 */
  [hidden]{display:none!important}
  /* 2026-09-21 修：攻略中心卡片统一高度、图文对齐。
     用 div.gcard 作用域，避免和游戏页 .tile 瓦片、首页内联 .gcard 冲突。 */
  .gcards{display:flex;flex-direction:column;gap:14px;margin:0 0 16px}
  div.gcard{
    --row:40px;
    display:grid;grid-template-columns:112px 1fr;gap:16px;padding:14px;
    border:1px solid var(--line);border-radius:12px;background:var(--card);
    transition:box-shadow .2s,border-color .2s;cursor:pointer;color:inherit;
    align-items:center
  }
  div.gcard:hover{border-color:rgba(91,140,255,.5);box-shadow:0 8px 24px rgba(0,0,0,.32)}
  div.gcard .cover{border-radius:10px;overflow:hidden;background:#1a2537;width:100%;align-self:center}
  div.gcard .cover img{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover}
  div.gcard .info{min-width:0;display:flex;flex-direction:column;gap:8px;align-self:stretch;justify-content:center}
  div.gcard .top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  div.gcard .gname{font-size:15px;font-weight:700;color:var(--ink);margin:0;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  div.gcard .gname a{color:inherit;text-decoration:none}
  div.gcard .gcat{font-size:11.5px;color:var(--muted);font-weight:500;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  div.gcard .cnt{font-size:11px;font-weight:600;color:var(--brand);background:var(--brand-soft);
    padding:2px 8px;border-radius:99px;white-space:nowrap;flex:none}
  div.gcard .alist{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none;min-height:calc(var(--row)*2 + 5px)}
  div.gcard .alist li{margin:0;padding:0}
  div.gcard .alist a{display:flex;align-items:center;font-size:13px;color:var(--ink2);padding:8px 10px;border-radius:6px;
    transition:background .15s,color .15s;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:var(--row)}
  div.gcard .alist a:hover{background:var(--brand-soft);color:var(--brand)}
  div.gcard .alist a.hit{background:var(--brand-soft);color:var(--brand);font-weight:600}
  div.gcard .alist .cat{display:inline-block;font-size:11px;font-weight:600;color:#fff;
    background:var(--brand-deep);border-radius:4px;padding:1px 5px;margin-right:5px;vertical-align:middle;flex:none}
  div.gcard .alist .cat.info{background:var(--accent);color:#241a00}
  /* 右侧默认只展示前 2 篇；搜索命中时展开。 */
  div.gcard .alist li:nth-child(n+3){display:none}
  div.gcard.srch .alist li{display:list-item}
  div.gcard .more{font-size:11.5px;color:var(--muted);align-self:flex-start;text-decoration:none;display:inline-flex;align-items:center;padding:8px 0;min-height:28px}
  div.gcard .more:hover{color:var(--brand)}
  div.gcard.collapsed{display:none}
  .more-btn{display:block;width:100%;padding:14px;margin:8px 0 28px;border:1px dashed var(--line);
    border-radius:12px;background:var(--card);color:var(--ink2);font-size:14px;font-weight:600;
    text-align:center;cursor:pointer;transition:border-color .18s,color .18s;font-family:inherit}
  .more-btn:hover{border-color:var(--brand);color:var(--brand)}
  @media (max-width:760px){
    div.gcard{--row:44px;grid-template-columns:88px 1fr;gap:12px;padding:12px}
  }
  @media (max-width:640px){
    .srchbar{position:relative;flex-direction:row;align-items:center;gap:10px;margin-bottom:28px}
    .srchbar input{flex:1;height:65px;font-size:17px;padding:0 18px;border-radius:16px;background-image:none}
    .srchbar .srchbtn{display:flex;width:65px;height:65px;border-radius:16px}
    .srchbar .srchbtn svg{width:26px;height:26px}
    .srchbar .hint{display:block;position:absolute;top:100%;left:0;right:0;text-align:center;font-size:12px;margin-top:6px}
  }
.foot{text-align:center;padding:34px 20px;border-top:1px solid var(--line);background:transparent;font-size:13px;color:var(--muted)}
  .foot a{color:var(--muted);margin:0 10px;padding:8px 0;display:inline-block}
  .foot a:hover{color:var(--brand)}
  @media (max-width:640px){
    .wrap{padding:24px 16px 52px}
    h1.ttl{font-size:23px}
    .ghero h1{font-size:22px}
    .ghero .pic{width:100%}
    .body{font-size:16px}
    .body h2{font-size:19px}
    .nav{gap:14px}
  }

  /* ===== 资讯中心：原创资讯图文卡片 ===== */
  .icards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin:18px 0 34px}
  .icard{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:13px;overflow:hidden;background:var(--card);color:var(--ink);transition:box-shadow .2s,border-color .2s;text-decoration:none}
  .icard:hover{border-color:rgba(91,140,255,.5);box-shadow:0 8px 24px rgba(0,0,0,.32)}
  .icard .icv{aspect-ratio:16/9;background:#1a2537;overflow:hidden}
  .icard .icv img{width:100%;height:100%;object-fit:cover;display:block}
  .icard .icv-ph{width:100%;height:100%;background:linear-gradient(135deg,#1c2333,#131b29)}
  .icard .ibd{padding:13px 14px 15px;display:flex;flex-direction:column;flex:1;min-width:0}
  .icard .imeta{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;color:var(--muted)}
  .icard .icat{font-size:11px;font-weight:600;color:#fff;background:var(--brand-deep);border-radius:99px;padding:2px 8px;flex:none}
  .icard .itl{font-size:15px;font-weight:700;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.9em}
  .icard .ism{margin-top:7px;font-size:12.5px;color:var(--muted);line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  /* ===== 资讯中心：置顶精选专题（编辑长文） ===== */
  .feagrid{display:grid;grid-template-columns:1fr;gap:14px;margin:18px 0 34px}
  .fea{position:relative;display:block;padding:22px 24px;border-radius:16px;background:linear-gradient(120deg,#16233f,#101b30);
    border:1px solid rgba(97,175,255,.38);overflow:hidden;text-decoration:none;transition:transform .2s,box-shadow .2s,border-color .2s}
  .fea:before{content:"";position:absolute;inset:0;background:radial-gradient(420px 180px at 0% 0%,rgba(61,123,255,.22),transparent 60%);pointer-events:none}
  .fea:hover{transform:translateY(-3px);border-color:rgba(97,175,255,.7);box-shadow:0 14px 34px rgba(8,14,28,.5),0 0 0 1px rgba(97,175,255,.2)}
  .fea .fea-tag{display:inline-block;font-size:.7rem;font-weight:700;color:#0e1a30;background:linear-gradient(90deg,#6ab8ff,#7dd3fc);border-radius:99px;padding:2.5px 12px;margin-bottom:12px}
  .fea .fea-t{font-size:1.24rem;line-height:1.5;font-weight:800;color:#fff;margin:0 0 8px;position:relative}
  .fea .fea-s{font-size:.9rem;line-height:1.8;color:#a9b6cd;margin:0 0 14px;position:relative}
  .fea .fea-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:.76rem;color:#6f7d94;position:relative}
  .fea .fea-more{color:#6ab8ff;font-weight:700}
  .fea:hover .fea-more{color:#8ecbff}
  /* ===== 游戏页：精彩图集 ===== */
  .gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:8px 0 30px}
  .gallery img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:12px;background:#1a2537}
  .gallery figcaption{font-size:12.5px;color:var(--muted);margin-top:6px;text-align:center}

  /* ══════════════════════════════════════════════════════════════
     内页移动端重设计 2026-09-21 · 仅 ≤760px 生效
     ══════════════════════════════════════════════════════════════ */
  @media (max-width:760px){
    /* 顶栏：链接热区 27px → 44px */
    .topbar{padding:7px 14px;gap:10px;min-height:56px}
    .brand{font-size:15px;padding:9px 0;white-space:nowrap}
    .topbar .nav{gap:3px;flex-wrap:nowrap}
    .topbar .nav a{padding:12px 9px;font-size:13.5px;border-radius:9px;
      min-height:44px;display:flex;align-items:center;white-space:nowrap}

    /* 游戏大厅：单列 352px 高（一屏仅 1.5 张）→ 2 列 */
    .grid{grid-template-columns:repeat(2,1fr)!important;gap:12px}
    .grid .card{border-radius:14px}
    .grid .card img{aspect-ratio:16/9}
    .grid .card .bd{padding:10px 11px 12px}
    .grid .card .nm{font-size:14px;line-height:1.35;margin-bottom:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}
    .grid .card .ds{font-size:11.5px;line-height:1.55;min-height:3.1em;margin-bottom:9px;
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .grid .card .row{gap:6px}
    .grid .card .btn{flex:1 1 0;min-width:0;padding:11px 6px;font-size:11.5px;
      text-align:center;border-radius:9px}

    /* 攻略中心 / 归档列表：条目热区提到 44px */
    div.gcard .alist a{min-height:44px;display:flex;align-items:center}
    div.gcard .more{padding:11px 0}
    .lst a{min-height:52px}
    .rel a{min-height:52px}
    .catnav a{padding:11px 14px;min-height:42px;display:inline-flex;align-items:center}
    .pn a{padding:15px 16px}

    /* 资讯中心：移动端改为横向小图卡，隐藏摘要缩短页面 */
    .icards{grid-template-columns:1fr;gap:12px}
    .icard{flex-direction:row;gap:12px;padding:12px;align-items:center}
    .icard .icv{flex:0 0 96px;aspect-ratio:1/1;border-radius:9px}
    .icard .ibd{padding:0}
    .icard .itl{font-size:14.5px;-webkit-line-clamp:2;min-height:0}
    .icard .ism{display:none}
    /* 游戏页图集：2 列 */
    .gallery{grid-template-columns:repeat(2,1fr);gap:10px}

    /* 文末按钮 / 搜索框热区 */
    .cta-btn{padding:14px 30px;min-height:48px}
    .srchbar input{height:44px}
    .more-btn{padding:16px}

    /* 标题略放大；正文维持 640px 断点的 16px，避免手机页面被拉长 */
    h1.ttl{font-size:24px;line-height:1.35}

    /* 底部标签栏占位 */
    body{padding-bottom:calc(66px + env(safe-area-inset-bottom,0px))!important}
  }

  /* ── 底部标签栏：移动端专属 ── */
  .tabbar{display:none}
  @media (max-width:760px){
    .tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:140;
      height:calc(62px + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:rgba(10,15,25,.97);
      -webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);
      border-top:1px solid rgba(255,255,255,.09);box-shadow:0 -6px 24px rgba(0,0,0,.42)}
    .tabbar a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:4px;color:var(--muted);text-decoration:none;font-size:11.5px;font-weight:600;
      -webkit-tap-highlight-color:transparent;transition:color .16s}
    .tabbar a svg{width:21px;height:21px;display:block}
    .tabbar a svg path,.tabbar a svg rect{stroke-width:1.9}
    .tabbar a.on{color:#00d4ff}
    .tabbar a.on svg{filter:drop-shadow(0 0 7px rgba(0,212,255,.5))}
  }
`;

// 首页「爬虫链接区」样式（首页是深色配色，跟随其变量）
const INDEX_EXTRA_CSS = `
  /* ===== 爬虫可见的站内链接区（由 build-articles.js 自动生成） ===== */
  .seo-crawl-links{max-width:1200px;margin:0 auto;padding:26px 20px 34px;display:flex;gap:14px;flex-wrap:wrap;justify-content:center;border-top:1px solid rgba(255,255,255,.08)}
  .seo-crawl-links a{font-size:.85rem;color:var(--sub,#9aa3bd);padding:8px 18px;border:1px solid rgba(255,255,255,.12);border-radius:99px;transition:all .2s}
  .seo-crawl-links a:hover{color:#fff;border-color:var(--accent2,#6366f1)}
  .seo-noscript{max-width:900px;margin:0 auto;padding:24px 20px;color:#dfe4f0;font-size:.9rem}
  .seo-noscript h2{font-size:1.05rem;margin:22px 0 10px;color:#fff}
  .seo-noscript ul{display:flex;flex-wrap:wrap;gap:4px 20px;list-style:none;padding:0;margin:0}
  .seo-noscript li{font-size:.85rem;line-height:1.95}
  .seo-noscript a{color:#9aa3bd}
  .seo-noscript a:hover{color:#fff}

      /* ══════════════════════════════════════════════════════════════
     移动端重设计 2026-09-21 · 仅 ≤760px 生效，桌面样式不受影响
     ══════════════════════════════════════════════════════════════ */
  @media (max-width:760px){

    /* ── 1. 顶栏：三行堆叠 173px → 单行 56px，主导航下沉到底部标签栏 ── */
    .nav{height:56px;background:rgba(10,15,25,.95);
      -webkit-backdrop-filter:blur(14px) saturate(180%);backdrop-filter:blur(14px) saturate(180%)}
    .nav-in{height:56px;padding:0 14px;gap:10px;max-width:none;flex-wrap:nowrap!important}
    .nav-logo{gap:7px;flex:none;order:1!important}
    .nav-logo-img{width:26px;height:26px;border-radius:7px}
    .logo-name{font-size:14.5px;font-weight:700;letter-spacing:0;white-space:nowrap}
    #navLinks{display:none!important}
    .nav-cta{display:none!important}
    .nav-toggle{display:none!important}
    .nav-srch{order:2!important;flex:0 1 auto!important;width:auto!important;
      min-width:110px;margin-left:auto!important;position:relative}
    .nav-srch input{width:100%!important;height:38px;font-size:13.5px;border-radius:11px;
      padding:0 12px 0 34px;border:1px solid rgba(255,255,255,.1)}
    .nav-srch input:focus{width:100%!important}
    .nav-srch .ic{left:12px;font-size:12.5px}
    .srch-panel{position:fixed;left:10px;right:10px;top:62px;max-height:62vh;overflow:auto}

    /* ── 2. 轮播：3D 堆叠（左右被裁）→ 横向翻页卡（覆盖 JS 内联 transform）── */
    .hero{height:auto!important;min-height:0!important;padding:66px 0 8px!important;margin-top:0!important}
    .carousel{position:static!important;height:auto!important;display:flex;gap:10px;align-items:stretch;
      overflow-x:auto;overflow-y:hidden;padding:4px 16px 12px;
      scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    .carousel::-webkit-scrollbar{display:none}
    .carousel .card{position:static!important;top:auto!important;left:auto!important;right:auto!important;
      width:auto!important;flex:0 0 80vw;max-width:330px;scroll-snap-align:center;
      transform:none!important;opacity:1!important;pointer-events:auto!important;z-index:auto!important;
      border-radius:16px}
    .carousel .card .card-img{aspect-ratio:16/9;border-radius:16px 16px 0 0}
    .carousel .card-bd{padding:12px 14px 14px}
    .carousel .card-bd h3{font-size:16px;margin-bottom:4px}
    .carousel .card-bd .sl{font-size:12px;margin-bottom:10px}
    .hero-arrow{width:32px;height:32px;font-size:1rem;background:rgba(10,16,28,.62)}

    /* ── 3. 信任状四宫格：4 列挤成一团 → 2×2 ── */
    .feat-grid{grid-template-columns:repeat(2,1fr)!important;gap:10px}

    /* ── 4. 游戏网格：3 列 113px（封面图仅 64px 高）→ 2 列 175px ── */
    .game-grid{grid-template-columns:repeat(2,1fr)!important;gap:12px}
    .game-grid .card{border-radius:14px}
    .game-grid .card .card-img{aspect-ratio:16/9}
    .game-grid .card-bd{padding:10px 11px 12px}
    .game-grid .card-bd h3{font-size:14px;line-height:1.35;margin-bottom:4px}
    .game-grid .card-bd .sl{font-size:11.5px;margin-bottom:9px;
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .game-grid .btns{gap:6px}
    .game-grid .btn{flex:1 1 0;min-width:0;padding:12px 6px;font-size:11.5px;
      text-align:center;border-radius:9px;white-space:nowrap}

    /* ── 5. 区块标题收紧 ── */
    .sec-head{padding:0 4px}
    .sec-head h2{font-size:22px;line-height:1.3}

    /* ── 6. 筛选 chips：贴边滑动 + 右缘渐隐，提示可横向滚动 ── */
    .tabs{margin:0 -16px;padding:2px 16px 10px;
      -webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 26px),transparent 100%);
      mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 26px),transparent 100%)}

    /* ── 7. 为底部标签栏留出安全间距 ── */
    body{padding-bottom:calc(66px + env(safe-area-inset-bottom,0px))!important}
  }

  /* ── 底部标签栏：移动端专属，桌面隐藏 ── */
  .tabbar{display:none}
  @media (max-width:760px){
    .tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:140;
      height:calc(62px + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:rgba(10,15,25,.97);
      -webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);
      border-top:1px solid rgba(255,255,255,.09);box-shadow:0 -6px 24px rgba(0,0,0,.42)}
    .tabbar a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:4px;color:var(--muted);text-decoration:none;font-size:11.5px;font-weight:600;
      -webkit-tap-highlight-color:transparent;transition:color .16s}
    .tabbar a svg{width:21px;height:21px;display:block}
    .tabbar a svg path,.tabbar a svg rect{stroke-width:1.9}
    .tabbar a.on{color:#00d4ff}
    .tabbar a.on svg{filter:drop-shadow(0 0 7px rgba(0,212,255,.5))}
  }
`;

function head(title, desc, canonical, opts) {
  const o = opts || {};
  const prefix = o.prefix == null ? '../' : o.prefix;
  const img = o.image ? SITE + '/' + String(o.image).replace(/^\.\.\//, '') : SITE + '/assets/images/logo_xiaomeng.png';
  const lds = (o.ld || []).map(x => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=0.85, minimum-scale=0.85, maximum-scale=3.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${o.robots || 'index, follow'}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${o.ogType || 'website'}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="小梦怀旧手游">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
${o.published ? `<meta property="article:published_time" content="${esc(o.published)}">` : ''}
<link rel="icon" href="${prefix}favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="${prefix}favicon.svg" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="${prefix}favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="${prefix}favicon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="${prefix}favicon-192.png">
<link rel="manifest" href="${prefix}site.webmanifest">
${lds}
${o.extraHead || ''}
<style>${BASE_CSS}</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">🎮 小梦怀旧手游</a>
  <nav class="nav">
    <a href="/games">游戏大厅</a>
    <a href="/news">官网资讯</a>
    <a href="/guides">攻略中心</a>
    <a href="/gift">福利礼包</a>
  </nav>
</header>
`;
}

const TABBAR = `
<nav class="tabbar" aria-label="主导航">
  <a href="/" data-tab="home"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path d="M3 10.6 12 3.2l9 7.4"/><path d="M5.6 9.4V20.8h12.8V9.4"/></svg><span>首页</span></a>
  <a href="/games" data-tab="games"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="6.5" width="20" height="11" rx="5.5"/><path d="M7 10.2v3.6M5.2 12h3.6M15.8 11h.01M18.2 13h.01"/></svg><span>游戏大厅</span></a>
  <a href="/guides" data-tab="guides"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path d="M4 4.5h6.2a1.8 1.8 0 0 1 1.8 1.8v13.2a1.8 1.8 0 0 0-1.8-1.8H4z"/><path d="M20 4.5h-6.2A1.8 1.8 0 0 0 12 6.3v13.2a1.8 1.8 0 0 1 1.8-1.8H20z"/></svg><span>攻略</span></a>
  <a href="/news" data-tab="news"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="14" rx="2.4"/><path d="M7.5 9.4h9M7.5 13h5.6"/></svg><span>资讯</span></a>
  <a href="/gift" data-tab="gift"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><rect x="3" y="8" width="18" height="4" rx="1.5"/><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/><path d="M12 8v12.5"/><path d="M12 8c-2.6 0-4-1.9-4-4 0-.8.7-1.5 1.5-1.5S11 3.6 11 5v3M12 8c2.6 0 4-1.9 4-4 0-.8.7-1.5-1.5-1.5S13 3.6 13 5v3"/></svg><span>礼包</span></a>
</nav>
<script>(function(){var p=location.pathname,t=p==='/'?'home':(p.indexOf('/games')===0||p.indexOf('/game/')===0)?'games':(p.indexOf('/guides')===0||p.indexOf('/article/')===0)?'guides':(p.indexOf('/news')===0)?'news':(p.indexOf('/gift')===0)?'gift':'home';var a=document.querySelector('.tabbar a[data-tab="'+t+'"]');if(a)a.classList.add('on');})()<\/script>
`;

function foot() {
  return `
<footer class="foot">
  <a href="/">首页</a>
  <a href="/games">全部游戏</a>
  <a href="/news">官网资讯</a>
  <a href="/guides">全部攻略</a>
  <p style="margin:14px 0 0">本站仅提供游戏导航与攻略信息 · 游戏版权归各开发商所有</p>
  <p style="margin:6px 0 0">© 2026 小梦怀旧手游 · fmbly.com</p>
</footer>
${TABBAR}
</body>
</html>
`;
}

// ===== 4. 目录准备 =====
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(GAME_DIR, { recursive: true });
// news/ 不再无条件预建：writeFile() 会按需逐级建目录，避免公告下线后留下一个空目录。

const sitemapUrls = [];
let writtenCount = 0;
function writeFile(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });   // 公告独立页在 news/<专区>/ 下，需逐级建目录
  fs.writeFileSync(full, content);
  writtenCount++;
}

// ===== 5. 生成每篇攻略页面 =====
articles.forEach((a) => {
  const game = a.gameId ? gameById[a.gameId] : null;
  const url = SITE + '/article/' + a.id;

  const cover = a.cover ? a.cover.replace(/^assets\//, '../assets/') : '';
  const extra = (guideExtra[a.id] || '') + (guideFaq[a.id] || '');
  const contentHtml = fixRel(a.content || '', '../') + extra;

  const related = articles
    .filter(x => x.gameId === a.gameId && x.id !== a.id)
    .concat(articles.filter(x => x.gameId !== a.gameId).sort((m, n) => (n.views || 0) - (m.views || 0)))
    .slice(0, 6);

  const relatedHtml = related.length
    ? `<div class="sec-h">继续阅读</div>
<div class="rel">
${related.map(r => `  <a href="/article/${r.id}"><span class="cat">${esc(r.category || '攻略')}</span><span class="nm">${esc(r.title)}</span></a>`).join('\n')}
</div>`
    : '';

  // 文末下载卡：有归属游戏时直达联运落地页（链接取 games.js 原值，与游戏页同款回退规则），
  // 无归属（综合/汇总文）时给「浏览全部游戏」出口，保证孤岛页也有站内出口。
  const ctaHtml = game ? `<div class="cta dlcard">
    <a class="dlc-pic" href="/game/${game.id}"><img src="../${esc(game.cover)}" alt="${esc(game.name)}"${sizeAttrs(game.cover)} loading="lazy"></a>
    <div class="dlc-info">
      <div class="dlc-t">🎮 ${esc(game.name)}</div>
      <p class="dlc-d">${esc((game.desc || '').replace(/\s+/g, ' ').slice(0, 72))}</p>
      <div class="dl">
        <a class="and" href="${esc(game.androidUrl ? game.androidUrl : game.url)}" target="_blank" rel="sponsored noopener noreferrer">安卓下载</a>
        <a class="ios" href="${esc(game.iosUrl ? game.iosUrl : game.url)}" target="_blank" rel="sponsored noopener noreferrer">苹果下载</a>
      </div>
      <a class="dlc-more" href="/game/${game.id}">查看《${esc(game.name)}》详情与全部攻略 →</a>
    </div>
  </div>` : `<div class="cta">
    <p>这篇攻略对你有帮助吗？站内还有多款怀旧手游与攻略，一次看全。</p>
    <a class="cta-btn" href="/games">浏览全部游戏</a>
    <p class="cta-back"><a href="/">← 返回首页</a></p>
  </div>`;

  const crumbs = [
    `<a href="/">首页</a>`,
    `<a href="/guides">攻略中心</a>`,
    game ? `<a href="/game/${game.id}">${esc(game.name)}</a>` : ''
  ].filter(Boolean).join('<i>/</i>');

  const ldArticle = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.summary || '',
    image: a.cover ? [SITE + '/' + a.cover] : undefined,
    datePublished: a.date || undefined,
    dateModified: a.date || undefined,
    articleSection: a.category || '攻略',
    inLanguage: 'zh-CN',
    author: { '@type': 'Organization', name: a.author || '小梦攻略组' },
    publisher: {
      '@type': 'Organization',
      name: '小梦怀旧手游',
      logo: { '@type': 'ImageObject', url: SITE + '/assets/images/logo_xiaomeng.png' }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }
  };
  const ldBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: '攻略中心', item: SITE + '/guides' },
      ...(game ? [{ '@type': 'ListItem', position: 3, name: game.name, item: SITE + '/game/' + game.id }] : [])
    ]
  };

  const html = head(a.title + ' - 小梦怀旧手游 游戏攻略', a.summary || '', url, {
    ogType: 'article',
    image: a.cover,
    published: a.date,
    ld: [ldArticle, ldBreadcrumb]
  }) + `<main class="wrap">
  <nav class="crumb">${crumbs}<i>/</i><span>正文</span></nav>
  <article>
    ${a.category ? `<span class="tag">${esc(a.category)}</span>` : ''}
    <h1 class="ttl">${esc(a.title)}</h1>
    <div class="meta">
      <span>${esc(a.author || '小梦攻略组')}</span>
      <span>${esc(a.date || '')}</span>
      ${game ? `<span><a href="/game/${game.id}">${esc(game.name)}</a></span>` : ''}
    </div>
    ${cover ? `<img class="cover" src="${esc(cover)}" alt="${esc(a.title)}"${sizeAttrs(a.cover)} decoding="async" fetchpriority="high">` : ''}
    <div class="body">
${contentHtml}
    </div>
  </article>

${ctaHtml}
${relatedHtml}
</main>
` + foot();

  writeFile('article/' + a.id + '.html', html);
  sitemapUrls.push({
    loc: url,
    lastmod: a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : TODAY,
    priority: '0.8'
  });
});
console.log('✅ 生成 ' + articles.length + ' 篇攻略静态页');

// ===== 6. 生成每款游戏独立页 =====
const articlesByGame = new Map();
articles.forEach(a => {
  const k = a.gameId || 0;
  if (!articlesByGame.has(k)) articlesByGame.set(k, []);
  articlesByGame.get(k).push(a);
});

games.forEach((g) => {
  const url = SITE + '/game/' + g.id;
  const ext = gameExtra[g.id] || {};
  const mine = (articlesByGame.get(g.id) || []).slice().sort((m, n) => String(n.date).localeCompare(String(m.date)));

  // 下载入口：严格沿用首页弹窗的同款回退规则
  //   androidUrl 为空 -> 回退 url ；iosUrl 为空 -> 回退 url
  // ⚠️ href 必须是 data/games.js 里的原值，不得改写。
  const androidHref = (g.androidUrl && g.androidUrl !== '') ? g.androidUrl : g.url;
  const iosHref = (g.iosUrl && g.iosUrl !== '') ? g.iosUrl : g.url;

  // 结构化参数表
  const baseFacts = [
    ['开发商', g.developer || '—'],
    ['发行年份', g.year ? String(g.year) : '—'],
    ['游戏平台', g.platform || '手游'],
    ['游戏分类', g.category || '角色扮演'],
    ['安装大小', g.sizeText || (g.size ? (g.size / 1024).toFixed(1) + 'GB' : '—')],
    ['玩家评分', g.rating ? '★ ' + g.rating + '.0' : '—']
  ];
  const facts = baseFacts.concat(Array.isArray(ext.facts) ? ext.facts : []);

  const factsHtml = facts
    .filter(f => f && f[1] != null && String(f[1]).trim() !== '' && String(f[1]) !== '—')
    .map(f => `    <tr><th>${esc(f[0])}</th><td>${esc(f[1])}</td></tr>`).join('\n');

  const hlHtml = Array.isArray(ext.highlights) && ext.highlights.length
    ? `<h2 class="sec-h">游戏特色</h2>\n<ul class="hl">\n${ext.highlights.map(h => `  <li>${esc(h)}</li>`).join('\n')}\n</ul>`
    : '';

  const introParas = [];
  if (ext.intro) introParas.push(...String(ext.intro).split(/\n+/).filter(Boolean));
  else if (g.desc) introParas.push(g.desc);
  if (ext.extraIntro) introParas.push(...String(ext.extraIntro).split(/\n+/).filter(Boolean));

  const introHtml = `<h2 class="sec-h">游戏介绍</h2>
<div class="prose">
${introParas.map(p => (p.trim().startsWith('<') ? p : '<p>' + esc(p) + '</p>')).join('\n')}
</div>`;

  const artImgs = artImagesForGame(g.id);
  const galleryHtml = artImgs.length
    ? `<h2 class="sec-h">《${esc(g.name)}》精彩图集</h2>
<div class="gallery">
${artImgs.map((src, i) => `  <img src="../${esc(src)}" alt="${esc(g.name + ' 游戏截图 ' + (i + 1))}" loading="lazy"${sizeAttrs(src)}>`).join('\n')}
</div>`
    : '';

  const mineHtml = mine.length
    ? `<h2 class="sec-h">${esc(g.name)} 攻略（${mine.length} 篇）</h2>
<div class="lst">
${mine.map(a => `  <a href="/article/${a.id}"><span class="cat">${esc(a.category || '攻略')}</span><span><span class="nm">${esc(a.title)}</span><span class="sm">${esc((a.summary || '').slice(0, 70))}</span></span></a>`).join('\n')}
</div>`
    : '';

  // 相关游戏：同分类优先，其次按热度
  const others = games.filter(x => x.id !== g.id)
    .sort((m, n) => {
      const ms = (m.category === g.category ? 1 : 0), ns = (n.category === g.category ? 1 : 0);
      if (ms !== ns) return ns - ms;
      return (n.heat || 0) - (m.heat || 0);
    }).slice(0, 8);

  const othersHtml = `<h2 class="sec-h">同类怀旧手游推荐</h2>
<div class="tiles">
${others.map(o => `  <a class="tile" href="/game/${o.id}">
    <img src="../${esc(o.cover)}" alt="${esc(o.name)}" loading="lazy"${sizeAttrs(o.cover)}>
    <div class="bd"><div class="nm">${esc(o.name)}</div><div class="ds">${esc((o.desc || '').slice(0, 34))}</div></div>
  </a>`).join('\n')}
</div>`;

  // 官方动态：来自三九互娱官方专区的真实公告（fetch-official-news.js 自动同步，非人工编撰）
  // 游戏页只展示最近 8 条，全量归档在 /news/<slug>
  const nz = officialNews && officialNews.games ? officialNews.games[String(g.id)] : null;
  const nzArc = nz && officialNews.archives ? officialNews.archives[nz.slug] : null;
  let newsHtml = '';
  if (nzArc && Array.isArray(nzArc.items) && nzArc.items.length) {
    const synced = String(officialNews.generatedAt || '').slice(0, 10);
    newsHtml = `<h2 class="sec-h">官方动态</h2>
<p class="news-src">以下内容来自 ${esc(nzArc.official)} 公开公告 ·
<a href="/news/${esc(nzArc.slug)}">全部公告归档</a>
</p>
<ul class="news">
${nzArc.items.slice(0, 8).map(it => `  <li>
    <div class="nh"><span class="nd">${esc(it.date || '')}</span><span class="nc">${esc(it.category || '公告')}</span>${newsTitleHtml(nzArc.slug, it)}</div>${it.summary ? `\n    <p class="ns">${esc(it.summary)}</p>` : ''}
  </li>`).join('\n')}
</ul>`;
  }

  const desc = (g.desc || '').replace(/\s+/g, ' ').slice(0, 150);
  const ldGame = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: g.name,
    description: g.desc || '',
    image: (() => {
      const imgs = [];
      if (g.cover) imgs.push(SITE + '/' + g.cover);
      artImgs.slice(0, 4).forEach(s => imgs.push(SITE + '/' + s));
      return imgs.length ? imgs : undefined;
    })(),
    applicationCategory: 'Game',
    operatingSystem: 'Android, iOS',
    genre: g.category || '角色扮演',
    author: { '@type': 'Organization', name: g.developer || '未知' },
    datePublished: g.year ? String(g.year) : undefined,
    inLanguage: 'zh-CN'
  };
  const ldBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: '游戏大厅', item: SITE + '/games' },
      { '@type': 'ListItem', position: 3, name: g.name, item: url }
    ]
  };

  const html = head(g.name + ' - 官方下载入口与攻略 - 小梦怀旧手游', desc, url, {
    ogType: 'article',
    image: g.cover,
    ld: [ldGame, ldBreadcrumb]
  }) + `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><a href="/games">游戏大厅</a><i>/</i><span>${esc(g.name)}</span></nav>
  <div class="ghero">
    <div class="pic"><img src="../${esc(g.cover)}" alt="${esc(g.name)}"${sizeAttrs(g.cover)} decoding="async" fetchpriority="high"></div>
    <div class="info">
      ${g.category ? `<span class="tag">${esc(g.category)}</span>` : ''}
      <h1>${esc(g.name)}</h1>
      <div class="sub">${esc(g.developer || '')}${g.platform ? ' · ' + esc(g.platform) : ''}${g.year ? ' · ' + g.year + ' 年' : ''}</div>
      <div class="score">${g.rating ? '★ ' + g.rating + '.0 / 5.0' : ''}</div>
      <div class="dl">
        <a class="and" href="${esc(androidHref)}" target="_blank" rel="sponsored noopener noreferrer">安卓下载</a>
        <a class="ios" href="${esc(iosHref)}" target="_blank" rel="sponsored noopener noreferrer">苹果下载</a>
      </div>
    </div>
  </div>

  <h2 class="sec-h">官方信息</h2>
  <table class="facts">
${factsHtml}
  </table>

${introHtml}

${galleryHtml}

${hlHtml}

${newsHtml}

${mineHtml}

${othersHtml}

  <div class="cta">
    <p>想找更多经典 IP 正版复刻的怀旧手游？回到首页一次看全。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>
</main>
` + foot();

  writeFile('game/' + g.id + '.html', html);
  sitemapUrls.push({ loc: url, lastmod: TODAY, priority: '0.8' });
});
console.log('✅ 生成 ' + games.length + ' 款游戏独立页');

// ===== 6.5 生成官方公告归档页 /news 与 /news/<slug> =====
// 内容全部来自三九互娱官方专区公开公告（scripts/fetch-official-news.js 自动同步）
// 结构：只做「标题 + 日期 + 分类 + 摘要 + 官方原文链接」，不为每条公告单独建页，
//       避免一次性给新站灌入上千个薄页面。
const NEWS_CATS = ['开服公告', '合服公告', '维护公告', '版本更新', '活动', '赛事', '攻略', '官方资讯'];
const newsArchives = officialNews && officialNews.archives ? officialNews.archives : null;
const archiveList = newsArchives
  ? Object.values(newsArchives).filter(a => a && Array.isArray(a.items) && a.items.length)
      .sort((m, n) => n.items.length - m.items.length)
  : [];

let hubNews = null;

/* 本站原创资讯：data/articles.js 里 category === '资讯' 的文章。
   它们此前只出现在 /article/N 与 sitemap，资讯中心（/news）看不到 —— 这里补上入口。
   定义在 if 之外，这样即便官方公告被清空走「空态」分支，原创资讯依然可见。 */
const infoArticles = articles
  .filter(a => a.category === '资讯')
  .slice()
  .sort((m, n) => String(n.date || '').localeCompare(String(m.date || '')));
const infoCardsHtml = infoArticles.map(a => {
  const g = (a.gameId && gameById[a.gameId]) ? gameById[a.gameId] : null;
  const gname = g ? g.name : '综合资讯';
  const coverRoot = a.cover || '';
  const coverRel = coverRoot.replace(/^assets\//, '../assets/');
  const size = coverRoot ? sizeAttrs(coverRoot) : '';
  const sm = a.summary ? `<div class="ism">${esc(a.summary.slice(0, 110))}</div>` : '';
  return `<a class="icard" href="/article/${a.id}">
  <div class="icv">${coverRel ? `<img src="${esc(coverRel)}" alt="${esc(a.title)}"${size} loading="lazy">` : '<div class="icv-ph"></div>'}</div>
  <div class="ibd">
    <div class="imeta"><span class="icat">${esc(gname)}</span><span>${esc(a.date || '')}</span></div>
    <div class="itl">${esc(a.title)}</div>
    ${sm}
  </div>
</a>`;
}).join('\n');
const infoSectionHtml = infoArticles.length
  ? '  <h2 class="sec-h">本站原创资讯</h2>\n  <div class="icards">\n' + infoCardsHtml + '\n  </div>\n\n'
  : '';

/* 置顶精选专题：上传统计汇总等本站编辑长文（data/editorials.js）。
   独立页在 /news/feature/<slug>.html，资讯中心最顶部置顶一块高亮卡。 */
const feaCardsHtml = editorials.map(e => {
  const feaUrl = SITE + '/news/feature/' + String(e.slug || '').trim();
  const feaCat = esc(e.category || '精选专题');
  return `  <a class="fea" href="${feaUrl}" aria-label="阅读：${esc(e.title)}">
  <div class="fea-tag">${feaCat}</div>
  <h3 class="fea-t">${esc(e.title)}</h3>
  <p class="fea-s">${esc(e.summary || '')}</p>
  <div class="fea-meta"><span>${esc(String(e.date || ''))}</span><span class="fea-more">阅读全文 →</span></div>
</a>`;
}).join('\n');
const editorialTopHtml = editorials.length
  ? '  <h2 class="sec-h">本期精选专题</h2>\n  <div class="feagrid">\n' + feaCardsHtml + '\n  </div>\n\n'
  : '';

if (archiveList.length) {
  const synced = String(officialNews.generatedAt || '').slice(0, 10);
  const nameOfSlug = {};
  archiveList.forEach(a => a.gameIds.forEach(id => { if (gameById[id]) nameOfSlug[a.slug] = gameById[id].name; }));
  const titleOf = (a) => nameOfSlug[a.slug] || (a.official || '').replace(/^三九互娱《|》官方专区$/g, '');

  // --- /news 总览 ---
  const totalNews = archiveList.reduce((s, a) => s + a.items.length, 0);
    // 首页入口区需要的汇总（第 10 步生成首页「资讯/攻略」按键 + 最新一条）
  let latestNewsItem = null;
  archiveList.forEach(a => {
    a.items.forEach(it => {
      const href = newsHref(a.slug, it);
      if (!href) return;
      const d = String(it.date || '');
      if (!latestNewsItem || d > latestNewsItem.d) {
        latestNewsItem = { d, url: href, title: it.title, game: titleOf(a) };
      }
    });
  });
  hubNews = {
    total: totalNews,
    archives: archiveList.length,
    latestUrl: latestNewsItem ? latestNewsItem.url : '/news',
    latestTitle: latestNewsItem ? latestNewsItem.title : '前往资讯中心查看全部公告',
    latestDate: latestNewsItem ? latestNewsItem.d : ''
  };

  // 每个专区一个区块（标题 + 最近 5 条），外加顶部「按游戏分类」的锚点芯片
  const newsArchiveHtml = archiveList.map(a => {
    const list = a.items.slice(0, 5).map(it => {
      const hd = `<div class="nh"><span class="nd">${esc(it.date || '')}</span><span class="nc">${esc(it.category || '公告')}</span>${newsTitleHtml(a.slug, it)}</div>`;
      const sm = it.summary ? `\n      <p class="ns">${esc(it.summary)}</p>` : '';
      return `    <li>\n      ${hd}${sm}\n    </li>`;
    }).join('\n');
    return `  <section class="nsec">\n  <h3 class="cathd" id="s-${esc(a.slug)}">${esc(titleOf(a))}<span class="cn">共 ${a.items.length} 条 · <a href="/news/${esc(a.slug)}">查看全部</a></span></h3>\n  <ul class="news">\n${list}\n  </ul>\n  </section>`;
  }).join('\n');

  const newsChipsHtml = archiveList
    .map(a => `    <a href="#s-${esc(a.slug)}">${esc(titleOf(a))}<b>${a.items.length}</b></a>`).join('\n');

  // 可点开的公告条数（无正文的条目只在归档页显示标题，不进搜索索引）
  const newsSearchable = archiveList.reduce(
    (s, a) => s + a.items.filter(it => newsHref(a.slug, it)).length, 0);

  const newsBody = `<main class="wrap wide">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>游戏资讯</span></nav>
  <h1>游戏资讯与官方公告</h1>
  <p class="lead">本页汇总<strong>本站原创资讯</strong>与收录的怀旧手游官方专区公开公告，包含开服、合服、维护、版本更新与活动等。
  每篇均可站内直接阅读全文，无需跳转任何外部站点。</p>

${editorialTopHtml}
  <div class="srchbar">
    <input id="newsSearch" type="search" placeholder="搜索游戏名或公告标题，例如「龙之谷」「维护」" autocomplete="off" aria-label="搜索官方资讯">
    <span class="hint" id="newsHint">输入即搜</span>
  </div>
  <div class="srch-res" id="newsRes" hidden></div>

  <div id="newsBrowse">
${infoSectionHtml}  <h2 class="sec-h">按游戏分类</h2>
  <div class="chips">
${newsChipsHtml}
  </div>

  <h2 class="sec-h">各游戏最新公告</h2>
${newsArchiveHtml}
  </div>

  <div class="cta">
    <p>想找更多经典 IP 正版复刻的怀旧手游？回到首页一次看全。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>

  <script>
  (function(){
    function idxData(){return (typeof NEWS_INDEX!=='undefined'&&NEWS_INDEX)?NEWS_INDEX:null;}
    function esc2(s){var d=document.createElement('div');d.textContent=(s==null?'':String(s));return d.innerHTML;}
    var box=document.getElementById('newsSearch'),res=document.getElementById('newsRes'),
        browse=document.getElementById('newsBrowse'),hint=document.getElementById('newsHint');
    if(!box||!res||!browse)return;
    var TOTAL=${newsSearchable};
    function render(){
      var q=String(box.value||'').trim().toLowerCase();
      if(!q){res.hidden=true;res.innerHTML='';browse.hidden=false;hint.textContent='输入即搜';return;}
      var list=idxData();
      if(!list){res.innerHTML='<p class="empty">搜索索引加载中，请稍候…</p>';res.hidden=false;browse.hidden=true;return;}
      var hits=[],CAP=60,i;
      for(i=0;i<list.length;i++){
        var it=list[i];
        if((it[0]+' '+it[2]).toLowerCase().indexOf(q)>=0){hits.push(it);if(hits.length>=CAP)break;}
      }
      browse.hidden=true;
      hint.textContent='命中 '+hits.length+' 条'+(hits.length>=CAP?'（仅列出前 '+CAP+' 条）':'');
      if(!hits.length){
        res.innerHTML='<p class="empty">没有找到与「'+esc2(box.value.trim())+'」相关的公告。换个关键词试试，比如游戏名、「维护」、「开服」。</p>';
        res.hidden=false;return;
      }
      var html='<p class="hd">共 '+hits.length+' 条结果</p><div class="lst">';
      for(i=0;i<hits.length;i++){
        var h=hits[i];
        html+='<a href="'+esc2(h[1])+'"><span class="cat">'+esc2(h[2])+'</span><span><span class="nm">'+esc2(h[0])+'</span><span class="sm">'+esc2(h[3]||'')+'</span></span></a>';
      }
      res.innerHTML=html+'</div>';
      res.hidden=false;
    }
    box.addEventListener('input',render);
    box.addEventListener('keyup',render);
    box.addEventListener('change',render);
    box.addEventListener('search',render);
    box.addEventListener('keydown',function(e){if(e.key==='Escape'){box.value='';render();box.blur();}});
    var srchBtn=document.getElementById('guideSrchBtn');
    if(srchBtn){srchBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();render();box.blur();});}
  })();
  </script>
</main>
` + foot();


  const newsUrl = SITE + '/news';
  writeFile('news.html', head(
    '游戏资讯与官方公告 - 开服/合服/维护/活动 - 小梦怀旧手游',
    `汇总怀旧手游的官方开服、合服、维护、版本更新与活动公告，以及本站原创资讯长文，均可站内直接阅读全文。`,
    newsUrl,
    { prefix: '', ld: [{
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: '手游官方公告合集', url: newsUrl, inLanguage: 'zh-CN',
      isPartOf: { '@type': 'WebSite', name: '小梦怀旧手游', url: SITE + '/' }
    }], extraHead: '<script src="/js/news-index.js" defer><\/script>' }
  ) + newsBody);
  sitemapUrls.push({ loc: newsUrl, lastmod: TODAY, priority: '0.7' });

  // ===== 6.6 福利礼包 / 兑换码中心（活动时效内容，数据来自 data/gifts.js） =====
  const giftUrl = SITE + '/gift';
  if (gifts && gifts.length) {
    const giftSections = gifts.map(g => {
      const gg = g.gameId ? gameById[g.gameId] : null;
      const gameName = gg ? gg.name : g.game;
      const tagHtml = g.tag ? `<span class="gift-tag">${esc(g.tag)}</span>` : '';
      const gameLink = gg ? `<a class="gift-game-link" href="/game/${gg.id}">下载与攻略 →</a>` : '';
      const cardsHtml = g.gifts.map(gf => `    <div class="gift-card">
      <div class="gift-top"><span class="gift-name">${esc(gf.name)}</span><span class="gift-period">${esc(gf.period)}</span></div>
      <div class="gift-code">${esc(gf.code)}</div>
      <button class="gift-copy" type="button" data-code="${esc(gf.code)}">复制兑换码</button>
      <div class="gift-items">${esc(gf.items)}</div>
    </div>`).join('\n');
      return `  <section class="gift-sec">
    <h2 class="sec-h">${tagHtml}${esc(gameName)}${gameLink}</h2>
    <div class="gift-grid">
${cardsHtml}
    </div>
  </section>`;
    }).join('\n');

    const giftBody = `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>福利礼包</span></nav>
  <h1>福利礼包兑换中心</h1>
  <p class="lead">中秋、国庆活动限时礼包码汇总，点击「复制兑换码」后在对应游戏内兑换。礼包码请在有效期内使用，过期失效。</p>
  <div class="gift-notice">⚠️ 兑换是否成功以游戏内实际为准；若提示无效，可能是已过期或该账号已领取过。</div>

${giftSections}

  <div class="cta">
    <p>没看到你想玩的游戏？回游戏大厅一次看全。</p>
    <a class="cta-btn" href="/games">浏览全部游戏</a>
  </div>

  <script>
  (function(){
    function doCopy(code, cb){
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(code).then(function(){cb(true)},function(){cb(false)}); }
      else{
        var ta=document.createElement('textarea'); ta.value=code; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        var ok=false; try{ ok=document.execCommand('copy'); }catch(e){}
        document.body.removeChild(ta); cb(ok);
      }
    }
    var btns=document.querySelectorAll('.gift-copy');
    for(var i=0;i<btns.length;i++){
      btns[i].addEventListener('click', function(){
        var self=this, code=this.getAttribute('data-code');
        doCopy(code, function(ok){ self.textContent = ok ? '已复制 ✓' : '复制失败'; setTimeout(function(){ self.textContent='复制兑换码'; },1600); });
      });
    }
  })();
  <\/script>
</main>` + foot();

    writeFile('gift.html', head(
      '福利礼包兑换中心 - 中秋国庆礼包码 - 小梦怀旧手游',
      '怀旧手游中秋、国庆活动福利礼包码汇总，一键复制兑换，含永恒岛、星辰变等热门游戏。',
      giftUrl,
      { prefix: '', ld: [{
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: '福利礼包兑换中心', url: giftUrl, inLanguage: 'zh-CN',
        isPartOf: { '@type': 'WebSite', name: '小梦怀旧手游', url: SITE + '/' }
      }] }
    ) + giftBody);
    sitemapUrls.push({ loc: giftUrl, lastmod: TODAY, priority: '0.8' });
    console.log('✅ 生成 gift.html（' + gifts.length + ' 款游戏 / ' + gifts.reduce(function(s, g) { return s + g.gifts.length; }, 0) + ' 个礼包）');
  } else {
    console.log('ℹ️  无礼包数据，跳过 gift.html');
  }

  // --- 站内搜索索引 /js/news-index.js（资讯中心用；随每日公告自动重建） ---
  const newsIndexArr = [];
  archiveList.forEach(a => {
    const gname = titleOf(a);
    a.items.forEach(it => {
      const href = newsHref(a.slug, it);
      if (!href) return;
      newsIndexArr.push([it.title, href, gname, it.date || '']);
    });
  });
  /* 本站原创资讯也进搜索索引，否则资讯中心搜不到自己站内的文章 */
  infoArticles.forEach(a => {
    const gname = (a.gameId && gameById[a.gameId]) ? gameById[a.gameId].name : '综合资讯';
    newsIndexArr.push([a.title, '/article/' + a.id, gname, a.date || '']);
  });
  /* 置顶精选专题也进搜索索引 */
  editorials.forEach(e => {
    if (e && e.slug) newsIndexArr.push([e.title, '/news/feature/' + String(e.slug).trim(), e.category || '精选专题', String(e.date || '')]);
  });
  const newsIndexSrc = '/* 资讯搜索索引 · 由 scripts/build-articles.js 自动生成，请勿手改 */\n' +
    'var NEWS_INDEX=' + JSON.stringify(newsIndexArr).replace(/</g, '\\u003c') + ';\n';
  fs.writeFileSync(path.join(ROOT, 'js', 'news-index.js'), newsIndexSrc);
  console.log('✅ 生成 js/news-index.js（' + newsIndexArr.length + ' 条 / ' +
    Buffer.byteLength(newsIndexSrc, 'utf8') + ' 字节）');

  // --- /news/<slug> 单专区全量归档 ---
  archiveList.forEach(a => {
    const gameName = titleOf(a);
    const url = SITE + '/news/' + a.slug;
    // 按分类分组（保持固定顺序，未列出的分类排最后）
    const groups = {};
    a.items.forEach(it => {
      const c = NEWS_CATS.includes(it.category) ? it.category : '官方资讯';
      (groups[c] = groups[c] || []).push(it);
    });
    const cats = NEWS_CATS.filter(c => groups[c] && groups[c].length);
    // 月份分组：便于长列表浏览
    const catNav = cats.map((c, i) => `    <a href="#c${i + 1}">${esc(c)}（${groups[c].length}）</a>`).join('\n');

    const body = `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><a href="/news">官方公告</a><i>/</i><span>${esc(gameName)}</span></nav>
  <h1>《${esc(gameName)}》官方公告归档</h1>
  <p class="lead">以下公告均来自 ${esc(a.official)}公开信息，按分类整理，每条均可在本站直接阅读全文。
  本站页面内不设任何指向外部站点的链接；如需核对原文，可在官方专区按标题检索。</p>

  <nav class="catnav">
${catNav}
  </nav>

${cats.map((c, i) => `  <h2 class="cathd" id="c${i + 1}">${esc(c)}<span class="cn">${groups[c].length} 条</span></h2>
  <ul class="news">
${groups[c].map(it => `    <li>
      <div class="nh"><span class="nd">${esc(it.date || '')}</span>${newsTitleHtml(a.slug, it)}</div>${it.summary ? `\n      <p class="ns">${esc(it.summary)}</p>` : ''}
    </li>`).join('\n')}
  </ul>`).join('\n')}

  <h2 class="sec-h">这款游戏的其他内容</h2>
  <div class="lst">
${a.gameIds.filter(id => gameById[id]).map(id => `    <a href="/game/${id}"><span class="cat">下载</span><span><span class="nm">《${esc(gameById[id].name)}》下载入口与攻略</span><span class="sm">${esc((gameById[id].desc || '').slice(0, 60))}</span></span></a>`).join('\n')}
    <a href="/news"><span class="cat">公告</span><span><span class="nm">全部游戏官方公告合集</span><span class="sm">按分类查看 ${archiveList.length} 款游戏的官方公告</span></span></a>
  </div>

  <div class="cta">
    <p>想找更多经典 IP 正版复刻的怀旧手游？回到首页一次看全。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>
</main>
` + foot();

    writeFile('news/' + a.slug + '.html', head(
      `《${gameName}》官方公告归档 - 开服/维护/活动 - 小梦怀旧手游`,
      `${gameName}官方公告按开服、合服、维护、版本更新、活动等分类整理，每条均为站内独立页面，可直接阅读全文。`,
      url,
      { ld: [{
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: `《${gameName}》官方公告归档`, url, inLanguage: 'zh-CN',
        isPartOf: { '@type': 'WebSite', name: '小梦怀旧手游', url: SITE + '/' }
      }, {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: '官方公告', item: newsUrl },
          { '@type': 'ListItem', position: 3, name: `《${gameName}》官方公告归档`, item: url }
        ]
      }] }
    ) + body);
    sitemapUrls.push({ loc: url, lastmod: TODAY, priority: '0.6' });

    // --- 每条公告生成一个站内独立页 /news/<专区>/<key> ---
    // 正文取 data/news-bodies.js 的纯文本段落（不引用官方站图片，页面完全自包含、无外链）。
    const pubItems = a.items.filter((it) => newsHref(a.slug, it));
    pubItems.forEach((it, i) => {
      const itemUrl = SITE + '/news/' + a.slug + '/' + it.key;
      const itemBody = newsBodies[it.key] || [];
      const bodyHtml = itemBody
        .map((p) => (/^【[^】]{2,14}】$/.test(p) ? `      <h3>${esc(p)}</h3>` : `      <p>${esc(p)}</p>`))
        .join('\n');
      const catLabel = it.category || '公告';
      const prevIt = pubItems[i - 1];   // 列表按时间倒序 → 前一个是更新的
      const nextIt = pubItems[i + 1];
      const sameCat = pubItems.filter((x) => x !== it && x.category === it.category).slice(0, 6);

      const pnHtml = (prevIt || nextIt)
        ? `  <nav class="pn">
${prevIt ? `    <a href="/news/${esc(a.slug)}/${esc(prevIt.key)}"><span class="k">← 上一条（更新）</span><span class="v">${esc(prevIt.title)}</span></a>` : ''}
${nextIt ? `    <a href="/news/${esc(a.slug)}/${esc(nextIt.key)}"><span class="k">下一条（更早）→</span><span class="v">${esc(nextIt.title)}</span></a>` : ''}
  </nav>`
        : '';

      const moreHtml = sameCat.length
        ? `<h2 class="sec-h">${esc(catLabel)} · 更多</h2>
<div class="lst">
${sameCat.map((x) => `  <a href="/news/${esc(a.slug)}/${esc(x.key)}"><span class="cat">${esc(x.category || '公告')}</span><span><span class="nm">${esc(x.title)}</span><span class="sm">${esc(x.date || '')}</span></span></a>`).join('\n')}
</div>`
        : '';

      // isBasedOn 保留官方原文地址，仅写在结构化数据里（访客看不到、点不到），
      // 用于向搜索引擎标明转载出处；页面正文中不出现任何外站链接。
      const ldItem = {
        '@context': 'https://schema.org', '@type': 'NewsArticle',
        headline: it.title,
        description: (it.summary || `${gameName}官方公告`).slice(0, 150),
        datePublished: it.date || undefined,
        dateModified: synced,
        articleSection: catLabel,
        inLanguage: 'zh-CN',
        isBasedOn: it.url,
        author: { '@type': 'Organization', name: '三九互娱官方专区' },
        publisher: { '@type': 'Organization', name: '小梦怀旧手游', logo: { '@type': 'ImageObject', url: SITE + '/assets/images/logo_xiaomeng.png' } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': itemUrl }
      };
      const ldItemCrumb = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: '官方公告', item: newsUrl },
          { '@type': 'ListItem', position: 3, name: `《${gameName}》官方公告`, item: SITE + '/news/' + a.slug },
          { '@type': 'ListItem', position: 4, name: it.title, item: itemUrl }
        ]
      };

      const itemHtml = head(`${it.title} - 《${gameName}》官方公告 - 小梦怀旧手游`,
        (it.summary || `${gameName}官方公告`).slice(0, 150),
        itemUrl,
        { prefix: '../../', ogType: 'article', published: it.date, ld: [ldItem, ldItemCrumb] }
      ) + `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><a href="/news">官方公告</a><i>/</i><a href="/news/${esc(a.slug)}">《${esc(gameName)}》</a><i>/</i><span>${esc(catLabel)}</span></nav>
  <article class="nitem">
    <span class="tag">${esc(catLabel)}</span>
    <h1 class="ttl">${esc(it.title)}</h1>
    <div class="nmeta">
      <span>${esc(it.date || '官方未标注日期')}</span>
      <span>来源：三九互娱《${esc(gameName)}》官方专区</span>
      <span>本站收录于 ${esc(synced)}</span>
    </div>
    <div class="body">
${bodyHtml}
    </div>
    <div class="src-note">本条内容为《${esc(gameName)}》官方专区公开公告，由本站自动同步收录、未作改写，仅供玩家查阅。原始出处：三九互娱官方专区（3975.com）。本站页面内不设任何站外跳转；如需核对原文，可在官方专区按标题检索。</div>
  </article>
${pnHtml}
${moreHtml}
  <div class="cta">
    <p>想找更多经典 IP 正版复刻的怀旧手游？回到首页一次看全。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>
</main>
` + foot();

      writeFile('news/' + a.slug + '/' + it.key + '.html', itemHtml);
      sitemapUrls.push({
        loc: itemUrl,
        lastmod: it.date && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : TODAY,
        priority: '0.5'
      });
    });
    console.log(`   ↳ ${a.slug}：生成 ${pubItems.length} 个公告独立页` +
      (pubItems.length !== a.items.length ? `（另有 ${a.items.length - pubItems.length} 条无正文，仅列标题）` : ''));
  });

  console.log('✅ 生成官方公告归档页：1 个总览 + ' + archiveList.length + ' 个专区页，共 ' + totalNews + ' 条公告');
} else {
  /* 2026-09-16 用户要求清空全部官方公告（原抓取内容里有 QQ 群/微信/扫码等导流信息，且正文无图，
     导致「扫描下方二维码」这类文字后面是空的）。这里仍重新生成一个干净的资讯中心空态页，
     避免旧的 news.html 继续对外服务。将来要恢复抓取，把 data 文件填回去即可。 */
  console.log('⏭ 无官方公告数据 → 生成资讯中心空态页');
  writeFile('news.html', head(
    '官网资讯中心 - 开服/合服/维护/活动公告 - 小梦怀旧手游',
    '小梦怀旧手游官网资讯中心：按游戏分类整理手游开服、合服、维护、版本更新与活动公告，支持站内搜索。',
    SITE + '/news',
    { prefix: '', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '官网资讯中心', url: SITE + '/news' }] }
  ) + `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>官网资讯</span></nav>
  <h1 class="ttl">官网资讯中心</h1>
  <p class="lead">这里汇总本站原创资讯，以及各款怀旧手游的官方公告：开服、合服、维护、版本更新与活动。</p>
${editorialTopHtml}${infoSectionHtml}  <p class="lead">官方公告内容正在重新整理，整理好会一款一款放上来。</p>
  <div class="cta">
    <p>想先看看有哪些游戏？游戏大厅里有全部怀旧手游的下载入口和攻略。</p>
    <a class="cta-btn" href="/games">← 去游戏大厅</a>
  </div>
</main>
` + foot());
  fs.writeFileSync(path.join(ROOT, 'js', 'news-index.js'),
    '/* 资讯搜索索引 · 由 scripts/build-articles.js 自动生成，请勿手改 */\nvar NEWS_INDEX=[];\n');
  console.log('✅ 生成 news.html（空态）与空的 js/news-index.js');
}

// ===== 6.6 生成置顶精选专题独立页 /news/feature/<slug>.html =====
// 内容为本站原创编辑（data/editorials.js），整页静态 HTML，六分段正文，供搜索引擎完整抓取收录。
if (editorials.length) {
  editorials.forEach((e) => {
    const slug = String(e.slug || '').trim();
    if (!slug) return;
    const url = SITE + '/news/feature/' + slug;
    const pub = e.date && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) ? String(e.date) : TODAY;
    const contentHtml = fixRel(e.content || '', '../');

    const ho = { '@context': 'https://schema.org', '@type': 'NewsArticle',
      headline: e.title, description: e.summary || '',
      image: e.cover ? [SITE + '/' + String(e.cover).replace(/^assets\//, 'assets/')] : undefined,
      datePublished: pub, dateModified: pub,
      articleSection: e.category || '精选专题', inLanguage: 'zh-CN',
      author: { '@type': 'Organization', name: '小梦怀旧手游' },
      publisher: { '@type': 'Organization', name: '小梦怀旧手游', logo: { '@type': 'ImageObject', url: SITE + '/assets/images/logo_xiaomeng.png' } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url } };
    const hb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: '游戏资讯', item: SITE + '/news' },
        { '@type': 'ListItem', position: 3, name: e.title, item: url }
      ] };

    const html = head(e.title + ' - 小梦怀旧手游资讯', e.summary || '', url, {
      ogType: 'article', image: e.cover, published: pub, active: 'news', ld: [ho, hb]
    }) + `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><a href="/news">游戏资讯</a><i>/</i><span>${esc(e.category || '精选专题')}</span></nav>
  <article>
    <span class="tag">${esc(e.category || '精选专题')}</span>
    <h1 class="ttl">${esc(e.title)}</h1>
    <div class="meta"><span>小梦怀旧手游</span><span>${esc(pub)}</span></div>
    ${e.cover ? `<img class="cover" src="../${esc(String(e.cover).replace(/^assets\//, 'assets/'))}" alt="${esc(e.title)}" loading="eager" fetchpriority="high">` : ''}
    <div class="body">
${contentHtml}
    </div>
  </article>

  <div class="cta">
    <p>更多怀旧手游的最新公告和更新，回到官网资讯中心一次看全。</p>
    <a class="cta-btn" href="/news">← 返回官网资讯中心</a>
  </div>
</main>
` + foot();

    writeFile('news/feature/' + slug + '.html', html);
    sitemapUrls.push({ loc: url, lastmod: pub, priority: '0.8' });
  });
  console.log('✅ 生成置顶精选专题独立页 ' + editorials.length + ' 个（/news/feature/*）');
}

// ===== 7. 生成攻略索引页 guides.html =====
const byGame = articlesByGame;
/* gameId=0 / 无单一游戏归属的文章（例如「N 款游戏月度动态汇总」这类跨游戏长文）单独成组。
   它们原本混在 gameGroups 里，但 buildCard 里取不到 gameById[0] 会整组 return ''，
   导致这类文章在攻略中心完全不可达 —— 改成单独渲染一张卡。 */
const miscArticles = (byGame.get(0) || []).slice()
  .sort((m, n) => String(n.date).localeCompare(String(m.date)));
const gameGroups = [...byGame.entries()]
  .filter(([gid]) => gid !== 0 && gameById[gid])
  .sort((x, y) => y[1].length - x[1].length);
const HOT_COUNT = 4;
const hotGroups = gameGroups.slice(0, HOT_COUNT);
const restGroups = gameGroups.slice(HOT_COUNT);

const guidesIndexHtml = head(
  '全部游戏攻略索引 - 小梦怀旧手游',
  `小梦怀旧手游全部游戏攻略索引，按游戏分类整理：职业加点、开荒路线、打金搬砖、装备获取、版本玩法，一站式查阅，支持站内搜索。`,
  SITE + '/guides',
  { prefix: '', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '全部游戏攻略索引', url: SITE + '/guides' }] }
) + (() => {
  /* 游戏卡片式布局：每张卡片左边是游戏封面+名称，右边是攻略标题列表。
     点击卡片整体 → 进入游戏详情页；点击单篇攻略 → 进入文章页。
     只展示热门游戏（攻略数最多的前 HOT_COUNT 个），其余折叠，点击「展开全部」后显示。 */
  const buildCard = (gid, list, collapsed) => {
    const g = gameById[gid];
    if (!g) return '';
    const gname = g.name;
    const gcat = g.category || '';
    const cover = g.cover || '';
    const showCount = Math.min(4, list.length);
    const shown = list.slice(0, showCount);
    /* 视觉上每张卡只露前 2 篇（CSS nth-child(n+3) 隐藏），所以「还有 N 篇」按 2 计算，
       这样文案与用户实际看到的一致；DOM 里仍保留 4 篇链接供爬虫跟随。 */
    const VISIBLE_ON_CARD = 2;
    const extraCount = Math.max(0, list.length - VISIBLE_ON_CARD);

    const items = shown.map(a => {
      const catClass = (a.category === '资讯') ? 'cat info' : 'cat';
      const catLabel = a.category || '攻略';
      const hay = esc([gname, catLabel, a.title, (a.summary || '')].join(' '));
      return `    <li><a href="/article/${a.id}" data-s="${hay}"><span class="${catClass}">${esc(catLabel)}</span>${esc(a.title)}</a></li>`;
    }).join('\n');

    const more = extraCount > 0
      ? `  <a class="more" href="/game/${gid}">还有 ${extraCount} 篇 →</a>`
      : `  <a class="more" href="/game/${gid}">查看游戏详情 →</a>`;
    const cls = collapsed ? 'gcard collapsed' : 'gcard';

    return `<div class="${cls}" data-href="/game/${gid}">
  <div class="cover">
    <a href="/game/${gid}"><img src="${esc(cover)}" alt="${esc(gname)}" loading="lazy"></a>
  </div>
  <div class="info">
    <div class="top">
      <div>
        <h3 class="gname"><a href="/game/${gid}">${esc(gname)}</a></h3>
        <div class="gcat">${esc(gcat)}</div>
      </div>
      <span class="cnt">${list.length} 篇攻略</span>
    </div>
    <ul class="alist">
${items}
    </ul>
${more}
  </div>
</div>`;
  };

  /* 无单一游戏归属的文章渲染成一张「综合汇总」卡。
     封面用站点 logo —— 与 .gcard .cover img 的 1/1 正方形比例一致。 */
  const buildMiscCard = (list) => {
    if (!list || !list.length) return '';
    const VISIBLE_ON_CARD = 2;
    const shown = list.slice(0, Math.min(4, list.length));
    const extraCount = Math.max(0, list.length - VISIBLE_ON_CARD);
    const items = shown.map(a => {
      const catLabel = a.category || '资讯';
      const catClass = (a.category === '资讯') ? 'cat info' : 'cat';
      const hay = esc(['综合汇总', catLabel, a.title, (a.summary || '')].join(' '));
      return `    <li><a href="/article/${a.id}" data-s="${hay}"><span class="${catClass}">${esc(catLabel)}</span>${esc(a.title)}</a></li>`;
    }).join('\n');
    const more = extraCount > 0
      ? `  <a class="more" href="/news">还有 ${extraCount} 篇 →</a>`
      : `  <a class="more" href="/news">查看全部资讯 →</a>`;
    return `<div class="gcard" data-href="/news">
  <div class="cover">
    <a href="/news"><img src="assets/images/logo_xiaomeng.png" alt="综合汇总" loading="lazy"></a>
  </div>
  <div class="info">
    <div class="top">
      <div>
        <h3 class="gname"><a href="/news">综合汇总</a></h3>
        <div class="gcat">多游戏资讯</div>
      </div>
      <span class="cnt">${list.length} 篇</span>
    </div>
    <ul class="alist">
${items}
    </ul>
${more}
  </div>
</div>`;
  };

  const miscCard = buildMiscCard(miscArticles);
  const hotCards = hotGroups.map(([gid, list]) => buildCard(gid, list, false)).join('\n');
  const restCards = restGroups.map(([gid, list]) => buildCard(gid, list, true)).join('\n');
  const moreBtn = restGroups.length ? `  <button class="more-btn" id="moreBtn" type="button">展开全部 ${restGroups.length} 个游戏攻略 ↓</button>` : '';

  return `<main class="wrap wide">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>攻略中心</span></nav>
  <h1 class="ttl">全部游戏攻略索引</h1>
  <p class="lead"><strong>按游戏分组</strong>整理，点击卡片查看全部攻略，也可以直接搜索游戏名或攻略标题。</p>

  <div class="srchbar">
    <input id="guideSearch" type="search" placeholder="搜索游戏名或攻略标题，例如「龙之谷」「打金」" autocomplete="off" aria-label="搜索攻略">
    <button class="srchbtn" id="guideSrchBtn" type="button" aria-label="搜索">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    </button>
    <span class="hint" id="guideHint">输入即搜</span>
  </div>
  <div class="srch-res" id="guideRes" hidden></div>

  <div class="gcards" id="guideCards">
${hotCards}
${miscCard}
  </div>
${moreBtn}
  <div class="gcards" id="guideCardsRest">
${restCards}
  </div>

  <div class="cta">
    <p>想找更多经典 IP 正版复刻的怀旧手游？回到首页一次看全。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>

  <script>
  (function(){
    var box=document.getElementById('guideSearch'),res=document.getElementById('guideRes'),
        hint=document.getElementById('guideHint'),moreBtn=document.getElementById('moreBtn');
    if(!box)return;
    var cards=[].slice.call(document.querySelectorAll('.gcard'));
    var links=[].slice.call(document.querySelectorAll('.gcard .alist a'));
    var collapsedCards=cards.filter(function(c){return c.classList.contains('collapsed')});
    var IDLE_HINT='输入即搜';
    var expanded=false;

    function applyCollapse(){
      collapsedCards.forEach(function(c){c.classList.toggle('collapsed',!expanded)});
      if(moreBtn){moreBtn.hidden=expanded;}
    }

    // 卡片点击跳转（点击内部链接时不触发）
    cards.forEach(function(card){
      card.addEventListener('click',function(e){
        if(e.target.closest('a'))return;
        var href=card.getAttribute('data-href');
        if(href)window.location.href=href;
      });
    });

    if(moreBtn){
      moreBtn.addEventListener('click',function(e){
        e.preventDefault();
        expanded=!expanded;
        applyCollapse();
        if(!expanded && moreBtn){
          moreBtn.scrollIntoView({behavior:'smooth',block:'center'});
        }
      });
    }

    // 保存原始顺序，清空搜索时恢复
    var allContainer=document.getElementById('guideCards');
    var restContainer=document.getElementById('guideCardsRest');
    var cardOrder=[];
    cards.forEach(function(c){cardOrder.push(c);});

    function render(){
      var q=String(box.value||'').trim().toLowerCase();
      var i,j;
      if(!q){
        // 恢复原始顺序
        for(i=0;i<cardOrder.length;i++){
          var c=cardOrder[i];
          c.hidden=false;
          c.classList.remove('srch');
          var items=c.querySelectorAll('.alist a');
          for(var k=0;k<items.length;k++){items[k].hidden=false;items[k].classList.remove('hit');}
          if(c.classList.contains('collapsed')){
            if(restContainer)restContainer.appendChild(c);
          }else{
            if(allContainer)allContainer.appendChild(c);
          }
        }
        applyCollapse();
        res.hidden=true;res.innerHTML='';
        hint.textContent=IDLE_HINT;
        return;
      }
      // 多关键词搜索：空格分隔，全部匹配才算命中（AND 逻辑）
      var keywords=q.split(/\\s+/).filter(function(k){return k.length>0;});
      // 搜索时展开所有折叠卡片
      collapsedCards.forEach(function(c){c.classList.remove('collapsed')});
      var n=0;
      var hitCards=[],missCards=[];
      for(i=0;i<cards.length;i++){
        var items=[].slice.call(cards[i].querySelectorAll('.alist a')),hit=0;
        for(j=0;j<items.length;j++){
          var hay=(items[j].getAttribute('data-s')||'').toLowerCase();
          var ok=true;
          for(var ki=0;ki<keywords.length;ki++){
            if(hay.indexOf(keywords[ki])<0){ok=false;break;}
          }
          items[j].hidden=!ok;
          if(ok){hit++;items[j].classList.add('hit');}else{items[j].classList.remove('hit');}
        }
        cards[i].hidden=(hit===0);
        cards[i].classList.toggle('srch',hit>0);
        if(hit>0)hitCards.push(cards[i]);else missCards.push(cards[i]);
        n+=hit;
      }
      // 匹配的卡片移到最前面
      var container=allContainer || cards[0].parentElement;
      for(i=0;i<hitCards.length;i++){
        container.appendChild(hitCards[i]);
      }
      hint.textContent=(n?('命中 '+n+' 篇'):'0 篇');
      if(n){
        res.hidden=true;res.innerHTML='';
        // 滚动到结果区域顶部
        setTimeout(function(){
          if(container){
            container.scrollIntoView({behavior:'smooth',block:'start'});
          }
        },50);
        return;
      }
      var d=document.createElement('div');
      d.textContent=box.value.trim();
      res.innerHTML='<p class="empty">没有找到与「'+d.innerHTML+'」相关的攻略。换个关键词试试，比如游戏名或「打金」「职业」。</p>';
      res.hidden=false;
    }
    box.addEventListener('input',render);
    box.addEventListener('keyup',render);
    box.addEventListener('change',render);
    box.addEventListener('search',render);
    box.addEventListener('keydown',function(e){if(e.key==='Escape'){box.value='';render();box.blur();}});
    var srchBtn=document.getElementById('guideSrchBtn');
    if(srchBtn){srchBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();render();box.blur();});}
  })();
  </script>
</main>
`;
})() + foot();
writeFile('guides.html', guidesIndexHtml);
console.log('✅ 生成 guides.html（' + articles.length + ' 篇 / ' + gameGroups.length + ' 组，含站内搜索）');

// ===== 7b. 生成站内搜索索引 js/search-index.js =====
// 首页顶部搜索框用；随内容自动重建，避免索引与页面脱节。
const searchGuides = articles.map(a => ({
  k: 'a',
  t: a.title,
  s: String(a.summary || '').slice(0, 60),
  u: '/article/' + a.id,
  g: (gameById[a.gameId] && gameById[a.gameId].name) || ''
}));
const searchGames = games.map(g => ({
  k: 'g',
  t: g.name,
  s: [g.category, g.year].filter(Boolean).join(' · '),
  u: '/game/' + g.id,
  g: ''
}));
const searchIndexSrc = '/* 站内搜索索引 · 由 scripts/build-articles.js 自动生成，请勿手改 */\n' +
  'var SEARCH_INDEX=' +
  JSON.stringify(searchGames.concat(searchGuides)).replace(/</g, '\\u003c') +
  ';\n';
fs.writeFileSync(path.join(ROOT, 'js', 'search-index.js'), searchIndexSrc);
console.log('✅ 生成 js/search-index.js（攻略 ' + searchGuides.length + ' + 游戏 ' + searchGames.length +
  '，' + Buffer.byteLength(searchIndexSrc, 'utf8') + ' 字节）');

// ===== 8. 生成游戏索引页 games.html =====
const gamesHtml = head(
  '全部怀旧手游大全 - 小梦怀旧手游',
  `小梦怀旧手游收录 ${games.length} 款经典端游正版复刻怀旧手游：传奇、奇迹MU、仙境传说、龙之谷、武林外传、永恒岛等，点击进入游戏详情页查看官方下载入口与攻略。`,
  SITE + '/games',
  { prefix: '', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '全部怀旧手游大全', url: SITE + '/games' }] }
) + `<main class="wrap wide">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>游戏大厅</span></nav>
  <h1 class="ttl">全部怀旧手游大全</h1>
  <p class="lead">共收录 <strong>${games.length}</strong> 款经典端游正版复刻手游。点击卡片进入游戏详情页，查看官方信息、下载入口与全部攻略。</p>
  <div class="grid">
${[...games].sort((a, b) => (b.heat || 0) - (a.heat || 0)).map(g => {
  const cnt = (byGame.get(g.id) || []).length;
  return `    <a class="card" href="/game/${g.id}" id="g-${g.id}">
      <img src="${esc(g.cover)}" alt="${esc(g.name)}" loading="lazy"${sizeAttrs(g.cover)}>
      <div class="bd">
        <div class="nm">${esc(g.name)}</div>
        <div class="ds">${esc((g.desc || '').slice(0, 42))}</div>
        <div class="row">
          <span class="btn">游戏详情</span>
          ${cnt ? `<span class="btn ghost">攻略 ${cnt}</span>` : ''}
        </div>
      </div>
    </a>`;
}).join('\n')}
  </div>
</main>
` + foot();
writeFile('games.html', gamesHtml);
console.log('✅ 生成 games.html（' + games.length + ' 款）');

// ===== 9. 生成 404.html =====
const recent = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
const notFoundHtml = head('页面不存在 - 小梦怀旧手游', '你要找的页面可能已经下线，或者地址写错了。', SITE + '/404', {
  prefix: '/', robots: 'noindex, follow'
}) + `<main class="wrap">
  <h1 class="ttl">页面不存在</h1>
  <p class="lead">你要找的页面可能已经下线，或者地址写错了。下面这些入口应该能帮到你。</p>
  <p style="margin-bottom:34px">
    <a class="btn" href="/" style="padding:11px 24px;font-size:14px">返回首页</a>
    <a class="btn ghost" href="/games" style="padding:11px 24px;font-size:14px">全部游戏</a>
    <a class="btn ghost" href="/guides" style="padding:11px 24px;font-size:14px">全部攻略</a>
  </p>
  <h2 class="sec-h">最新攻略</h2>
  <div class="lst">
${recent.map(a => `    <a href="/article/${a.id}"><span class="cat">${esc(a.category || '攻略')}</span><span class="nm">${esc(a.title)}</span></a>`).join('\n')}
  </div>
</main>
` + foot();
writeFile('404.html', notFoundHtml);
console.log('✅ 生成 404.html');

// ===== 10. 首页埋点与 SEO 链接区块 =====
const INDEX_MARK_START = '<!-- SEO-LINKS:START -->';
const INDEX_MARK_END = '<!-- SEO-LINKS:END -->';
const WRONG_PRELOAD = '<link rel="preload" as="image" href="assets/images/hero/hero_longzhigu.webp" fetchpriority="high">';
const RIGHT_PRELOAD = '<link rel="preload" as="image" href="assets/images/jizhan_cover.jpg" type="image/jpeg" fetchpriority="high">';
const SLIDES_OLD = "'<div class=\"card-img\"><img src=\"'+s.img+'\" alt=\"'+esc(s.g)+'\" draggable=\"false\">'+";
const SLIDES_NEW = "'<div class=\"card-img\"><img src=\"'+s.img+'\" alt=\"'+esc(s.g)+'\" draggable=\"false\" '+(i===0?'fetchpriority=\"high\" decoding=\"async\"':'loading=\"lazy\" decoding=\"async\"')+'>'+";
const LAZY_GUARD = 'fetchpriority="high" decoding="async"';

function ensureIndexHooks() {
  const file = path.join(ROOT, 'index.html');
  let src = fs.readFileSync(file, 'utf8');
  const notes = [];

  if (src.includes(WRONG_PRELOAD)) {
    src = src.replace(WRONG_PRELOAD, RIGHT_PRELOAD);
    notes.push('preload 已修正为轮播真实首图');
  }

  if (!src.includes(LAZY_GUARD)) {
    if (src.includes(SLIDES_OLD)) {
      src = src.replace(SLIDES_OLD, SLIDES_NEW);
      notes.push('轮播已改为「首图高优先级 + 其余懒加载」');
    } else {
      notes.push('⚠️ 轮播模板未命中，可能已被改动，跳过了懒加载改写');
    }
  }

  if (!src.includes(INDEX_MARK_START)) {
    const before = src;
    src = src.replace(
      '</body></html>',
      INDEX_MARK_START + '\n<!-- 此区块由 scripts/build-articles.js 自动生成，请勿手动编辑 -->\n' + INDEX_MARK_END + '\n\n</body></html>'
    );
    notes.push(src === before ? '⚠️ 未找到 </body></html>，SEO 标记未能插入' : '已插入 SEO 链接区块标记');
  }

  if (!src.includes('.seo-crawl-links{')) {
    src = src.replace('</style>', INDEX_EXTRA_CSS + '</style>');
    notes.push('已补爬虫链接区样式');
  }

  if (notes.length) {
    fs.writeFileSync(file, src);
    notes.forEach(n => console.log('   · ' + n));
  } else {
    console.log('   · 首页埋点已是最新，无需改动');
  }
}
console.log('\n🔧 检查首页埋点');
ensureIndexHooks();

const SEO_START = '<!-- SEO-LINKS:START -->';
const SEO_END = '<!-- SEO-LINKS:END -->';
const HUB_START = '<!-- HOME-HUB:START -->';
const HUB_END = '<!-- HOME-HUB:END -->';
const indexRel = 'index.html';
let indexSrc = fs.readFileSync(path.join(ROOT, indexRel), 'utf8');

const sortedGames = [...games].sort((a, b) => (b.heat || 0) - (a.heat || 0));
const sortedArticles = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
/* 2026-09-15 用户要求：页脚到版权行为止，下方不再有可见链接区块。
   只保留 <noscript> —— 人看不到，但不执行 JS 的爬虫仍能从这里发现全部内页。 */
const seoBlock = `${SEO_START}
  <noscript>
  <div class="seo-noscript">
    <p><a href="/games">全部游戏（${games.length} 款）</a> · <a href="/guides">全部攻略</a></p>
    <h2>全部游戏（${games.length} 款）</h2>
    <ul>
${sortedGames.map(g => `      <li><a href="/game/${g.id}">${esc(g.name)}</a></li>`).join('\n')}
    </ul>
    <h2>全部攻略</h2>
    <ul>
${sortedArticles.map(a => `      <li><a href="/article/${a.id}">${esc(a.title)}</a></li>`).join('\n')}
    </ul>
  </div>
  </noscript>
  ${SEO_END}`;

if (indexSrc.includes(SEO_START) && indexSrc.includes(SEO_END)) {
  indexSrc = indexSrc.replace(new RegExp(SEO_START + '[\\s\\S]*?' + SEO_END), () => seoBlock);
  console.log('✅ index.html SEO 链接区块已更新（游戏 ' + games.length + ' / 攻略 ' + articles.length + '，游戏链接指向 /game/N）');
} else {
  console.log('⚠️  跳过：index.html 里找不到 ' + SEO_START + ' 标记，请先手动加入标记');
}

/* ===== 10c. 首页游戏网格「构建期预渲染」（2026-09-16 新增）=====
   审计发现：首页 #gameGrid 的真实卡片全靠 JS 渲染（renderGames()），不执行 JS 的爬虫
   在首页看不到任何 /game/N 链接；残留的那块旧静态网格还是 onclick 弹窗版、且硬编码了一条渠道链接。
   这里按 renderGames() 完全相同的模板，把全部游戏静态写进 <!-- GAME-GRID:START/END -->，
   让百度/搜狗等爬虫直接拿到 42 个真实 <a href="/game/N">。 */
const GRID_START = '<!-- GAME-GRID:START -->';
const GRID_END = '<!-- GAME-GRID:END -->';
const fmtHeat = (h) => (h >= 10000 ? (h / 10000).toFixed(1) + '万' : h);
let inlineGames = [];
try {
  inlineGames = new Function('return (' + extractBalanced(indexSrc, 'var GAMES', '[', ']') + ');')();
} catch (e) {
  console.log('⚠️  内联 var GAMES 解析失败，首页游戏网格未预渲染：' + e.message);
}
if (Array.isArray(inlineGames) && inlineGames.length) {
  const gridCards = [...inlineGames].sort((a, b) => (b.heat || 0) - (a.heat || 0)).map((g) => {
    const hasPlatform = (g.androidUrl && g.androidUrl !== '') || (g.iosUrl && g.iosUrl !== '');
    return '<a class="gcard" href="/game/' + g.id + '">' +
      '<div class="cv"><img src="' + g.cover + '" alt="' + esc(g.name) + '" loading="lazy"></div>' +
      '<div class="bd"><div class="nm">' + esc(g.name) + '</div>' +
      '<div class="meta"><span class="score">★ ' + esc(g.sc) + '</span>' +
      (hasPlatform ? '<span class="plat" title="支持安卓/iOS分版本下载">📱 双端</span>' : '') + '</div>' +
      '<div class="ft"><span class="heat">🔥 ' + fmtHeat(g.heat) + '</span><span class="go">查看详情 ↗</span></div>' +
      '</div></a>';
  }).join('');
  const gridBlock = GRID_START + gridCards + GRID_END;
  if (indexSrc.includes(GRID_START) && indexSrc.includes(GRID_END)) {
    indexSrc = indexSrc.replace(new RegExp(GRID_START + '[\\s\\S]*?' + GRID_END), () => gridBlock);
    console.log('✅ index.html 游戏网格已预渲染（' + inlineGames.length + ' 张卡片，链接为真实 /game/N）');
  } else {
    console.log('⚠️  跳过：index.html 的 #gameGrid 里找不到 ' + GRID_START + ' 标记');
  }
}


/* ===== 10b. 首页「官网资讯 / 游戏攻略」入口区 =====
   2026-09-16 用户要求：这两个板块内容太多、手机端滑不到底 → 收成两个导航按键放到独立页面。
   首页只留：两张入口卡（带条数） + 各一条最新标题（CSS 截断，只露出几个字）。 */
const shortDate = (d) => {
  const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : String(d || '');
};
const latestArticle = sortedArticles[0];
const hubBlock = `${HUB_START}
    <div class="hub-grid">
      <a class="hub-card" href="/news">
        <div><span class="hub-ic">📣</span><span class="hub-kick">NOTICES</span></div>
        <h3 class="hub-t">官网资讯</h3>
        <p class="hub-p">开服 · 合服 · 维护 · 版本更新 · 活动福利，按游戏分类整理，支持站内搜索。</p>
        <span class="hub-go">进入资讯中心 →</span>
      </a>
      <a class="hub-card" href="/guides">
        <div><span class="hub-ic">📖</span><span class="hub-kick">GUIDES</span></div>
        <h3 class="hub-t">游戏攻略</h3>
        <p class="hub-p">新手避坑 · 职业加点 · 打金搬砖 · 版本玩法，按游戏分类整理，支持站内搜索。</p>
        <span class="hub-go">进入攻略中心 →</span>
      </a>
    </div>
    <div class="hub-latest">
      ${hubNews ? `<a class="hub-line" href="${hubNews.latestUrl}"><span class="lb">最新资讯</span><span class="tx">${esc(hubNews.latestTitle)}</span><span class="dt2">${esc(shortDate(hubNews.latestDate))}</span></a>` : ''}
      <a class="hub-line" href="/article/${latestArticle.id}"><span class="lb">最新攻略</span><span class="tx">${esc(latestArticle.title)}</span><span class="dt2">${esc(shortDate(latestArticle.date))}</span></a>
    </div>
  ${HUB_END}`;

if (indexSrc.includes(HUB_START) && indexSrc.includes(HUB_END)) {
  indexSrc = indexSrc.replace(new RegExp(HUB_START + '[\\s\\S]*?' + HUB_END), () => hubBlock);
  console.log('✅ index.html 资讯/攻略入口区已更新（攻略 ' + articles.length + ' 篇 / ' + articlesByGame.size + ' 款，' +
    (hubNews ? '资讯 ' + hubNews.total + ' 条 / ' + hubNews.archives + ' 专区' : '资讯暂无内容') + '）');
} else {
  console.log('⚠️  跳过：index.html 里找不到 ' + HUB_START + ' 标记，入口区未生成');
}

/* ===== 10c. 首页数量文案：构建时按真实数量注入 =====
   2026-09-18：原文案写死「39+ 款 / 44+ 篇」，而实际已是 42 款 / 59 篇，
   且每次增删内容都会再错一次。改为读 <!--CNT:games--> / <!--CNT:articles--> 标记，
   在这次构建里替换成真实数字，之后永不再过期。 */
const injectCount = (src, key, text) => src.replace(
  new RegExp("(<!--CNT:" + key + "-->)[\\s\\S]*?(<!--/CNT-->)", "g"),
  (m, a, b) => a + text + b);
/* 判定用「有没有找到标记」，而不是「内容有没有变」——
   数字本来就没变时（例如连跑两次构建），内容也不会变，用后者会误报"未找到标记"。 */
const hasGamesMark = indexSrc.indexOf("<!--CNT:games-->") >= 0;
const hasArticlesMark = indexSrc.indexOf("<!--CNT:articles-->") >= 0;
indexSrc = injectCount(indexSrc, "games", games.length + " 款");
indexSrc = injectCount(indexSrc, "articles", articles.length + " 篇");
if (!hasGamesMark && !hasArticlesMark) {
  console.log("⚠️  首页未找到 <!--CNT:games--> / <!--CNT:articles--> 标记，数量文案未注入");
} else {
  console.log("✅ index.html 数量文案已同步（游戏 " + games.length + " 款 / 攻略 " + articles.length + " 篇）");
}

fs.writeFileSync(path.join(ROOT, indexRel), indexSrc);

// ===== 11. 重建 sitemap.xml =====
const sitemapItems = [
  { loc: SITE + '/', lastmod: TODAY, priority: '1.0', changefreq: 'daily' },
  { loc: SITE + '/games', lastmod: TODAY, priority: '0.9', changefreq: 'weekly' },
  { loc: SITE + '/guides', lastmod: TODAY, priority: '0.9', changefreq: 'weekly' },
  ...sitemapUrls.map(it => ({ loc: it.loc, lastmod: it.lastmod, priority: it.priority, changefreq: 'weekly' }))
];
sitemapItems.sort((a, b) => {
  if (a.loc === SITE + '/') return -1;
  if (b.loc === SITE + '/') return 1;
  if (a.priority !== b.priority) return a.priority > b.priority ? -1 : 1;
  return String(b.lastmod).localeCompare(String(a.lastmod));
});

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapItems.map(it => `  <url>
    <loc>${it.loc}</loc>
    <lastmod>${it.lastmod}</lastmod>
    <changefreq>${it.changefreq}</changefreq>
    <priority>${it.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);
console.log('✅ sitemap.xml 已重建，共 ' + sitemapItems.length + ' 条可索引 URL');
console.log('   本次写入 ' + writtenCount + ' 个页面文件 + 1 个 sitemap');
