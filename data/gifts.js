/**
 * 福利礼包 / 兑换码数据
 * 礼包码和物品内容按提供内容入库，物品清单分隔符统一为顿号（仅排版）。
 * 活动类礼包码失效后，应从本数组移除对应条目并重新构建。
 * ⚠️ 游戏通用礼包码（如「精灵永恒」的 JLYH 系列 / GQ888）没有固定截止日，但运营方随时可能停用；
 *    玩家反馈用不了时，同样应移除对应条目并重新构建。
 */
const GIFTS_DATA = [
  {
    gameId: 19,
    game: "永恒岛：高清重制版",
    gifts: [
      { name: "中秋礼包", code: "ALSZQ666", items: "神藏精华*20、勋章的光辉*5、1级宝石礼盒*20、金币*100000", period: "9.25-10.1" },
      { name: "国庆礼包", code: "ALSGQ888", items: "史诗卡片随机礼盒*1、脚底升级石*50、幻想羽毛*5、装备强化晶石*10", period: "10.1-10.7" }
    ]
  },
  {
    gameId: 41,
    game: "永恒岛：彩虹回忆",
    tag: "普发",
    gifts: [
      { name: "中秋礼包", code: "CHDZQ2026", items: "神佑水晶*20、装备精炼石*20、装备洗练石*10", period: "9.25-10.1" },
      { name: "国庆礼包", code: "CHDGQ2026", items: "幻想羽毛*20、高级坐骑经验药*10、高级翅膀经验药*10", period: "10.1-10.7" }
    ]
  },
  {
    gameId: 3,
    game: "星辰变：归来",
    tag: "普发",
    gifts: [
      { name: "中秋礼包", code: "XCBZQ666", items: "还童天书*10、归元石*50、中品灵兽经验丹*10", period: "9.24-9.30" },
      { name: "国庆礼包", code: "XCBGQ888", items: "下品灵性丹*10、地劫余烬*100、一级符篆包*10", period: "9.30-10.7" }
    ]
  },
  {
    gameId: 45,
    game: "热血江湖2.0",
    tag: "礼包码",
    gifts: [
      { name: "通用礼包", code: "RDLJH666", items: "土灵符x10/重生符x10/九转(小)x1/千年(小)x1", period: "" }
    ]
  },
  {
    gameId: 47,
    game: "屠龙世界：再战沙巴克",
    tag: "礼包码",
    gifts: [
      { name: "通用礼包", code: "CP23Y7", items: "", period: "" }
    ]
  },
  {
    gameId: 46,
    game: "机战：钢铁巨舰",
    tag: "礼包码",
    gifts: [
      { name: "礼包码 1", code: "JZ2026", items: "高级能源石*1、流星*1、银河币*10W", period: "" },
      { name: "礼包码 2", code: "JZ2007", items: "高级幸运模组*2、高级移速模组*2、高级经验模组*2、银河币*5W", period: "" },
      { name: "礼包码 3", code: "JZBACK", items: "乔氏粒子*10、传说改造石*10、超级金属*10、载具能量*10", period: "" },
      { name: "礼包码 4", code: "JZ666", items: "超级金属*10、4星维能晶片*2、银河币*1W", period: "" },
      { name: "礼包码 5", code: "JZVIP", items: "随机宝石箱（2级）*1、幸运核心包*1、银河币*1W", period: "" },
      { name: "礼包码 6", code: "VIP888", items: "一阶精品改造石*10、改造稳定仪*2、银河币*1W", period: "" },
      { name: "礼包码 7", code: "VIP777", items: "乔氏粒子*10、加固模组*2、银河币*1W", period: "" },
      { name: "礼包码 8", code: "VIP666", items: "增幅充能剂*2、高级经验模组*2、银河币*1W", period: "" },
      { name: "礼包码 9", code: "JZTW2026", items: "高级能源石*1、流星*1、银河币*10W", period: "" },
      { name: "礼包码 10", code: "jizhan99", items: "初级能源石*5、1阶传说改造石*50、银河币*50W", period: "" },
      { name: "礼包码 11", code: "66jizhan", items: "中级能源石*2、乔氏粒子*30、银河币*50W", period: "" },
      { name: "礼包码 12", code: "77jizhan", items: "进击宝石箱（2级）*2、防护宝石箱（2级）*2、银河币*500000", period: "" }
    ]
  },
  {
    gameId: 1,
    game: "龙之谷启程",
    tag: "礼包码",
    gifts: [
      { name: "礼包码 1", code: "lzg6666", items: "龙蛋*2、龙爪*2、金币*30000", period: "" },
      { name: "礼包码 2", code: "lzg7777", items: "纹章碎片*50、秘传纹章*10、金币*20000", period: "" },
      { name: "礼包码 3", code: "lzg8888", items: "橙色纹章随机礼包*1、水晶代码*10", period: "" },
      { name: "礼包码 4", code: "vip9999", items: "武器强化石*50、中级保护魔法药*1", period: "" },
      { name: "礼包码 5", code: "lzg2026", items: "水晶代码*5、幸运符*5", period: "" },
      { name: "礼包码 6", code: "LZGWXGZ", items: "猎犬*1、复古书*5、金币*50000", period: "" }
    ]
  },
  {
    gameId: 8,
    game: "龙城秘境：凤凰沉默",
    tag: "礼包码",
    gifts: [
      { name: "礼包码 555", code: "555", items: "化魔珠*100、天师符*100、100W经验卷*60", period: "" },
      { name: "礼包码 666", code: "666", items: "闪翼削月刃(限时3天)、霸主特权激活卡", period: "" },
      { name: "礼包码 777", code: "777", items: "生肖自选箱*50、天绝剑残片*5、心法残卷*70", period: "" },
      { name: "礼包码 888", code: "888", items: "江湖侠客章、1W绑定元宝*5", period: "" },
      { name: "礼包码 999", code: "999", items: "30万绑定灵符、1W绑定元宝*60、元素精华*100", period: "" }
    ]
  },
  {
    gameId: 2,
    game: "墨香情",
    tag: "礼包码",
    gifts: [
      { name: "礼包码 1", code: "10os48zf3o", items: "原石*10、墨币20W", period: "" },
      { name: "礼包码 2", code: "85f9o5555z", items: "力量护符(1小时)*1、敏捷护符(1小时)*1、墨币*10w", period: "" },
      { name: "礼包码 3", code: "413cgls00d", items: "高级逍遥符(3小时)*1、高级快活符(3小时)*1、高级自在符(3小时)*1、护魂卷(1天)*1", period: "" }
    ]
  },
  {
    gameId: 48,
    game: "精灵永恒",
    tag: "礼包码",
    gifts: [
      { name: "礼包码 1", code: "JLYH666", items: "初级图鉴铭牌*5、小钻石随机宝箱*1", period: "" },
      { name: "礼包码 2", code: "JLYH888", items: "2阶宝石随机宝箱*2、金币*5000", period: "" },
      { name: "礼包码 3", code: "JLYH999", items: "珍稀级装备重铸石*1、小飞鞋*5", period: "" },
      { name: "礼包码 4", code: "JLYH6666", items: "初级洗炼石*10、珍稀级装备重铸石*1", period: "" },
      { name: "礼包码 5", code: "JLYH8888", items: "3小时双倍经验小精灵*1、初级强化幸运卷轴*1", period: "" },
      { name: "礼包码 6", code: "GQ888", items: "珍稀级装备重铸石*1、3阶宝石随机宝箱*1、3小时初级战神小精灵*1", period: "" }
    ]
  },
  {
    gameId: 49,
    game: "独步武林",
    tag: "礼包码",
    gifts: [
      { name: "成长礼包", code: "VIP666", items: "强化石*10、大培元丹*3、太极神丹*3、白银宝盒*1", period: "" },
      { name: "新手礼包", code: "VIP888", items: "金疮药（大）*100、雪原参*100、生死符*20、热血令*1", period: "" },
      { name: "关注礼包", code: "VIP999", items: "强化石*10、护心丹（30%）*1、长白山参*1、传送符*20", period: "" }
    ]
  }
];
