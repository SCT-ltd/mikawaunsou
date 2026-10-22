/**
 * QR の合言葉（QR の URL の ?k=…）。打刻ページ（ログインなし）が本人の端末だと示すのに使う。
 * 最初に QR から開いたときに端末に覚えておき、以後は URL に無くても使う（ホーム画面から開いたときなど）。
 */
const storageKey = (employeeId: number) => `mk_qrkey_${employeeId}`;

export function qrKeyFor(employeeId: number): string {
  let k = "";
  try {
    k = new URLSearchParams(window.location.search).get("k") ?? "";
  } catch { /* ignore */ }
  try {
    if (k) localStorage.setItem(storageKey(employeeId), k);
    else k = localStorage.getItem(storageKey(employeeId)) ?? "";
  } catch { /* 端末の保存が使えない（プライベートブラウズなど）ときは URL の値だけ使う */ }
  return k;
}

/** サーバーが「QR が古い（合言葉が無い）」と返したか */
export const isQrKeyError = (text: string) => text.includes("qr-key-required");
