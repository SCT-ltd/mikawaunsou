// 画面の最初に動く：開いた画面に合わせてアイコンを切り替える。
//   スタッフの打刻ページ（/driver/:id・/office/:id ＝ QRで開くページ）＝橙のアイコン・「三川打刻」
//   それ以外（事務所の管理画面）＝濃い色のアイコン・「三川管理」（index.html の既定）
// ホーム画面に追加したときのアイコンと名前も、ここで決まる。
(function () {
  try {
    if (!/^\/(driver|office)\/\d+\/?$/.test(location.pathname)) return;
    var set = function (sel, attr, val) { var el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
    set('link[rel="icon"][type="image/svg+xml"]', "href", "/favicon-staff.svg");
    set('link[rel="icon"][type="image/png"]', "href", "/favicon-staff-32.png");
    set('link[rel="manifest"]', "href", "/manifest.webmanifest");
    set('link[rel="apple-touch-icon"]', "href", "/apple-touch-icon.png");
    set('meta[name="apple-mobile-web-app-title"]', "content", "三川打刻");
    set('meta[name="theme-color"]', "content", "#FF3C00");
  } catch (e) { /* アイコンが既定のままでも動く */ }
})();
