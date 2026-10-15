/**
 * 工单发文脚本：解析 GitHub Issue 表单，生成文章并追加到 data/articles.js
 * 在 GitHub Actions 中运行，由 .github/workflows/publish-article.yml 触发
 */
const fs = require('fs');
const { marked } = require('marked');

const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_NUMBER = process.env.ISSUE_NUMBER || '';

/** 从 issue 正文中提取表单字段（issue 表单以 "### 字段名" 作为分隔） */
function parseField(body, label) {
  const re = new RegExp('###\\s*' + label + '\\s*\\r?\\n+([\\s\\S]*?)(?=\\r?\\n###\\s|$)');
  const m = body.match(re);
  if (!m) return '';
  const v = m[1].trim();
  return v === '_No response_' ? '' : v;
}

// ===== 1. 解析表单字段 =====
const gameName = parseField(ISSUE_BODY, '游戏名');
const category = parseField(ISSUE_BODY, '文章分类') || '攻略';
const summaryRaw = parseField(ISSUE_BODY, '内容摘要');
const contentRaw = parseField(ISSUE_BODY, '正文内容');

const title = ISSUE_TITLE.trim();

if (!title) {
  console.error('错误：文章标题（工单标题）为空');
  process.exit(1);
}
if (!contentRaw) {
  console.error('错误：正文内容为空');
  process.exit(1);
}

// ===== 2. 游戏名 -> gameId、封面 =====
const gamesSrc = fs.readFileSync('data/games.js', 'utf8');
const gameMap = {};
let gm;
const gameRe = /id\s*:\s*(\d+)\s*,\s*name\s*:\s*"([^"]+)"/g;
while ((gm = gameRe.exec(gamesSrc)) !== null) {
  if (!gameMap[gm[2]]) gameMap[gm[2]] = parseInt(gm[1], 10);
}

if (!gameName || !gameMap[gameName]) {
  console.error('错误：无法识别游戏名「' + gameName + '」，请检查表单里的游戏名');
  process.exit(1);
}
const gameId = gameMap[gameName];

// 从游戏对象中提取封面
const coverMatch = gamesSrc.match(new RegExp('id\\s*:\\s*' + gameId + '[\\s\\S]{0,600}?cover\\s*:\\s*"([^"]+)"'));
const cover = coverMatch ? coverMatch[1] : 'assets/images/placeholder.jpg';

// ===== 3. 正文 Markdown -> HTML =====
const html = marked.parse(contentRaw, { breaks: true }).trim();

// ===== 4. 摘要（留空则截取正文开头） =====
let summary = summaryRaw;
if (!summary) {
  const plain = contentRaw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // 去图片
    .replace(/[#>*`~\-]+/g, '')              // 去格式符号
    .replace(/\s+/g, ' ')
    .trim();
  summary = plain.slice(0, 60) + (plain.length > 60 ? '…' : '');
}

// ===== 5. 计算新文章 ID =====
const articlesSrc = fs.readFileSync('data/articles.js', 'utf8');
let maxId = 0, am;
const idRe = /id\s*:\s*(\d+)/g;
while ((am = idRe.exec(articlesSrc)) !== null) maxId = Math.max(maxId, parseInt(am[1], 10));
const newId = maxId + 1;

const today = new Date().toISOString().slice(0, 10);
const views = Math.floor(2000 + Math.random() * 8000);

// ===== 6. 追加文章条目（字段用 JSON.stringify 保证特殊字符安全） =====
const entry = `
  // ===== ${gameName}（工单 #${ISSUE_NUMBER} 自动发布） =====
  {
    id: ${newId},
    gameId: ${gameId},
    title: ${JSON.stringify(title)},
    summary: ${JSON.stringify(summary)},
    content: ${JSON.stringify(html)},
    author: "小梦攻略组",
    date: "${today}",
    category: ${JSON.stringify(category)},
    cover: ${JSON.stringify(cover)},
    views: ${views}
  }
];`;

const lastBrack = articlesSrc.lastIndexOf('];');
if (lastBrack === -1) {
  console.error('错误：articles.js 格式异常，找不到结尾 ];');
  process.exit(1);
}
const updated = articlesSrc.slice(0, lastBrack).trimEnd() + ',' + entry + '\n';
fs.writeFileSync('data/articles.js', updated);

// ===== 7. 更新 sitemap 日期 =====
let sitemap = fs.readFileSync('sitemap.xml', 'utf8');
sitemap = sitemap.replace(/<lastmod>[\d-]+<\/lastmod>/g, '<lastmod>' + today + '</lastmod>');
fs.writeFileSync('sitemap.xml', sitemap);

// ===== 8. 输出结果供后续步骤使用 =====
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, 'ARTICLE_ID=' + newId + '\n');
  fs.appendFileSync(process.env.GITHUB_ENV, 'ARTICLE_TITLE=' + title.replace(/\n/g, ' ') + '\n');
}
console.log('✅ 文章生成成功：#' + newId + '《' + title + '》 游戏：' + gameName + ' 分类：' + category);
