/**
 * 龙之谷·启程官网 - 交互脚本
 * 导航滚动变色 | 移动端菜单 | 锚点高亮
 */
(function () {
  var navbar = document.getElementById('navbar');
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.querySelector('.nav-links');
  var links = document.querySelectorAll('.nav-links a');
  var sections = document.querySelectorAll('section[id], header[id]');
  // 攻略/文章子页面：导航栏始终白底（页面顶部无深色背景）
  var isSubpage = document.body.classList.contains('subpage');

  // 滚动时导航栏变白
  function onScroll() {
    if (isSubpage || window.scrollY > 40) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
    if (!isSubpage) highlightActive();
  }

  // 滚动时高亮当前区块对应的导航项
  function highlightActive() {
    var current = 'home';
    sections.forEach(function (sec) {
      if (window.scrollY >= sec.offsetTop - 120) {
        current = sec.id;
      }
    });
    links.forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  // 移动端菜单开关
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
    });
    // 点击菜单项后自动收起
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
      });
    });
  }

  // 初始化
  onScroll();
})();
