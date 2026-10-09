/* 修仙家族模拟器2 · 官网交互 */
(function () {
  'use strict';

  // ===== 移动端导航 =====
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function (e) {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? '✕' : '☰';
      e.stopPropagation();
    });
    // 点击链接后收起菜单
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '☰';
      });
    });
    document.addEventListener('click', function (e) {
      if (links.classList.contains('open') && !links.contains(e.target) && !toggle.contains(e.target)) {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '☰';
      }
    });
  }

  // ===== 导航背景增强（滚动后） =====
  var head = document.querySelector('.site-head');
  window.addEventListener('scroll', function () {
    if (!head) return;
    if (window.scrollY > 40) head.style.background = 'rgba(10,15,18,.94)';
    else head.style.background = 'rgba(10,15,18,.82)';
  }, { passive: true });

  // ===== 滚动渐现（尊重 reduced-motion，且失败开放：从不隐藏内容） =====
  var items = document.querySelectorAll('.intro-card, .feat, .news-card, .family-inner');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && 'IntersectionObserver' in window) {
    items.forEach(function (el) {
      el.style.opacity = '1'; // 默认可见
      el.style.transition = 'opacity .7s ease, transform .7s ease';
      el.style.transform = 'translateY(20px)';
      el.style.opacity = '0';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.style.opacity = '1';
          en.target.style.transform = 'translateY(0)';
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  }
})();