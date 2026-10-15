/* 内页顶部导航搜索 · 与首页搜索同源逻辑（索引见 js/search-index.js，由构建脚本自动重建） */
(function () {
  var input = document.getElementById('xmSearch'), panel = document.getElementById('xmPanel');
  if (!input || !panel) return;

  function data() { return (typeof SEARCH_INDEX !== 'undefined' && SEARCH_INDEX) ? SEARCH_INDEX : null; }
  function esc2(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }

  function render(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) { panel.hidden = true; panel.innerHTML = ''; return; }
    var list = data();
    if (!list) { panel.innerHTML = '<div class="srch-empty">搜索数据加载中…</div>'; panel.hidden = false; return; }
    var scored = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i], lv = -1, t = String(it.t || '').toLowerCase();
      if (it.k === 'g') {
        if (t === q) lv = 0; else if (t.indexOf(q) === 0) lv = 1; else if (t.indexOf(q) >= 0) lv = 2;
      } else {
        var hay = (t + ' ' + (it.s || '') + ' ' + (it.g || '')).toLowerCase();
        if (hay.indexOf(q) >= 0) {
          if (t === q) lv = 0; else if (t.indexOf(q) === 0) lv = 1; else if (t.indexOf(q) >= 0) lv = 2; else lv = 3;
        }
      }
      if (lv >= 0) scored.push({ it: it, lv: lv, kind: (it.k === 'g' ? 0 : 1) });
    }
    scored.sort(function (a, b) { return a.kind - b.kind || a.lv - b.lv; });
    var hits = scored.slice(0, 8).map(function (x) { return x.it; });
    if (!hits.length) {
      panel.innerHTML = '<div class="srch-empty">没有找到「' + esc2(q) + '」相关内容，换个关键词试试</div>';
      panel.hidden = false; return;
    }
    var games = hits.filter(function (h) { return h.k === 'g'; });
    var arts = hits.filter(function (h) { return h.k !== 'g'; });
    var html = '';
    if (games.length) {
      html += '<div class="sp-hd">游戏</div>';
      html += games.map(function (it) {
        var cover = it.c ? ('/' + String(it.c).replace(/^\/+/, '')) : '';
        var ch = cover
          ? '<div class="sp-cv"><img src="' + esc2(cover) + '" alt="" loading="lazy"></div>'
          : '<div class="sp-cv" style="display:flex;align-items:center;justify-content:center;font-size:1.6rem">🎮</div>';
        return '<a class="sp-game" href="' + esc2(it.u) + '">' + ch +
          '<div class="sp-info"><div class="gn">' + esc2(it.t) + '</div>' +
          '<div class="gm">' + esc2(it.s || '经典怀旧手游') + '</div>' +
          '<span class="go">进入游戏页 →</span></div></a>';
      }).join('');
    }
    if (arts.length) {
      html += '<div class="sp-hd">攻略文章</div>';
      html += arts.map(function (it) {
        return '<a class="sp-item" href="' + esc2(it.u) + '"><span class="t">' + esc2(it.t) +
          '</span><span class="m">' + esc2('攻略 · ' + (it.g || '小梦攻略组')) + '</span></a>';
      }).join('');
    }
    panel.innerHTML = html;
    panel.hidden = false;
  }

  input.addEventListener('input', function () { render(input.value); });
  input.addEventListener('focus', function () { if (input.value) render(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; panel.hidden = true; input.blur(); }
    else if (e.key === 'Enter') { var f = panel.querySelector('a'); if (f) location.href = f.getAttribute('href'); }
  });
  document.addEventListener('click', function (e) {
    if (!panel.contains(e.target) && e.target !== input) panel.hidden = true;
  });
})();
