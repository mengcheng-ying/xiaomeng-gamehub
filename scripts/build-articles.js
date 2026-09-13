/**
 * 小梦怀旧手游 攻略预渲染构建脚本
 * -------------------------------------------------
 * 目的：解决 SPA + hash 路由导致攻略页无法被搜索引擎收录的问题。
 * 为 data/articles.js 中的每一篇攻略生成独立的、服务端渲染完成的
 * 静态 HTML 页面（article/{id}.html），正文直接烘焙进 HTML，
 * 爬虫无需执行 JS 即可读取完整内容。
 *
 * 本脚本产出：
 *   1) article/{id}.html   —— 每篇攻略一个静态页（含结构化数据、og 标签）
 *   2) guides.html         —— 全站攻略索引（按游戏分组，站内链接中枢）
 *   3) games.html          —— 全部游戏索引
 *   4) 404.html            —— 真正的 404 页面
 *   5) sitemap.xml         —— 只含可索引的真实 URL（去掉 # 锚点）
 *   6) index.html          —— 更新 <!-- SEO-LINKS:START --> 区块，
 *                             把全部游戏和攻略以真实 <a> 输出，
 *                             让不执行 JS 的爬虫也能拿到完整站内链接
 *
 * 用法：node scripts/build-articles.js
 * 部署时在发布工单 workflow 中同样调用，保证新增/修改文章后自动同步。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://fmbly.com';
const OUT_DIR = path.join(ROOT, 'article');
const TODAY = new Date().toISOString().slice(0, 10);

// ===== 1. 解析数据文件（自维护数据，使用 Function 取值） =====
function loadJsArray(rel, keyword) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const start = src.indexOf(keyword);
  if (start === -1) throw new Error(rel + ' 中找不到 ' + keyword);
  const open = src.indexOf('[', start);
  // 找到匹配的闭合 ]
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const arrText = src.slice(open, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function('return (' + arrText + ');')();
}

const articles = loadJsArray('data/articles.js', 'ARTICLES_DATA');
const games = loadJsArray('data/games.js', 'GAMES_DATA');
const gameById = {};
games.forEach(g => { gameById[g.id] = g; });

// ===== 2. 工具 =====
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 正文内相对资源路径从站点根 -> 当前 article/ 子目录
function fixRel(src) {
  return String(src || '')
    .replace(/src=["']assets\/([^"']+)["']/g, 'src="../assets/$1"')
    .replace(/href=["']assets\/([^"']+)["']/g, 'href="../assets/$1"');
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

// 生成 <img> 的尺寸属性串（拿不到尺寸时返回空串）
function sizeAttrs(rootRel) {
  const d = imageSize(rootRel);
  return d ? ` width="${d.w}" height="${d.h}"` : '';
}

// ===== 3. 站内公共头部/底部与索引页样式 =====
const INDEX_CSS = `
  .seo-topbar{position:sticky;top:0;z-index:100;background:#fff;border-bottom:1px solid var(--border,#e3e8f2);display:flex;align-items:center;justify-content:space-between;padding:14px 20px}
  .seo-topbar .seo-brand{font-weight:700;color:var(--primary,#2456c8);letter-spacing:1px}
  .seo-nav{display:flex;gap:18px}
  .seo-nav a{color:var(--text-secondary,#4a5674);font-size:14px}
  .seo-nav a:hover{color:var(--primary,#2456c8)}
  .seo-main{max-width:960px;margin:0 auto;padding:36px 20px 60px}
  .seo-crumb{font-size:13px;color:var(--text-muted,#8a93ad);margin-bottom:22px}
  .seo-crumb a{color:var(--text-muted,#8a93ad)}
  .seo-crumb a:hover{color:var(--primary,#2456c8)}
  .seo-crumb span{margin:0 8px}
  .seo-h1{font-size:28px;font-weight:700;line-height:1.35;color:var(--text-primary,#1a2340);margin-bottom:10px}
  .seo-lead{font-size:15px;color:var(--text-secondary,#4a5674);margin-bottom:32px;line-height:1.8}
  .seo-gtitle{font-size:20px;margin:40px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--border,#e3e8f2);color:var(--text-primary,#1a2340);display:flex;align-items:center;gap:10px;scroll-margin-top:90px}
  .seo-gtitle .cnt{font-size:12px;font-weight:400;color:var(--text-muted,#8a93ad)}
  .seo-list{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:8px}
  .seo-item{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--border,#e3e8f2);border-radius:8px;background:#fff;color:var(--text-primary,#1a2340)}
  .seo-item:hover{box-shadow:0 4px 16px rgba(13,35,82,.08)}
  .seo-item-cat{flex:none;font-size:11px;color:#fff;background:var(--primary,#2456c8);border-radius:4px;padding:2px 8px;margin-top:2px}
  .seo-item-name{font-size:15px;font-weight:600;line-height:1.6;display:block}
  .seo-item-sum{font-size:13px;color:var(--text-muted,#8a93ad);margin-top:4px;line-height:1.6;display:block}
  .seo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
  .seo-gcard{border:1px solid var(--border,#e3e8f2);border-radius:10px;background:#fff;overflow:hidden;display:block;color:var(--text-primary,#1a2340);scroll-margin-top:90px}
  .seo-gcard:hover{box-shadow:0 6px 20px rgba(13,35,82,.1)}
  .seo-gcard img{width:100%;height:auto;display:block;aspect-ratio:16/9;object-fit:cover;background:#eef1f7}
  .seo-gcard-bd{padding:12px 14px}
  .seo-gcard-nm{font-size:15px;font-weight:600;margin-bottom:6px}
  .seo-gcard-ds{font-size:12px;color:var(--text-muted,#8a93ad);line-height:1.6;margin-bottom:10px;min-height:38px}
  .seo-gcard-links{display:flex;gap:8px;flex-wrap:wrap}
  .seo-btn{display:inline-block;font-size:12px;padding:5px 12px;border-radius:6px;background:var(--primary,#2456c8);color:#fff!important}
  .seo-btn.ghost{background:#eef1f7;color:var(--text-secondary,#4a5674)!important}
  .seo-footer{text-align:center;padding:32px 20px;border-top:1px solid var(--border,#e3e8f2);background:#fff;font-size:13px;color:var(--text-muted,#8a93ad)}
  .seo-footer a{color:var(--text-muted,#8a93ad);margin:0 10px}
  .seo-footer a:hover{color:var(--primary,#2456c8)}
  @media (max-width:640px){.seo-h1{font-size:22px}.seo-gtitle{font-size:18px}.seo-main{padding:24px 16px 48px}.seo-nav{gap:12px}}
`;

// 首页「爬虫链接区」的样式。首页是深色配色，这里跟随其变量。
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

function renderHeader() {
  return `
<header class="seo-topbar">
  <a class="seo-brand" href="/">小梦怀旧手游</a>
  <nav class="seo-nav">
    <a href="/games">游戏大厅</a>
    <a href="/guides">攻略中心</a>
    <a href="/">首页</a>
  </nav>
</header>`;
}

function renderFooter() {
  return `
<footer class="seo-footer">
  <a href="/">首页</a>
  <a href="/games">全部游戏</a>
  <a href="/guides">全部攻略</a>
</footer>`;
}

// ===== 4. 目录准备 =====
fs.mkdirSync(OUT_DIR, { recursive: true });

const sitemapUrls = [];
let writtenCount = 0;
function writeFile(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content);
  writtenCount++;
}

// ===== 5. 生成每篇攻略页面 =====
articles.forEach((a) => {
  const game = a.gameId ? gameById[a.gameId] : null;
  const url = SITE + '/article/' + a.id;
  const canonical = url;

  // 封面与正文内资源路径修正
  const cover = a.cover ? a.cover.replace(/^assets\//, '../assets/') : '';
  const contentHtml = fixRel(a.content);

  // 相关阅读：同游戏其他文章优先（最多 6 条，站内链接越密收录越快）
  const related = articles
    .filter(x => x.gameId === a.gameId && x.id !== a.id)
    .concat(articles.filter(x => x.gameId !== a.gameId).sort((m, n) => (n.views || 0) - (m.views || 0)))
    .slice(0, 6);

  const relatedHtml = related.length
    ? `<h2 class="seo-related-title">更多攻略</h2>
       <div class="seo-related-list">
       ${related.map(r => `
         <a class="seo-related-item" href="/article/${r.id}">
           <span class="seo-related-cat">${esc(r.category || '攻略')}</span>
           <span class="seo-related-name">${esc(r.title)}</span>
         </a>`).join('')}
       </div>`
    : '';

  const breadcrumb = game
    ? `<nav class="seo-breadcrumb"><a href="/">首页</a><span>/</span><a href="/guides">攻略</a><span>/</span><a href="/guides#game-${game.id}">${esc(game.name)}</a><span>/</span><span>正文</span></nav>`
    : `<nav class="seo-breadcrumb"><a href="/">首页</a><span>/</span><a href="/guides">攻略</a></nav>`;

  // 结构化数据
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
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical }
  };
  const ldBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: '攻略中心', item: SITE + '/guides' },
      ...(game ? [{ '@type': 'ListItem', position: 3, name: game.name, item: SITE + '/guides#game-' + game.id }] : [])
    ]
  };

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(a.title)} - 小梦怀旧手游 游戏攻略</title>
<meta name="description" content="${esc(a.summary || '')}">
<meta name="robots" content="index, follow">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(a.summary || '')}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="小梦怀旧手游">
${a.cover ? `<meta property="og:image" content="${SITE}/${esc(a.cover)}">
<meta property="og:image:alt" content="${esc(a.title)}">` : ''}
<meta name="twitter:card" content="${a.cover ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(a.title)}">
<meta name="twitter:description" content="${esc(a.summary || '')}">
${a.cover ? `<meta name="twitter:image" content="${SITE}/${esc(a.cover)}">` : ''}
${a.date ? `<meta property="article:published_time" content="${esc(a.date)}">` : ''}
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="../favicon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="../favicon-192.png">
<link rel="manifest" href="../site.webmanifest">
<link rel="stylesheet" href="../css/style.css">
<script type="application/ld+json">${JSON.stringify(ldArticle)}</script>
<script type="application/ld+json">${JSON.stringify(ldBreadcrumb)}</script>
<style>
  .seo-topbar{position:sticky;top:0;z-index:100;background:#fff;border-bottom:1px solid var(--border,#e3e8f2);display:flex;align-items:center;justify-content:space-between;padding:14px 20px}
  .seo-topbar .seo-brand{font-weight:700;color:var(--primary,#2456c8);letter-spacing:1px}
  .seo-nav{display:flex;gap:18px}
  .seo-nav a{color:var(--text-secondary,#4a5674);font-size:14px}
  .seo-nav a:hover{color:var(--primary,#2456c8)}
  .seo-main{max-width:820px;margin:0 auto;padding:36px 20px 60px}
  .seo-breadcrumb{font-size:13px;color:var(--text-muted,#8a93ad);margin-bottom:22px}
  .seo-breadcrumb a{color:var(--text-muted,#8a93ad)}
  .seo-breadcrumb a:hover{color:var(--primary,#2456c8)}
  .seo-breadcrumb span{margin:0 8px}
  .seo-cat{display:inline-block;font-size:12px;color:#fff;background:var(--accent,#ff9d2e);border-radius:4px;padding:2px 10px;margin-bottom:14px}
  .seo-title{font-size:28px;font-weight:700;line-height:1.35;color:var(--text-primary,#1a2340);margin-bottom:14px}
  .seo-meta{font-size:13px;color:var(--text-muted,#8a93ad);display:flex;flex-wrap:wrap;gap:14px;margin-bottom:26px;border-bottom:1px solid var(--border,#e3e8f2);padding-bottom:20px}
  .seo-cover{width:100%;height:auto;border-radius:10px;margin-bottom:26px;background:#eef1f7}
  .seo-related-title{font-size:20px;margin:48px 0 16px;color:var(--text-primary,#1a2340)}
  .seo-related-list{display:grid;grid-template-columns:1fr;gap:10px}
  .seo-related-item{display:flex;align-items:center;gap:10px;padding:14px 16px;border:1px solid var(--border,#e3e8f2);border-radius:8px;background:#fff;transition:box-shadow .2s;color:var(--text-primary,#1a2340)}
  .seo-related-item:hover{box-shadow:0 4px 16px rgba(13,35,82,.08)}
  .seo-related-cat{flex:none;font-size:11px;color:#fff;background:var(--primary,#2456c8);border-radius:4px;padding:2px 8px}
  .seo-related-name{font-size:15px;font-weight:600}
  .seo-footer{text-align:center;padding:32px 20px;border-top:1px solid var(--border,#e3e8f2);background:#fff;font-size:13px;color:var(--text-muted,#8a93ad)}
  .seo-footer a{color:var(--text-muted,#8a93ad);margin:0 10px}
  .seo-footer a:hover{color:var(--primary,#2456c8)}
  .back-home{margin-bottom:20px}
  .back-home a{font-size:14px;color:var(--text-secondary,#4a5674)}
  .back-home a:hover{color:var(--primary,#2456c8)}
  @media (max-width:640px){
    .seo-title{font-size:22px}
    .seo-main{padding:24px 16px 48px}
    .seo-nav{gap:12px}
  }
</style>
</head>
<body>
${renderHeader()}
<main class="seo-main">
  ${breadcrumb}
  <div class="back-home"><a href="/guides">← 返回攻略中心</a></div>
  <article itemscope itemtype="https://schema.org/Article">
    ${a.category ? `<span class="seo-cat">${esc(a.category)}</span>` : ''}
    <h1 class="seo-title" itemprop="headline">${esc(a.title)}</h1>
    <div class="seo-meta">
      <span>👤 ${esc(a.author || '小梦攻略组')}</span>
      <span>📅 <time itemprop="datePublished" datetime="${esc(a.date || '')}">${esc(a.date || '')}</time></span>
      <span>👁 ${(a.views || 0).toLocaleString()} 阅读</span>
    </div>
    ${cover ? `<img class="seo-cover" src="${esc(cover)}" alt="${esc(a.title)}"${sizeAttrs(a.cover)} decoding="async" fetchpriority="high">` : ''}
    <div class="article-detail-content" itemprop="articleBody">
${contentHtml}
    </div>
  </article>
  ${relatedHtml}
</main>
${renderFooter()}
</body>
</html>
`;

  writeFile('article/' + a.id + '.html', html);
  sitemapUrls.push({
    loc: url,
    lastmod: a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : TODAY,
    priority: '0.8'
  });
});
console.log('✅ 生成 ' + articles.length + ' 篇攻略静态页');

// ===== 6. 生成攻略索引页 guides.html =====
const byGame = new Map();
articles.forEach(a => {
  const key = a.gameId || 0;
  if (!byGame.has(key)) byGame.set(key, []);
  byGame.get(key).push(a);
});
const gameGroups = [...byGame.entries()].sort((x, y) => y[1].length - x[1].length);

const guidesIndexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>全部游戏攻略索引 - 小梦怀旧手游</title>
<meta name="description" content="小梦怀旧手游全部 ${articles.length} 篇游戏攻略索引，按游戏分类整理：职业加点、开荒路线、打金搬砖、装备获取、版本玩法，一站式查阅。">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${SITE}/guides">
<meta property="og:type" content="website">
<meta property="og:title" content="全部游戏攻略索引 - 小梦怀旧手游">
<meta property="og:description" content="小梦怀旧手游全部 ${articles.length} 篇游戏攻略索引，按游戏分类整理。">
<meta property="og:url" content="${SITE}/guides">
<meta property="og:site_name" content="小梦怀旧手游">
<meta property="og:image" content="${SITE}/assets/images/logo_xiaomeng.png">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="stylesheet" href="css/style.css">
<style>${INDEX_CSS}</style>
</head>
<body>
${renderHeader()}
<main class="seo-main">
  <nav class="seo-crumb"><a href="/">首页</a><span>/</span><span>攻略中心</span></nav>
  <h1 class="seo-h1">全部游戏攻略索引</h1>
  <p class="seo-lead">共收录 <strong>${articles.length}</strong> 篇原创攻略，覆盖 <strong>${gameGroups.length}</strong> 款怀旧手游。按游戏分组，点击标题直接阅读。</p>
${gameGroups.map(([gid, list]) => {
  const g = gameById[gid];
  const gname = g ? g.name : '其他攻略';
  return `  <h2 class="seo-gtitle" id="game-${gid}">${esc(gname)}<span class="cnt">${list.length} 篇</span></h2>
  <div class="seo-list">
${list.map(a => `    <a class="seo-item" href="/article/${a.id}">
      <span class="seo-item-cat">${esc(a.category || '攻略')}</span>
      <span><span class="seo-item-name">${esc(a.title)}</span><span class="seo-item-sum">${esc((a.summary || '').slice(0, 80))}</span></span>
    </a>`).join('\n')}
  </div>`;
}).join('\n')}
</main>
${renderFooter()}
</body>
</html>
`;
writeFile('guides.html', guidesIndexHtml);
console.log('✅ 生成 guides.html（' + articles.length + ' 篇 / ' + gameGroups.length + ' 组）');

// ===== 7. 生成游戏索引页 games.html =====
const gamesHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>全部怀旧手游大全 - 小梦怀旧手游</title>
<meta name="description" content="小梦怀旧手游收录 ${games.length} 款经典端游正版复刻怀旧手游：传奇、奇迹MU、仙境传说、龙之谷、武林外传、永恒岛等，点击直达官方下载入口。">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${SITE}/games">
<meta property="og:type" content="website">
<meta property="og:title" content="全部怀旧手游大全 - 小梦怀旧手游">
<meta property="og:description" content="小梦怀旧手游收录 ${games.length} 款经典端游正版复刻怀旧手游，点击直达官方下载入口。">
<meta property="og:url" content="${SITE}/games">
<meta property="og:site_name" content="小梦怀旧手游">
<meta property="og:image" content="${SITE}/assets/images/logo_xiaomeng.png">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="stylesheet" href="css/style.css">
<style>${INDEX_CSS}</style>
</head>
<body>
${renderHeader()}
<main class="seo-main">
  <nav class="seo-crumb"><a href="/">首页</a><span>/</span><span>游戏大厅</span></nav>
  <h1 class="seo-h1">全部怀旧手游大全</h1>
  <p class="seo-lead">共收录 <strong>${games.length}</strong> 款经典端游正版复刻手游。点击「官网下载」进入官方下载入口，点击「查看攻略」阅读该游戏的新手开荒与进阶攻略。</p>
  <div class="seo-grid">
${[...games].sort((a, b) => (b.heat || 0) - (a.heat || 0)).map(g => {
  const cnt = (byGame.get(g.id) || []).length;
  return `    <div class="seo-gcard" id="g-${g.id}">
      <img src="${esc(g.cover)}" alt="${esc(g.name)}" loading="lazy"${sizeAttrs(g.cover)}>
      <div class="seo-gcard-bd">
        <div class="seo-gcard-nm">${esc(g.name)}</div>
        <div class="seo-gcard-ds">${esc((g.desc || '').slice(0, 44))}</div>
        <div class="seo-gcard-links">
          <a class="seo-btn" href="${esc(g.url)}" target="_blank" rel="sponsored noopener noreferrer">官网下载</a>
          ${cnt ? `<a class="seo-btn ghost" href="/guides#game-${g.id}">查看攻略 ${cnt}</a>` : ''}
        </div>
      </div>
    </div>`;
}).join('\n')}
  </div>
</main>
${renderFooter()}
</body>
</html>
`;
writeFile('games.html', gamesHtml);
console.log('✅ 生成 games.html（' + games.length + ' 款）');

// ===== 8. 生成 404.html =====
const recent = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
const notFoundHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>页面不存在 - 小梦怀旧手游</title>
<meta name="robots" content="noindex, follow">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/css/style.css">
<style>${INDEX_CSS}</style>
</head>
<body>
${renderHeader()}
<main class="seo-main">
  <h1 class="seo-h1">页面不存在</h1>
  <p class="seo-lead">你要找的页面可能已经下线，或者地址写错了。下面这些入口应该能帮到你。</p>
  <p style="margin-bottom:32px">
    <a class="seo-btn" href="/">返回首页</a>
    <a class="seo-btn ghost" href="/games">全部游戏</a>
    <a class="seo-btn ghost" href="/guides">全部攻略</a>
  </p>
  <h2 class="seo-gtitle">最新攻略</h2>
  <div class="seo-list">
${recent.map(a => `    <a class="seo-item" href="/article/${a.id}">
      <span class="seo-item-cat">${esc(a.category || '攻略')}</span>
      <span class="seo-item-name">${esc(a.title)}</span>
    </a>`).join('\n')}
  </div>
</main>
${renderFooter()}
</body>
</html>
`;
writeFile('404.html', notFoundHtml);
console.log('✅ 生成 404.html');

// ===== 9a. 确保 index.html 的性能埋点与 SEO 标记齐全（幂等） =====
// 首页有三处必须成立的设置，缺一处就会明显丢分：
//   1) preload 指向轮播真实首图（原本指错了文件，白下载 370KB）
//   2) 轮播只让首图高优先级加载，其余懒加载（原本 8 张全部立即加载 = 首屏 3.1MB）
//   3) SEO 链接区块的标记存在（供下一步填入全部游戏/攻略链接）
// 这个函数每次构建都会检查，已应用则原样通过，不会重复改动。
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

// ===== 9b. 更新 index.html 的 SEO 链接区块 =====
// 首页主体内容由 JS 渲染，不执行 JS 的爬虫（百度、字节）看到的是空容器。
// 这里把全部游戏与攻略以真实 <a> 输出，让爬虫拿到完整的站内链接入口。
const SEO_START = '<!-- SEO-LINKS:START -->';
const SEO_END = '<!-- SEO-LINKS:END -->';
const indexRel = 'index.html';
const indexSrc = fs.readFileSync(path.join(ROOT, indexRel), 'utf8');

const sortedGames = [...games].sort((a, b) => (b.heat || 0) - (a.heat || 0));
const sortedArticles = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
const seoBlock = `${SEO_START}
<noscript>
<div class="seo-noscript">
  <h2>全部游戏（${games.length} 款）</h2>
  <ul>
${sortedGames.map(g => `    <li><a href="/games#g-${g.id}">${esc(g.name)}</a></li>`).join('\n')}
  </ul>
  <h2>全部攻略（${articles.length} 篇）</h2>
  <ul>
${sortedArticles.map(a => `    <li><a href="/article/${a.id}">${esc(a.title)}</a></li>`).join('\n')}
  </ul>
</div>
</noscript>
<div class="seo-crawl-links">
  <a href="/games">全部游戏（${games.length}）</a>
  <a href="/guides">全部攻略（${articles.length}）</a>
</div>
${SEO_END}`;

if (indexSrc.includes(SEO_START) && indexSrc.includes(SEO_END)) {
  const re = new RegExp(SEO_START + '[\\s\\S]*?' + SEO_END);
  fs.writeFileSync(path.join(ROOT, indexRel), indexSrc.replace(re, seoBlock));
  console.log('✅ index.html SEO 链接区块已更新（游戏 ' + games.length + ' / 攻略 ' + articles.length + '）');
} else {
  console.log('⚠️  跳过：index.html 里找不到 ' + SEO_START + ' 标记，请先手动加入标记');
}

// ===== 10. 重建 sitemap.xml =====
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
