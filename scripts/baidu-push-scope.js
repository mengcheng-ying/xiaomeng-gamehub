/**
 * 百度推送范围配置 —— 唯一来源
 * ------------------------------------------------------------------
 * scripts/baidu-push-priority.js（真正推送）与 scripts/baidu-push-status.js（查进度）
 * 都从这里取规则，不要在两处各写一套。
 * 教训：2026-09-14 就因为把「58 篇攻略」当成 id 1..58，漏掉了 id 59-63 的 5 篇存量文章。
 *
 * 2026-09-28 用户明确：站内每个可以被搜索访问的内容页都应提交收录。
 *   推   —— 首页、游戏大厅、攻略中心/游戏攻略页、礼包中心/游戏礼包页、
 *           游戏独立页、攻略文章
 *   不推 —— 每日抓取的官方公告页 /news 系列（只供玩家在自己站内查看）
 *
 * 2026-10-14 用户改口：公告页也纳入推送（当天录入龙之谷 S56–S62 后，
 *   明确说「这几条一起纳入推送吧」）。此时公告已改为**人工少量录入**，
 *   不再是每天自动抓几百条，占配额的问题不存在了 → 取消 /news 的排除。
 */
const SITE = 'https://fmbly.com';

const PUSH_SCOPE = [
  /^\/$/,                 // 首页
  /^\/official\/[a-z0-9-]+\/$/,        // 官网首页（2026-10-13 加：此前从未被推送过）
  /^\/official\/[a-z0-9-]+\/[\w-]+\.html$/, // 官网页的子页（职业/公告等，有实质内容）
  /^\/games$/,            // 游戏大厅
  /^\/guides(?:\/\d+|\/misc)?$/, // 攻略中心 + 游戏攻略页
  /^\/gift(?:\/\d+)?$/,   // 礼包中心 + 游戏礼包页
  /^\/game\/\d+$/,        // 游戏独立页
  /^\/article\/\d+$/,     // 攻略文章（含以后每天新发的 2 篇）
  /^\/news$/,                                   // 资讯总览（2026-10-14 起纳入）
  /^\/news\/[a-z0-9-]+$/,                       // 专区归档，如 /news/dn
  /^\/news\/[a-z0-9-]+\/[a-z0-9][\w.-]*$/,      // 公告独立页，如 /news/dn/manual-20261014-dn-s56
];

// 即使 sitemap 里存在，也永不推送的路径。
// 2026-10-14：原本排除 /news 系列，用户改口后清空 —— 保留数组以便将来再排除别的前缀。
const NEVER_PUSH = [];

// 只推 id 大于该值的攻略文章。
// ⚠️ 必须是「设定规则当天」的最大 id 快照，**不能写篇数**：
//    实测攻略 id 是 1..63 之间**不连续的 58 个**（5 个缺号）。
//    当前快照 = 0；2026-09-27 全站存量文章已清空，此后再发的文章 id 从 1 重新开始，
//    如果仍写 63，新文章会被全部跳过、永远推不进百度，故设为 0（存量也已不存在）。
//    设为 0 = 全部在范围内的文章都推。
const ARTICLE_MIN_ID = 0;

function pathOf(u) {
  const p = u.startsWith(SITE) ? u.slice(SITE.length) : u;
  return p.replace(/[?#].*$/, '') || '/';
}
function idOf(u) {
  const m = pathOf(u).match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1], 10) : 9999;
}
function priority(u) {
  const p = pathOf(u);
  if (p === '/') return 0;                    // 首页：品牌词入口最先推
  if (/^\/official\//.test(p)) return 1;      // 官网页（2026-10-13 起，优先级仅次于首页）
  if (/^\/article\/\d+$/.test(p)) return 2;   // 新攻略：搜索引擎最需要及时发现的正文
  if (/^\/guides(?:\/\d+|\/misc)?$/.test(p)) return 3; // 攻略中心与游戏攻略页
  if (/^\/gift(?:\/\d+)?$/.test(p)) return 4; // 礼包中心与游戏礼包页
  if (p === '/games') return 5;               // 游戏大厅
  if (/^\/game\/\d+$/.test(p)) return 6;      // 游戏独立页
  if (/^\/news(\/|$)/.test(p)) return 7;      // 公告/资讯（2026-10-14 纳入，排最后）
  return 9;
}

/** sitemap.xml 里属于本站的 URL */
function sitemapUrls(xml) {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].trim()))]
    .filter((u) => u.startsWith(SITE));
}

/** 是否在推送范围内（已应用 NEVER_PUSH 与 ARTICLE_MIN_ID） */
function inScope(u) {
  const p = pathOf(u);
  if (NEVER_PUSH.some((re) => re.test(p))) return false;
  if (!PUSH_SCOPE.some((re) => re.test(p))) return false;
  if (/^\/article\/\d+$/.test(p) && idOf(u) <= ARTICLE_MIN_ID) return false;
  return true;
}

/** 由 sitemap 得到推送目标（已过滤 + 按优先级排序） */
function targetsFromSitemap(xml) {
  return sitemapUrls(xml).filter(inScope)
    .sort((a, b) => priority(a) - priority(b) || idOf(a) - idOf(b));
}

/** 由 sitemap 得到被排除的 URL */
function excludedFromSitemap(xml) {
  return sitemapUrls(xml).filter((u) => !inScope(u));
}

module.exports = {
  SITE, PUSH_SCOPE, NEVER_PUSH, ARTICLE_MIN_ID,
  pathOf, idOf, priority,
  sitemapUrls, inScope, targetsFromSitemap, excludedFromSitemap
};
