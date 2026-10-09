/* 热血江湖2.0 - 官网交互 */
(function () {
  "use strict";

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- 导航开合 ---------- */
  var header = $("#siteHeader");
  var navToggle = $("#navToggle");
  var siteNav = $("#siteNav");
  var navOverlay = $("#navOverlay");

  function setNav(open) {
    siteNav.classList.toggle("open", open);
    navOverlay.classList.toggle("show", open);
    navToggle.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", open);
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (navToggle && siteNav) {
    navToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      setNav(!siteNav.classList.contains("open"));
    });
    navOverlay.addEventListener("click", function () { setNav(false); });
    $$(".site-nav a", siteNav).forEach(function (a) {
      a.addEventListener("click", function () { setNav(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setNav(false);
    });
  }

  /* ---------- 滚动状态：header 阴影 + 底部下载条 ---------- */
  var bottomBar = $("#bottomBar");

  function onScroll() {
    var y = window.scrollY || 0;
    if (header) header.classList.toggle("scrolled", y > 10);
    if (bottomBar) bottomBar.classList.toggle("show", y > window.innerHeight * 0.6);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- 公告 Tab 切换 ---------- */
  var newsTabs = $("#newsTabs");
  var newsList = $("#newsList");
  var newsItems = $$(".news-item", newsList);

  if (newsTabs && newsItems.length) {
    newsTabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      var tab = btn.dataset.tab;
      $$(".tab", newsTabs).forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      newsItems.forEach(function (item) {
        item.classList.toggle("hide", item.dataset.group !== tab);
      });
    });
  }

  /* ---------- 职业切换 ---------- */
  var classTabs = $("#classTabs");
  var classStage = $("#classStage");
  var classCards = $$(".class-card", classStage);

  if (classTabs && classCards.length) {
    classTabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".classtab");
      if (!btn) return;
      var key = btn.dataset.class;
      if (btn.classList.contains("active")) return;
      $$(".classtab", classTabs).forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      classCards.forEach(function (card) {
        card.classList.toggle("active", card.dataset.class === key);
      });
    });
  }

  /* ---------- 滚动进入动画 ---------- */
  var revealEls = [];
  $$(".section").forEach(function (sec) {
    sec.classList.add("fade-up");
    revealEls.push(sec);
  });

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- 平滑锚点（桌面端备用） ---------- */
  $$('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (id.length > 1 && document.querySelector(id)) return; // 交给 CSS scroll-behavior
    });
  });

  /* ---------- iOS 下载（第三方分发平台落地页） ---------- */
  var IOS_URL = "https://uf5.uwanting.com/gr7bt2";
  // 点击下载按钮：iOS 直接跳转平台落地页，其余走原逻辑
  function iosInstall(e) {
    e.preventDefault();
    var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    var isAndroid = /Android/.test(navigator.userAgent);
    if (isIOS) {
      // 苹果：第三方分发平台落地页，平台自动处理设备检测、证书信任引导与安装
      window.location.href = IOS_URL;
    } else if (isAndroid) {
      // 安卓：走 apk 直链
      window.open("https://res-engine-rxyqcy.cyltc.com/package/rx/4510454/promote/4510454_4515285_c866021f3ef54b8bdece6de6a4ae7951.apk?v=1788665710", "_blank");
    } else {
      // 桌面：打开平台落地页
      window.open(IOS_URL, "_blank");
    }
  }
  var iosBtns = $$(".btn-ios-install, #iosInstall");
  iosBtns.forEach(function (btn) {
    if (btn) btn.addEventListener("click", iosInstall);
  });
})();