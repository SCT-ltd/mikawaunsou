// 三川運送のサービスワーカー
//  1. プッシュ通知を出す（事務所からのメッセージ・打ち忘れのお知らせなど）
//  2. 打刻ページ（/driver/:id・/office/:id）の画面の控えを持つ。電波が無くても画面が開き、
//     押した打刻は端末に溜めておける（電波が戻ったら画面が送る）。API（/api/）は控えない。
const CACHE = "mikawa-shell-v1";
const SCOPE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const SHELL_KEY = `${SCOPE}/__driver-shell`;
const PUNCH_PAGE = new RegExp(`^${SCOPE}/(driver|office)/\\d+/?$`);

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** 画面の HTML が参照しているファイルだけを残す（入れ替えのたびに古いファイルが溜まらないように） */
async function pruneAssets(html) {
  const keep = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], self.location.origin).pathname));
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith(`${SCOPE}/assets/`) && !keep.has(p)) await cache.delete(req);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(`${SCOPE}/api/`)) return;

  // 打刻ページ：まずネットから。届かなければ控えた画面を出す
  if (req.mode === "navigate" && PUNCH_PAGE.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil((async () => {
            const html = await copy.clone().text();
            const cache = await caches.open(CACHE);
            await cache.put(SHELL_KEY, copy);
            await pruneAssets(html);
          })());
        }
        return res;
      } catch {
        const hit = await caches.match(SHELL_KEY);
        return hit ?? new Response("<!doctype html><meta charset=utf-8><p style='font:16px sans-serif;padding:2em'>電波がありません。電波の良いところで開き直してください。</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // 画面の部品（名前に版が入っているので、控えがあればそれを使う）
  if (url.pathname.startsWith(`${SCOPE}/assets/`) || /\/(theme-init\.js|favicon\.svg|icon-\d+\.png|apple-touch-icon\.png|manifest\.webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit && url.pathname.startsWith(`${SCOPE}/assets/`)) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); }
        return res;
      } catch {
        return hit ?? Response.error();
      }
    })());
  }
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title ?? "三川運送";
  const options = {
    body: data.body ?? "",
    icon: `${SCOPE}/icon-192.png`,
    badge: `${SCOPE}/icon-192.png`,
    data: data.url ? { url: data.url } : {},
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/messages";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
