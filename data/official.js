/**
 * 各游戏「官方网站」内容（2026-10-09 合并）
 *
 * 来源：原 fmbly.com 下的 7 个游戏子域名官网（jz / lzgqc / jh / mu / mxq / wulin / xiuxian），
 * 子域名作废后把官网首页内容并进主站游戏页（/game/<id>），文案与图片都取自原官网，未改写。
 *
 * 字段说明：
 *   slug      - 图片目录名，对应 assets/images/official/<slug>/
 *   kv        - 官网主视觉大图
 *   kvSlogan  - 主视觉上的一句话标语（原官网 h1 文案）
 *   features  - 「游戏特色」卡片：[{ t 标题, d 说明, img 配图(可选) }]
 *   group     - 第二组卡片（各站叫法不同）：{ title, items:[{ t, d, img }] }
 *   news      - 官网公告标题列表（原文照录；原站的公告正文页尚未合并，故此处不带链接）
 *
 * ⚠️ 只放能核实的内容。原官网里的公告子页、攻略子页（如 mu 的 5 篇公告、lzgqc 的 6 篇攻略）
 *    这批没有一起合并，需要时再单独处理。
 */
const OFFICIAL_DATA = {
  /* 机战：钢铁巨舰 */
  46: {
    slug: 'jz',
    kv: 'assets/images/official/jz/hero-mecha.jpg',
    kvSlogan: '机甲集结 决战宇宙之巅',
    features: [
      { t: '机甲重装回归', d: '对决浩渺星际，钢铁巨兽重返战场', img: 'assets/images/official/jz/hero-mecha.jpg' },
      { t: '火力全开', d: '驾驭钢铁巨兽，全维度火力覆盖', img: 'assets/images/official/jz/feat-1.jpg' },
      { t: '舰队出征', d: '组建星际舰队，征战星辰大海', img: 'assets/images/official/jz/feat-2.jpg' },
      { t: '自由改装', d: '打造专属机甲，定制你的战斗风格', img: 'assets/images/official/jz/feat-3.jpg' }
    ]
  },

  /* 龙之谷启程 */
  1: {
    slug: 'lzgqc',
    kv: 'assets/images/official/lzgqc/hero-bg-2.jpg',
    kvSlogan: '龙之谷·启程 重返阿尔特里亚',
    features: [
      { t: '无锁定战斗', d: '延续端游经典无锁定战斗机制，自由走位、技能连招，躲避、打断、反击全凭操作，尽享指尖动作快感。' },
      { t: '千人同屏激战', d: '画面全面升级，支持千人同屏大型团战，史诗级战场流畅不卡顿，体验热血沸腾的群战爽感。' },
      { t: '多人副本协作', d: '经典多人副本回归，与好友组队开荒挑战强力BOSS，职业搭配、战术配合，重现并肩作战的乐趣。' },
      { t: '重返阿尔特里亚', d: '经典端游《龙之谷》IP正统续作，原汁原味还原阿尔特里亚大陆，熟悉的场景与剧情，开启全新冒险篇章。' }
    ],
    group: {
      title: '八大职业',
      items: [
        { t: '战神', d: '血量防御双高，旋风斩强力聚怪，自带团队增伤，副本容错高，开荒非常舒服。' },
        { t: '剑圣', d: '多段位移连招丝滑，单刷BOSS伤害极高，PVP表现优秀；身板偏脆，群怪能力弱。' },
        { t: '箭神', d: '全游戏最远射程，箭雨风暴范围清怪，操作简单，PVE刷图巢穴极稳；惧怕贴脸近身。' },
        { t: '游侠', d: '大量位移闪避，浮空连击破霸体强，竞技场1v1强势；需贴脸输出，操作门槛高。' },
        { t: '元素师', d: '冰火双系大范围清怪，升级搬砖效率顶尖，团队核心输出位；身板极脆很吃走位。' },
        { t: '魔导师', d: '减速定身重力场，时间加速全队减CD，高难巢穴刚需；单刷乏力，适合固定队。' },
        { t: '贤者', d: '高格挡护盾嘲讽，能拉BOSS仇恨保护队友，能抗能打；高难副本必备主T。' },
        { t: '祭司', d: '治愈之手持续回血，提供攻击增益，团队续航核心；高难副本组队刚需。' }
      ]
    }
  },

  /* 热血江湖2.0 */
  45: {
    slug: 'jh',
    kv: 'assets/images/official/jh/hero-cover.webp',
    kvSlogan: '江湖再启，热血不灭',
    group: {
      title: '五大职业',
      items: [
        { t: '刀客', d: '刀光所至，寸草不生', img: 'assets/images/official/jh/class-daoke.jpg' },
        { t: '剑客', d: '一剑光寒十九洲', img: 'assets/images/official/jh/class-jianke.jpg' },
        { t: '弓手', d: '百步穿杨，箭定乾坤', img: 'assets/images/official/jh/class-gongshou.jpg' },
        { t: '枪客', d: '我自横枪向天笑', img: 'assets/images/official/jh/class-qiangke.jpg' },
        { t: '医师', d: '医者仁心，妙手回春', img: 'assets/images/official/jh/class-yixian.jpg' }
      ]
    },
    features: [
      { t: '千人同屏 · 热血PK', d: '跨服争霸、帮派混战，千人同屏技能特效拉满，体验刀刀见血的热血群战。', img: 'assets/images/official/jh/feature-pvp.jpg' },
      { t: '开放江湖 · 自由探索', d: '山川湖海、古城秘境尽收眼底，自由探索的广袤武侠世界等你来闯。', img: 'assets/images/official/jh/feature-world.jpg' },
      { t: '神兽坐骑 · 酷炫外观', d: '烈焰猛虎、玄冰神龙，收集养成你的专属神兽坐骑，驰骋江湖威风凛凛。', img: 'assets/images/official/jh/feature-mount.jpg' }
    ]
  },

  /* 荣耀出征卡点服（原官网自称「荣耀出征·原始点卡服」） */
  6: {
    slug: 'mu',
    kv: 'assets/images/official/mu/hero_bg.webp',
    kvSlogan: '经典奇迹MU题材，原汁原味点卡服 · 公平绿色，永不滚服',
    features: [
      { t: '原始点卡服', d: '公平游戏时长计费，无商城道具售卖，还原最纯粹的装备掉落与打宝乐趣。' },
      { t: '经典奇迹MU', d: '致敬经典的大陆世界观，熟悉的勇者大陆、冰风谷、地下城，重温热血征程。' },
      { t: '永不滚服', d: '单服生态持续运营，不频繁开新服合并，你的每一次付出都有长期价值。' },
      { t: '公平绿色', d: '无VIP特权、无战力排行榜、无自动寻路抢怪，实力说话，纯粹冒险。' }
    ],
    news: [
      '9月11日全区全服维护更新公告',
      '【开服通知】荣耀37区 9月11日13:00开启',
      '开服时间线一览',
      '已开展活动盘点'
    ]
  },

  /* 墨香情 */
  2: {
    slug: 'mxq',
    kv: 'assets/images/official/mxq/hero_keyvisual.webp',
    kvSlogan: '执笔入画，墨染情长',
    features: [
      { t: '无职业束缚 · 武器即流派', d: '无传统战法牧职业划分，刀、枪、剑、拳、弓、暗器六大武器随时切换。外功招式配五行内功心法自由搭配，三百余种武学组合自定义套路，高级武学副本/野外掉落获取。' },
      { t: '复古武侠大世界 · 高自由度', d: '还原端游七十余张经典地图：长安、开封、龙门石窟、沙漠等地貌。特色轻功神行百变、一苇渡江，飞檐走壁水上穿行；正邪双轨江湖，行事路线自由。' },
      { t: '硬核战斗 · PVP&PVE', d: '浮空、硬直、霸体机制细节拉满，打击感强、重操作。PVP含野外自由PK、擂台单挑、武林大会、跨服帮战；PVE含组队副本与世界BOSS争夺，极品装备掉落不绑定。' },
      { t: '开放自由交易 · 可搬砖', d: '装备、武学、材料大多不绑定，支持玩家自由交易与交易行流通。打怪与BOSS产出的道具即可变现，打造玩家驱动的江湖经济，适合搬砖打金。' },
      { t: '三端互通 · 情怀复刻', d: '手机、模拟器、PC数据互通，同一账号多设备畅玩，无需重新建号。画风、段位系统、音效与经典剧情高度还原老墨香端游，怀旧向玩法。' },
      { t: '江湖社交与养成', d: '行会、结拜等社交玩法，支持帮派领地争夺；外观时装自由搭配，捏脸自定义角色。养成无强制氪金，资源主要靠副本、野外刷怪获取。' }
    ]
  },

  /* 武林外传：十年之约 */
  21: {
    slug: 'wulin',
    kv: 'assets/images/official/wulin/hero_kv.webp',
    kvSlogan: '十年客栈 · 再续江湖新篇',
    group: {
      title: '特色玩法',
      items: [
        { t: '跨服论剑 · 群雄逐鹿', d: '全服同屏切磋，无锁定快攻打斗。五行相生相克、招式千变万化，真人在线、公平竞技，谁才是你当年的那个「天下剑宗」？', img: 'assets/images/official/wulin/feature-lunjian.webp' },
        { t: '江湖情缘 · 结伴同游', d: '与好友结拜、与知己携手。同乘马车游尽山河，系统花轿迎亲、结伴闯关，江湖路上不再孤单。', img: 'assets/images/official/wulin/feature-qingyuan.webp' },
        { t: '探秘奇缘 · 副本寻宝', d: '古墓机关重重，奇遇接连不断。组队闯荡、押镖护卫、寻宝夺奖，每一次探索都藏着新的江湖传说。', img: 'assets/images/official/wulin/feature-jitan.webp' }
      ]
    },
    news: [
      '《武林外传·十年之约》预创角注册开启公告',
      '《武林外传·十年之约》群侠版全平台预约今日开启',
      '江湖情报站 Vol.1：同福客栈大焕新装修揭秘',
      '新手江湖指南：从七侠镇出发的第一步'
    ]
  },

  /* 修仙家族模拟器2 */
  36: {
    slug: 'xiuxian',
    kv: 'assets/images/official/xiuxian/hero_kv.webp',
    kvSlogan: '从一介凡人，到一族之宗',
    features: [
      { t: '家族经营', d: '建设灵田、炼丹炼器、培养弟子，一步步壮大家族根基。' },
      { t: '自由修仙', d: '功法万千、机缘无数，突破境界，成仙成神皆由你定。' },
      { t: '群雄争锋', d: '宗门林立、世仇争夺，家族联姻、结盟、征战，谱写仙途大戏。' },
      { t: '血脉传承', d: '天赋血脉代代相传，子孙延续家族荣光，仙誓不朽。' }
    ],
    group: {
      title: '三途仙路',
      items: [
        { t: '兴家立业', d: '从一间院落开始，开辟灵田、修筑屋舍、招募灵仆，经营家族的每一寸根基，让家族在乱世仙途立足繁衍。', img: 'assets/images/official/xiuxian/feature_family.webp' },
        { t: '闭关悟道', d: '纳灵气、炼丹药、悟功法，境界层层突破，踏上炼气、筑基、金丹直至化神的漫长仙途。', img: 'assets/images/official/xiuxian/feature_cultivate.webp' },
        { t: '逐鹿仙途', d: '加入或创建宗门，家族间联姻结盟、争夺资源、征战四方，在恩怨与荣耀中登上仙道之巅。', img: 'assets/images/official/xiuxian/feature_faction.webp' }
      ]
    },
    news: [
      '《修仙家族模拟器2》全平台预约正式开启',
      '家族血脉玩法前瞻：传承与荣光',
      '仙途地图揭秘：六大灵域风水各异'
    ]
  }
};
