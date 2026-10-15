/**
 * 百度推送范围配置 —— 唯一来源
 * ------------------------------------------------------------------
 * scripts/baidu-push-priority.js（真正推送）与 scripts/baidu-push-status.js（查进度）
 * 都从这里取规则，不要在两处各写一套。
 * 教训：2026-09-14 就因为把「58 篇攻略」当成 id 1..58，漏掉了 id 59-63 的 5 篇存量文章。
 *
 * 2026-09-14 用户明确：
 *   推   —— 首页 + 41 个游戏独立页 + **以后新发**的攻略文章（存量不推）
 *   不推 —— 每日抓取的官方公告页 /news 系列（只供玩家在自己站内查看，不提交收录）
 *   不推 —— /games、/guides 两个列表页（未列入清单）
 */
const SITE = 'https://fmbly.com';

const PUSH_SCOPE = [
  /^\/$/,                 // 首页
  /^\/game\/\d+$/,        // 41 个游戏独立页
  /^\/article\/\d+$/,     // 攻略文章（含以后每天新发的 2 篇）
];

// 即使 sitemap 里存在（将来也可能误加回来），也永不推送
const NEVER_PUSH = [
  /^\/news(\/|$)/,        // /news 总览 + /news/<专区> 归档 + /news/<专区>/<key> 公告独立页
];

// 只推 id 大于该值的攻略文章。
// ⚠️ 必须是「设定规则当天」的最大 id 快照，**不能写篇数**：
//    实测攻略 id 是 1..63 之间**不连续的 58 个**（5 个缺号）。
//    当前快照 = 63；以后新发的文章 id 从 64 起，会被正常推送。
//    设为 0 = 存量也一起推。
const ARTICLE_MIN_ID = 63;

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
  if (/^\/game\/\d+$/.test(p)) return 0;      // 游戏独立页：搜索量最大，最先推
  if (p === '/') return 1;                    // 首页
  if (/^\/article\/\d+$/.test(p)) return 2;   // 攻略文章
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
