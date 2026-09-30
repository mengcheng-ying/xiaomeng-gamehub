#!/usr/bin/env node
/**
 * 百度「普通收录」API 推送 —— 带状态记录的优先级顺序推送
 * ------------------------------------------------------------------
 * 为什么重写：旧的 .github/scripts/baidu-push-onebyone.js 每天读 sitemap 后
 *   **从第 1 条开始**逐条推，遇到 over quota 就 break，且没有任何状态记录。
 *   结果是每天推的都是同一批前 N 条，排在后面的 URL 永远轮不到。
 *
 * 推送范围（2026-09-14 用户明确）—— 规则写在 scripts/baidu-push-scope.js，改那里：
 *   推   ：首页 + 41 个游戏独立页 + 以后新发的攻略文章
 *   不推 ：每日抓取的官方公告页 /news 系列（只供玩家站内查看，不提交收录）
 *   不推 ：/games、/guides 列表页
 *
 * 本脚本：
 *   - 优先级：游戏独立页 > 首页 > 攻略文章（游戏名是搜索量最大的词）
 *   - .github/baidu-push-state.json 记录已成功推送的 URL，游标会真正向前走
 *   - 被 over quota 拒绝的 URL **不写入已推列表**（否则会被永久跳过）
 *   - ⚠️ 已成功推送过的 URL **不会被再推第二次**（百度明确说高频重复提交会拉低站点评级）
 *   - 逐条推送，遇到配额上限立即停止，把当天剩余配额用在真正没推过的 URL 上
 *
 * 2026-09-30 加：--new-today（「发布即推」专用，与 baidu-push.yml 的「两条道」配套）
 *   百度配额是「每天 10 条」的硬上限。以前任何一次内容更新都会从积压队列里取走
 *   最多 10 条 —— 如果上午那次小更新把当天额度花在还旧债上，下午新发的文章当天
 *   就一条都推不进去、要等到第二天，而新内容恰恰最需要抢时效。故拆成两条道：
 *     发布即推（workflow_run）→ 带 --new-today，只推 lastmod 是今天的页面（通常 1~3 条）
 *     定时任务（schedule）    → 不带该参数，负责还历史积压，每次最多 10 条
 *   判定依据是 sitemap 里的 lastmod：新页面首次写盘时 lastmod 即当天
 *   （见 build-articles.js 第 4.5 段），积压的老页面 lastmod 停在旧日期，
 *   所以不会被「发布即推」抢走额度。日期统一用 UTC，与本脚本记录已推日期的口径、
 *   以及构建脚本 TODAY 的口径一致；北京时间 00:00~08:00 发的页面当天不走这条道，
 *   由 13:23 那次定时补上（每天仍有 10 条额度可用，不会漏）。
 *
 * 用法：
 *   node scripts/baidu-push-priority.js --dry        # 只打印计划与进度，不消耗配额
 *   node scripts/baidu-push-priority.js              # 默认最多推 10 条
 *   node scripts/baidu-push-priority.js --max=5      # 自定义单次上限
 *   node scripts/baidu-push-priority.js --new-today  # 只推今天新产生的页面（发布即推用）
 *
 * token 来源：环境变量 BAIDU_TOKEN 或 BAIDU_PUSH_TOKEN
 *   ⚠️ site= 参数绝不能 URL 编码（编码后百度返回 400 site init fail）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const SCOPE = require('./baidu-push-scope');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
// 状态文件放 .github/ 而不是 data/，有两个原因：
//   1) rebuild.yml 的触发路径包含 data/**，放 data 会让每次推百度都白跑一次站点重建；
//   2) 配合 baidu-push.yml 的 paths-ignore，提交状态文件不会反过来触发自己。
const STATE = path.join(ROOT, '.github', 'baidu-push-state.json');
const SITE = SCOPE.SITE;
const TOKEN = process.env.BAIDU_TOKEN || process.env.BAIDU_PUSH_TOKEN || '';

const argv = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
});
const DRY = !!argv.dry;
/* 只推「今天新产生的页面」——给「发布即推」用，避免把当天的 10 条额度花在历史积压上 */
const NEW_TODAY = !!argv['new-today'];
/* 日期口径：与 build-articles.js 的 TODAY、以及本脚本记录已推日期一致（都是 UTC 日期） */
const TODAY = new Date().toISOString().slice(0, 10);
/* 单次上限：默认 10（与百度每日配额量级匹配），最多 50。
   上限的意义是别一次把配额和日志撑爆；非数字（含空、带命令的字符串）一律回退 10。 */
const MAX_PARSED = argv.max ? parseInt(argv.max, 10) : 10;
const MAX = Math.max(1, Math.min(50, Number.isFinite(MAX_PARSED) ? MAX_PARSED : 10));

if (!TOKEN && !DRY) {
  console.log('⏭ 未配置 BAIDU_TOKEN / BAIDU_PUSH_TOKEN，跳过本次推送。');
  process.exit(0);
}

