/**
 * 百度链接逐条推送脚本（主站 fmbly.com 专用）
 * -------------------------------------------------
 * 目的：按用户要求，把 sitemap 中的规范链接【一条一条】投递给百度 API，
 * 每推一条就检查一次配额，一旦返回 over quota（今日配额已用完）立即停止，
 * 从而把今天的可用配额最大化地用满，而不是一次批量提交触发上限被整包拒绝。
 *
 * 用法（在 GitHub Actions 中通过 workflow_dispatch 以 onebyone 模式调用）：
 *   node .github/scripts/baidu-push-onebyone.js
 * 依赖 secrets.BAIDU_PUSH_TOKEN（百度资源平台「普通收录-API推送」的 token）
 */
const fs = require('fs');

const SITE = 'https://fmbly.com';
const TOKEN = process.env.BAIDU_TOKEN;

if (!TOKEN) {
  console.log('⏭ 未配置 BAIDU_PUSH_TOKEN，跳过。');
  process.exit(0);
}

// ===== 读取 sitemap 中的规范 URL（无 .html 后缀的干净链接） =====
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()).filter(Boolean);
// 去重保序
const unique = [...new Set(urls)];

console.log('待逐条推送链接（去重后）共 ' + unique.length + ' 条：');
unique.forEach((u, i) => console.log('  ' + (i + 1) + '. ' + u));

const ENDPOINT = 'http://data.zz.baidu.com/urls?site=' + SITE + '&token=' + TOKEN;

function pushOne(url) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: url
  }).then(async res => {
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* ignore */ }
    return { http: res.status, text: text, json: json };
  });
}

(async () => {
  let success = 0, remain = null, quotaHit = false;
  const failReasons = {};

  for (let i = 0; i < unique.length; i++) {
    const url = unique[i];
    let r;
    try {
      r = await pushOne(url);
    } catch (err) {
      console.log(`✖ [${i + 1}/${unique.length}] ${url} -> 请求失败: ${err.message}`);
      failReasons['network_error'] = (failReasons['network_error'] || 0) + 1;
      // 网络错误继续尝试下一条，不中断
      continue;
    }

    const msg = r.json && (r.json.message || '') || (typeof r.text === 'string' ? r.text : '');

    if (msg.includes('over quota')) {
      console.log(`⏹ [${i + 1}/${unique.length}] ${url} -> 今日配额已用完(over quota)，停止推送。`);
      quotaHit = true;
      break;
    }
    if (r.json && typeof r.json.success === 'number') {
      success += r.json.success;
      if (typeof r.json.remain === 'number') remain = r.json.remain;
      console.log(`✔ [${i + 1}/${unique.length}] ${url} -> success=${r.json.success} remain=${r.json.remain}`);
    } else if (r.json && r.json.error) {
      console.log(`✖ [${i + 1}/${unique.length}] ${url} -> 错误码 ${r.json.error}: ${r.json.message || ''}（不中断，继续下一条）`);
      failReasons[r.json.error] = (failReasons[r.json.error] || 0) + 1;
    } else {
      console.log(`? [${i + 1}/${unique.length}] ${url} -> 非预期响应: ${r.text}`);
      failReasons['unknown'] = (failReasons['unknown'] || 0) + 1;
    }
  }

  console.log('\n========== 汇总 ==========');
  console.log('成功推送: ' + success + ' 条');
  if (remain !== null) console.log('剩余今日配额(remain): ' + remain);
  if (quotaHit) console.log('状态: 触发今日配额上限而停止');
  else console.log('状态: ' + unique.length + ' 条链接已全部遍历完毕' + (remainingCount()));
  if (Object.keys(failReasons).length) {
    console.log('错误分类: ' + JSON.stringify(failReasons));
  }

  function remainingCount() {
    // 括号内只是辅助信息，实际是否用完以上面 continue/break 逻辑为准
    return '';
  }
})();