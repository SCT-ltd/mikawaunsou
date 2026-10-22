/**
 * つながりが切れても、自分でつなぎ直すリアルタイム受信（EventSource）。
 *
 * ブラウザの EventSource は、切れたあとにサーバーが一度でもエラー（502 など）を返すと
 * そこでつなぎ直しをやめてしまう（サーバーの入れ替え中・電波が悪いときに起きる）。
 * そうなったら少し待ってから作り直す。電波が戻ったとき・画面に戻ったときもすぐつなぎ直す。
 * onOpen はつながる（つながり直す）たびに呼ぶので、切れていた間の分を取り直すのに使う。
 */
export function openLiveStream(url: string, handlers: { onMessage: (e: MessageEvent) => void; onOpen?: () => void }): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let wait = 2000;
  /** 最後に何か届いた時刻（サーバーは15〜25秒ごとに ping を送る） */
  let lastSeen = Date.now();
  const seen = () => { lastSeen = Date.now(); };

  const connect = () => {
    if (closed) return;
    if (timer) { clearTimeout(timer); timer = null; }
    es?.close();
    es = new EventSource(url);
    lastSeen = Date.now();
    es.onopen = () => { wait = 2000; seen(); handlers.onOpen?.(); };
    es.onmessage = (e) => { seen(); handlers.onMessage(e); };
    es.addEventListener("ping", seen);
    es.onerror = () => {
      // つなぎ直しをやめた（CLOSED）ときだけ、自分で作り直す
      if (es && es.readyState === EventSource.CLOSED && !closed) {
        timer = setTimeout(connect, wait);
        wait = Math.min(wait * 2, 30000);
      }
    };
  };
  const revive = () => { if (!es || es.readyState === EventSource.CLOSED) connect(); };
  const onVisible = () => { if (document.visibilityState === "visible") revive(); };
  // 途中の中継（プロキシ）がつながったふりをしたまま止まることがある。60秒なにも来なければつなぎ直す
  const watchdog = setInterval(() => {
    if (es && es.readyState === EventSource.OPEN && Date.now() - lastSeen > 60000) connect();
  }, 10000);
  window.addEventListener("online", revive);
  document.addEventListener("visibilitychange", onVisible);
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    clearInterval(watchdog);
    window.removeEventListener("online", revive);
    document.removeEventListener("visibilitychange", onVisible);
    es?.close();
  };
}
