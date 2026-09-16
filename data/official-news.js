/* 官方公告数据
 * 2026-09-16 用户要求清空：原抓取内容里 12% 带 QQ 群 / 微信 / 扫码 / 客服等导流信息，
 * 且正文没搬图，导致「扫描下方二维码」这类文字后面是空的；用户决定全部撤下、改由自己供稿。
 * 结构保持不变，将来要恢复抓取，跑 scripts/fetch-official-news.js 即可。
 */
const OFFICIAL_NEWS = { generatedAt: '2026-09-16', archives: {}, games: {} };
