// Web Push の購読（ドライバーのQR画面と事務所のメッセージ画面で共用）

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * プッシュ通知を購読し、サーバーに登録する。
 *
 * サーバーの VAPID 鍵を作り直したとき、端末には古い鍵の購読が残っている。
 * その状態で新しい鍵の subscribe() を呼ぶとブラウザが InvalidStateError を投げるため、
 * 鍵が違う購読は一度解除してから購読し直す（これが無いと鍵の入れ替え後に通知が永久に届かなくなる）。
 */
export async function registerPush(
  employeeId: number | null,
  role: "office" | "employee",
  opts: { askPermission?: boolean } = {},
): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${BASE}/api/messages/vapid-public-key`);
    const { publicKey } = await keyRes.json() as { publicKey: string };
    if (!publicKey) return;
    if (opts.askPermission) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    const serverKey = urlBase64ToUint8Array(publicKey);

    const existing = await reg.pushManager.getSubscription();
    if (existing && !sameKey(existing.options.applicationServerKey, serverKey)) {
      await existing.unsubscribe();
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey as BufferSource,
    });
    const json = sub.toJSON();
    await fetch(`${BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        role,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }),
    });
  } catch { /* 通知は補助機能なので、失敗しても画面は止めない */ }
}
