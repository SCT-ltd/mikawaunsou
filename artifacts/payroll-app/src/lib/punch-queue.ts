/**
 * 電波が悪い所でも打刻を落とさないための「溜め置き」。
 *
 * 打刻（とアルコールチェック・メッセージ）は、押すごとに端末で番号（clientId）を作って送る。
 * - 送れたら終わり。
 * - 電波が無くて送れなかったら、端末（IndexedDB）に溜めておき、電波が戻ったら順に送る。
 *   サーバーは同じ番号の2回目を捨てるので、何度送り直しても二重にはならない。
 *   溜めておいた打刻は「端末で押した時刻」で送る（サーバーは24時間以内なら受け付ける）。
 * - サーバーに断られたら（順番が違う・24時間を過ぎた など）、溜めた分から外して理由を返す。
 */

export interface QueuedItem {
  clientId: string;
  employeeId: number;
  /** 送り先（/api のあと。例 /attendance/record） */
  path: string;
  body: Record<string, unknown>;
  /** 端末で押した時刻（ミリ秒） */
  createdAt: number;
  /** 何の記録か（画面の表示用） */
  kind: "record" | "alcohol" | "message";
  attempts: number;
}

export type SendResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; queued: true }
  | { ok: false; queued: false; status: number; error: string; json: unknown };

const DB_NAME = "mikawa-punch";
const STORE = "queue";
const LS_KEY = "mikawa_punch_queue";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function newClientId(): string {
  try {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

// ── 保存先（IndexedDB。使えない端末では localStorage） ─────────────────
let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!("indexedDB" in window)) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "clientId" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function lsAll(): QueuedItem[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as QueuedItem[]; } catch { return []; }
}
function lsSave(items: QueuedItem[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch { /* いっぱい */ }
}

export async function allQueued(): Promise<QueuedItem[]> {
  const db = await openDb();
  if (!db) return lsAll().sort((a, b) => a.createdAt - b.createdAt);
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedItem[]).sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

async function putItem(item: QueuedItem): Promise<void> {
  const db = await openDb();
  if (!db) { lsSave([...lsAll().filter(x => x.clientId !== item.clientId), item]); return; }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

async function removeItem(clientId: string): Promise<void> {
  const db = await openDb();
  if (!db) { lsSave(lsAll().filter(x => x.clientId !== clientId)); return; }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(clientId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function queuedFor(employeeId: number): Promise<QueuedItem[]> {
  return (await allQueued()).filter(x => x.employeeId === employeeId);
}

// ── 送る ─────────────────────────────────────────────
async function post(path: string, body: unknown, headers: Record<string, string>, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      credentials: "same-origin",
    });
  } finally {
    clearTimeout(t);
  }
}

function errorText(status: number, json: unknown, text: string): string {
  const j = json as { error?: string } | null;
  if (j?.error) return j.error;
  if (status === 401) return "暗証番号の確認が必要です。画面を読み込み直して、暗証番号を入れてください。";
  return text && text.length < 200 ? text : "送れませんでした。";
}

/**
 * いま送る。電波が無ければ溜めて { queued: true } を返す（電波が戻ったら flushQueue が送る）。
 * サーバーが落ちている（5xx）ときも溜める。
 */
export async function sendOrQueue(item: Omit<QueuedItem, "attempts" | "createdAt"> & { createdAt?: number }, headers: Record<string, string>): Promise<SendResult> {
  const full: QueuedItem = { ...item, createdAt: item.createdAt ?? Date.now(), attempts: 0 };
  // 先に溜めておく（送っている途中で画面を閉じても消えないように）。送れたら外す。
  await putItem(full);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, queued: true };
  return sendOne(full, headers, false);
}

async function sendOne(item: QueuedItem, headers: Record<string, string>, late: boolean): Promise<SendResult> {
  const body = { ...item.body, clientId: item.clientId, ...(late ? { offline: true, clientTime: new Date(item.createdAt).toISOString() } : {}) };
  let res: Response;
  try {
    res = await post(item.path, body, headers);
  } catch {
    // 電波が無い・時間切れ：溜めたまま
    await putItem({ ...item, attempts: item.attempts + 1 });
    return { ok: false, queued: true };
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* 本文が JSON でない */ }
  if (res.ok) {
    await removeItem(item.clientId);
    return { ok: true, status: res.status, json };
  }
  if (res.status >= 500 || res.status === 429 || res.status === 408) {
    await putItem({ ...item, attempts: item.attempts + 1 });
    return { ok: false, queued: true };
  }
  // 断られた（順番が違う・古すぎる・暗証番号が要る など）：溜めた分から外す
  if (res.status !== 401) await removeItem(item.clientId);
  return { ok: false, queued: false, status: res.status, error: errorText(res.status, json, text), json };
}

let flushing = false;
/**
 * 溜めた分を古い順に送る。1件でも電波で送れなければそこで止める（順番を守るため）。
 * onResult は1件ごとに呼ぶ（画面の更新・断られた理由の表示に使う）。
 */
export async function flushQueue(headersFor: (employeeId: number) => Record<string, string>, onResult?: (item: QueuedItem, r: SendResult) => void): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of await allQueued()) {
      // 1日以上たったものは送っても断られるので外す（画面には知らせる）
      if (Date.now() - item.createdAt > 24 * 3600_000 + 5 * 60_000) {
        await removeItem(item.clientId);
        onResult?.(item, { ok: false, queued: false, status: 400, error: "24時間より前の打刻は送れませんでした。修正申請をしてください。", json: null });
        continue;
      }
      const r = await sendOne(item, headersFor(item.employeeId), true);
      onResult?.(item, r);
      if (!r.ok && r.queued) break;
      if (!r.ok && !r.queued && r.status === 401) break;
    }
  } finally {
    flushing = false;
  }
}

/** 端末に残っている日ごとの点検・下書きの控えのうち、古いもの（7日より前）を消す */
export function cleanupOldLocalKeys(days = 7): void {
  try {
    const limit = new Date(Date.now() + 9 * 3600_000 - days * 24 * 3600_000).toISOString().slice(0, 10);
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k?.match(/^(cl|draft)_\d+_(\d{4}-\d{2}-\d{2})$/);
      if (k && m && m[2]! < limit) drop.push(k);
    }
    drop.forEach(k => localStorage.removeItem(k));
  } catch { /* 使えない端末 */ }
}
