/* 武林外传 · 十年之约 — 交互脚本 */
(function(){
  'use strict';
  document.documentElement.classList.add('js');

  /* 顶部导航滚动状态 */
  var head = document.getElementById('top');
  function onScroll(){
    if(window.scrollY > 40){ head.classList.add('scrolled'); }
    else{ head.classList.remove('scrolled'); }
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();

  /* 移动端菜单 */
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if(toggle && links){
    toggle.addEventListener('click', function(){
      var open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ links.classList.remove('open'); toggle.classList.remove('open'); toggle.setAttribute('aria-expanded','false'); });
    });
  }

  /* 滚动显现（fail-open：js 不存在或异常时内容默认可见） */
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} });
    }, {threshold:0.12, rootMargin:'0px 0px -8% 0px'});
    reveals.forEach(function(el){ io.observe(el); });
  } else {
    reveals.forEach(function(el){ el.classList.add('in'); });
  }

  /* 倒计时：公测目标时间 */
  var target = new Date('2026/12/18 10:00:00').getTime();
  var boxes = document.querySelectorAll('[data-cd]');
  function pad(n){ return n < 10 ? '0'+n : ''+n; }
  function tick(){
    var diff = target - Date.now();
    if(diff < 0) diff = 0;
    var s = Math.floor(diff/1000);
    var d = Math.floor(s/86400), h = Math.floor(s%86400/3600),
        m = Math.floor(s%3600/60), sec = s%60;
    if(boxes.length){
      var map = {d:d, h:pad(h), m:pad(m), s:pad(sec)};
      boxes.forEach(function(el){ var k = el.getAttribute('data-cd'); if(map[k]!==undefined) el.textContent = map[k]; });
    }
  }
  if(boxes.length){ tick(); setInterval(tick, 1000); }

  /* 多平台下载：data-adapt 按钮按设备自动分流（iOS→7606 苹果版，其他→7631 安卓版） */
  var DL = {
    android: "https://sdkn-ldy.zhangyu39.com/?app_id=7631&promote_id=1778",
    ios:     "https://sdkn-ldy.zhangyu39.com/?app_id=7606&promote_id=1778"
  };
  function detectMobile(){
    var ua = navigator.userAgent;
    if(/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if(/Android/i.test(ua)) return 'android';
    return 'desktop';
  }
  var adaptBtns = document.querySelectorAll('[data-adapt]');
  adaptBtns.forEach(function(btn){
    btn.addEventListener('click', function(e){
      var dev = detectMobile();
      // 仅当能识别设备时自动分流，否则保留原 7631 直链
      if(dev === 'ios'){
        e.preventDefault();
        window.location.href = DL.ios;
      }
    });
  });
})();