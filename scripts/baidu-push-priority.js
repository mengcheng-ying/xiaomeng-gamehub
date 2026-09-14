#!/usr/bin/env node
/**
 * 百度「普通收录」API 推送 —— 带状态记录的优先级顺序推送
 * ------------------------------------------------------------------
 * 为什么重写：旧的 .github/scripts/baidu-push-onebyone.js 每天读 sitemap 后
 *   **从第 1 条开始**逐条推，遇到 over quota 就 break，且没有任何状态记录。
 *   结果是每天推的都是同一批前 N 条，排在后面的 URL 永远轮不到 ——
 *   113 条 URL 的站点，实际被主动推送过的长期只有前 10 条。
 *
 * 本脚本：
 *   - 按优先级排序：游戏页(/game/N) > 攻略页(/article/N) > 公告归档(/news/<专区>) > 其余
 *     （游戏名是搜索量最大的词，最该先被收录）
 *   - data/baidu-push-state.json 记录已成功推送的 URL，游标会真正向前走
 *   - 被 over quota 拒绝的 URL **不写入已推列表**（否则会被永久跳过）
 *   - 逐条推送，遇到配额上限立即停止，把当天剩余配额用在真正没推过的 URL 上
 *
 * 用法：
 *   node scripts/baidu-push-priority.js --dry        # 只打印计划，不消耗配额
 *   node scripts/baidu-push-priority.js              # 默认最多推 10 条
 *   node scripts/baidu-push-priority.js --max=5      # 自定义单次上限
 *
 * token 来源：环境变量 BAIDU_TOKEN 或 BAIDU_PUSH_TOKEN
 *   ⚠️ site= 参数绝不能 URL 编码（编码后百度返回 400 site init fail）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
// 状态文件放 .github/ 而不是 data/，有两个原因：
//   1) rebuild.yml 的触发路径包含 data/**，放 data 会让每次推百度都白跑一次站点重建；
//   2) 配合 baidu-push.yml 的 paths-ignore，提交状态文件不会反过来触发自己。
const STATE = path.join(ROOT, '.github', 'baidu-push-state.json');
const SITE = 'https://fmbly.com';
const TOKEN = process.env.BAIDU_TOKEN || process.env.BAIDU_PUSH_TOKEN || '';

const argv = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
});
const DRY = !!argv.dry;
const MAX = argv.max ? Math.max(1, parseInt(argv.max, 10) || 10) : 10;

if (!TOKEN && !DRY) {
  console.log('⏭ 未配置 BAIDU_TOKEN / BAIDU_PUSH_TOKEN，跳过本次推送。');
  process.exit(0);
}

// ---------- 优先级 ----------
function priority(u) {
  const p = u.replace(SITE, '') || '/';
  if (/^\/game\//.test(p)) return 0;      // 游戏独立页：搜索量最大
  if (/^\/article\//.test(p)) return 1;   // 攻略长尾
  if (/^\/news\//.test(p)) return 2;      // 专区公告归档
  if (p === '/news') return 3;
  return 4;                               // 首页 / 列表页：百度自己会来抓
}
function seq(u) {
  const m = u.match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1], 10) : 9999;
}

// ---------- 读 sitemap ----------
if (!fs.existsSync(SITEMAP)) {
  console.error('✖ 找不到 sitemap.xml：' + SITEMAP);
  process.exit(1);
}
const xml = fs.readFileSync(SITEMAP, 'utf8');
const all = [...new Set([...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].trim()))];
const targets = all
  .filter((u) => u.startsWith(SITE))
  .sort((a, b) => priority(a) - priority(b) || seq(a) - seq(b));

// ---------- 读状态 ----------
let state = { pushed: {}, history: [], lastRun: null };
try {
  const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  if (raw && typeof raw === 'object') state = Object.assign(state, raw);
} catch (e) { /* 首次运行 */ }
state.pushed = state.pushed || {};

const todo = targets.filter((u) => !state.pushed[u]);
const batch = todo.slice(0, MAX);

console.log('站点：' + SITE);
console.log('sitemap 内本站 URL：' + targets.length + ' 条');
console.log('已成功推送过：' + Object.keys(state.pushed).length + ' 条');
console.log('尚未推送：' + todo.length + ' 条');
console.log('本次计划推送：' + batch.length + ' 条（上限 ' + MAX + '）' + (DRY ? '  [DRY RUN，不会真的发送]' : ''));
console.log('');
const counts = { 游戏页: 0, 攻略页: 0, 公告归档: 0, 其他: 0 };
targets.forEach((u) => { const k = ['游戏页', '攻略页', '公告归档', '公告归档', '其他'][priority(u)]; counts[k]++; });
console.log('优先级分布：' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' / '));
console.log('');
batch.forEach((u, i) => console.log('  ' + (i + 1) + '. ' + u));

if (DRY) {
  console.log('\n[DRY RUN] 未发送任何请求，未修改状态文件。');
  process.exit(0);
}
if (!batch.length) {
  console.log('\n✅ sitemap 内所有 URL 都已推送过一轮。');
  process.exit(0);
}

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
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8');

  console.log('\n========== 汇总 ==========');
  console.log('本次成功推送：' + ok + ' 条');
  console.log('累计已推送：' + Object.keys(state.pushed).length + ' / ' + targets.length + ' 条');
  console.log('仍未推送：' + targets.filter((u) => !state.pushed[u]).length + ' 条');
  if (quotaHit) console.log('状态：触发今日配额上限而停止（明天会从下一个未推过的 URL 继续）');
  if (Object.keys(failReasons).length) console.log('错误分类：' + JSON.stringify(failReasons));
  console.log('状态文件：' + STATE);
})();
