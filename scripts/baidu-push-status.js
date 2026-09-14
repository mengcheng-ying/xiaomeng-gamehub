#!/usr/bin/env node
/**
 * 百度推送进度查询（只读，不消耗配额、不写任何文件）
 * ------------------------------------------------------------------
 * 状态文件 .github/baidu-push-state.json 由 GitHub Actions 的 baidu-push.yml
 * 每天北京时间 13:00 提交，**只存在于远端**；本地镜像通常没有它，
 * 所以 `baidu-push-priority.js --dry` 在本地看到的「已推送」会一直是 0。
 *
 * 本脚本从 GitHub API 取回远端状态（只在内存里用，不落盘），
 * 按 scripts/baidu-push-scope.js 的同一套规则算出真实进度并打印。
 *
 * 用法：node scripts/baidu-push-status.js
 * 取不到（无令牌 / 无网络）时打印一行说明后正常退出，不会让调用方失败。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const SCOPE = require('./baidu-push-scope');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_STATE = path.join(ROOT, '.github', 'baidu-push-state.json');
const API_PATH = '/repos/mengcheng-ying/xiaomeng-gamehub/contents/.github/baidu-push-state.json?ref=main';

function findToken() {
  const cands = [
    path.join(os.homedir(), '.workbuddy', 'fmbly-github.token'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.workbuddy', 'fmbly-github.token') : '',
    process.env.HOME ? path.join(process.env.HOME, '.workbuddy', 'fmbly-github.token') : ''
  ].filter(Boolean);
  for (const p of cands) {
    try {
      const t = fs.readFileSync(p, 'utf8').match(/[A-Za-z0-9_]{20,}/);
      if (t) return t[0];
    } catch (e) { /* 试下一个 */ }
  }
  return '';
}

function readLocal() {
  try { return JSON.parse(fs.readFileSync(LOCAL_STATE, 'utf8')); } catch (e) { return null; }
}

function fetchRemote() {
  return new Promise((resolve) => {
    const TOKEN = findToken();
    if (!TOKEN) return resolve({ err: '本机找不到 GitHub 令牌（~/.workbuddy/fmbly-github.token）' });
    const req = https.get({
      host: 'api.github.com', path: API_PATH,
      headers: { Authorization: 'token ' + TOKEN, 'User-Agent': 'wb', Accept: 'application/vnd.github+json' }
    }, (r) => {
      let s = '';
      r.on('data', (d) => (s += d));
      r.on('end', () => {
        if (r.statusCode !== 200) return resolve({ err: 'GitHub API 返回 HTTP ' + r.statusCode });
        try {
          const j = JSON.parse(s);
          resolve({ state: JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8')) });
        } catch (e) { resolve({ err: '状态文件解析失败' }); }
      });
    });
    req.on('error', (e) => resolve({ err: '网络不可达：' + e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ err: '请求超时' }); });
  });
}

(async () => {
  let xml = '';
  try { xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); } catch (e) {
    console.log('百度推送进度：无法读取 sitemap.xml，跳过。');
    return;
  }
  const targets = SCOPE.targetsFromSitemap(xml);

  let state = readLocal();
  let source = '本地副本';
  if (!state) {
    const r = await fetchRemote();
    if (r.err) {
      console.log('百度推送进度：暂时读不到（' + r.err + '）。');
      console.log('  推送范围共 ' + targets.length + ' 条 URL，远端进度需联网查询。');
      return;
    }
    state = r.state;
    source = 'GitHub 远端';
  }

  const pushed = (state && state.pushed) || {};
  const doneList = targets.filter((u) => pushed[u]);
  const rest = targets.filter((u) => !pushed[u]);

  console.log('百度推送进度（数据来源：' + source + '）');
  console.log('  推送范围内共 ' + targets.length + ' 条 URL（首页 + 游戏独立页 + 以后新发的攻略）');
  console.log('  已成功推送：' + doneList.length + ' / ' + targets.length + ' 条');
  console.log('  尚未推送：' + rest.length + ' 条'
    + (rest.length ? '（按每天 10 条约 ' + Math.ceil(rest.length / 10) + ' 天推完）' : '　—— 已推完一轮'));
  if (state && state.lastRun) {
    const t = new Date(new Date(state.lastRun).getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
    console.log('  上次运行：' + t + '（北京时间）');
  }
  // 上次运行结果由 baidu-push-priority.js 写入状态文件。
  // 这是因为 GitHub 的 Actions 日志接口对本令牌为 403，读不到 stdout，
  // 只能靠状态文件把「推成功 / 撞配额 / 令牌失效」区分开。
  const lr = state && state.lastResult;
  if (lr) {
    const OUT = {
      pushed: '✅ 正常推成功',
      over_quota: '⏹ 撞当日配额上限（不是失败，明天会自动接着推）',
      no_success: '⚠️ 一条都没成功 —— 看下面的错误分类'
    };
    console.log('  上次结果：' + (OUT[lr.outcome] || lr.outcome)
      + '（尝试 ' + lr.attempted + ' 条，成功 ' + lr.success + ' 条）');
    if (lr.errors && Object.keys(lr.errors).length) console.log('  错误分类：' + JSON.stringify(lr.errors));
  } else if (state && state.lastRun) {
    console.log('  上次结果：（状态文件还是旧版，升级后的那次运行才会记录）');
  }
  const hist = (state && state.history) || [];
  if (hist.length) {
    const last = hist[hist.length - 1];
    console.log('  最近一批（' + last.urls.length + ' 条）：' + last.urls.slice(0, 3).join(' , ')
      + (last.urls.length > 3 ? ' …' : ''));
  }
  if (rest.length) {
    console.log('  下一批将推：' + rest.slice(0, 3).join(' , ') + (rest.length > 3 ? ' …' : ''));
  }
  console.log('  注意：已推送过的 URL 不会再推第二次（避免高频重复提交被判定降级）。');
})().catch((e) => console.log('百度推送进度：查询异常（' + e.message + '），跳过。'));
