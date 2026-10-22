import { db, attendanceRecordsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";

/**
 * 勤務（シフト）の決まり。打刻・画面の表示・集計がみな同じ関数を使う。
 *
 * ■ 打刻をどの勤務日に付けるか
 *   出勤は、押した時刻の日本の日付が勤務日になる。
 *   出勤以外（休憩・退勤）は「直近24時間以内に出勤があって、まだ退勤していない勤務」に付ける。
 *   以前は「朝5時まで」で区切っていたため、朝5時を過ぎて退勤すると勤務が2日に割れていた。
 *
 * ■ いまの勤務の日付（画面に出す日付）
 *   直近24時間以内の出勤で、まだ退勤していないものがあればその日。無ければ今日。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const JST_MS = 9 * 60 * 60 * 1000;
export const SHIFT_WINDOW_MS = DAY_MS;

export type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";
export const EVENT_TYPES: EventType[] = ["clock_in", "clock_out", "break_start", "break_end"];
export const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了",
};

/** 日本時間の日付（YYYY-MM-DD） */
export function jstDate(d: Date = new Date()): string {
  return new Date(d.getTime() + JST_MS).toISOString().slice(0, 10);
}
/** 日本時間の時（0〜23） */
export function jstHour(d: Date = new Date()): number {
  return new Date(d.getTime() + JST_MS).getUTCHours();
}
export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 取り消していない打刻だけ */
export const active = isNull(attendanceRecordsTable.voidedAt);

type Rec = { employeeId: number; eventType: string; workDate: string; recordedAt: Date | string };
type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * 打刻の一覧から「at の時点で開いたままの勤務の日付」を探す（DB を見ない版）。
 * 直近24時間以内の出勤のうちいちばん新しいもの。その勤務日に退勤が無ければ開いている。
 */
export function openShiftDateFrom(recs: Rec[], at: Date): string | null {
  const t = at.getTime();
  const ins = recs
    .filter(r => r.eventType === "clock_in")
    .filter(r => { const x = new Date(r.recordedAt).getTime(); return x <= t + 60_000 && x > t - SHIFT_WINDOW_MS; })
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  const latest = ins[0];
  if (!latest) return null;
  const closed = recs.some(r => r.eventType === "clock_out" && r.workDate === latest.workDate);
  return closed ? null : latest.workDate;
}

/** 社員ごとの「いまの勤務の日付」。開いた勤務が無ければ at の日付。 */
export async function currentShiftDates(employeeIds: number[] | null, at: Date = new Date(), tx: Db | Tx = db): Promise<Map<number, string>> {
  const today = jstDate(at);
  const from = addDaysStr(today, -2);
  const conds = [gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, today), active,
    inArray(attendanceRecordsTable.eventType, ["clock_in", "clock_out"])];
  if (employeeIds) {
    if (employeeIds.length === 0) return new Map();
    conds.push(inArray(attendanceRecordsTable.employeeId, employeeIds));
  }
  const recs = await tx.select({
    employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType,
    workDate: attendanceRecordsTable.workDate, recordedAt: attendanceRecordsTable.recordedAt,
  }).from(attendanceRecordsTable).where(and(...conds));
  const byEmp = new Map<number, Rec[]>();
  for (const r of recs) { if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []); byEmp.get(r.employeeId)!.push(r); }
  const out = new Map<number, string>();
  for (const id of employeeIds ?? [...byEmp.keys()]) {
    out.set(id, openShiftDateFrom(byEmp.get(id) ?? [], at) ?? today);
  }
  return out;
}

/** 1人分の「いまの勤務の日付」 */
export async function currentShiftDate(employeeId: number, at: Date = new Date(), tx: Db | Tx = db): Promise<string> {
  return (await currentShiftDates([employeeId], at, tx)).get(employeeId) ?? jstDate(at);
}

/** 打刻を付ける勤務日。出勤は押した日、それ以外は開いている勤務（無ければ押した日）。 */
export async function shiftDateForEvent(employeeId: number, eventType: string, at: Date, tx: Db | Tx = db): Promise<string> {
  if (eventType === "clock_in") return jstDate(at);
  return currentShiftDate(employeeId, at, tx);
}