// ---------- 读 sitemap ----------
if (!fs.existsSync(SITEMAP)) {
  console.error('✖ 找不到 sitemap.xml：' + SITEMAP);
  process.exit(1);
}
const xml = fs.readFileSync(SITEMAP, 'utf8');
/* sitemap 里每个 URL 的 lastmod（只取日期部分），供 --new-today 判定「今天新产生的页面」 */
const lastmodOf = {};
for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
  lastmodOf[m[1].trim()] = m[2].trim().slice(0, 10);
}
const all = SCOPE.sitemapUrls(xml);
const targets = SCOPE.targetsFromSitemap(xml);
const excluded = SCOPE.excludedFromSitemap(xml);
const excludedNews = excluded.filter((u) => /^\/news(\/|$)/.test(SCOPE.pathOf(u)));
const excludedLegacy = excluded.filter((u) => /^\/article\/\d+$/.test(SCOPE.pathOf(u)) && SCOPE.idOf(u) <= SCOPE.ARTICLE_MIN_ID);
const excludedOther = excluded.filter((u) => !excludedNews.includes(u) && !excludedLegacy.includes(u));

// ---------- 读状态 ----------
let state = { pushed: {}, history: [], lastRun: null };
try {
  const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  if (raw && typeof raw === 'object') state = Object.assign(state, raw);
} catch (e) { /* 首次运行（或本地镜像没有状态文件，属正常） */ }
state.pushed = state.pushed || {};

const backlog = targets.filter((u) => !state.pushed[u]);
const todo = NEW_TODAY ? backlog.filter((u) => lastmodOf[u] === TODAY) : backlog;
const batch = todo.slice(0, MAX);
const done = targets.filter((u) => state.pushed[u]).length;

console.log('站点：' + SITE);
console.log('');
console.log('推送范围（2026-09-14 起，规则见 scripts/baidu-push-scope.js）：');
console.log('  首页 + 游戏/攻略/礼包内容页 + 新发攻略文章');
console.log('  sitemap 内本站 URL 合计：' + all.length + ' 条');
console.log('  ├─ 在推送范围内：' + targets.length + ' 条');
console.log('  ├─ 排除 · 官方公告页（/news 系列，不提交收录）：' + excludedNews.length + ' 条');
if (excludedLegacy.length) console.log('  ├─ 排除 · 存量攻略（id <= ' + SCOPE.ARTICLE_MIN_ID + '）：' + excludedLegacy.length + ' 条');
if (excludedOther.length) {
  console.log('  └─ 排除 · 其它（不在白名单内）：' + excludedOther.length + ' 条');
  excludedOther.slice(0, 8).forEach((u) => console.log('        ' + SCOPE.pathOf(u)));
}
console.log('');
const counts = { 首页: 0, 攻略: 0, 礼包: 0, 游戏大厅: 0, 游戏页: 0 };
const countLabel = { 0: '首页', 1: '攻略', 2: '攻略', 3: '礼包', 4: '游戏大厅', 5: '游戏页' };
targets.forEach((u) => { counts[countLabel[SCOPE.priority(u)] || '攻略']++; });
console.log('范围内构成：' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' / '));
console.log('');
console.log('进度：已推送 ' + done + ' / ' + targets.length + ' 条，仍有 ' + backlog.length + ' 条从未推送过'
  + (backlog.length ? '（按每天 10 条约 ' + Math.ceil(backlog.length / 10) + ' 天推完）' : ''));
if (NEW_TODAY) {
  console.log('模式：只推「今天（' + TODAY + ' UTC）新产生的页面」——候选 ' + todo.length + ' 条'
    + '，另有 ' + (backlog.length - todo.length) + ' 条历史积压留给每日定时任务（不占当天额度）');
}
console.log('本次计划推送：' + batch.length + ' 条（上限 ' + MAX + '）' + (DRY ? '  [DRY RUN，不会真的发送]' : ''));
console.log('');
batch.forEach((u, i) => console.log('  ' + (i + 1) + '. ' + u));

if (DRY) {
  console.log('');
  console.log('[DRY RUN] 未发送任何请求，未修改状态文件。');
  console.log('提示：本地镜像通常没有 .github/baidu-push-state.json（它由 Actions 提交、只存在远端），');
  console.log('      所以「已推送」在本地可能显示为 0 —— 要看真实进度请跑 scripts/baidu-push-status.js');
  process.exit(0);
}
if (!batch.length) {
  if (NEW_TODAY && backlog.length) {
    console.log('\n✅ 今天没有新产生的页面需要推送；' + backlog.length + ' 条历史积压留给每日定时任务（当天额度不被占用，留给新内容）。');
  } else {
    console.log('\n✅ 推送范围内所有 URL 都已推送过一轮。');
  }
  process.exit(0);
}

// ---------- 并发保护（2026-09-29 加）----------
/* 状态文件是「读 → 推 → 写」三段式：两个实例同时跑会**双推同一批 URL**，
   而且后写的那个会把另一个的成果覆盖掉（状态回退）。
   CI 里由 workflow 的 concurrency: main-writer 串行化，但手动/本地跑没有这层保护，
   所以脚本自己也上一把锁。锁超过 10 分钟视为进程被 kill 留下的陈旧锁，自动接管。 */
