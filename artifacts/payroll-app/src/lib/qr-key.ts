/**
 * QR の合言葉（QR の URL の ?k=…）。打刻ページ（ログインなし）が本人の端末だと示すのに使う。
 * 最初に QR から開いたときに端末に覚えておき、以後は URL に無くても使う（ホーム画面から開いたときなど）。
 */
const storageKey = (employeeId: number) => `mk_qrkey_${employeeId}`;

/**
 * iPhone・iPad では、ホーム画面に追加したアプリが Safari と別の保存場所を使う。
 * アドレス欄から合言葉を消すと、ホーム画面に追加したときの URL にも合言葉が入らず開けなくなるので、
 * そのときだけ残す（Android はホーム画面のアプリも Chrome と同じ保存場所なので消してよい）。
 */
function keepKeyInUrl(): boolean {
  try {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true; // iPadOS はデスクトップの名乗りをする
  } catch { /* ignore */ }
  return false;
}

export function qrKeyFor(employeeId: number): string {
  let k = "";
  try {
    k = new URLSearchParams(window.location.search).get("k") ?? "";
  } catch { /* ignore */ }
  try {
    if (k) {
      localStorage.setItem(storageKey(employeeId), k);
      // 端末に覚えられたら、アドレス欄から合言葉を消す（画面ごと見られたり、URL をそのまま送ってしまったりしないように）
      if (localStorage.getItem(storageKey(employeeId)) === k && !keepKeyInUrl()) {
        const u = new URL(window.location.href);
        u.searchParams.delete("k");
        window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
      }
    } else k = localStorage.getItem(storageKey(employeeId)) ?? "";
  } catch { /* 端末の保存が使えない（プライベートブラウズなど）ときは URL の値だけ使う（消さない） */ }
  return k;
}

/** サーバーが「QR が古い（合言葉が無い）」と返したか */
export const isQrKeyError = (text: string) => text.includes("qr-key-required");
