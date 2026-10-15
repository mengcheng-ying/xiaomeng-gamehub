#!/usr/bin/env node
/**
 * IndexNow 即时提交（Bing / Naver / Seznam.cz / Yandex / Yep）
 * -------------------------------------------------------------
 * 作用：站点内容更新后，主动告诉这些搜索引擎「哪些 URL 变了」，
 *      让它们立刻来抓取，而不是等自然发现（否则可能数天到数周）。
 *
 * 原理：IndexNow 是公开协议，密钥文件挂在站点根目录证明所有权，
 *      这里把 sitemap.xml 里的全部 URL 一次性批量提交。
 *
 * 用法：node scripts/indexnow-ping.js [--dry]
 *   --dry  只演练不发送（打印将要提交的 URL，不消耗任何配额）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'fmbly.com';
const KEY_FILE = path.join(ROOT, 'eea5d3d2859263c4f3ab19dfa8441436.txt');
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const DRY = process.argv.includes('--dry');

function readKey() {
  if (!fs.existsSync(KEY_FILE)) {
    console.error('❌ 找不到 IndexNow 密钥文件：' + KEY_FILE);
    process.exit(1);
  }
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!key) {
    console.error('❌ IndexNow 密钥文件为空');
    process.exit(1);
  }
  return key;
}

function readUrls() {
  const sitemap = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(sitemap)) {
    console.error('❌ 找不到 sitemap.xml');
    process.exit(1);
  }
  const src = fs.readFileSync(sitemap, 'utf8');
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const u = m[1].trim();
    if (u) urls.push(u);
  }
  return urls;
}

function post(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(ENDPOINT);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'indexnow-fmbly/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
    req.write(body);
    req.end();
  });
}

(async () => {
  const key = readKey();
  const urls = readUrls();

  console.log(`IndexNow：从 sitemap.xml 读取到 ${urls.length} 个 URL（host=${HOST}）`);

  if (!urls.length) {
    console.log('⚠️  没有可提交的 URL，跳过');
    return;
  }

  if (DRY) {
    console.log('[dry] 不实际发送，预览前 10 条：');
    urls.slice(0, 10).forEach((u) => console.log('  ' + u));
    if (urls.length > 10) console.log('  …（其余 ' + (urls.length - 10) + ' 条略）');
    return;
  }

  const payload = {
    host: HOST,
    key,
    keyLocation: `https://${HOST}/${key}.txt`,
    urlList: urls
  };

  try {
    const r = await post(payload);
    // 200 = 已受理，202 = 已入队，均视为成功
    if (r.status === 200 || r.status === 202) {
      console.log(`✅ IndexNow 提交成功（HTTP ${r.status}）`);
    } else if (r.status === 403) {
      console.error('❌ 密钥无效（HTTP 403），请检查站点根目录是否已部署密钥文件 ' + key + '.txt');
      process.exit(1);
    } else if (r.status === 429) {
      console.error('⚠️  触发频率限制（HTTP 429），本次跳过，下次更新会重试');
      process.exit(2);
    } else {
      console.error(`⚠️  IndexNow 返回 HTTP ${r.status}：${r.body}`);
      process.exit(1);
    }
  } catch (e) {
    console.error('❌ IndexNow 请求失败：' + e.message);
    process.exit(1);
  }
})();