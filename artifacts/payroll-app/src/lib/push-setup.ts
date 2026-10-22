/**
 * スマホへの通知（Web Push）を打刻ページで使えるようにする。
 *
 * - 通知の許可はボタン（「通知をオンにする」）を押したときだけ求める。
 *   iPhone は「利用者が押したとき」でないと許可の画面を出せないうえ、
 *   ホーム画面に追加したアプリからでないと通知そのものが使えない。
 * - すでに許可されていれば、開くたびに黙って登録し直す（1台を何人かで使うときは、最後に開いた人に届く）。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type PushState = "unsupported" | "ios-install" | "default" | "granted" | "denied";

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}
export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushState(): PushState {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-install";
  if (!supported) return "unsupported";
  return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "default";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

/**
 * 登録する。ask=true のときは許可を求める（ボタンを押したときだけ true にする）。
 * 戻り値：登録できたか、前にこの端末で通知を受けていた人の番号（ほかの人に切り替わったとき）。
 */
export async function subscribePush(employeeId: number, headers: Record<string, string>, ask: boolean): Promise<{ ok: boolean; state: PushState; replacedEmployeeId?: number | null }> {
  let state = pushState();
  if (state === "unsupported" || state === "ios-install" || state === "denied") return { ok: false, state };
  if (state === "default") {
    if (!ask) return { ok: false, state };
    const perm = await Notification.requestPermission();
    state = perm === "granted" ? "granted" : perm === "denied" ? "denied" : "default";
    if (state !== "granted") return { ok: false, state };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${BASE}/api/messages/vapid-public-key`);
    const { publicKey } = await keyRes.json() as { publicKey: string };
    if (!publicKey) return { ok: false, state };
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const json = sub.toJSON();
    const res = await fetch(`${BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ employeeId, role: "employee", endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
    });
    if (!res.ok) return { ok: false, state };
    const body = await res.json().catch(() => ({})) as { replacedEmployeeId?: number | null };
    return { ok: true, state, replacedEmployeeId: body.replacedEmployeeId ?? null };
  } catch {
    return { ok: false, state };
  }
}