const LOCK = path.join(ROOT, '.github', 'baidu-push.lock');
const LOCK_STALE_MS = 10 * 60 * 1000;

function acquireLock() {
  if (DRY) return true;                    // 演练不写状态文件，不需要锁
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
      console.log('⚠️  发现超过 10 分钟的陈旧锁，接管并继续。');
      fs.unlinkSync(LOCK);
    } else {
      return false;
    }
  } catch (e) { /* 没有锁文件 = 正常，继续往下抢 */ }
  try {
    fs.writeFileSync(LOCK, String(process.pid) + ' ' + new Date().toISOString(), { flag: 'wx' });  // wx = 原子独占创建
    return true;
  } catch (e) {
    return false;
  }
}
function releaseLock() {
  if (DRY) return;
  try { fs.unlinkSync(LOCK); } catch (e) { /* 已不存在 */ }
}
process.on('exit', releaseLock);

// ---------- 推送 ----------
const ENDPOINT = 'http://data.zz.baidu.com/urls?site=' + SITE + '&token=' + TOKEN;

function pushOne(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(url) }
    }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => {
        const text = Buffer.concat(c).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
        resolve({ http: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.write(url);
    req.end();
  });
}

(async () => {
  let ok = 0, quotaHit = false;
  const failReasons = {};
  const newlyPushed = [];

  if (!acquireLock()) {
    console.log('⏭ 已有另一次推送在运行（.github/baidu-push.lock 存在），本次直接跳过：');
    console.log('   状态文件是「读-推-写」，两个实例同时跑会双推同一批 URL、并互相覆盖状态文件。');
    process.exit(0);
  }

  for (let i = 0; i < batch.length; i++) {
    const url = batch[i];
    let r;
    try {
      r = await pushOne(url);
    } catch (e) {
      console.log(`✖ [${i + 1}/${batch.length}] ${url} -> 请求失败：${e.message}`);
      failReasons['network_error'] = (failReasons['network_error'] || 0) + 1;
      continue;
    }
    const j = r.json;
    const msg = (j && (j.message || j.error)) || r.text || '';

    if (String(msg).includes('over quota')) {
      console.log(`⏹ [${i + 1}/${batch.length}] 今日配额已用完（over quota），停止。被拒的 URL 不写入已推列表。`);
      quotaHit = true;
      break;
    }
    if (j && typeof j.success === 'number' && j.success > 0) {
      ok += j.success;
      state.pushed[url] = new Date().toISOString().slice(0, 10);
      newlyPushed.push(url);
      console.log(`✔ [${i + 1}/${batch.length}] ${url} -> success=${j.success}` + (typeof j.remain === 'number' ? ' remain=' + j.remain : ''));
    } else if (j && j.error) {
      console.log(`✖ [${i + 1}/${batch.length}] ${url} -> ${j.error}: ${j.message || ''}（继续下一条）`);
      failReasons[j.error] = (failReasons[j.error] || 0) + 1;
    } else {
      console.log(`? [${i + 1}/${batch.length}] ${url} -> 非预期响应：${r.text}`);
      failReasons['unknown'] = (failReasons['unknown'] || 0) + 1;
    }
  }

  if (newlyPushed.length) {
    state.history = (state.history || []).concat([{ at: new Date().toISOString(), urls: newlyPushed }]).slice(-60);
  }
  state.lastRun = new Date().toISOString();
  // 把本次运行结果也写进状态文件。
  // 为什么需要：GitHub 的 Actions 日志接口对本令牌返回 403，读不到 stdout，
  // 所以「这次是推成功了、还是撞配额上限、还是令牌失效」在外部看不出来 —— 写进状态文件就能看。
  state.lastResult = {
    at: state.lastRun,
    attempted: batch.length,                                   // 本次尝试推几条
    success: ok,                                               // 其中成功几条
    outcome: quotaHit ? 'over_quota'                          // 撞到当日配额上限
      : ok > 0 ? 'pushed'                                      // 正常推成功
        : 'no_success',                                        // 一条没成功（看 errors）
    errors: failReasons
  };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8');
  releaseLock();

  const doneNow = targets.filter((u) => state.pushed[u]).length;
  console.log('\n========== 汇总 ==========');
  console.log('本次成功推送：' + ok + ' 条');
  console.log('累计已推送：' + doneNow + ' / ' + targets.length + ' 条（推送范围内）');
  console.log('仍未推送：' + (targets.length - doneNow) + ' 条');
  if (quotaHit) console.log('状态：触发今日配额上限而停止（明天会从下一个未推过的 URL 继续）');
  if (Object.keys(failReasons).length) console.log('错误分类：' + JSON.stringify(failReasons));
  console.log('注意：已推送过的 URL 不会再推第二次（百度明确说高频重复提交会拉低站点评级）。');
  console.log('状态文件：' + STATE);
})();