// ── 押す順番 ─────────────────────────────────────────────
export type ShiftState = "none" | "working" | "break" | "done";

/** 打刻（時刻順）から、いまの状態を出す。順番が崩れていてもできるだけ読む。 */
export function stateOf(evs: Array<{ eventType: string }>): ShiftState {
  let s: ShiftState = "none";
  for (const e of evs) {
    if (e.eventType === "clock_in") s = "working";
    else if (e.eventType === "break_start") s = "break";
    else if (e.eventType === "break_end") s = "working";
    else if (e.eventType === "clock_out") s = "done";
  }
  return s;
}

/** いまの状態で、その打刻を押してよいか。だめなら理由を返す。 */
export function transitionError(state: ShiftState, eventType: string): string | null {
  switch (eventType) {
    case "clock_in":
      if (state === "none") return null;
      return state === "done" ? "この日はもう退勤しています。打ち間違いは「打刻の修正を申請」から直してください。" : "すでに出勤しています。";
    case "break_start":
      if (state === "working") return null;
      if (state === "break") return "すでに休憩中です。";
      return state === "done" ? "退勤したあとは休憩を始められません。" : "まだ出勤していません。先に「出勤」を押してください。";
    case "break_end":
      if (state === "break") return null;
      return state === "none" ? "まだ出勤していません。" : state === "done" ? "退勤したあとです。" : "休憩を始めていません。";
    case "clock_out":
      if (state === "working" || state === "break") return null; // 休憩中なら休憩終了を自動で足す
      return state === "done" ? "すでに退勤しています。" : "まだ出勤していません。先に「出勤」を押してください。";
    default:
      return "打刻の種類が正しくありません。";
  }
}

/** 打刻の並び（時刻順）がまるごと正しい順番か。だめなら最初の理由を返す（管理画面の修正の確認用）。 */
export function sequenceError(evs: Array<{ eventType: string; recordedAt: Date | string }>): string | null {
  const sorted = [...evs].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  let s: ShiftState = "none";
  for (const e of sorted) {
    const err = transitionError(s, e.eventType);
    if (err && !(e.eventType === "clock_out" && s === "break")) {
      const at = new Date(new Date(e.recordedAt).getTime() + JST_MS).toISOString().slice(11, 16);
      return `${at} の「${EVENT_LABELS[e.eventType as EventType] ?? e.eventType}」：${err}`;
    }
    if (e.eventType === "clock_out" && s === "break") return "休憩中のまま退勤になっています（休憩終了がありません）。";
    s = e.eventType === "clock_in" ? "working" : e.eventType === "break_start" ? "break" : e.eventType === "break_end" ? "working" : "done";
  }
  return null;
}

/** 1つの勤務日の打刻（取り消していないもの・時刻順） */
export async function shiftRecords(employeeId: number, workDate: string, tx: Db | Tx = db) {
  return tx.select().from(attendanceRecordsTable)
    .where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.workDate, workDate), active))
    .orderBy(attendanceRecordsTable.recordedAt, attendanceRecordsTable.id);
}

// ── 時間の計算 ────────────────────────────────────────────
export interface Segment { start: number; end: number }

/**
 * 働いていた区間（休憩を除く）。時刻順の打刻から作る。
 * 出勤〜休憩開始、休憩終了〜休憩開始／退勤。1日に2回出退勤していても全部足す。
 * 退勤していない区間は until があればそこまで、無ければ数えない。
 */
export function workSegments(evs: Array<{ eventType: string; recordedAt: Date | string }>, until?: number): Segment[] {
  const sorted = [...evs].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const out: Segment[] = [];
  let open: number | null = null;
  for (const e of sorted) {
    const t = new Date(e.recordedAt).getTime();
    if (e.eventType === "clock_in" || e.eventType === "break_end") {
      if (open === null) open = t;
    } else if (e.eventType === "break_start" || e.eventType === "clock_out") {
      if (open !== null) { if (t > open) out.push({ start: open, end: t }); open = null; }
    }
  }
  if (open !== null && until !== undefined && until > open) out.push({ start: open, end: until });
  return out;
}

