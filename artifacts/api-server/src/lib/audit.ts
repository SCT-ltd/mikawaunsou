import type { Request } from "express";
import { db, pool, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";
import { MANUAL_LABELS, type Snap } from "./audit-catalog";

/**
 * 操作の記録を1件足す。記録に失敗しても本来の操作は止めない（ログに残す）。
 * detail には暗証番号・パスワードの値を入れないこと。
 * summary（日本語の一文）・category・対象の社員は、渡されなければ操作の名前と target から決める。
 */
export interface AuditOpts {
  summary?: string;
  category?: string;
  employeeId?: number | null;
  status?: number;
  /** ログインしていない操作（QR の打刻ページ）の、だれが */
  actor?: string;
}

/** 社員の名前（記録の一文に入れる）。1分だけ覚えておく */
const nameCache = new Map<number, { name: string; at: number }>();
export async function employeeName(id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  const c = nameCache.get(id);
  if (c && Date.now() - c.at < 60_000) return c.name;
  try {
    const r = await pool.query<{ name: string }>("select name from employees where id = $1", [id]);
    const name = r.rows[0]?.name ?? null;
    if (name) nameCache.set(id, { name, at: Date.now() });
    return name;
  } catch {
    return null;
  }
}

export function actorOf(req: Request): string | null {
  const s = req.session;
  if (!s?.userId) return null;
  return s.displayName ? `${s.displayName}（${s.username}）` : String(s.username ?? s.userId);
}

export async function audit(req: Request, action: string, target: string | null, detail?: unknown, opts: AuditOpts = {}): Promise<void> {
  try {
    const s = req.session;
    const known = MANUAL_LABELS[action];
    const empFromTarget = /^employee:(\d+)$/.exec(target ?? "");
    const employeeId = opts.employeeId !== undefined ? opts.employeeId : empFromTarget ? Number(empFromTarget[1]) : null;
    let summary = opts.summary;
    const name = !summary || (!s?.userId && !opts.actor) ? await employeeName(employeeId) : null;
    if (!summary) summary = (known?.[0] ?? action) + (name ? `（${name}）` : "");
    // 時刻はこちらで入れる（DB の既定値 now() は本番の DB が日本時間なので、読み出しと9時間ずれる）
    await db.insert(auditLogsTable).values({
      at: new Date(),
      userId: s?.userId ?? null,
      actor: actorOf(req) ?? opts.actor ?? (name ? `社員：${name}（QR打刻ページ）` : "QR打刻ページ"),
      action,
      target,
      detail: detail === undefined ? null : JSON.stringify(detail),
      ip: req.header("cf-connecting-ip") || req.ip || null,
      summary,
      category: opts.category ?? known?.[1] ?? "その他",
      status: opts.status ?? 200,
      employeeId,
      userAgent: (req.header("user-agent") ?? "").slice(0, 200) || null,
    });
  } catch (err) {
    logger.warn({ err, action, target }, "操作の記録に失敗しました");
  }
}

/** 変わった項目だけを { 項目: [前, 後] } にする（社員・会社設定などの更新の記録用） */
export function diffOf(before: Record<string, unknown>, after: Record<string, unknown>, hide: string[] = ["pin", "passwordHash", "qrKey"]): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    if (hide.includes(k) || k === "updatedAt" || k === "createdAt") continue;
    const a = before[k], b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}

// ── 変更の前後を取る ───────────────────────────────────────────────

/** 記録に残さない列（暗証番号・合言葉・パスワード・いつ直したか） */
const HIDE_COLS = new Set(["pin", "qr_key", "password_hash", "updated_at", "created_at", "updated_by"]);
const SECRET_KEYS = /pin|password|secret|token|key|auth|p256dh|endpoint/i;

/**
 * 時刻の列（タイムゾーンなし）は、アプリが UTC で書いている（drizzle と同じ読み方をする）。
 * 素の問い合わせはこれを「この端末の時刻」として読むので、その分を戻す。
 */
function cleanRow(r: Record<string, unknown>, naiveCols: Set<string>, dateCols: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (HIDE_COLS.has(k) || SECRET_KEYS.test(k)) continue;
    if (v instanceof Date && dateCols.has(k)) out[k] = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    else if (v instanceof Date) out[k] = new Date(naiveCols.has(k) ? v.getTime() - v.getTimezoneOffset() * 60000 : v.getTime()).toISOString();
    else out[k] = v;
  }
  return out;
}

export type SnapValue = Record<string, unknown> | Array<Record<string, unknown>> | null;

async function runOne(s: Snap, m: RegExpExecArray, req: Request): Promise<SnapValue> {
  const args = s.args(m, req);
  if (args.some((a) => a === null || a === undefined)) return null;
  const r = await pool.query(s.sql, args);
  const naive = new Set(r.fields.filter((f) => f.dataTypeID === 1114).map((f) => f.name));
  const dates = new Set(r.fields.filter((f) => f.dataTypeID === 1082).map((f) => f.name));
  const rows = r.rows.map((x) => cleanRow(x as Record<string, unknown>, naive, dates));
  return s.one ? rows[0] ?? null : rows;
}

/** snap が1つならその値、名前つきで複数なら { 名前: 値 } */
export async function takeSnap(snap: Snap | Record<string, Snap>, m: RegExpExecArray, req: Request): Promise<unknown> {
  if (typeof (snap as Snap).sql === "string") return runOne(snap as Snap, m, req);
  const out: Record<string, SnapValue> = {};
  for (const [k, s] of Object.entries(snap as Record<string, Snap>)) out[k] = await runOne(s, m, req);
  return { __group: true, ...out };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 前後の差を作る。1行どうしなら変わった列だけを { 列: [前, 後] }。
 * 行の一覧（手当など）は、変わったときだけ [前, 後] で丸ごと残す。
 * 名前つきの組（その月の手当・控除など）は、組ごとに同じことをする（キーは「組.列」）。
 */
export function changesOf(before: unknown, after: unknown): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!same(before, after)) out["（一覧）"] = [before ?? [], after ?? []];
    return out;
  }
  if ((isObj(before) && before["__group"]) || (isObj(after) && after["__group"])) {
    const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (k === "__group") continue;
      for (const [sk, v] of Object.entries(changesOf(b[k], a[k]))) out[sk === "（一覧）" ? k : `${k}.${sk}`] = v;
    }
    return out;
  }
  if (isObj(before) || isObj(after)) {
    const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (k === "id") continue;
      if (!same(b[k], a[k])) out[k] = [b[k] ?? null, a[k] ?? null];
    }
  }
  return out;
}

/** 受け取った中身から秘密の項目を伏せ、メッセージの本文は文字数だけにする */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => {
    if (SECRET_KEYS.test(k)) return [k, "（伏せ字）"];
    if (k === "content" && typeof x === "string") return [k, `（本文 ${x.length}文字）`];
    return [k, redact(x, depth + 1)];
  }));
}
