/**
 * 工单发文脚本：解析 GitHub Issue 表单，生成文章并追加到 data/articles.js
 * 在 GitHub Actions 中运行，由 .github/workflows/publish-article.yml 触发
 *
 * ⚠️ 安全前提（2026-09-29 加固，改动前务必读完）
 *   本仓库是公开仓库，**Issue 正文是任何人都能提交的不可信输入**：
 *     1) 工作流层用 author_association 白名单，只允许 OWNER / MEMBER / COLLABORATOR 触发；
 *     2) 本脚本对 marked 的输出做 sanitize-html 白名单净化。
 *        实测 marked@12 会**原样保留**正文里的 <script>、onerror、<iframe>、<style>、
 *        <meta refresh>、javascript: 与 data:text/html —— 7 类危险载荷全部穿透。
 *        不净化就是存储型 XSS：攻击者开个 Issue 就能让脚本在文章页执行。
 *     3) 长度与分类走白名单校验，超限**直接报错退出**，不做静默截断
 *        （截断会产出半截正文，比失败更难排查）。
 */
const fs = require('fs');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_NUMBER = process.env.ISSUE_NUMBER || '';

// ===== 0. 输入上限与白名单 =====
const LIMITS = { title: 120, summary: 300, content: 100000 };
const CATEGORIES = ['攻略', '资讯', '评测'];

/**
 * 正文允许的标签。
 * 特意**不含 <h1>**：文章页的 H1 是文章标题，正文里再出现 H1 会破坏「每页唯一 H1」。
 * 也不含 script/style/iframe/object/embed/form/meta/link —— 这些直接丢弃。
 */
const ALLOWED_TAGS = [
  'p', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i',
  'blockquote', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'br', 'hr', 'code', 'pre',
];

/** 只保留安全的属性：不放开 style/class/on* 事件 */
const ALLOWED_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

/** 含标签的容器：连内部文字一起丢弃（否则 iframe 里的内容会以纯文本残留） */
const NON_TEXT_TAGS = ['script', 'style', 'textarea', 'option', 'noscript',
  'iframe', 'object', 'embed', 'form', 'meta', 'link', 'svg', 'math'];

function sanitize(html) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    // 只允许这几种协议：javascript:、vbscript:、data: 全部被拦
    // （data: 尤其要挡：data:image/svg+xml 可以内嵌脚本）
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    // 挡掉 //evil.example 这类协议相对地址
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: NON_TEXT_TAGS,
  });
}

/** 字符长度按码点算（中文按 1 个算，emoji 也算 1 个） */
function lenOf(s) {
  return [...String(s || '')].length;
}

function fail(msg) {
  console.error('✖ ' + msg);
  // 交给工作流的 if: failure() 步骤在 Issue 里回复原因
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV,
      'PUBLISH_ERROR=' + String(msg).replace(/\r?\n/g, ' ') + '\n');
  }
  process.exit(1);
}

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
const categoryRaw = parseField(ISSUE_BODY, '文章分类').trim();
const summaryRaw = parseField(ISSUE_BODY, '内容摘要');
const contentRaw = parseField(ISSUE_BODY, '正文内容');

const title = ISSUE_TITLE.trim();

// ===== 2. 输入校验（超限/越界一律报错退出，不静默截断） =====
if (!title) fail('文章标题（工单标题）为空。');
if (lenOf(title) > LIMITS.title) {
  fail(`标题过长：${lenOf(title)} 字，上限 ${LIMITS.title} 字。请把标题改短后重新提交工单。`);
}
if (!contentRaw) fail('正文内容为空。');
if (lenOf(contentRaw) > LIMITS.content) {
  fail(`正文过长：${lenOf(contentRaw)} 字，上限 ${LIMITS.content} 字。建议拆成多篇分别提交。`);
}

const category = categoryRaw || '攻略';
if (!CATEGORIES.includes(category)) {
  fail(`文章分类「${category}」不在允许范围（${CATEGORIES.join(' / ')}）内。请修改工单里的分类后重新提交。`);
}

if (!gameName || !/^[\u4e00-\u9fa5A-Za-z0-9：:·\-—\s（）()]+$/.test(gameName)) {
  fail(`游戏名「${gameName}」含非法字符。请填 data/games.js 里的游戏名原文。`);
}

// ===== 3. 游戏名 -> gameId、封面 =====
const gamesSrc = fs.readFileSync('data/games.js', 'utf8');
const gameMap = {};
let gm;
const gameRe = /id\s*:\s*(\d+)\s*,\s*name\s*:\s*"([^"]+)"/g;
while ((gm = gameRe.exec(gamesSrc)) !== null) {
  if (!gameMap[gm[2]]) gameMap[gm[2]] = parseInt(gm[1], 10);
}

