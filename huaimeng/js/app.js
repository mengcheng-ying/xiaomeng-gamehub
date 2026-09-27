/* ============================================================
   怀梦手游 · 页面逻辑
   ------------------------------------------------------------
   数据来源：data/games.js（游戏）、data/notices.js（公告）、data/gifts.js（兑换码）
   知识点沿用站内在用的老做法：
   1. 数据与渲染分离——运营改 data/*.js 即可，不动 HTML；
   2. 站内搜索用"本地索引 + 打分排序"（精确 / 前缀 / 包含 / 正文命中），不依赖后端；
   3. 所有动态文本先做 HTML 转义再插入，避免 XSS；
   4. 尊重 prefers-reduced-motion 与键盘操作。
   ============================================================ */
(function () {
  'use strict';

  var GAMES   = (typeof GAMES_DATA   !== 'undefined') ? GAMES_DATA   : [];
  var GENRE   = (typeof GAME_GENRE   !== 'undefined') ? GAME_GENRE   : {};
  var NOTICES = (typeof NOTICES_DATA !== 'undefined') ? NOTICES_DATA : [];
  var GIFTS   = (typeof GIFTS_DATA   !== 'undefined') ? GIFTS_DATA   : [];

  var GENRE_ORDER = ['传奇怀旧', '武侠修仙', '奇迹MU·RO', '永恒岛·Q版', '科幻奇幻', '动作冒险'];
  var GAME_LIMIT = 12;      // 首页默认展示的游戏数，点"显示全部"展开
  var NOTICE_LIMIT = 5;     // 默认展示的公告条数

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function setText(sel, v) { var el = $(sel); if (el) el.textContent = v; }

  /* ---------------- 工具 ---------------- */
  function esc(x) {
    return (x == null ? '' : String(x)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hl(text, q) { // 搜索结果关键词高亮
    var s = esc(text);
    if (!q) return s;
    var i = s.toLowerCase().indexOf(q);
    if (i < 0) return s;
    return s.slice(0, i) + '<mark>' + s.slice(i, i + q.length) + '</mark>' + s.slice(i + q.length);
  }
  function hostOf(url) {
    try { return new URL(url, location.href).hostname; } catch (e) { return url; }
  }
  function dateCN(iso, withYear) { // '2026-09-14' → '9月14日'
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return iso || '';
    return (withYear ? m[1] + '年' : '') + (+m[2]) + '月' + (+m[3]) + '日';
  }

  /* 有效期 '9.25-10.1' → 起止时间（活动都在当年，跨年自动顺延） */
  function periodRange(p) {
    var m = /^(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})$/.exec(String(p || '').trim());
    if (!m) return null;
    var y = new Date().getFullYear();
    var s = new Date(y, +m[1] - 1, +m[2], 0, 0, 0);
    var e = new Date(y, +m[3] - 1, +m[4], 23, 59, 59);
    if (e < s) e = new Date(y + 1, +m[3] - 1, +m[4], 23, 59, 59);
    return [s, e];
  }
  function periodStatus(p) {
    var r = periodRange(p);
    if (!r) return { k: 'live', t: '兑换中' };
    var now = new Date();
    if (now < r[0]) return { k: 'soon', t: '未开始' };
    if (now > r[1]) return { k: 'end',  t: '已结束' };
    return { k: 'live', t: '兑换中' };
  }

  /* 按当前设备挑一个最合适的下载入口（PC 上用通用入口） */
  var UA = navigator.userAgent || '';
  var IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var IS_ANDROID = /Android/i.test(UA);
  function bestUrl(g) {
    if (!g) return '#';
    if (IS_IOS && g.iosUrl) return g.iosUrl;
    if (IS_ANDROID && g.androidUrl) return g.androidUrl;
    return g.url || g.androidUrl || g.iosUrl || '#';
  }
  function gameById(id) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
    return null;
  }
  function genreOf(g) { return GENRE[g.id] || '经典怀旧'; }
  function shortDesc(g) {
    var d = String(g.desc || '')
      .replace(/^《[^》]*》/, '')          // 卡片标题已显示游戏名，正文里不重复
      .replace(/^（[^）]*）/, '')         // 顺带去掉紧跟的别名括注
      .replace(/^[：:，,、。；\s]+/, '')
      .replace(/^(是|乃|为|则)/, '')      // "《X》是……" 去掉书名后开头剩"是"
      .replace(/^[，。；、\s]+/, '');
    return d.length > 54 ? d.slice(0, 54) + '…' : d;
  }
  function heatText(h) { return h >= 10000 ? (h / 10000).toFixed(1) + '万' : String(h || 0); }

  /* 热度前 8 打"热门"角标（依据数据里的 heat 字段，不另造数据） */
  var HOT_IDS = {};
  GAMES.slice().sort(function (a, b) { return (b.heat || 0) - (a.heat || 0); })
    .slice(0, 8).forEach(function (g) { HOT_IDS[g.id] = true; });

  /* ---------------- 轻提示 ---------------- */
  var toastEl = $('#toast'), toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------------- 复制 ---------------- */
  function copyText(text, okMsg) {
    function done() { toast(okMsg || ('已复制：' + text)); }
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('复制失败，请长按兑换码手动复制'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, legacy);
    } else legacy();
  }

  /* ---------------- 结构自愈 ----------------
     用可视化编辑器导出的快照会丢掉 display:none 的节点：
     底部标签栏（桌面端不显示）与下载确认弹窗的内部结构都会消失。
     这里检测缺失就补回，保证功能不因导出而失效。 */
  var TABBAR_ITEMS = [
    ['#top', '首页', '<path d="M3 10.6 12 3.2l9 7.4"/><path d="M5.6 9.4V20.8h12.8V9.4"/>'],
    ['#games', '游戏库', '<rect x="2" y="6.5" width="20" height="11" rx="5.5"/><path d="M7 10.2v3.6M5.2 12h3.6M15.8 11h.01M18.2 13h.01"/>'],
    ['#notices', '公告', '<rect x="3.5" y="5" width="17" height="14" rx="2.4"/><path d="M7.5 9.4h9M7.5 13h5.6"/>'],
    ['#gifts', '兑换码', '<rect x="3.6" y="9.2" width="16.8" height="11" rx="2.2"/><path d="M3.6 13.2h16.8M12 9.2v11"/><path d="M8.4 9.2a2.4 2.4 0 1 1 0-4.8c1.9 0 3.6 4.8 3.6 4.8s1.7-4.8 3.6-4.8a2.4 2.4 0 1 1 0 4.8"/>'],
    ['#faq', '问答', '<circle cx="12" cy="12" r="9.2"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.6-2.4 2-2.4 3.4"/><path d="M12.1 16.8h.01"/>']
  ];
  function ensureShell() {
    if (!document.querySelector('.tabbar')) {
      var nav = document.createElement('nav');
      nav.className = 'tabbar';
      nav.setAttribute('aria-label', '移动端主导航');
      nav.innerHTML = TABBAR_ITEMS.map(function (t, i) {
        return '<a href="' + t[0] + '"' + (i === 0 ? ' class="on"' : '') +
          '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          t[2] + '</svg><span>' + t[1] + '</span></a>';
      }).join('');
      document.body.appendChild(nav);
    }
    var gm = document.getElementById('goModal');
    if (gm && !document.getElementById('goLink')) {
      gm.innerHTML =
        '<div class="modal-card">' +
          '<button class="x" type="button" data-close aria-label="关闭">×</button>' +
          '<div class="go-ic" aria-hidden="true">↗</div>' +
          '<h3 id="goTitle">即将前往官方下载</h3>' +
          '<p class="sub">确认目标网站无误，再继续。</p>' +
          '<div class="go-game"><img id="goCover" src="" alt=""><div>' +
            '<div class="n" id="goName"></div><div class="h" id="goHost"></div></div></div>' +
          '<ul class="go-points"><li>该入口来自游戏发行渠道，不是广告中转页</li>' +
            '<li>怀梦全程免费、不代充，收费的都和我们无关</li></ul>' +
          '<label class="go-remember"><input type="checkbox" id="goRemember"> 以后直接跳转，不再提示</label>' +
          '<div class="go-acts"><button class="btn btn-ghost" type="button" data-close>再想想</button>' +
            '<a class="btn btn-brand" id="goLink" href="#" target="_blank" rel="noopener noreferrer">继续前往下载</a></div>' +
        '</div>';
    }
  }
  ensureShell();

  /* ---------------- 弹窗 ---------------- */
  var lastFocus = null;
  function openModal(el) {
    if (!el) return;
    lastFocus = document.activeElement;
    el.hidden = false;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    var first = el.querySelector('.x');
    if (first) first.focus();
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.remove('open');
    el.hidden = true;
    if (!$('.modal.open')) document.body.style.overflow = '';
    /* 关闭游戏详情时同步清掉地址栏里的 #game-xx，避免"关了还在深链状态" */
    if (el === gameModal && /^#game-\d+$/.test(location.hash || '')) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function closeAll() { $$('.modal.open').forEach(closeModal); }

  $$('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(m); });
    $$('[data-close]', m).forEach(function (b) {
      b.addEventListener('click', function () { closeModal(m); });
    });
    // 键盘焦点留在弹窗内
    m.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = $$('a[href],button:not([disabled]),input', m).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  /* ---------------- 游戏详情 ---------------- */
  var gameModal = $('#gameModal');
  var currentGameName = '', currentGameCover = '';
  function openGame(id) {
    var g = gameById(id);
    if (!g) return;
    currentGameName = g.name;
    currentGameCover = g.cover || '';
    $('#gmCover').src = g.cover || '';
    $('#gmCover').alt = g.name + ' 游戏封面';
    $('#gmTitle').textContent = g.name;
    $('#gmTags').innerHTML =
      '<span>' + esc(genreOf(g)) + '</span>' +
      (g.year ? '<span>' + esc(g.year) + ' 年发行</span>' : '') +
      '<span>手机 / 平板</span>' +
      (HOT_IDS[g.id] ? '<span>近期热门</span>' : '');
    $('#gmDesc').textContent = g.desc || '暂无介绍。';
    var facts = '<div><b>题材</b>' + esc(genreOf(g)) + '</div>' +
      '<div><b>发行年份</b>' + (g.year ? esc(g.year) + ' 年' : '以游戏内为准') + '</div>' +
      '<div><b>安装包</b>' + (g.sizeText ? '约 ' + esc(g.sizeText) : '以官方商店页为准') + '</div>' +
      '<div><b>热度</b>' + esc(heatText(g.heat)) + '</div>';
    $('#gmFacts').innerHTML = facts;

    var acts = [];
    if (g.androidUrl) acts.push({ t: '安卓下载', u: g.androidUrl });
    if (g.iosUrl)     acts.push({ t: '苹果下载', u: g.iosUrl });
    if (!acts.length) acts.push({ t: '前往官方下载', u: g.url });
    $('#gmActs').innerHTML = acts.map(function (a, i) {
      return '<button class="btn ' + (i === 0 ? 'btn-brand' : 'btn-ghost') + '" type="button" data-go="' +
        esc(a.u) + '">' + esc(a.t) + ' ↗</button>';
    }).join('');

    openModal(gameModal);
    /* 把当前游戏写进地址栏（#game-46）：可分享、可收藏，搜索爬虫也能拿到真实链接 */
    try { history.replaceState(null, '', '#game-' + g.id); } catch (e) {}
  }
  $('#gmActs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (!b) return;
    var url = b.getAttribute('data-go');
    closeModal(gameModal);
    askDownload(currentGameName, url, currentGameCover);
  });

  /* ---------------- 下载跳转确认 ---------------- */
  var goModal = $('#goModal'), goLink = $('#goLink'), goRemember = $('#goRemember');
  var SKIP_KEY = 'hm.skipGoTip';
  function skipTip() {
    try { return localStorage.getItem(SKIP_KEY) === '1'; } catch (e) { return false; }
  }
  function setSkipTip(v) {
    try { v ? localStorage.setItem(SKIP_KEY, '1') : localStorage.removeItem(SKIP_KEY); } catch (e) {}
    renderResetTip();
  }
  function askDownload(gameName, url, cover) {
    if (!url || url === '#') { toast('该游戏暂未提供下载入口'); return; }
    if (skipTip()) { window.open(url, '_blank', 'noopener'); return; }
    $('#goName').textContent = gameName || '游戏';
    $('#goHost').textContent = '将要前往：' + hostOf(url);
    var img = $('#goCover');
    img.src = cover || '';
    img.alt = (gameName || '') + ' 游戏封面';
    img.style.display = cover ? '' : 'none';
    goLink.href = url;
    goRemember.checked = false;
    openModal(goModal);
  }
  goLink.addEventListener('click', function () {
    if (goRemember.checked) setSkipTip(true);
    closeModal(goModal);
  });
  /* 用户曾勾选"不再提示"时，页脚给出恢复入口，避免设置无法撤销 */
  function renderResetTip() {
    var old = $('#resetGoTip');
    if (!skipTip()) { if (old) old.parentNode.removeChild(old); return; }
    if (old) return;
    var p = document.createElement('p');
    p.innerHTML = '<a href="#" id="resetGoTip">恢复「下载前提示」</a>';
    $('.foot').appendChild(p);
    p.firstChild.addEventListener('click', function (e) {
      e.preventDefault(); setSkipTip(false); toast('已恢复下载前提示');
    });
  }

  /* ---------------- 游戏库 ---------------- */
  /* 若页面里已预渲染了全部游戏（例如导出快照），默认保持展开，避免加载后列表"缩水" */
  var curGenre = 'all', gamesExpanded = $$('#gameGrid .gcard').length > GAME_LIMIT;
  function genreCounts() {
    var c = {};
    GAMES.forEach(function (g) { var k = genreOf(g); c[k] = (c[k] || 0) + 1; });
    return c;
  }
  function renderChips() {
    var counts = genreCounts(), html = '';
    html += '<button class="chip' + (curGenre === 'all' ? ' on' : '') + '" type="button" data-genre="all">全部<span class="n">' + GAMES.length + '</span></button>';
    GENRE_ORDER.forEach(function (k) {
      if (!counts[k]) return;
      html += '<button class="chip' + (curGenre === k ? ' on' : '') + '" type="button" data-genre="' + esc(k) + '">' +
        esc(k) + '<span class="n">' + counts[k] + '</span></button>';
    });
    $('#genreChips').innerHTML = html;
  }
  function renderGames() {
    var list = GAMES.slice().sort(function (a, b) { return (b.heat || 0) - (a.heat || 0); });
    if (curGenre !== 'all') list = list.filter(function (g) { return genreOf(g) === curGenre; });
    var total = list.length;
    var show = (curGenre === 'all' && !gamesExpanded) ? Math.min(GAME_LIMIT, total) : total;
    var shown = list.slice(0, show);

    $('#gameGrid').innerHTML = shown.map(function (g) {
      return '<article class="gcard">' +
        '<div class="cv"><img src="' + esc(g.cover) + '" alt="' + esc(g.name) + ' 游戏封面" loading="lazy" decoding="async" width="640" height="360">' +
        (HOT_IDS[g.id] ? '<span class="hotb">热门</span>' : '') + '</div>' +
        '<div class="bd">' +
          '<h3 class="nm"><a href="#game-' + g.id + '">' + esc(g.name) + '</a></h3>' +
          '<div class="meta"><span class="tag">' + esc(genreOf(g)) + '</span>' +
            (g.year ? '<span>' + esc(g.year) + '年</span>' : '') + '</div>' +
          '<p class="ds">' + esc(shortDesc(g)) + '</p>' +
          '<div class="acts">' +
            '<button class="btn btn-brand" type="button" data-dl="' + g.id + '">下载游戏</button>' +
            '<button class="btn btn-ghost" type="button" data-detail="' + g.id + '">查看介绍</button>' +
          '</div>' +
        '</div></article>';
    }).join('');

    setText('#gamesShown', show);
    var more = $('#moreGames');
    if (curGenre === 'all' && !gamesExpanded && total > GAME_LIMIT) {
      more.hidden = false;
      more.textContent = '显示全部 ' + total + ' 款游戏';
    } else {
      more.hidden = true;
    }
  }
  $('#genreChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-genre]');
    if (!b) return;
    curGenre = b.getAttribute('data-genre');
    gamesExpanded = true;   // 切题材后展示该题材全部，避免再次折叠
    renderChips(); renderGames();
  });
  $('#moreGames').addEventListener('click', function () {
    gamesExpanded = true; renderGames();
    toast('已显示全部 ' + GAMES.length + ' 款游戏');
  });
  $('#gameGrid').addEventListener('click', function (e) {
    /* 游戏名是真实链接（#game-46），点它走深链；按钮优先级更高，放前面判断 */
    var t = e.target.closest('a[href^="#game-"]');
    if (t) {
      e.preventDefault();
      openGame(+(t.getAttribute('href') || '').slice(6));
      return;
    }
    var d = e.target.closest('[data-detail]');
    if (d) { openGame(+d.getAttribute('data-detail')); return; }
    var b = e.target.closest('[data-dl]');
    if (b) {
      var g = gameById(+b.getAttribute('data-dl'));
      if (!g) return;
      currentGameName = g.name;
      askDownload(g.name, bestUrl(g), g.cover);
      return;
    }
    /* 整行可点：点在这一行的空白处也打开游戏介绍（横向列表的常见做法，触控更宽容）；
       gameId 从行内既有按钮上取，导出过的静态快照同样适用 */
    var card = e.target.closest('.gcard');
    if (card) {
      var ref = card.querySelector('[data-detail]');
      if (ref) openGame(+ref.getAttribute('data-detail'));
    }
  });

  /* ---------------- 最新公告 ---------------- */
  /* 同游戏库：快照里若已展开全部公告，加载后保持展开 */
  var noticesExpanded = $$('#noticeList .nitem').length > NOTICE_LIMIT;
  var TYPE_CLS = { '开区': 'nt-open', '更新': 'nt-update', '活动': 'nt-act', '维护': 'nt-fix' };
  function sortedNotices() {
    return NOTICES.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }
  function noticeItem(n) {
    var cls = TYPE_CLS[n.type] || 'nt-fix';
    var g = n.gameId ? gameById(n.gameId) : null;
    return '<div class="nitem" data-nid="' + esc(n.id) + '">' +
      '<button class="head" type="button" aria-expanded="false">' +
        '<span class="nt ' + cls + '">' + esc(n.type || '公告') + '</span>' +
        '<span class="tx"><span class="tt">' + esc(n.title) + '</span>' +
          '<span class="mm">' + (n.game ? '<b>' + esc(n.game) + '</b>' : '<b>综合公告</b>') +
          '<span>' + esc(dateCN(n.date)) + '</span></span></span>' +
        '<span class="arrow" aria-hidden="true">▾</span>' +
      '</button>' +
      '<div class="body"><p>' + esc(n.content || '') + '</p>' +
        (g ? '<div class="acts"><button class="btn btn-brand btn-sm" type="button" data-nlink="' + g.id + '">进入游戏 ↗</button>' +
             '<button class="btn btn-ghost btn-sm" type="button" data-ngame="' + g.id + '">看游戏介绍</button></div>' : '') +
      '</div></div>';
  }
  function renderNotices() {
    var list = sortedNotices();
    var show = noticesExpanded ? list.length : Math.min(NOTICE_LIMIT, list.length);
    $('#noticeList').innerHTML = list.slice(0, show).map(noticeItem).join('');
    var more = $('#moreNotices');
    if (!noticesExpanded && list.length > NOTICE_LIMIT) {
      more.hidden = false;
      more.textContent = '展开全部 ' + list.length + ' 条公告';
    } else more.hidden = true;
  }
  $('#moreNotices').addEventListener('click', function () {
    noticesExpanded = true; renderNotices();
  });
  $('#noticeList').addEventListener('click', function (e) {
    var link = e.target.closest('[data-nlink]');
    if (link) {
      var g1 = gameById(+link.getAttribute('data-nlink'));
      if (g1) askDownload(g1.name, bestUrl(g1), g1.cover);
      return;
    }
    var intro = e.target.closest('[data-ngame]');
    if (intro) { openGame(+intro.getAttribute('data-ngame')); return; }
    var head = e.target.closest('.head');
    if (!head) return;
    var item = head.parentNode;
    var open = item.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  /* 搜索命中公告时：确保该条已渲染 → 展开 → 滚动到位置 */
  function openNotice(id) {
    var n = NOTICES.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    var list = sortedNotices();
    if (!noticesExpanded && list.indexOf(n) >= NOTICE_LIMIT) { noticesExpanded = true; renderNotices(); }
    var sel = '[data-nid="' + ((window.CSS && CSS.escape) ? CSS.escape(id) : id) + '"]';
    var el = $('#noticeList').querySelector(sel);
    if (!el) return;
    el.classList.add('open', 'flash');
    var head = $('.head', el); if (head) head.setAttribute('aria-expanded', 'true');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { el.classList.remove('flash'); }, 1800);
  }

  /* ---------------- 兑换码 ---------------- */
  function renderGifts() {
    if (!GIFTS.length) { $('#giftList').innerHTML = '<p class="sr-empty">近期暂无新的兑换码活动。</p>'; return; }
    $('#giftList').innerHTML = GIFTS.map(function (grp) {
      var rows = grp.gifts.map(function (gf) {
        var st = periodStatus(gf.period);
        return '<div class="code-row">' +
            '<span class="cl"><span class="cname">' + esc(gf.name) + '</span>' +
              '<span class="code">' + esc(gf.code) + '</span></span>' +
            '<button class="btn btn-brand btn-sm" type="button" data-copy="' + esc(gf.code) + '">复制兑换码</button>' +
          '</div>' +
          '<p class="items"><b>礼包内容：</b>' + esc(gf.items || '以游戏内实际发放为准') + '</p>' +
          /* 有效期放状态行：窄屏时"有效期 + 复制按钮"挤在一行会折行断开 */
          '<div class="gfoot"><span class="pill pill-' + st.k + '">' + st.t + '</span>' +
            (gf.period ? '<span>有效期 ' + esc(gf.period) + '</span>' : '') + '</div>';
      }).join('');
      return '<article class="gift">' +
        '<div class="gh"><span class="gn">' + esc(grp.game) + '</span>' +
        (grp.tag ? '<span class="gt">' + esc(grp.tag) + '</span>' : '') + '</div>' + rows + '</article>';
    }).join('');
  }
  $('#giftList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (b) copyText(b.getAttribute('data-copy'), '兑换码已复制：' + b.getAttribute('data-copy'));
  });

  /* ---------------- 站内搜索（顶栏 + 首屏，同一套逻辑） ---------------- */
  var IDX = null;
  function buildIndex() {
    var idx = [];
    GAMES.forEach(function (g) {
      idx.push({
        kind: 'game', id: g.id, title: g.name, cover: g.cover,
        meta: genreOf(g) + (g.year ? ' · ' + g.year + '年' : ''),
        text: (g.name + ' ' + (g.desc || '')).toLowerCase(),
        heat: g.heat || 0
      });
    });
    GIFTS.forEach(function (grp) {
      grp.gifts.forEach(function (gf) {
        var st = periodStatus(gf.period);
        idx.push({
          kind: 'gift', code: gf.code, gid: grp.gameId, title: gf.code,
          meta: grp.game + ' · ' + gf.name + (gf.period ? ' · ' + gf.period : ''),
          /* rank：兑换中的排前面；text 里补上"兑换码/礼包码"等词，保证搜"兑换码"能找到码 */
          rank: st.k === 'live' ? 0 : (st.k === 'soon' ? 1 : 2),
          text: (grp.game + ' ' + gf.name + ' ' + gf.code + ' ' + (gf.items || '') +
                 ' 兑换码 礼包码 激活码 福利 礼包').toLowerCase(),
          heat: 0
        });
      });
    });
    sortedNotices().forEach(function (n, i) {
      idx.push({
        kind: 'notice', id: n.id, title: n.title, rank: i, // rank：按日期新的在前
        meta: (n.game ? n.game + ' · ' : '') + dateCN(n.date),
        text: (n.title + ' ' + (n.content || '') + ' ' + (n.game || '') + ' 公告 资讯').toLowerCase(),
        heat: 0
      });
    });
    return idx;
  }
  function score(it, q) {
    var t = it.title.toLowerCase();
    if (it.kind === 'gift') {
      if (String(it.code).toLowerCase() === q) return 0;
      if (t.indexOf(q) >= 0) return 2;
      return it.text.indexOf(q) >= 0 ? 3 : -1;
    }
    if (t === q) return 0;
    if (t.indexOf(q) === 0) return 1;
    if (t.indexOf(q) >= 0) return 2;
    return it.text.indexOf(q) >= 0 ? 3 : -1;
  }
  var KIND_ORDER = { game: 0, gift: 1, notice: 2 };
  function search(q0) {
    var q = String(q0 || '').trim().toLowerCase();
    if (!q) return null;
    if (!IDX) IDX = buildIndex();
    var hits = [];
    IDX.forEach(function (it) {
      var s = score(it, q);
      if (s >= 0) hits.push({ it: it, s: s });
    });
    hits.sort(function (a, b) {
      return a.s - b.s || KIND_ORDER[a.it.kind] - KIND_ORDER[b.it.kind] ||
        (a.it.rank || 0) - (b.it.rank || 0) || (b.it.heat || 0) - (a.it.heat || 0);
    });
    var out = { game: [], gift: [], notice: [] };
    hits.forEach(function (h) { if (out[h.it.kind].length < 5) out[h.it.kind].push(h.it); });
    out.total = out.game.length + out.gift.length + out.notice.length;
    return out;
  }

  function bindSearch(rootSel, inputSel, panelSel) {
    var root = $(rootSel), input = $(inputSel), panel = $(panelSel);
    if (!root || !input || !panel) return;
    var cur = -1;

    function rows() { return $$('.sr', panel); }
    function paint() { rows().forEach(function (r, i) { r.classList.toggle('cur', i === cur); }); }
    function hide() { panel.hidden = true; panel.innerHTML = ''; cur = -1; }

    function render() {
      var q = input.value.trim();
      if (!q) { hide(); return; }
      var res = search(q);
      if (!res || !res.total) {
        panel.innerHTML = '<div class="sr-empty">没找到和「' + esc(q) + '」相关的内容' +
          '<span class="hint">换个关键词试试，比如"屠龙""江湖""MU"，或直接搜索"兑换码"</span></div>';
        panel.hidden = false; cur = -1; return;
      }
      var html = '';
      if (res.game.length) {
        html += '<div class="sg-title">游戏（' + res.game.length + '）</div>';
        html += res.game.map(function (it) {
          return '<button class="sr" type="button" data-sgame="' + it.id + '">' +
            '<img class="thumb" src="' + esc(it.cover) + '" alt="" loading="lazy">' +
            '<span class="tx"><span class="t">' + hl(it.title, q) + '</span>' +
            '<span class="m">' + esc(it.meta) + '</span></span>' +
            '<span class="go">看介绍</span></button>';
        }).join('');
      }
      if (res.gift.length) {
        html += '<div class="sg-title">兑换码（' + res.gift.length + '）</div>';
        html += res.gift.map(function (it) {
          return '<button class="sr" type="button" data-scode="' + esc(it.code) + '">' +
            '<span class="tx"><span class="t"><span class="code">' + hl(it.title, q) + '</span></span>' +
            '<span class="m">' + esc(it.meta) + '</span></span>' +
            '<span class="go">复制</span></button>';
        }).join('');
      }
      if (res.notice.length) {
        html += '<div class="sg-title">公告（' + res.notice.length + '）</div>';
        html += res.notice.map(function (it) {
          return '<button class="sr" type="button" data-snotice="' + esc(it.id) + '">' +
            '<span class="tx"><span class="t">' + hl(it.title, q) + '</span>' +
            '<span class="m">' + esc(it.meta) + '</span></span>' +
            '<span class="go">查看</span></button>';
        }).join('');
      }
      panel.innerHTML = html;
      panel.hidden = false;
      cur = -1; paint();
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', function () { if (input.value.trim()) render(); });
    input.addEventListener('keydown', function (e) {
      var list = rows();
      if (e.key === 'Escape') { input.value = ''; hide(); input.blur(); return; }
      if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); cur = (cur + 1) % list.length; paint(); list[cur].scrollIntoView({ block: 'nearest' }); return; }
      if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); cur = (cur - 1 + list.length) % list.length; paint(); list[cur].scrollIntoView({ block: 'nearest' }); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        var pick = (cur >= 0 && list[cur]) ? list[cur] : list[0];
        if (pick) pick.click();
      }
    });
    panel.addEventListener('click', function (e) {
      var g = e.target.closest('[data-sgame]');
      if (g) { openGame(+g.getAttribute('data-sgame')); input.blur(); hide(); return; }
      var c = e.target.closest('[data-scode]');
      if (c) { copyText(c.getAttribute('data-scode'), '兑换码已复制：' + c.getAttribute('data-scode')); input.blur(); hide(); return; }
      var n = e.target.closest('[data-snotice]');
      if (n) { openNotice(n.getAttribute('data-snotice')); input.blur(); hide(); return; }
    });
    document.addEventListener('click', function (e) { if (!root.contains(e.target)) hide(); });
    root._searchRender = render;
  }

  /* ---------------- 刷新数据统计 / 页脚 ---------------- */
  function renderStats() {
    var live = 0;
    GIFTS.forEach(function (g) { g.gifts.forEach(function (gf) { if (periodStatus(gf.period).k === 'live') live++; }); });
    var latest = sortedNotices()[0];
    /* 统计位可能按运营需要从页面删掉，缺位就跳过，避免报错影响后面的搜索等功能 */
    setText('#statGames', GAMES.length);
    setText('#statGifts', live);
    setText('#statFresh', latest ? dateCN(latest.date) : '—');
    setText('#footFresh', latest ? dateCN(latest.date, true) : '—');
  }

  /* ---------------- 导航高亮（顶栏导航 + 底部标签栏同步） ---------------- */
  function bindSpy() {
    var links = $$('.nav a, .tabbar a');
    var map = {};
    links.forEach(function (a) {
      var id = String(a.getAttribute('href') || '').slice(1);
      if (id) (map[id] = map[id] || []).push(a);
    });
    var secs = ['top', 'games', 'notices', 'gifts', 'faq']
      .map(function (id) { return document.getElementById(id); }).filter(Boolean);
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('on'); });
        (map[en.target.id] || []).forEach(function (a) { a.classList.add('on'); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach(function (s) { io.observe(s); });
  }

  /* ---------------- 首屏热词 ---------------- */
  $$('.hot button').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = b.getAttribute('data-q');
      var input = $('#heroSearchInput');
      input.value = q;
      input.focus();
      $('#heroSearch')._searchRender && $('#heroSearch')._searchRender();
      $('#heroSearch').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  $('#heroSearchBtn').addEventListener('click', function () {
    var input = $('#heroSearchInput');
    if (!input.value.trim()) { input.focus(); return; }
    var first = $('#heroSearchPanel .sr');
    if (first) first.click();
  });

  /* ---------------- 深链：#game-46 直接打开对应游戏 ----------------
     游戏名在页面里是真实链接（<a href="#game-46">），既方便分享收藏，
     也让搜索引擎爬到 42 条带游戏名的站内链接。 */
  function hashGameId() {
    var m = /^#game-(\d+)$/.exec(location.hash || '');
    return m ? +m[1] : 0;
  }
  window.addEventListener('hashchange', function () {
    var id = hashGameId();
    if (id) openGame(id); else closeModal(gameModal);
  });

  /* ---------------- 启动 ---------------- */
  if (hashGameId()) openGame(hashGameId());
  renderChips();
  renderGames();
  renderNotices();
  renderGifts();
  renderStats();
  bindSearch('#topSearch', '#topSearchInput', '#topSearchPanel');
  bindSearch('#heroSearch', '#heroSearchInput', '#heroSearchPanel');
  bindSpy();
  renderResetTip();
})();