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
  :root{--ink:#16203a;--ink2:#495571;--muted:#8b94a8;--line:#e7ecf5;--brand:#2456c8;--brand-soft:#eef3fe;--accent:#ff9d2e;--bg:#f6f8fc;--card:#fff}
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}
  a{text-decoration:none;color:var(--brand)}
  img{max-width:100%}
  .topbar{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.94);backdrop-filter:saturate(180%) blur(8px);
    border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:13px 20px}
  .brand{font-weight:700;color:var(--brand);letter-spacing:.5px;font-size:16px}
  .nav{display:flex;gap:20px}
  .nav a{color:var(--ink2);font-size:14px}
  .nav a:hover{color:var(--brand)}
  .wrap{max-width:780px;margin:0 auto;padding:34px 20px 64px}
  .wrap.wide{max-width:1040px}
  .crumb{font-size:13px;color:var(--muted);margin-bottom:20px}
  .crumb a{color:var(--muted)}
  .crumb a:hover{color:var(--brand)}
  .crumb i{font-style:normal;margin:0 7px;opacity:.55}
  .tag{display:inline-block;font-size:12px;font-weight:600;color:#fff;background:var(--accent);border-radius:99px;padding:3px 12px;margin-bottom:14px}
  h1.ttl{font-size:29px;line-height:1.4;font-weight:700;margin:0 0 14px;letter-spacing:-.2px}
  .meta{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px 18px;padding-bottom:20px;margin-bottom:26px;border-bottom:1px solid var(--line)}
  .cover{width:100%;height:auto;display:block;border-radius:12px;margin:0 0 28px;background:#e9eef7;box-shadow:0 6px 22px rgba(20,40,80,.07)}

  /* ===== 正文排版 ===== */
  .body{font-size:16.5px;line-height:1.95;color:#26314c;word-break:break-word}
  .body p{margin:0 0 18px}
  .body h2{font-size:21px;line-height:1.5;font-weight:700;color:var(--ink);margin:40px 0 16px;padding-left:13px;border-left:4px solid var(--brand)}
  .body h2:first-child{margin-top:0}
  .body h3{font-size:17.5px;line-height:1.6;font-weight:600;color:var(--ink);margin:28px 0 12px}
  .body h4{font-size:16px;font-weight:600;color:var(--ink2);margin:22px 0 10px}
  .body ul,.body ol{margin:0 0 18px;padding-left:22px}
  .body li{margin-bottom:8px}
  .body strong{color:var(--ink);font-weight:700}
  .body em{font-style:normal;color:var(--brand);font-weight:600}
  .body blockquote{margin:0 0 20px;padding:14px 18px;background:var(--brand-soft);border-left:3px solid var(--brand);border-radius:0 8px 8px 0;color:#3b4970;font-size:15.5px}
  .body blockquote p:last-child{margin-bottom:0}
  .body table{width:100%;border-collapse:collapse;margin:0 0 22px;font-size:15px;display:block;overflow-x:auto}
  .body th,.body td{border:1px solid var(--line);padding:10px 13px;text-align:left;white-space:nowrap}
  .body th{background:#f2f5fb;font-weight:600;color:var(--ink)}
  .body tr:nth-child(even) td{background:#fafbfe}
  .body img{display:block;width:100%;height:auto;border-radius:10px;margin:26px 0;background:#e9eef7}
  .body figure{margin:26px 0}
  .body figure img{margin:0}
  .body figcaption{font-size:13px;color:var(--muted);text-align:center;margin-top:10px}
  .body hr{border:none;border-top:1px solid var(--line);margin:34px 0}

  /* ===== 文末返回首页按钮 ===== */
  .cta{margin:44px 0 0;padding:26px 22px;text-align:center;background:linear-gradient(135deg,#f2f6ff,#eaf1ff);
    border:1px solid #dbe6fb;border-radius:14px}
  .cta p{margin:0 0 16px;font-size:15px;color:var(--ink2)}
  .cta-btn{display:inline-block;font-size:15px;font-weight:600;color:#fff!important;background:var(--brand);
    padding:12px 30px;border-radius:99px;box-shadow:0 6px 18px rgba(36,86,200,.25);transition:transform .15s,box-shadow .15s}
  .cta-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(36,86,200,.3)}

  /* ===== 相关阅读 ===== */
  .sec-h{font-size:19px;font-weight:700;margin:46px 0 16px;color:var(--ink)}
  .rel{display:grid;grid-template-columns:1fr;gap:10px}
  .rel a{display:flex;align-items:center;gap:11px;padding:13px 16px;border:1px solid var(--line);border-radius:10px;
    background:var(--card);color:var(--ink);transition:box-shadow .18s,border-color .18s}
  .rel a:hover{border-color:#cfdcf7;box-shadow:0 4px 16px rgba(20,40,80,.07)}
  .rel .cat{flex:none;font-size:11px;font-weight:600;color:#fff;background:var(--brand);border-radius:5px;padding:2px 9px}
  .rel .nm{font-size:15px;font-weight:600;line-height:1.6}

  /* ===== 游戏页 ===== */
  .ghero{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap;margin-bottom:28px}
  .ghero .pic{flex:none;width:210px;border-radius:12px;overflow:hidden;background:#e9eef7;box-shadow:0 6px 22px rgba(20,40,80,.08)}
  .ghero .pic img{display:block;width:100%;height:auto}
  .ghero .info{flex:1;min-width:230px}
  .ghero h1{font-size:27px;margin:0 0 10px}
  .ghero .sub{font-size:14px;color:var(--ink2);margin-bottom:14px}
  .score{font-size:14px;color:#e8a13a;font-weight:700;margin-bottom:16px}
  .dl{display:flex;gap:12px;flex-wrap:wrap}
  .dl a{display:inline-block;font-size:15px;font-weight:600;color:#fff!important;padding:11px 26px;border-radius:99px;transition:transform .15s}
  .dl a:hover{transform:translateY(-2px)}
  .dl .and{background:#2456c8;box-shadow:0 6px 16px rgba(36,86,200,.25)}
  .dl .ios{background:#2c3550;box-shadow:0 6px 16px rgba(44,53,80,.22)}
  .facts{width:100%;border-collapse:collapse;margin:4px 0 30px;font-size:15px}
  .facts th,.facts td{border:1px solid var(--line);padding:11px 14px;text-align:left}
  .facts th{background:#f2f5fb;width:118px;font-weight:600;color:var(--ink)}
  .facts td{color:var(--ink2)}
  .prose{font-size:16px;line-height:1.95;color:#26314c;margin-bottom:30px}
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
  .src-note{margin:32px 0 0;padding:14px 16px;background:#f4f7fd;border:1px solid #e3ecfa;border-radius:10px;font-size:13px;line-height:1.8;color:var(--ink2)}
  .pn{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0 0}
  .pn a{flex:1;min-width:240px;padding:13px 16px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
  .pn a:hover{border-color:#cfdcf7;box-shadow:0 4px 16px rgba(20,40,80,.07)}
  .pn .k{display:block;font-size:11px;color:var(--muted);margin-bottom:5px}
  .pn .v{font-size:14.5px;font-weight:600;line-height:1.6}
  .lst .sm{display:block;font-size:12.5px;color:var(--muted);margin-top:4px}
  /* 公告归档页 */
  .acards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:0 0 30px}
  .acard{border:1px solid var(--line);border-radius:11px;background:var(--card);padding:16px 18px;display:block;color:var(--ink)}
  .acard:hover{box-shadow:0 6px 20px rgba(20,40,80,.09)}
  .acard .an{font-weight:700;font-size:16px;margin-bottom:6px}
  .acard .am{font-size:13px;color:var(--muted)}
  .catnav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
  .catnav a{font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:99px;color:var(--ink2);background:var(--card)}
  .catnav a:hover{border-color:var(--brand);color:var(--brand)}
  .cathd{margin:30px 0 4px;font-size:17px;font-weight:700;padding-bottom:8px;border-bottom:2px solid var(--line)}
  .cathd .cn{font-size:13px;font-weight:400;color:var(--muted);margin-left:8px}
  .hl li{position:relative;padding-left:24px;margin-bottom:10px;font-size:15.5px;color:#33405f}
  .hl li:before{content:"◆";position:absolute;left:0;top:0;color:var(--brand);font-size:12px}
  .gcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}
  .gcard{border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--card);display:block;color:var(--ink)}
  .gcard:hover{box-shadow:0 6px 20px rgba(20,40,80,.09)}
  .gcard img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#e9eef7}
  .gcard .bd{padding:11px 13px}
  .gcard .nm{font-size:14.5px;font-weight:600;margin-bottom:5px}
  .gcard .ds{font-size:12px;color:var(--muted);line-height:1.6}

  /* ===== 索引页 ===== */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
  .card{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);display:block;color:var(--ink)}
  .card:hover{box-shadow:0 8px 24px rgba(20,40,80,.09)}
  .card img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#e9eef7}
  .card .bd{padding:13px 15px}
  .card .nm{font-size:15.5px;font-weight:600;margin-bottom:6px}
  .card .ds{font-size:12.5px;color:var(--muted);line-height:1.65;margin-bottom:11px;min-height:40px}
  .card .row{display:flex;gap:8px;flex-wrap:wrap}
  .btn{display:inline-block;font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:7px;background:var(--brand);color:#fff!important}
  .btn.ghost{background:var(--brand-soft);color:var(--brand)!important}
  .lead{font-size:15px;color:var(--ink2);margin:0 0 32px}
  .grp-h{font-size:19px;font-weight:700;margin:38px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--line);
    display:flex;align-items:baseline;gap:10px;scroll-margin-top:86px}
  .grp-h .cnt{font-size:12px;font-weight:400;color:var(--muted)}
  .lst{display:grid;grid-template-columns:1fr;gap:10px}
  .lst a{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
  .lst a:hover{box-shadow:0 4px 16px rgba(20,40,80,.07)}
  .lst .cat{flex:none;font-size:11px;font-weight:600;color:#fff;background:var(--brand);border-radius:5px;padding:2px 9px;margin-top:2px}
  .lst .nm{font-size:15px;font-weight:600;line-height:1.6;display:block}
  .lst .sm{font-size:13px;color:var(--muted);margin-top:4px;line-height:1.6;display:block}
    /* ===== 站内搜索 / 分类芯片（攻略中心 · 资讯中心） ===== */
  .srchbar{display:flex;gap:12px;align-items:center;margin:0 0 20px}
  .srchbar input{flex:1;min-width:0;height:48px;padding:0 16px;border-radius:12px;border:1px solid var(--line);
    background:var(--card);color:var(--ink);font-size:15px;font-family:inherit;outline:none;transition:border-color .18s,box-shadow .18s}
  .srchbar input:focus{border-color:#b9cdf3;box-shadow:0 0 0 4px rgba(36,86,200,.08)}
  .srchbar .hint{flex:none;font-size:13px;color:var(--muted);white-space:nowrap}
  .srch-res{margin:0 0 26px}
  .srch-res .hd{font-size:13px;color:var(--muted);margin:0 0 10px}
  .srch-res .empty{font-size:14px;color:var(--muted);padding:18px 0;margin:0}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
  .chips a{font-size:13px;padding:6px 13px;border:1px solid var(--line);border-radius:99px;color:var(--ink2);background:var(--card)}
  .chips a:hover{border-color:var(--brand);color:var(--brand)}
  .chips a b{font-weight:600;color:var(--muted);margin-left:5px}
  @media (max-width:640px){
    .srchbar{flex-direction:column;align-items:stretch;gap:8px}
    .srchbar .hint{text-align:right}
  }
.foot{text-align:center;padding:34px 20px;border-top:1px solid var(--line);background:#fff;font-size:13px;color:var(--muted)}
  .foot a{color:var(--muted);margin:0 10px}
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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    <a href="/guides">攻略中心</a>
    <a href="/">首页</a>
  </nav>
</header>
`;
}

function foot() {
  return `
<footer class="foot">
  <a href="/">首页</a>
  <a href="/games">全部游戏</a>
  <a href="/guides">全部攻略</a>
  <p style="margin:14px 0 0">本站仅提供游戏导航与攻略信息 · 游戏版权归各开发商所有</p>
  <p style="margin:6px 0 0">© 2026 小梦怀旧手游 · fmbly.com</p>
</footer>
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
    ? `<h2 class="sec-h">继续阅读</h2>
<div class="rel">
${related.map(r => `  <a href="/article/${r.id}"><span class="cat">${esc(r.category || '攻略')}</span><span class="nm">${esc(r.title)}</span></a>`).join('\n')}
</div>`
    : '';

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

  <div class="cta">
    <p>这篇攻略对你有帮助吗？回到首页，还有更多怀旧手游和攻略等你发现。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>
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
<div class="gcards">
${others.map(o => `  <a class="gcard" href="/game/${o.id}">
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
    image: g.cover ? SITE + '/' + g.cover : undefined,
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
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>官方公告</span></nav>
  <h1>手游官方公告合集</h1>
  <p class="lead">本页汇总本站收录的怀旧手游官方专区公开公告，<strong>按游戏分类</strong>整理，包含开服、合服、维护、版本更新与活动等。
  每条公告均已收录到本站独立页面，点击即可直接阅读全文，无需跳转任何外部站点。</p>

  <div class="srchbar">
    <input id="newsSearch" type="search" placeholder="搜索游戏名或公告标题，例如「龙之谷」「维护」" autocomplete="off" aria-label="搜索官方资讯">
    <span class="hint" id="newsHint">输入即搜</span>
  </div>
  <div class="srch-res" id="newsRes" hidden></div>

  <div id="newsBrowse">
  <h2 class="sec-h">按游戏分类</h2>
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
    box.addEventListener('keydown',function(e){if(e.key==='Escape'){box.value='';render();box.blur();}});
  })();
  </script>
</main>
` + foot();


  const newsUrl = SITE + '/news';
  writeFile('news.html', head(
    '手游官方公告合集 - 开服/合服/维护/活动 - 小梦怀旧手游',
    `按游戏分类汇总怀旧手游的开服、合服、维护、版本更新与活动公告，每条均为站内独立页面，可直接阅读全文。`,
    newsUrl,
    { prefix: '', ld: [{
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: '手游官方公告合集', url: newsUrl, inLanguage: 'zh-CN',
      isPartOf: { '@type': 'WebSite', name: '小梦怀旧手游', url: SITE + '/' }
    }], extraHead: '<script src="/js/news-index.js" defer><\/script>' }
  ) + newsBody);
  sitemapUrls.push({ loc: newsUrl, lastmod: TODAY, priority: '0.7' });

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
  <p class="lead">这里按游戏分类汇总各款怀旧手游的官方公告：开服、合服、维护、版本更新与活动。</p>
  <p class="lead">内容正在重新整理，整理好会一款一款放上来。</p>
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

// ===== 7. 生成攻略索引页 guides.html =====
const byGame = articlesByGame;
const gameGroups = [...byGame.entries()].sort((x, y) => y[1].length - x[1].length);

const guidesIndexHtml = head(
  '全部游戏攻略索引 - 小梦怀旧手游',
  `小梦怀旧手游全部游戏攻略索引，按游戏分类整理：职业加点、开荒路线、打金搬砖、装备获取、版本玩法，一站式查阅，支持站内搜索。`,
  SITE + '/guides',
  { prefix: '', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '全部游戏攻略索引', url: SITE + '/guides' }] }
) + (() => {
  /* 按游戏分组：每组一个 <section class="gsec">，搜索时整组一起隐藏；每条链接带 data-s 供前端过滤 */
  const chips = gameGroups.map(([gid, list]) => {
    const g = gameById[gid];
    return `    <a href="#game-${gid}">${esc(g ? g.name : '其他攻略')}<b>${list.length}</b></a>`;
  }).join('\n');

  const sections = gameGroups.map(([gid, list]) => {
    const g = gameById[gid];
    const gname = g ? g.name : '其他攻略';
    const gLink = g ? `<a href="/game/${g.id}" style="font-size:13px;font-weight:400">查看游戏 →</a>` : '';
    const items = list.map(a => {
      const sm = (a.summary || '').slice(0, 80);
      const hay = esc([gname, a.category || '', a.title, sm].join(' '));
      return `    <a href="/article/${a.id}" data-s="${hay}"><span class="cat">${esc(a.category || '攻略')}</span><span><span class="nm">${esc(a.title)}</span><span class="sm">${esc(sm)}</span></span></a>`;
    }).join('\n');
    return `  <section class="gsec">
  <h2 class="grp-h" id="game-${gid}">${esc(gname)}<span class="cnt">${list.length} 篇</span>${gLink}</h2>
  <div class="lst">
${items}
  </div>
  </section>`;
  }).join('\n');

  return `<main class="wrap wide">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>攻略中心</span></nav>
  <h1 class="ttl">全部游戏攻略索引</h1>
  <p class="lead"><strong>按游戏分组</strong>整理，点击标题直接阅读；也可以在下方搜索框里直接搜游戏名或攻略标题。</p>

  <div class="srchbar">
    <input id="guideSearch" type="search" placeholder="搜索游戏名或攻略标题，例如「龙之谷」「打金」" autocomplete="off" aria-label="搜索攻略">
    <span class="hint" id="guideHint">输入即搜</span>
  </div>
  <div class="srch-res" id="guideRes" hidden></div>

  <div class="chips" id="guideChips">
${chips}
  </div>

${sections}

  <div class="cta">
    <p>想找更多经典 IP 正版复刻的怀旧手游？回到首页一次看全。</p>
    <a class="cta-btn" href="/">← 返回小梦怀旧手游首页</a>
  </div>

  <script>
  (function(){
    var box=document.getElementById('guideSearch'),chips=document.getElementById('guideChips'),
        res=document.getElementById('guideRes'),hint=document.getElementById('guideHint');
    if(!box)return;
    var secs=[].slice.call(document.querySelectorAll('section.gsec'));
    var all=[].slice.call(document.querySelectorAll('section.gsec .lst a'));
    var IDLE_HINT='输入即搜';
    function render(){
      var q=String(box.value||'').trim().toLowerCase();
      var i,j;
      if(!q){
        for(i=0;i<secs.length;i++)secs[i].hidden=false;
        for(i=0;i<all.length;i++)all[i].hidden=false;
        if(chips)chips.hidden=false;
        res.hidden=true;res.innerHTML='';
        hint.textContent=IDLE_HINT;
        return;
      }
      if(chips)chips.hidden=true;
      var n=0;
      for(i=0;i<secs.length;i++){
        var items=[].slice.call(secs[i].querySelectorAll('.lst a')),hit=0;
        for(j=0;j<items.length;j++){
          var ok=(items[j].getAttribute('data-s')||'').toLowerCase().indexOf(q)>=0;
          items[j].hidden=!ok;
          if(ok)hit++;
        }
        secs[i].hidden=(hit===0);
        n+=hit;
      }
      hint.textContent=(n?('命中 '+n+' 篇'):'0 篇');
      if(n){res.hidden=true;res.innerHTML='';return;}
      var d=document.createElement('div');
      d.textContent=box.value.trim();
      res.innerHTML='<p class="empty">没有找到与「'+d.innerHTML+'」相关的攻略。换个关键词试试，比如游戏名或「打金」「职业」。</p>';
      res.hidden=false;
    }
    box.addEventListener('input',render);
    box.addEventListener('keydown',function(e){if(e.key==='Escape'){box.value='';render();box.blur();}});
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