/** 休憩の区間 */
export function breakSegments(evs: Array<{ eventType: string; recordedAt: Date | string }>, until?: number): Segment[] {
  const sorted = [...evs].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const out: Segment[] = [];
  let open: number | null = null;
  for (const e of sorted) {
    const t = new Date(e.recordedAt).getTime();
    if (e.eventType === "break_start") { if (open === null) open = t; }
    else if (e.eventType === "break_end" || e.eventType === "clock_out") {
      if (open !== null) { if (t > open) out.push({ start: open, end: t }); open = null; }
    }
  }
  if (open !== null && until !== undefined && until > open) out.push({ start: open, end: until });
  return out;
}

export const minutesOf = (segs: Segment[]) => segs.reduce((s, x) => s + (x.end - x.start), 0) / 60000;

/** 区間のうち深夜（22時〜翌5時・日本時間）に重なる分数 */
export function nightMinutes(segs: Segment[]): number {
  let ms = 0;
  for (const s of segs) {
    // 区間の前日〜最終日まで、各日の 22:00〜翌5:00 と重ねる
    const firstDay = jstDate(new Date(s.start - DAY_MS));
    const lastDay = jstDate(new Date(s.end));
    for (let d = firstDay; d <= lastDay; d = addDaysStr(d, 1)) {
      const w0 = new Date(`${d}T22:00:00+09:00`).getTime();
      const w1 = w0 + 7 * 60 * 60 * 1000;
      const a = Math.max(s.start, w0), b = Math.min(s.end, w1);
      if (b > a) ms += b - a;
    }
  }
  return ms / 60000;
}

/**
 * 休憩なしで続けて働いた最も長い時間（分）。改善基準告示の「連続運転4時間」の目安。
 * 運転と荷役を分けて打刻していないので、勤務の時間で見積もる（推定）。
 * 1回10分以上の休憩を「中断」として数え、中断が合計30分に達したら続けた時間を0に戻す。
 */
export function maxContinuousMinutes(evs: Array<{ eventType: string; recordedAt: Date | string }>, until?: number): number {
  const work = workSegments(evs, until);
  const brks = breakSegments(evs, until);
  // 区間を時刻順に並べて歩く
  const items = [
    ...work.map(s => ({ ...s, kind: "work" as const })),
    ...brks.map(s => ({ ...s, kind: "break" as const })),
  ].sort((a, b) => a.start - b.start);
  let run = 0, breakAcc = 0, max = 0;
  for (const it of items) {
    const m = (it.end - it.start) / 60000;
    if (it.kind === "work") { run += m; max = Math.max(max, run); }
    else if (m >= 10) { breakAcc += m; if (breakAcc >= 30) { run = 0; breakAcc = 0; } }
  }
  return Math.round(max);
}

/** 1つの勤務の数字 */
export function shiftStats(evs: Array<{ eventType: string; recordedAt: Date | string }>, until?: number) {
  const sorted = [...evs].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const ins = sorted.filter(e => e.eventType === "clock_in");
  const outs = sorted.filter(e => e.eventType === "clock_out");
  const clockIn = ins[0] ? new Date(ins[0].recordedAt).getTime() : null;
  const clockOut = outs.length ? new Date(outs[outs.length - 1]!.recordedAt).getTime() : null;
  const work = workSegments(sorted, until);
  const brk = breakSegments(sorted, until);
  const end = clockOut ?? (until ?? null);
  return {
    clockIn, clockOut,
    workMinutes: minutesOf(work),
    breakMinutes: minutesOf(brk),
    nightMinutes: nightMinutes(work),
    /** 拘束時間（出勤〜退勤。休憩を含む） */
    restraintMinutes: clockIn !== null && end !== null && end > clockIn ? (end - clockIn) / 60000 : 0,
    maxContinuousMinutes: maxContinuousMinutes(sorted, until),
  };
}
