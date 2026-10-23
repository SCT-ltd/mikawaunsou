// 画面の最初に動く：テーマ（明るい／暗い）を先に決める（表示のちらつきを防ぐ）。
// 以前は index.html に直接書いていたが、読み込んでよい先を絞る指定（CSP）に合わせて別のファイルにした。
// FOUC対策: Reactマウント前にテーマを確定して html.dark を付与する
(function () {
  try {
    // スタッフの打刻ページ（/driver・/office）は明るい表示だけで作ってあるので、スマホが暗い設定でも暗くしない
    // （暗くすると文字だけ白くなって、白い背景の上で読めなくなっていた）
    if (/^\/(driver|office)\//.test(location.pathname)) return;
    var saved = localStorage.getItem("theme");
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) { /* ignore */ }
})();
    