if (!gameMap[gameName]) {
  fail(`无法识别游戏名「${gameName}」。请填 data/games.js 里已有的游戏名（完全一致的原文）。`);
}
const gameId = gameMap[gameName];

// 从游戏对象中提取封面
const coverMatch = gamesSrc.match(new RegExp('id\\s*:\\s*' + gameId + '[\\s\\S]{0,600}?cover\\s*:\\s*"([^"]+)"'));
const cover = coverMatch ? coverMatch[1] : 'assets/images/placeholder.jpg';

// ===== 4. 正文 Markdown -> HTML -> 白名单净化 =====
const htmlRaw = marked.parse(contentRaw, { breaks: true }).trim();
const html = sanitize(htmlRaw).trim();

/* 净化后自检：万一 sanitize 配置被后人改坏，这里直接拦住，不让危险内容进仓库 */
const FORBIDDEN = [
  [/<script[\s>]/i, '<script>'],
  [/<iframe[\s>]/i, '<iframe>'],
  [/<object[\s>]/i, '<object>'],
  [/<embed[\s>]/i, '<embed>'],
  [/<style[\s>]/i, '<style>'],
  [/<form[\s>]/i, '<form>'],
  [/<meta[\s>]/i, '<meta>'],
  [/<link[\s>]/i, '<link>'],
  [/\son[a-z]+\s*=/i, 'on* 事件属性'],
  [/javascript:/i, 'javascript: 协议'],
  [/vbscript:/i, 'vbscript: 协议'],
  [/data:text\/html/i, 'data:text/html 协议'],
];
for (const [re, what] of FORBIDDEN) {
  if (re.test(html)) fail(`净化后仍检测到 ${what}，已中止（请检查 sanitize 白名单配置）。`);
}

if (!html) fail('正文净化后为空，请检查内容。');

// ===== 5. 摘要（留空则截取正文开头） =====
let summary = sanitize(summaryRaw).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
if (!summary) {
  const plain = contentRaw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // 去图片
    .replace(/[#>*`~\-]+/g, '')              // 去格式符号
    .replace(/\s+/g, ' ')
    .trim();
  summary = plain.slice(0, 60) + (plain.length > 60 ? '…' : '');
}
if (lenOf(summary) > LIMITS.summary) {
  summary = [...summary].slice(0, LIMITS.summary - 1).join('') + '…';
}

// ===== 6. 计算新文章 ID =====
const articlesSrc = fs.readFileSync('data/articles.js', 'utf8');
let maxId = 0, am;
const idRe = /id\s*:\s*(\d+)/g;
while ((am = idRe.exec(articlesSrc)) !== null) maxId = Math.max(maxId, parseInt(am[1], 10));
const newId = maxId + 1;

const today = new Date().toISOString().slice(0, 10);
const views = Math.floor(2000 + Math.random() * 8000);

// ===== 7. 追加文章条目（字段用 JSON.stringify 保证特殊字符安全） =====
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
if (lastBrack === -1) fail('articles.js 格式异常，找不到结尾 ];');
const head = articlesSrc.slice(0, lastBrack).trimEnd();
/* ⚠️ 数组为空时（head 以 [ 结尾）不能再补逗号，
   否则产物是「[,\n{…}]」，文件直接语法错误、整站构建失败。
   2026-09-27 清空全部文章后，第 1 篇自动发布就会走到这个分支。 */
const updated = head + (/\[\s*$/.test(head) ? '' : ',') + entry + '\n';
fs.writeFileSync('data/articles.js', updated);

/* ===== 8. 不再在这里改写 sitemap 的 lastmod =====
   原实现在这里把 sitemap 里**所有** URL 的 lastmod 批量改成当天，
   等于每天宣告全站更新，Google 会直接不信这个字段。
   lastmod 现在由 scripts/build-articles.js 按「页面内容哈希是否变化」计算
   （状态存在 .github/sitemap-lastmod.json），这里不再插手。 */

// ===== 9. 输出结果供后续步骤使用 =====
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, 'ARTICLE_ID=' + newId + '\n');
  fs.appendFileSync(process.env.GITHUB_ENV, 'ARTICLE_TITLE=' + title.replace(/\n/g, ' ') + '\n');
}
console.log('✅ 文章生成成功：#' + newId + '《' + title + '》 游戏：' + gameName + ' 分类：' + category);
console.log('   净化前 ' + htmlRaw.length + ' 字符 → 净化后 ' + html.length + ' 字符');
