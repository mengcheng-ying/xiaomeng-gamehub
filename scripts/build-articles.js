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

// 游戏元数据：从首页内联数据（index.html 的 GAMES 数组）提取 id→{grp,sc} 映射。
// 游戏大厅的分类芯片与首页游戏区 tabs 共用 grp 分组，评分显示与首页共用 sc（10 分制），
// 保证两处页面完全一致（2026-09-19 统一改造）。
const gameMeta = (() => {
  const m = {};
  try {
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const re = /\{id:(\d+),[^{}]*?grp:"([^"]+)",sc:"([^"]+)"/g;
    let mm;
    while ((mm = re.exec(idx))) m[mm[1]] = { grp: mm[2], sc: mm[3] };
  } catch (e) { console.log('⚠️ 首页元数据提取失败，游戏大厅将不显示分类芯片：' + e.message); }
  return m;
})();
function grpOf(g) { return (gameMeta[String(g.id)] || {}).grp; }
function scOf(g) { return (gameMeta[String(g.id)] || {}).sc || ((g.rating || 0) + '.0'); }
// 分类芯片顺序与首页游戏区 tabs 保持一致
const GRP_TABS = [
  { k: '三九正版', label: '三九互娱正版' },
  { k: '传奇怀旧', label: '传奇怀旧' },
  { k: '奇迹MU', label: '奇迹MU / RO' },
  { k: '永恒岛', label: '永恒岛系列' },
  { k: '小小屠龙', label: '小小屠龙' },
  { k: '游昕经典', label: '游昕经典' },
  { k: '其他', label: '经典怀旧' },
];

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
  /* ============================================================
     小梦怀旧手游 · 内页设计系统「Midnight Arcade」
     与首页同源色板：深空蓝底 + 蓝青渐变 + 鎏金点缀（2026-09-19 全站重做）
     ============================================================ */
  :root{
    --bg:#0b101a;--bg2:#111827;--bg3:#1a2333;
    --card:#16202f;--card-hover:#1d2a3d;
    --ink:#eef2f7;--tx:#c6d0e2;--ink2:#c6d0e2;--muted:#9aa7ba;--dim:#6b7a90;
    --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.16);
    --brand:#5b8cff;--brand-soft:rgba(61,123,255,.13);--accent:#3d7bff;--accent2:#00d4ff;--gold:#f5b50a;
    --grad:linear-gradient(135deg,#3d7bff,#00d4ff);
    --radius:14px;--radius-sm:10px;
    --shadow:0 10px 40px rgba(0,0,0,.45);
    --glow:0 8px 30px rgba(61,123,255,.22);
    --link:#7ab3ff;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%;scroll-padding-top:88px;color-scheme:dark}
  body{margin:0;color:var(--ink);
    font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;
    background-color:var(--bg);
    background-image:radial-gradient(rgba(255,255,255,.026) 1px,transparent 1.6px);
    background-size:26px 26px}
  /* 顶部氛围光：固定定位，不随长页面滚动拉伸 */
  body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;
    background:radial-gradient(1100px 520px at 10% -6%,rgba(61,123,255,.14),transparent 55%),
      radial-gradient(1000px 540px at 94% 4%,rgba(0,212,255,.07),transparent 55%)}
  a{text-decoration:none;color:var(--link)}
  a:hover{color:#a5c8ff}
  img{max-width:100%}
  ::selection{background:rgba(61,123,255,.4);color:#fff}
  :focus-visible{outline:2px solid var(--accent2);outline-offset:2px;border-radius:4px}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-thumb{background:#233145;border-radius:99px;border:2px solid var(--bg)}
  ::-webkit-scrollbar-thumb:hover{background:#2e4059}
  ::-webkit-scrollbar-track{background:transparent}
  @keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}

  /* ===== 顶部深色导航（与首页同款：深色背景 + 彩色导航键 + 搜索框） ===== */
  .snav{position:sticky;top:0;z-index:120;background:rgba(11,16,26,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(255,255,255,.08)}
  .snav-in{max-width:1200px;margin:0 auto;padding:0 20px;height:68px;display:flex;align-items:center;gap:16px}
  .snav-logo{display:flex;align-items:center;gap:9px;flex:none}
  .snav-logo img{width:30px;height:30px;border-radius:8px;object-fit:cover;box-shadow:0 4px 14px rgba(61,123,255,.4)}
  .snav-logo b{color:#fff;font-size:1.02rem;font-weight:800;letter-spacing:.5px;text-shadow:0 0 20px rgba(61,123,255,.5);white-space:nowrap}
  .snav-links{display:flex;gap:4px;margin-left:auto}
  .snav-links a{padding:8px 15px;font-size:.88rem;color:var(--nc,#5b8cff);border-radius:8px;transition:.2s;white-space:nowrap}
  .snav-links a:nth-child(1){--nc:#5b8cff;--nc-bg:rgba(91,140,255,.18)}
  .snav-links a:nth-child(2){--nc:#22d3ee;--nc-bg:rgba(34,211,238,.18)}
  .snav-links a:nth-child(3){--nc:#ffb454;--nc-bg:rgba(255,180,84,.18)}
  .snav-links a:nth-child(4){--nc:#c084fc;--nc-bg:rgba(192,132,252,.18)}
  .snav-links a:hover{background:rgba(255,255,255,.08)}
  .snav-links a.active{background:var(--nc-bg);font-weight:700;box-shadow:inset 0 0 0 1px var(--nc)}
  .snav-srch{position:relative;flex:0 0 auto}
  .snav-srch .ic{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#9aa7ba;pointer-events:none;display:flex}
  .snav-srch input{width:178px;height:36px;padding:0 14px 0 34px;border-radius:999px;border:1.5px solid rgba(91,140,255,.55);background:rgba(255,255,255,.06);color:#eef2f7;font-size:.84rem;font-family:inherit;outline:none;transition:.22s}
  .snav-srch input::placeholder{color:#6b7a90}
  .snav-srch input:focus{width:214px;border-color:#5b8cff;background:rgba(61,123,255,.1);box-shadow:0 0 0 3px rgba(61,123,255,.18)}
  .snav-cta{flex:none;padding:8px 17px;border-radius:999px;background:linear-gradient(135deg,#3d7bff,#00d4ff);font-size:.82rem;font-weight:600;color:#fff;box-shadow:0 4px 16px rgba(61,123,255,.35);white-space:nowrap}
  .snav-cta:hover{opacity:.92}
  .srch-panel{position:absolute;top:calc(100% + 10px);right:0;width:360px;max-height:400px;overflow:auto;background:#16202f;border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:6px;z-index:130}
  .srch-panel[hidden]{display:none}
  .sp-hd{padding:8px 12px 6px;font-size:.72rem;color:#6b7a90;font-weight:600;letter-spacing:.5px}
  .sp-game{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:9px;border-radius:10px;background:linear-gradient(135deg,rgba(61,123,255,.12),rgba(0,212,255,.06));border:1px solid rgba(61,123,255,.25);margin-bottom:6px;transition:.2s}
  .sp-game:hover{border-color:rgba(61,123,255,.55)}
  .sp-cv{width:64px;height:64px;border-radius:8px;overflow:hidden;background:#0b101a}
  .sp-cv img{width:100%;height:100%;object-fit:cover;display:block}
  .sp-info{min-width:0;display:flex;flex-direction:column;justify-content:center}
  .sp-info .gn{font-size:.88rem;font-weight:700;color:#eef2f7;line-height:1.35;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sp-info .gm{font-size:.72rem;color:#9aa7ba;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sp-info .go{margin-top:5px;font-size:.72rem;color:#5b8cff;font-weight:600}
  .sp-item{display:block;padding:8px 12px;border-radius:8px;transition:.15s}
  .sp-item:hover{background:rgba(61,123,255,.14)}
  .sp-item .t{display:block;font-size:.84rem;font-weight:600;color:#eef2f7;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sp-item .m{display:block;font-size:.7rem;color:#6b7a90;margin-top:2px}
  .srch-empty{padding:18px 12px;text-align:center;font-size:.82rem;color:#9aa7ba}

  /* ===== 版心 ===== */
  .wrap{max-width:800px;margin:0 auto;padding:30px 20px 60px;animation:rise .45s ease both}
  .wrap.wide{max-width:1080px}

  /* ===== 面包屑 ===== */
  .crumb{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:.78rem;color:var(--dim);margin-bottom:18px}
  .crumb a{color:var(--muted);padding:3px 11px;border:1px solid var(--line);border-radius:99px;transition:.18s}
  .crumb a:hover{color:#fff;border-color:var(--line2);background:rgba(255,255,255,.05)}
  .crumb span{color:var(--muted);padding:3px 0}
  .crumb i{font-style:normal;opacity:.5}

  /* ===== 页首横幅（游戏大厅 / 攻略中心 / 资讯中心共用） ===== */
  .pagehead{position:relative;margin:4px 0 24px;padding:26px 28px 24px;border:1px solid var(--line);
    border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#131f34 0%,#0f1929 55%,#101c30 100%)}
  .pagehead::before{content:'';position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(640px 260px at 12% 0%,rgba(61,123,255,.16),transparent 60%),
      radial-gradient(560px 260px at 88% 110%,rgba(0,212,255,.1),transparent 60%)}
  .pagehead>*{position:relative}
  .ph-kick{display:inline-block;font-size:.66rem;font-weight:800;letter-spacing:.34em;
    background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:10px}
  h1.ttl{font-size:1.78rem;line-height:1.35;font-weight:900;color:#fff;margin:0 0 10px;letter-spacing:.02em}
  .lead{font-size:.92rem;color:var(--muted);margin:0 0 24px;line-height:1.85}
  .pagehead .lead{margin:0}
  .lead strong{color:var(--accent2);font-weight:800}
  .ph-stats{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}
  .ph-s{display:inline-flex;align-items:center;gap:5px;padding:4px 13px;border:1px solid var(--line2);
    border-radius:99px;background:rgba(255,255,255,.03);font-size:.76rem;color:var(--muted)}
  .ph-s b{color:#fff;font-weight:800;font-size:.82rem}

  /* ===== 文章页头 ===== */
  .tag{display:inline-block;font-size:.72rem;font-weight:700;color:#fff;background:var(--grad);
    border-radius:99px;padding:3px 13px;margin-bottom:14px;box-shadow:0 4px 14px rgba(61,123,255,.35)}
  .meta{font-size:.8rem;color:var(--dim);display:flex;flex-wrap:wrap;gap:6px 18px;padding-bottom:18px;
    margin-bottom:26px;border-bottom:1px solid var(--line)}
  .meta a{color:var(--muted)}
  .meta a:hover{color:#fff}
  .cover{width:100%;height:auto;display:block;border-radius:16px;margin:0 0 28px;background:#1a2537;
    border:1px solid var(--line);box-shadow:var(--shadow)}

  /* ===== 正文排版（深色阅读版） ===== */
  .body{font-size:16.5px;line-height:2;color:var(--tx);word-break:break-word}
  .body p{margin:0 0 18px}
  .body h2{position:relative;font-size:20px;line-height:1.5;font-weight:800;color:#fff;margin:42px 0 16px;padding-left:14px}
  .body h2::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:4px;border-radius:2px;
    background:var(--grad);box-shadow:0 0 10px rgba(61,123,255,.55)}
  .body h2:first-child{margin-top:0}
  .body h3{font-size:17px;line-height:1.6;font-weight:700;color:#fff;margin:28px 0 12px}
  .body h4{font-size:15.5px;font-weight:700;color:#dbe3f0;margin:22px 0 10px}
  .body ul,.body ol{margin:0 0 18px;padding-left:22px}
  .body li{margin-bottom:8px}
  .body strong{color:#fff;font-weight:700}
  .body em{font-style:normal;color:var(--accent2);font-weight:600}
  .body blockquote{margin:0 0 20px;padding:14px 18px;background:rgba(61,123,255,.08);
    border:1px solid rgba(61,123,255,.2);border-left:3px solid var(--accent);border-radius:0 12px 12px 0;
    color:#b9c6df;font-size:15.5px}
  .body blockquote p:last-child{margin-bottom:0}
  .body table{width:100%;border-collapse:collapse;margin:0 0 22px;font-size:14.5px;display:block;overflow-x:auto}
  .body th,.body td{border:1px solid var(--line2);padding:10px 13px;text-align:left;white-space:nowrap}
  .body th{background:#1c2842;font-weight:700;color:#fff}
  .body td{color:var(--tx)}
  .body tr:nth-child(even) td{background:rgba(255,255,255,.025)}
  .body img{display:block;width:100%;height:auto;border-radius:12px;margin:26px 0;background:#1a2537;border:1px solid var(--line)}
  .body figure{margin:26px 0}
  .body figure img{margin:0}
  .body figcaption{font-size:.8rem;color:var(--dim);text-align:center;margin-top:10px}
  .body hr{border:none;border-top:1px solid var(--line2);margin:34px 0}

  /* ===== 文末 CTA（与首页同款渐变卡） ===== */
  .cta{position:relative;margin:46px 0 0;padding:26px 22px;text-align:center;overflow:hidden;
    border-radius:18px;background:linear-gradient(120deg,#12233f,#0e1a30);border:1px solid rgba(61,123,255,.3)}
  .cta::before{content:'';position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(600px 300px at 20% 0%,rgba(61,123,255,.22),transparent 60%),
      radial-gradient(600px 300px at 80% 100%,rgba(0,212,255,.16),transparent 60%)}
  .cta>*{position:relative}
  .cta p{margin:0 0 16px;font-size:.9rem;color:var(--muted)}
  .cta-btn{display:inline-block;font-size:.9rem;font-weight:700;color:#fff!important;background:var(--grad);
    padding:12px 32px;border-radius:99px;box-shadow:0 8px 26px rgba(61,123,255,.45);transition:transform .16s,box-shadow .16s}
  .cta-btn:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(61,123,255,.55);color:#fff!important}

  /* ===== 小节标题 ===== */
  .sec-h{display:flex;align-items:center;gap:10px;font-size:1.1rem;font-weight:800;color:#fff;margin:36px 0 14px}
  .sec-h::before{content:'';flex:none;width:4px;height:17px;border-radius:2px;background:var(--grad);
    box-shadow:0 0 10px rgba(61,123,255,.5)}
  .rel{display:grid;grid-template-columns:1fr;gap:10px}
  .rel a{display:flex;align-items:center;gap:11px;padding:13px 16px;border:1px solid var(--line);border-radius:12px;
    background:var(--card);color:var(--tx);transition:border-color .18s,background .18s,transform .18s}
  .rel a:hover{border-color:rgba(61,123,255,.45);background:var(--card-hover);transform:translateX(3px)}
  .rel .cat{flex:none;font-size:.68rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#3d7bff,#2f6ef0);border-radius:6px;padding:2px 9px}
  .rel .nm{font-size:.9rem;font-weight:600;line-height:1.6;color:#dbe3f0}

  /* ===== 游戏页英雄区 ===== */
  .ghero{position:relative;display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;margin-bottom:26px;padding:24px;
    border:1px solid var(--line);border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#131f34,#0f1929)}
  .ghero::before{content:'';position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(560px 240px at 8% 0%,rgba(61,123,255,.16),transparent 60%),
      radial-gradient(520px 240px at 95% 110%,rgba(0,212,255,.1),transparent 60%)}
  .ghero>*{position:relative}
  .ghero .pic{flex:none;width:216px;border-radius:14px;overflow:hidden;background:#1a2537;
    border:1px solid var(--line2);box-shadow:var(--shadow)}
  .ghero .pic img{display:block;width:100%;height:auto}
  .ghero .info{flex:1;min-width:240px}
  .ghero h1{font-size:1.62rem;font-weight:900;color:#fff;margin:0 0 8px;letter-spacing:.02em}
  .ghero .sub{font-size:.84rem;color:var(--muted);margin-bottom:14px}
  .statrow{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
  .st{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border:1px solid var(--line2);
    border-radius:99px;font-size:.76rem;color:var(--muted);background:rgba(255,255,255,.03)}
  .st.star{color:var(--gold);border-color:rgba(245,181,10,.35);background:rgba(245,181,10,.08)}
  .dl{display:flex;gap:12px;flex-wrap:wrap}
  .dl a{display:inline-flex;align-items:center;gap:8px;font-size:.92rem;font-weight:700;color:#fff!important;
    padding:12px 28px;border-radius:99px;transition:transform .16s,box-shadow .16s,border-color .16s}
  .dl a:hover{transform:translateY(-2px)}
  .dl svg{flex:none}
  .dl .and{background:var(--grad);box-shadow:0 8px 26px rgba(61,123,255,.45)}
  .dl .ios{background:rgba(255,255,255,.07);border:1px solid var(--line2);box-shadow:0 8px 22px rgba(0,0,0,.35)}
  .dl .ios:hover{border-color:rgba(255,255,255,.32)}
  .prose{font-size:16px;line-height:2;color:var(--tx);margin-bottom:30px}
  .prose p{margin:0 0 16px}
  .hl{margin:0 0 30px;padding:0;list-style:none}
  .news-src{font-size:.8rem;color:var(--dim);margin:-4px 0 16px;line-height:1.7}
  .news-src a{color:var(--link)}
  .news{list-style:none;margin:0 0 30px;padding:0}
  .news li{padding:15px 2px;border-bottom:1px solid var(--line)}
  .news li:first-child{padding-top:0}
  .news li:last-child{border-bottom:0;padding-bottom:6px}
  .news .nh{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .news .nd{font-size:.8rem;color:var(--dim);flex-shrink:0;font-variant-numeric:tabular-nums}
  .news .nc{font-size:.68rem;font-weight:700;padding:2px 9px;border-radius:99px;background:var(--brand-soft);color:#8ab4ff;border:1px solid rgba(61,123,255,.28);flex-shrink:0}
  .news .nh a{font-weight:600;color:#e6ecf6;font-size:.92rem;line-height:1.6}
  .news .nh a:hover{color:var(--accent2)}
  .news .ns{margin:7px 0 0;font-size:.86rem;line-height:1.75;color:var(--muted)}
  .news .nt{font-weight:600;color:var(--tx);font-size:.92rem;line-height:1.6}

  /* ===== 资讯中心：游戏资讯卡片 ===== */
  .ncards{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px;margin:0 0 26px}
  .ncard{display:grid;grid-template-columns:118px 1fr;gap:15px;padding:15px;border:1px solid var(--line);border-radius:16px;
    background:var(--card);transition:transform .2s,box-shadow .2s,border-color .2s}
  .ncard:hover{transform:translateY(-3px);border-color:rgba(61,123,255,.45);box-shadow:var(--glow),var(--shadow)}
  .ncard .ncv{width:118px;height:118px;border-radius:12px;overflow:hidden;background:#1a2537;align-self:start;border:1px solid var(--line)}
  .ncard .ncv img{width:100%;height:100%;object-fit:cover;display:block}
  .ncard .ninfo{min-width:0;display:flex;flex-direction:column}
  .ncard .nhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
  .ncard .ngname{font-size:1rem;font-weight:800;color:#fff;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ncard .ncnt{flex:none;font-size:.7rem;font-weight:700;color:#8ab4ff;background:var(--brand-soft);
    border:1px solid rgba(61,123,255,.28);padding:2px 9px;border-radius:99px;white-space:nowrap}
  .ncard .nlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;flex:1}
  .ncard .nlist li{display:flex;align-items:center;gap:8px;min-width:0}
  .ncard .nlist .nd{flex:none;font-size:.72rem;color:var(--dim);font-variant-numeric:tabular-nums}
  .ncard .nlist .nlk{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    font-size:.84rem;color:#b6c2d8;font-weight:500}
  .ncard .nlist .nlk:hover{color:var(--accent2)}
  .ncard .nmore{margin-top:9px;font-size:.76rem;color:var(--link);font-weight:600;align-self:flex-start}
  .ncard .nmore:hover{opacity:.8}
  /* 彩色分类标签：开服=绿 合服=青 维护=橙 版本更新=蓝 活动=紫 赛事=红 攻略=青绿 其他=灰蓝 */
  .ncat{flex:none;display:inline-block;font-size:.66rem;font-weight:700;color:#fff;border-radius:5px;padding:1.5px 7px;line-height:1.6;white-space:nowrap}
  .ncat.cat-kf{background:#16a34a}
  .ncat.cat-hf{background:#0891b2}
  .ncat.cat-wh{background:#d97706}
  .ncat.cat-bb{background:#3d7bff}
  .ncat.cat-hd{background:#9333ea}
  .ncat.cat-ss{background:#dc2626}
  .ncat.cat-gl{background:#0d9488}
  .ncat.cat-zx{background:#64748b}

  /* ===== 资讯中心紧凑版（2026-09-19 用户反馈：字太大 / 排列松 / 搜索框大）=====
     仅作用于 .newshub 页面（news.html 资讯中心 + news/<专区> 归档页），
     攻略中心与顶部导航搜索不受影响。选择器均带 .newshub 前缀提高优先级。 */
  .newshub .crumb{margin-bottom:12px}
  .newshub h1{font-size:1.42rem;font-weight:900;color:#fff;margin:0 0 10px;letter-spacing:.02em}
  .newshub .lead{font-size:.85rem;margin:0 0 18px;line-height:1.75}
  .newshub .sec-h{font-size:1rem;margin:24px 0 12px}
  .newshub .ncards{gap:12px;margin-bottom:18px}
  .newshub .ncard{grid-template-columns:96px 1fr;gap:12px;padding:12px;border-radius:14px}
  .newshub .ncard .ncv{width:96px;height:96px;border-radius:10px}
  .newshub .ncard .ngname{font-size:.92rem}
  .newshub .ncard .nhead{margin-bottom:7px}
  .newshub .ncard .nlist{gap:3px}
  .newshub .ncard .nlist .nlk{font-size:.8rem}
  .newshub .ncard .nmore{margin-top:7px;font-size:.73rem}
  .newshub .catnav{margin-bottom:6px}
  .newshub .cathd{margin:22px 0 2px;font-size:.98rem;padding-bottom:7px}
  .newshub .news li{padding:12px 2px}
  .newshub .news .nh a,.newshub .news .nt{font-size:.86rem}
  .newshub .news .ns{font-size:.82rem;margin-top:5px}
  .newshub .lst a{padding:11px 14px}
  .newshub .cta{margin-top:32px;padding:20px 18px}
  .newshub .cta p{margin-bottom:12px;font-size:.85rem}
  .newshub .cta-btn{font-size:.85rem;padding:10px 26px}
  @media (max-width:640px){
    .newshub h1{font-size:1.28rem}
    .newshub .ncards{grid-template-columns:1fr;gap:10px}
    .newshub .ncard{grid-template-columns:88px 1fr;gap:10px;padding:11px}
    .newshub .ncard .ncv{width:88px;height:88px}
    .newshub .ncard .nlist .nlk{font-size:12.8px}
  }

  /* ===== 公告正文页 ===== */
  .nitem .nmeta{font-size:.8rem;color:var(--dim);display:flex;flex-wrap:wrap;gap:8px 18px;padding-bottom:18px;margin-bottom:24px;border-bottom:1px solid var(--line)}
  .nitem .body{font-size:16px;line-height:1.9}
  .nitem .body p{margin:0 0 12px}
  .nitem .body h3{margin:22px 0 10px}
  .src-note{margin:32px 0 0;padding:15px 17px;background:rgba(255,255,255,.03);border:1px solid var(--line);
    border-radius:12px;font-size:.8rem;line-height:1.85;color:var(--muted)}
  .pn{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0 0}
  .pn a{flex:1;min-width:240px;padding:13px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink)}
  .pn a:hover{border-color:rgba(61,123,255,.45);background:var(--card-hover)}
  .pn .k{display:block;font-size:.7rem;color:var(--dim);margin-bottom:5px}
  .pn .v{font-size:.9rem;font-weight:600;line-height:1.6;color:#e6ecf6}
  .lst .sm{display:block;font-size:.78rem;color:var(--muted);margin-top:4px}
  /* 公告归档页 */
  .acards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:0 0 30px}
  .acard{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:16px 18px;display:block;color:var(--ink);transition:border-color .18s,box-shadow .18s}
  .acard:hover{border-color:rgba(61,123,255,.45);box-shadow:var(--glow)}
  .acard .an{font-weight:800;font-size:.98rem;margin-bottom:6px;color:#fff}
  .acard .am{font-size:.8rem;color:var(--muted)}
  .catnav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
  .catnav a{font-size:.8rem;padding:5px 13px;border:1px solid var(--line2);border-radius:99px;color:var(--muted);background:var(--card)}
  .catnav a:hover{border-color:var(--accent);color:#fff}
  .cathd{margin:30px 0 4px;font-size:1.05rem;font-weight:800;color:#fff;padding-bottom:9px;border-bottom:1px solid var(--line2)}
  .cathd .cn{font-size:.8rem;font-weight:400;color:var(--dim);margin-left:8px}
  .hl li{position:relative;padding-left:24px;margin-bottom:10px;font-size:15.5px;color:var(--tx)}
  .hl li:before{content:"◆";position:absolute;left:0;top:0;color:var(--accent);font-size:12px;text-shadow:0 0 8px rgba(61,123,255,.6)}
  .gcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}
  .gcard{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card);display:block;color:var(--ink);transition:border-color .2s,box-shadow .2s,transform .2s}
  .gcard:hover{box-shadow:var(--glow);border-color:rgba(61,123,255,.45);transform:translateY(-3px)}
  .gcard img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#1a2537}
  .gcard .bd{padding:11px 13px}
  .gcard .nm{font-size:.9rem;font-weight:700;color:#fff;margin-bottom:5px}
  .gcard .ds{font-size:.75rem;color:var(--muted);line-height:1.6}

  /* ===== 索引页（.grid/.card 见下方「游戏大厅」强化版定义） ===== */
  .btn{display:inline-block;font-size:12px;font-weight:700;padding:6px 14px;border-radius:8px;
    background:var(--grad);color:#fff!important;box-shadow:0 4px 14px rgba(61,123,255,.3)}
  .btn.ghost{background:rgba(61,123,255,.12);color:#8ab4ff!important;border:1px solid rgba(61,123,255,.3);box-shadow:none}
  .grp-h{font-size:1.05rem;font-weight:800;color:#fff;margin:38px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--line);
    display:flex;align-items:baseline;gap:10px;scroll-margin-top:88px}
  .grp-h .cnt{font-size:.75rem;font-weight:400;color:var(--dim)}
  .lst{display:grid;grid-template-columns:1fr;gap:10px}
  .lst a{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);transition:border-color .18s,background .18s,transform .18s}
  .lst a:hover{border-color:rgba(61,123,255,.45);background:var(--card-hover);transform:translateX(3px)}
  .lst .cat{flex:none;font-size:.68rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#3d7bff,#2f6ef0);border-radius:6px;padding:2px 9px;margin-top:2px}
  .lst .nm{font-size:.92rem;font-weight:700;color:#e6ecf6;line-height:1.6;display:block}
  .lst .sm{font-size:.78rem;color:var(--muted);margin-top:4px;line-height:1.6;display:block}
  /* ===== 站内搜索 / 分类芯片（攻略中心 · 资讯中心）=====
     2026-09-19 用户反馈搜索框太大 → 全站统一紧凑版：桌面 40px / 移动 44px */
  .srchbar{display:flex;gap:10px;align-items:center;margin:0 0 16px}
  .srchbar input{flex:1;min-width:0;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line2);
    background:var(--card);color:var(--ink);font-size:13.5px;font-family:inherit;outline:none;transition:border-color .18s,box-shadow .18s}
  .srchbar input::placeholder{color:var(--dim)}
  .srchbar input:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(61,123,255,.16)}
  .srchbar .srchbtn{display:none;flex:none;width:40px;height:40px;border:none;border-radius:10px;
    background:var(--grad);color:#fff;cursor:pointer;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(61,123,255,.3)}
  .srchbar .srchbtn:hover{opacity:.9}
  .srchbar .hint{flex:none;font-size:.75rem;color:var(--dim);white-space:nowrap}
  .srch-res{margin:0 0 26px}
  .srch-res .hd{font-size:.8rem;color:var(--dim);margin:0 0 10px}
  .srch-res .empty{font-size:.88rem;color:var(--muted);padding:18px 0;margin:0}
  /* 2026-09-18 修：html hidden 属性会被作者样式 display:grid/block 覆盖（UA 样式优先度最低），
     导致搜索过滤、结果区切换全部失效。这条 !important 是让 hidden 真正生效的唯一办法。 */
  [hidden]{display:none!important}
  /* ===== 攻略中心「按游戏分组」卡片（.glist，仅攻略中心使用）=====
     ⚠️ 2026-09-19 修复记录（重做主题时必须原样保留这些规则）：
     1) 容器用独立类 .glist，与游戏详情页「同类推荐」的 .gcards 网格互不影响。
     2) 绝对定位封面在不同渲染引擎解析基准不一致，必须用 flex 行布局。
     3) 真正根因：通用 .cover 规则的 margin:0 0 28px 会泄漏进本卡片，把 stretch
        拉伸后的封面压短 28px，导致「资讯条目/还有N篇」掉到图片下面。
        修复：.glist .gcard .cover 显式 margin:0 归零 + align-items:stretch，
        封面恒等于文字区高度，底边齐平。 */
  .glist{display:flex;flex-direction:column;gap:14px;margin:0 0 16px}
  .glist .gcard{display:flex;align-items:stretch;gap:14px;padding:11px 14px;border:1px solid var(--line);border-radius:14px;
    background:var(--card);transition:box-shadow .2s,border-color .2s;cursor:pointer;color:inherit}
  .glist .gcard:hover{border-color:rgba(61,123,255,.4);box-shadow:var(--glow)}
  .glist .gcard .cover{flex:none;width:100px;margin:0;border-radius:9px;overflow:hidden;background:#1a2537}
  .glist .gcard .cover a{display:block;height:100%}
  .glist .gcard .cover img{display:block;width:100%;height:100%;aspect-ratio:auto;object-fit:cover}
  .glist .gcard .info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .glist .gcard .top{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .glist .gcard .gname{font-size:13.5px;font-weight:800;color:#fff;margin:0;line-height:1.4;
    min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .glist .gcard .gname a{color:inherit;text-decoration:none}
  .glist .gcard .cnt{font-size:10px;font-weight:700;color:#8ab4ff;background:var(--brand-soft);
    border:1px solid rgba(61,123,255,.28);padding:1.5px 7px;border-radius:99px;white-space:nowrap;line-height:1.5}
  .glist .gcard .alist{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none}
  .glist .gcard .alist li{margin:0;padding:0}
  .glist .gcard .alist a{display:block;font-size:11.8px;color:#aeb9cf;padding:1px 6px;border-radius:6px;
    transition:background .15s,color .15s;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .glist .gcard .alist a:hover{background:rgba(61,123,255,.12);color:#fff}
  .glist .gcard .alist a.hit{background:rgba(61,123,255,.14);color:#9cc0ff;font-weight:600}
  .glist .gcard .alist .cat{display:inline-block;font-size:9.5px;font-weight:700;color:#fff;
    background:linear-gradient(135deg,#3d7bff,#2f6ef0);border-radius:4px;padding:1px 5px;margin-right:5px;vertical-align:middle}
  .glist .gcard .alist .cat.info{background:linear-gradient(135deg,#ff9d2e,#ff7a3d)}
  /* 2026-09-18 合并自线上：卡片右侧默认只展示前 2 篇，其余靠「还有 N 篇」进游戏页看；
     搜索命中时给卡片加 .srch，把命中的条目全部展开。 */
  .glist .gcard .alist li:nth-child(n+3){display:none}
  .glist .gcard.srch .alist li{display:list-item}
  .glist .gcard .more{font-size:10.5px;color:var(--dim);margin-top:0;align-self:flex-start;text-decoration:none;
    display:inline-block;line-height:1.5}
  .glist .gcard .more:hover{color:var(--accent2)}
  .glist .gcard.collapsed{display:none}
  .more-btn{display:block;width:100%;padding:14px;margin:8px 0 28px;border:1px dashed var(--line2);
    border-radius:12px;background:rgba(255,255,255,.02);color:var(--muted);font-size:.86rem;font-weight:600;
    text-align:center;cursor:pointer;transition:border-color .18s,color .18s,background .18s;font-family:inherit}
  .more-btn:hover{border-color:var(--accent);color:#fff;background:rgba(61,123,255,.08)}
  @media (max-width:640px){
    /* 手机端：封面 84px 宽（2026-09-19 用户反馈图片占位过大），间距收紧，
       字号同步缩小，保证资讯条目 + 还有N篇 都落在封面拉伸后的高度内 */
    .glist{gap:12px}
    .glist .gcard{padding:10px 11px;gap:12px}
    .glist .gcard .cover{width:84px}
    .glist .gcard .alist a{font-size:11.5px;padding:1px 5px}
  }
  @media (max-width:640px){
    .srchbar{position:relative;flex-direction:row;align-items:center;gap:10px;margin-bottom:24px}
    .srchbar input{flex:1;height:44px;font-size:15px;padding:0 14px;border-radius:11px;background-image:none}
    .srchbar .srchbtn{display:flex;width:44px;height:44px;border-radius:11px}
    .srchbar .srchbtn svg{width:22px;height:22px}
    .srchbar .hint{display:block;position:absolute;top:100%;left:0;right:0;text-align:center;font-size:12px;margin-top:6px}
  }
.foot{text-align:center;padding:34px 20px;border-top:1px solid var(--line);background:#0d1422;font-size:13px;color:var(--muted)}
  .foot a{color:var(--muted);margin:0 10px}
  .foot a:hover{color:var(--accent2)}

  /* ===== 游戏大厅：排序条 + 强化卡片 ===== */
  .sortbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 20px}
  .sortbar .sb-label{font-size:13.5px;color:var(--muted);margin-right:2px}
  .sortbar .sbtn{font-size:13.5px;padding:7px 16px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--tx);cursor:pointer;font-family:inherit;transition:.18s}
  .sortbar .sbtn:hover{border-color:rgba(91,140,255,.55);color:#8ab4ff;background:rgba(61,123,255,.08)}
  .sortbar .sbtn.on{background:var(--grad);border-color:transparent;color:#fff;font-weight:600;box-shadow:0 4px 16px rgba(61,123,255,.35)}
  .sortbar .sb-count{margin-left:auto;font-size:13px;color:var(--muted)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(236px,1fr));gap:18px}
  .card{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card);display:block;color:var(--ink);position:relative;transition:transform .2s,box-shadow .2s,border-color .2s}
  .card:hover{transform:translateY(-4px);box-shadow:var(--glow);border-color:rgba(61,123,255,.45)}
  .card .cv{position:relative;overflow:hidden;background:#1a2537}
  .card .cv img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;transition:transform .35s}
  .card:hover .cv img{transform:scale(1.05)}
  .card .rk{position:absolute;top:10px;left:10px;padding:3px 11px;border-radius:99px;background:rgba(16,24,40,.62);backdrop-filter:blur(4px);font-size:.74rem;color:#ffc940;font-weight:700;border:1px solid rgba(255,201,64,.5);letter-spacing:.5px}
  .card .bd{padding:13px 15px 15px}
  .card .nm{font-size:15.5px;font-weight:700;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .card .mrow{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12.5px}
  .card .star{color:var(--gold);font-weight:700;white-space:nowrap}
  .card .ht{color:var(--muted);white-space:nowrap}
  .card .ds{font-size:12.5px;color:var(--muted);line-height:1.65;margin-bottom:12px;min-height:40px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card .row{display:flex;gap:8px;flex-wrap:wrap;min-height:30px;align-items:center}

  /* ===== 攻略中心：游戏快捷筛选芯片 ===== */
  .gchips{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;margin:0 0 22px;padding:2px 2px 6px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .gchips::-webkit-scrollbar{display:none}
  .gchip{flex:0 0 auto;font-size:13px;padding:7px 15px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--tx);cursor:pointer;font-family:inherit;white-space:nowrap;transition:.18s}
  .gchip b{font-weight:600;font-size:11.5px;color:var(--muted);margin-left:4px}
  .gchip:hover{border-color:rgba(91,140,255,.55);color:#8ab4ff;background:rgba(61,123,255,.08)}
  .gchip.on{background:var(--grad);border-color:transparent;color:#fff}
  .gchip.on b{color:rgba(255,255,255,.85)}

  /* ===== 404：热门游戏推荐 ===== */
  .popgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin:0 0 10px}
  .popgrid a{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);display:block;color:var(--ink);transition:transform .2s,box-shadow .2s,border-color .2s}
  .popgrid a:hover{transform:translateY(-3px);box-shadow:var(--glow);border-color:rgba(61,123,255,.45)}
  .popgrid img{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;background:#1a2537}
  .popgrid .pn2{padding:9px 11px;font-size:13px;font-weight:600;color:#e6ecf6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* ===== 导航响应式 ===== */
  @media (max-width:960px){
    .snav-cta{display:none}
    .snav-srch input{width:130px}
    .snav-srch input:focus{width:140px}
    .srch-panel{width:320px}
  }
  @media (max-width:760px){
    .snav-in{flex-wrap:wrap;height:auto;padding:10px 16px;gap:10px}
    .snav-logo{order:1}
    .snav-logo b{font-size:.95rem}
    .snav-srch{order:2;width:100%}
    .snav-srch input{width:100%;height:46px;font-size:.95rem;padding-left:40px;border-radius:14px}
    .snav-srch input:focus{width:100%}
    .snav-srch .ic{left:14px}
    .snav-links{order:3;width:100%;justify-content:space-between;gap:6px;margin-left:0}
    .snav-links a{flex:1;text-align:center;padding:9px 6px;font-size:.78rem;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
    .snav-links a.active{background:var(--nc-bg);border-color:var(--nc)}
    .srch-panel{left:0;right:0;width:auto;max-height:60vh}
    .sp-game{grid-template-columns:56px 1fr}
  }

  @media (max-width:640px){
    .wrap{padding:24px 16px 52px}
    h1.ttl{font-size:23px}
    .ghero h1{font-size:22px}
    .ghero .pic{width:100%}
    .body{font-size:16px}
    .body h2{font-size:19px}
    .grid{grid-template-columns:repeat(2,1fr);gap:12px}
    .card .ds{min-height:0}
    .popgrid{grid-template-columns:repeat(3,1fr);gap:10px}
    .sortbar .sb-count{display:none}
    .ncards{grid-template-columns:1fr;gap:12px}
    .ncard{grid-template-columns:96px 1fr;gap:12px;padding:12px}
    .ncard .ncv{width:96px;height:96px}
    .ncard .ngname{font-size:15px}
    .ncard .nlist .nlk{font-size:12.8px}
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
  const act = o.active || '';
  const link = (href, key, label) =>
    `<a href="${href}"${act === key ? ' class="active" aria-current="page"' : ''}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${o.robots || 'index, follow'}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="applicable-device" content="pc,mobile">
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
<header class="snav">
  <div class="snav-in">
    <a class="snav-logo" href="/"><img src="${prefix}assets/images/logo_xiaomeng.png" alt="小梦怀旧手游" width="30" height="30"><b>小梦怀旧手游</b></a>
    <nav class="snav-links" aria-label="主导航">
      ${link('/', 'home', '首页')}
      ${link('/games', 'games', '游戏大厅')}
      ${link('/news', 'news', '官网资讯')}
      ${link('/guides', 'guides', '游戏攻略')}
    </nav>
    <div class="snav-srch">
      <span class="ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
      <input id="xmSearch" type="text" placeholder="搜索攻略 / 游戏" autocomplete="off" aria-label="站内搜索">
      <div class="srch-panel" id="xmPanel" hidden></div>
    </div>
    <a class="snav-cta" href="/games">全部游戏</a>
  </div>
</header>
<script src="/js/search-index.js" defer></script>
<script src="/js/nav-search.js" defer></script>
`;
}

function foot() {
  return `
<footer class="foot">
  <a href="/">首页</a>
  <a href="/games">游戏大厅</a>
  <a href="/news">官网资讯</a>
  <a href="/guides">游戏攻略</a>
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
    active: 'guides',
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
    active: 'games',
    ld: [ldGame, ldBreadcrumb]
  }) + `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><a href="/games">游戏大厅</a><i>/</i><span>${esc(g.name)}</span></nav>
  <div class="ghero">
    <div class="pic"><img src="../${esc(g.cover)}" alt="${esc(g.name)}"${sizeAttrs(g.cover)} decoding="async" fetchpriority="high"></div>
    <div class="info">
      <h1>${esc(g.name)}</h1>
      <div class="sub">${esc(g.developer || '')}${g.platform ? ' · ' + esc(g.platform) : ''}${g.year ? ' · ' + g.year + ' 年' : ''}</div>
      <div class="score">★ ${esc(scOf(g))}</div>
      <div class="dl">
        <a class="and" href="${esc(androidHref)}" target="_blank" rel="sponsored noopener noreferrer">安卓下载</a>
        <a class="ios" href="${esc(iosHref)}" target="_blank" rel="sponsored noopener noreferrer">苹果下载</a>
      </div>
    </div>
  </div>

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
/* 彩色分类标签映射（开服=绿 合服=青 维护=橙 版本更新=蓝 活动=紫 赛事=红 攻略=青绿 其他=灰蓝） */
const CAT_CLS = { '开服公告': 'cat-kf', '合服公告': 'cat-hf', '维护公告': 'cat-wh', '版本更新': 'cat-bb', '活动': 'cat-hd', '赛事': 'cat-ss', '攻略': 'cat-gl', '官方资讯': 'cat-zx' };
const catCls = (c) => CAT_CLS[c] || 'cat-zx';
const shortD = (d) => { const m = String(d || '').match(/^\d{4}-(\d{2}-\d{2})/); return m ? m[1] : String(d || ''); };
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

  // 每个专区一张资讯卡片：左封面 + 游戏名/公告数 + 最新 3 条（彩色分类标签）+ 查看全部
  const newsCardsHtml = archiveList.map(a => {
    const gid = (a.gameIds || []).find(id => gameById[id] && gameById[id].cover) || (a.gameIds || [])[0];
    const g = gid ? gameById[gid] : null;
    const coverHtml = g && g.cover
      ? `<img src="${esc(g.cover)}" alt="${esc(titleOf(a))}" loading="lazy">`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:2rem">🎮</div>`;
    const items = a.items.slice(0, 3).map(it => {
      const href = newsHref(a.slug, it);
      const titleHtml = href
        ? `<a class="nlk" href="${esc(href)}">${esc(it.title)}</a>`
        : `<span class="nlk">${esc(it.title)}</span>`;
      return `      <li><span class="nd">${esc(shortD(it.date))}</span><span class="ncat ${catCls(it.category)}">${esc(it.category || '官方资讯')}</span>${titleHtml}</li>`;
    }).join('\n');
    return `    <div class="ncard">
    <div class="ncv">${coverHtml}</div>
    <div class="ninfo">
      <div class="nhead"><a class="ngname" href="/news/${esc(a.slug)}">${esc(titleOf(a))}</a><span class="ncnt">${a.items.length} 条公告</span></div>
      <ul class="nlist">
${items}
      </ul>
      <a class="nmore" href="/news/${esc(a.slug)}">查看全部公告 →</a>
    </div>
  </div>`;
  }).join('\n');

  // 可点开的公告条数（无正文的条目只在归档页显示标题，不进搜索索引）
  const newsSearchable = archiveList.reduce(
    (s, a) => s + a.items.filter(it => newsHref(a.slug, it)).length, 0);

  const newsBody = `<main class="wrap wide newshub">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>官方公告</span></nav>
  <h1>手游官方公告合集</h1>
  <p class="lead">本站收录的怀旧手游官方公告，<strong>按游戏分类</strong>整理，包含开服、合服、维护、版本更新与活动等。
  每条公告均为站内独立页面，点击即可直接阅读全文，无需跳转任何外部站点。</p>

  <div class="srchbar">
    <input id="newsSearch" type="search" placeholder="搜索游戏名或公告标题，例如「龙之谷」「维护」" autocomplete="off" aria-label="搜索官方资讯">
    <span class="hint" id="newsHint">输入即搜</span>
  </div>
  <div class="srch-res" id="newsRes" hidden></div>

  <div id="newsBrowse">
  <h2 class="sec-h">全部游戏公告</h2>
  <div class="ncards">
${newsCardsHtml}
  </div>
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
    var srchBtn=document.getElementById('guideSrchBtn');
    if(srchBtn){srchBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();render();box.blur();});}
  })();
  </script>
</main>
` + foot();


  const newsUrl = SITE + '/news';
  writeFile('news.html', head(
    '手游官方公告合集 - 开服/合服/维护/活动 - 小梦怀旧手游',
    `按游戏分类汇总怀旧手游的开服、合服、维护、版本更新与活动公告，每条均为站内独立页面，可直接阅读全文。`,
    newsUrl,
    { prefix: '', active: 'news', ld: [{
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

    const body = `<main class="wrap newshub">
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
      <div class="nh"><span class="nd">${esc(it.date || '')}</span><span class="ncat ${catCls(it.category)}">${esc(it.category || '官方资讯')}</span>${newsTitleHtml(a.slug, it)}</div>${it.summary ? `\n      <p class="ns">${esc(it.summary)}</p>` : ''}
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
      { active: 'news', ld: [{
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
        { prefix: '../../', ogType: 'article', published: it.date, active: 'news', ld: [ldItem, ldItemCrumb] }
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
  const emptyHotGames = [...games].sort((a, b) => (b.heat || 0) - (a.heat || 0)).slice(0, 8);
  writeFile('news.html', head(
    '官网资讯中心 - 开服/合服/维护/活动公告 - 小梦怀旧手游',
    '小梦怀旧手游官网资讯中心：按游戏分类整理手游开服、合服、维护、版本更新与活动公告，支持站内搜索。',
    SITE + '/news',
    { prefix: '', active: 'news', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '官网资讯中心', url: SITE + '/news' }] }
  ) + `<main class="wrap">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>官网资讯</span></nav>
  <h1 class="ttl">官网资讯中心</h1>
  <p class="lead">这里按游戏分类汇总各款怀旧手游的官方公告：开服、合服、维护、版本更新与活动。</p>
  <p class="lead">内容正在重新整理，整理好会一款一款放上来。</p>
  <h2 class="sec-h">先去逛逛热门游戏</h2>
  <div class="popgrid">
${emptyHotGames.map(g => `    <a href="/game/${g.id}"><img src="/${esc(g.cover)}" alt="${esc(g.name)}" loading="lazy"><span class="pn2">${esc(g.name)}</span></a>`).join('\n')}
  </div>
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
const HOT_COUNT = 4;
const hotGroups = gameGroups.slice(0, HOT_COUNT);
const restGroups = gameGroups.slice(HOT_COUNT);

const guidesIndexHtml = head(
  '全部游戏攻略索引 - 小梦怀旧手游',
  `小梦怀旧手游全部游戏攻略索引，按游戏分类整理：职业加点、开荒路线、打金搬砖、装备获取、版本玩法，一站式查阅，支持站内搜索。`,
  SITE + '/guides',
  { prefix: '', active: 'guides', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '全部游戏攻略索引', url: SITE + '/guides' }] }
) + (() => {
  /* 游戏卡片式布局：每张卡片左边是游戏封面+名称，右边是攻略标题列表。
     点击卡片整体 → 进入游戏详情页；点击单篇攻略 → 进入文章页。
     只展示热门游戏（攻略数最多的前 HOT_COUNT 个），其余折叠，点击「展开全部」后显示。 */
  const buildCard = (gid, list, collapsed) => {
    const g = gameById[gid];
    if (!g) return '';
    const gname = g.name;
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

    const more = extraCount > 0 ? `  <a class="more" href="/game/${gid}">还有 ${extraCount} 篇 →</a>` : '';
    const cls = collapsed ? 'gcard collapsed' : 'gcard';

    return `<div class="${cls}" data-href="/game/${gid}" data-game="${esc(gname)}">
  <div class="cover">
    <a href="/game/${gid}"><img src="${esc(cover)}" alt="${esc(gname)}" loading="lazy"></a>
  </div>
  <div class="info">
    <div class="top">
      <h3 class="gname"><a href="/game/${gid}">${esc(gname)}</a></h3>
      <span class="cnt">${list.length} 篇攻略</span>
    </div>
    <ul class="alist">
${items}
    </ul>
${more}
  </div>
</div>`;
  };

  const hotCards = hotGroups.map(([gid, list]) => buildCard(gid, list, false)).join('\n');
  const restCards = restGroups.map(([gid, list]) => buildCard(gid, list, true)).join('\n');
  const moreBtn = restGroups.length ? `  <button class="more-btn" id="moreBtn" type="button">展开全部 ${restGroups.length} 个游戏攻略 ↓</button>` : '';

  /* 游戏快捷筛选芯片：取攻略数最多（并列看热度）的前 12 个游戏 */
  const chipGames = gameGroups
    .map(([gid, list]) => ({ g: gameById[gid], n: list.length }))
    .filter(x => x.g)
    .sort((a, b) => b.n - a.n || ((b.g.heat || 0) - (a.g.heat || 0)))
    .slice(0, 12);
  const chipsHtml = chipGames.length
    ? `  <div class="gchips" id="guideChips" aria-label="按游戏快捷筛选">
    <button class="gchip on" data-g="" type="button">全部游戏</button>
${chipGames.map(x => `    <button class="gchip" data-g="${esc(x.g.name)}" type="button">${esc(x.g.name)}<b>${x.n}</b></button>`).join('\n')}
  </div>`
    : '';

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
${chipsHtml}

  <div class="glist" id="guideCards">
${hotCards}
  </div>
${moreBtn}
  <div class="glist" id="guideCardsRest">
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
    var collapsedCards=cards.filter(function(c){return c.classList.contains('collapsed')});
    var chips=[].slice.call(document.querySelectorAll('.gchips .gchip'));
    var IDLE_HINT='输入即搜';
    var expanded=false;
    var chipGame='';   /* 当前芯片选中的游戏名，空串 = 全部 */

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

    function setChipOn(g){
      chips.forEach(function(x){x.classList.toggle('on',(x.getAttribute('data-g')||'')===g)});
    }

    function render(){
      var q=String(box.value||'').trim().toLowerCase();
      var i,j;
      /* 搜索优先：一旦输入关键词，自动回到「全部游戏」 */
      if(q&&chipGame){chipGame='';setChipOn('');}
      if(!q&&!chipGame){
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
      if(!q&&chipGame){
        /* 芯片筛选模式：只显示选中游戏的卡片，条目全部展开并高亮 */
        collapsedCards.forEach(function(c){c.classList.remove('collapsed')});
        if(moreBtn){moreBtn.hidden=true;}
        for(i=0;i<cards.length;i++){
          var mine=(cards[i].getAttribute('data-game')===chipGame);
          cards[i].hidden=!mine;
          cards[i].classList.toggle('srch',mine);
          if(mine){
            var it2=cards[i].querySelectorAll('.alist a');
            for(var k2=0;k2<it2.length;k2++){it2[k2].hidden=false;it2[k2].classList.add('hit');}
          }
        }
        res.hidden=true;res.innerHTML='';
        hint.textContent=chipGame;
        return;
      }
      // 多关键词搜索：空格分隔，全部匹配才算命中（AND 逻辑）
      var keywords=q.split(/\\s+/).filter(function(k){return k.length>0;});
      // 搜索时展开所有折叠卡片
      collapsedCards.forEach(function(c){c.classList.remove('collapsed')});
      if(moreBtn){moreBtn.hidden=true;}
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
        return;
      }
      var d=document.createElement('div');
      d.textContent=box.value.trim();
      res.innerHTML='<p class="empty">没有找到与「'+d.innerHTML+'」相关的攻略。换个关键词试试，比如游戏名或「打金」「职业」。</p>';
      res.hidden=false;
    }

    /* 芯片点击：清空搜索词，按游戏过滤 */
    chips.forEach(function(ch){
      ch.addEventListener('click',function(){
        chipGame=ch.getAttribute('data-g')||'';
        setChipOn(chipGame);
        if(box.value){box.value='';}
        render();
      });
    });

    box.addEventListener('input',render);
    box.addEventListener('keydown',function(e){if(e.key==='Escape'){box.value='';chipGame='';setChipOn('');render();box.blur();}});
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
  g: '',
  c: g.cover || ''   /* 封面（内页导航搜索面板用，首页搜索不受影响） */
}));
const searchIndexSrc = '/* 站内搜索索引 · 由 scripts/build-articles.js 自动生成，请勿手改 */\n' +
  'var SEARCH_INDEX=' +
  JSON.stringify(searchGames.concat(searchGuides)).replace(/</g, '\\u003c') +
  ';\n';
fs.writeFileSync(path.join(ROOT, 'js', 'search-index.js'), searchIndexSrc);
console.log('✅ 生成 js/search-index.js（攻略 ' + searchGuides.length + ' + 游戏 ' + searchGames.length +
  '，' + Buffer.byteLength(searchIndexSrc, 'utf8') + ' 字节）');

// ===== 8. 生成游戏索引页 games.html（2026-09-19 重做：全站统一游戏大厅入口） =====
/* 热度显示：930000 -> 93万 */
function fmtHeat(h) {
  const n = Number(h) || 0;
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n);
}
const gamesByHeat = [...games].sort((a, b) => (b.heat || 0) - (a.heat || 0));

/* 分类芯片：数量为 0 的分类不显示 */
const grpCount = {};
games.forEach(g => {
  const grp = grpOf(g) || '其他';
  grpCount[grp] = (grpCount[grp] || 0) + 1;
});
const grpChipsHtml = GRP_TABS
  .filter(t => grpCount[t.k])
  .map(t => `    <button class="gchip" data-g="${esc(t.k)}" type="button">${esc(t.label)}<b>${grpCount[t.k]}</b></button>`)
  .join('\n');

const gameCardsHtml = gamesByHeat.map((g, i) => {
  const cnt = (byGame.get(g.id) || []).length;
  return `    <a class="card" href="/game/${g.id}" data-heat="${g.heat || 0}" data-year="${g.year || 0}" data-rating="${parseFloat(scOf(g)) || 0}" data-grp="${esc(grpOf(g) || '其他')}" data-name="${esc(String(g.name).toLowerCase())}">
      <div class="cv">
        <img src="${esc(g.cover)}" alt="${esc(g.name)}" loading="lazy"${sizeAttrs(g.cover)}>
        ${i < 10 ? `<span class="rk">TOP ${i + 1}</span>` : ''}
      </div>
      <div class="bd">
        <div class="nm">${esc(g.name)}</div>
        <div class="mrow"><span class="star">★ ${esc(scOf(g))}</span><span class="ht">🔥 ${fmtHeat(g.heat)}</span>${g.year ? `<span class="ht">${g.year} 年</span>` : ''}</div>
        <div class="ds">${esc((g.desc || '').slice(0, 42))}</div>
        <div class="row">
          <span class="btn">游戏详情</span>
          ${cnt ? `<span class="btn ghost">攻略 ${cnt}</span>` : ''}
        </div>
      </div>
    </a>`;
}).join('\n');

const gamesHtml = head(
  '游戏大厅 - 全部怀旧手游大全 - 小梦怀旧手游',
  `小梦怀旧手游游戏大厅收录 ${games.length} 款经典端游正版复刻怀旧手游：传奇、奇迹MU、仙境传说、龙之谷、武林外传、永恒岛等，支持搜索、分类筛选与人气/评分排序，点击进入游戏详情页查看官方下载入口与攻略。`,
  SITE + '/games',
  { prefix: '', active: 'games', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: '游戏大厅 · 全部怀旧手游大全', url: SITE + '/games' }] }
) + `<main class="wrap wide">
  <nav class="crumb"><a href="/">首页</a><i>/</i><span>游戏大厅</span></nav>

  <div class="pagehead">
    <span class="ph-kick">GAME HALL</span>
    <h1 class="ttl">游戏大厅</h1>
    <p class="lead">共收录 <strong>${games.length}</strong> 款经典端游正版复刻手游，横排陈列一键直达。支持按分类筛选、按人气 / 评分 / 上架时间排序，也可以直接搜索游戏名。</p>
    <div class="ph-stats">
      <span class="ph-s"><b>${games.length}</b> 款游戏</span>
      <span class="ph-s"><b>${articles.length}</b> 篇攻略</span>
      <span class="ph-s">正版授权 · 免费下载</span>
    </div>
  </div>

  <div class="srchbar">
    <input id="gameSearch" type="search" placeholder="搜索游戏名，例如「龙之谷」「屠龙」" autocomplete="off" aria-label="搜索游戏">
    <span class="hint" id="gameHint">输入即搜</span>
  </div>

  <div class="sortbar" role="group" aria-label="游戏排序方式">
    <span class="sb-label">排序：</span>
    <button class="sbtn on" data-sort="heat" type="button">人气优先</button>
    <button class="sbtn" data-sort="year" type="button">最新上架</button>
    <button class="sbtn" data-sort="rating" type="button">评分最高</button>
    <span class="sb-count" id="gameCount">${games.length} 款游戏</span>
  </div>

  <div class="gchips" id="gameChips" aria-label="按分类筛选">
    <button class="gchip on" data-g="" type="button">全部游戏<b>${games.length}</b></button>
${grpChipsHtml}
  </div>

  <div class="grid" id="gameGrid">
${gameCardsHtml}
  </div>
  <p id="gameEmpty" hidden style="text-align:center;color:var(--muted);padding:34px 0 10px;font-size:.9rem">没有找到匹配的游戏，换个关键词或分类试试。</p>

  <div class="cta">
    <p>每款游戏都有独立详情页：官方下载入口、版本信息与全部攻略一站看全。</p>
    <a class="cta-btn" href="/guides">去攻略中心找通关秘籍 →</a>
  </div>

  <script>
  (function(){
    var grid=document.getElementById('gameGrid');
    if(!grid)return;
    var box=document.getElementById('gameSearch'),hint=document.getElementById('gameHint'),
        count=document.getElementById('gameCount'),empty=document.getElementById('gameEmpty');
    var cards=[].slice.call(grid.children);
    var chips=[].slice.call(document.querySelectorAll('#gameChips .gchip'));
    var sbtns=[].slice.call(document.querySelectorAll('.sortbar .sbtn'));
    var state={q:'',grp:'',sort:'heat'};
    function apply(){
      var vis=[];
      cards.forEach(function(c){
        var okQ=!state.q||(c.getAttribute('data-name')||'').indexOf(state.q)>=0;
        var okG=!state.grp||c.getAttribute('data-grp')===state.grp;
        var show=okQ&&okG;
        c.hidden=!show;
        if(show)vis.push(c);
      });
      vis.sort(function(a,b){
        var av=parseFloat(a.getAttribute('data-'+state.sort))||0,
            bv=parseFloat(b.getAttribute('data-'+state.sort))||0;
        return bv-av;
      });
      vis.forEach(function(c){grid.appendChild(c)});
      if(count)count.textContent=vis.length+' 款游戏';
      if(empty)empty.hidden=vis.length>0;
      if(hint)hint.textContent=state.q?('命中 '+vis.length+' 款'):'输入即搜';
    }
    if(box){
      box.addEventListener('input',function(){state.q=box.value.trim().toLowerCase();apply();});
      box.addEventListener('keydown',function(e){if(e.key==='Escape'){box.value='';state.q='';apply();box.blur();}});
    }
    chips.forEach(function(ch){
      ch.addEventListener('click',function(){
        chips.forEach(function(x){x.classList.remove('on')});
        ch.classList.add('on');
        state.grp=ch.getAttribute('data-g')||'';
        apply();
      });
    });
    sbtns.forEach(function(b){
      b.addEventListener('click',function(){
        sbtns.forEach(function(x){x.classList.remove('on')});
        b.classList.add('on');
        state.sort=b.getAttribute('data-sort')||'heat';
        apply();
      });
    });
  })();
  </script>
</main>
` + foot();
writeFile('games.html', gamesHtml);
console.log('✅ 生成 games.html（' + games.length + ' 款 / ' + Object.keys(grpCount).length + ' 个分类）');

// ===== 9. 生成 404.html =====
const recent = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
const hotGames404 = [...games].sort((a, b) => (b.heat || 0) - (a.heat || 0)).slice(0, 8);
const notFoundHtml = head('页面不存在 - 小梦怀旧手游', '你要找的页面可能已经下线，或者地址写错了。', SITE + '/404', {
  prefix: '/', robots: 'noindex, follow'
}) + `<main class="wrap">
  <h1 class="ttl">页面不存在</h1>
  <p class="lead">你要找的页面可能已经下线，或者地址写错了。可以先回首页，或在下面直接找游戏和攻略。</p>
  <p style="margin-bottom:34px">
    <a class="btn" href="/" style="padding:11px 24px;font-size:14px">返回首页</a>
    <a class="btn ghost" href="/games" style="padding:11px 24px;font-size:14px">全部游戏</a>
    <a class="btn ghost" href="/guides" style="padding:11px 24px;font-size:14px">全部攻略</a>
  </p>
  <h2 class="sec-h">热门游戏推荐</h2>
  <div class="popgrid">
${hotGames404.map(g => `    <a href="/game/${g.id}"><img src="/${esc(g.cover)}" alt="${esc(g.name)}" loading="lazy"${sizeAttrs(g.cover)}><span class="pn2">${esc(g.name)}</span></a>`).join('\n')}
  </div>
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
/* fmtHeat 已在上方「游戏索引页」统一定义：930000 -> 93万 */
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
