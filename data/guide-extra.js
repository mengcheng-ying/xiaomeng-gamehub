/**
 * 攻略加厚内容（按文章 id 追加到正文末尾）
 * -------------------------------------------------
 * 本文件为可选增量文件，构建脚本 scripts/build-articles.js 会自动读取并
 * 追加到对应文章正文之后，原始 data/articles.js 保持不变。
 *
 * ⚠️ 涉及游戏事实的内容均来自公开可查渠道（官网 / 官方宣发稿 / 百度百科 /
 *    版号公示），未核实的信息一律不写。玩法建议类内容为原创整理。
 *
 * 用法：
 *   1) 在下面按 id 补写 HTML 片段（可用 h2 / h3 / p / ul / li / table / blockquote）
 *   2) 运行 node scripts/build-articles.js 重新生成静态页
 *
 * 2026-09-27 全站文章清空，原 58 篇加厚内容一并清空（旧 id 已失效）。
 * 历史内容保留在备份分支 backup/before-article-purge-20260927。
 */
const GUIDE_EXTRA = {
};
