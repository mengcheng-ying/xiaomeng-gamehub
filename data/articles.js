/**
 * 怀旧游戏攻略文章数据文件
 * -------------------------------------------------
 * 2026-09-27 全站攻略文章清空（用户要求），此文件保持空数组。
 * 后续每天 2 篇由「工单发布文章」工作流（.github/scripts/publish-article.js）
 * 自动追加到本数组，无需手工维护格式。
 *
 * 字段说明（自动发布时写入）：
 *   id       - 自增 id（= 当前最大 id + 1）
 *   gameId   - 关联 data/games.js 的游戏 id
 *   title / summary / content（HTML）/ author / date / category / cover / views
 */
const ARTICLES_DATA = [
];
