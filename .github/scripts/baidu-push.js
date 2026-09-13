/**
 * 百度链接自动推送脚本（增量版）
 * 每次文章上线后自动运行，只推送本次新增的链接，节省每日配额
 * 需要在仓库 Settings -> Secrets and variables -> Actions 中配置 BAIDU_PUSH_TOKEN
 * 用法：
 *   node baidu-push.js          —— 增量推送（默认，只推本次新增的文章链接）
 *   node baidu-push.js --all    —— 全量推送（手动触发时使用，推送全部链接）
 */
const { execSync } = require('child_process');
const fs = require('fs');

const SITE = 'fmbly.com'; // 用于拼接页面链接（https:// + SITE + /...）
const PUSH_SITE = 'https://fmbly.com'; // 百度 API 的 site 参数，须与资源平台注册格式一致（带协议）
const TOKEN = process.env.BAIDU_TOKEN;
const FORCE_ALL = process.argv.includes('--all');

if (!TOKEN) {
  console.log('⏭ 未配置 BAIDU_PUSH_TOKEN 密钥，本次跳过百度推送。');
  console.log('  配置方法：仓库 Settings -> Secrets and variables -> Actions -> New repository secret');
  console.log('  名称填 BAIDU_PUSH_TOKEN，值填百度资源平台「普通收录-API推送」地址里 token= 后面那串');
  process.exit(0);
}

let urls = [];

if (FORCE_ALL) {
  // ===== 全量模式：推送 sitemap 全部链接 + 全部文章链接 =====
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const articles = fs.readFileSync('data/articles.js', 'utf8');
  [...articles.matchAll(/id\s*:\s*(\d+)/g)].forEach(m => {
    urls.push('https://' + SITE + '/article/' + m[1]);
  });
} else {
  // ===== 增量模式：用 git diff 找出本次提交变动的页面 =====
  try {
    const changed = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);

    // 1) data/articles.js 有新增文章 → 推送对应静态攻略页（注意：必须是 /article/ID 这种真实可抓取 URL）
    //    ⚠️ 不能用 /#guide/ID —— # 后面的内容不会发送给服务器，百度会把它当成首页，等于白发。
    if (changed.includes('data/articles.js')) {
      const diff = execSync('git diff HEAD~1 HEAD -- data/articles.js', { encoding: 'utf8' });
      const addedIds = [...diff.matchAll(/^\+\s+id:\s*(\d+)/gm)].map(m => parseInt(m[1], 10));
      [...new Set(addedIds)].forEach(id => urls.push('https://' + SITE + '/article/' + id));
    }

    // 2) 首页 / 公告 / 收录入口 / 站点地图 有变动 → 推送首页，保证公告类更新也能被收录
    if (['index.html', 'data/notices.js', 'data/games.js', 'admin.html', 'sitemap.xml']
        .some(f => changed.includes(f))) {
      urls.push('https://' + SITE + '/');
    }

    urls = [...new Set(urls)];
    if (urls.length === 0) {
      console.log('⏭ 本次提交没有新增文章或首页变动，跳过推送（节省配额）。');
      process.exit(0);
    }
  } catch (e) {
    console.log('⏭ 无法获取 diff（可能是首次提交），跳过推送。');
    process.exit(0);
  }
}

// 去重，并剔除带 # 的碎片链接（百度推送 API 不接受，送了等于送首页）
const raw = [...new Set(urls)];
const unique = raw.filter(u => {
  if (u.includes('#')) {
    console.log('⚠️ 已跳过带 # 的无效链接（百度不可收录碎片地址）：' + u);
    return false;
  }
  return true;
});
console.log('本次推送 ' + unique.length + ' 条链接到百度...');
console.log(unique.join('\n'));

if (unique.length === 0) {
  console.log('⏭ 无有效链接可推送，退出。');
  process.exit(0);
}

// ===== 调用百度推送 API =====
fetch('http://data.zz.baidu.com/urls?site=' + PUSH_SITE + '&token=' + TOKEN, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: unique.join('\n')
})
  .then(async res => {
    const text = await res.text();
    console.log('百度返回：' + text);
    if (text.includes('"success"')) {
      const m = text.match(/"success":\s*(\d+)/);
      const remain = (text.match(/"remain":\s*(\d+)/) || [])[1];
      console.log('✅ 推送成功，百度已接收 ' + (m ? m[1] : unique.length) + ' 条链接，今日剩余配额 ' + (remain || '?'));
    } else if (text.includes('over quota')) {
      console.log('⚠️ 今日配额已用完，配额每日重置，明天发文时会自动正常推送。');
    } else if (text.includes('token') || text.includes('401')) {
      console.log('❌ token 无效，请检查 BAIDU_PUSH_TOKEN 密钥配置。');
      process.exit(1);
    } else {
      console.log('⚠️ 百度返回异常，请检查 PUSH_SITE 是否为 https://fmbly.com');
    }
  })
  .catch(err => {
    console.error('❌ 推送请求失败：' + err.message);
    process.exit(1);
  });
