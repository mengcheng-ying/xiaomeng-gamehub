# 小梦怀旧手游

经典端游复刻的怀旧手游下载导航与攻略站 —— **<https://fmbly.com>**

收录热血江湖 2.0、龙之谷启程、武林外传十年之约、墨香情、千年盛世、永恒岛、星辰变、奇迹 MU 等
40 余款怀旧手游，为每款游戏建独立资料页与官网页，提供下载入口、开服信息、礼包兑换与攻略内容。

## 线上地址

| 页面 | 地址 |
| --- | --- |
| 首页 | <https://fmbly.com> |
| 游戏大厅 | <https://fmbly.com/games> |
| 攻略中心 | <https://fmbly.com/guides> |
| 官方公告 | <https://fmbly.com/news> |
| 礼包中心 | <https://fmbly.com/gift> |

## 本仓库

纯静态站点，**源码即产物**：内容页由 `scripts/build-articles.js` 依据 `data/` 下的数据文件
预渲染生成（含结构化数据、sitemap 与 canonical），推送 `main` 分支后自动部署。

```
data/        游戏 / 攻略 / 礼包 / 公告 数据（内容的唯一来源）
scripts/     构建与运维脚本（build-articles.js 为页面生成入口）
official/    各游戏官网页（独立构建，含职业、攻略、公告子页）
news/        官方公告独立页（按游戏分区归档）
article/     攻略文章独立页
assets/      图片资源（含 WebP 多尺寸变体）
```

## 说明

本站不发行、不运营任何游戏，仅整理游戏公开信息并提供下载入口导航；
游戏名称与商标归各自权利人所有。
