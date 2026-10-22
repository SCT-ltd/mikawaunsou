import { db, workSchedulesTable, schedulePatternsTable } from "@workspace/db";
import { and, gte, lte, inArray } from "drizzle-orm";
import { holidayName } from "./jp-holidays";
import { addDaysStr } from "./shift";

/**
 * 出勤の予定（シフト）。
 *   その日の予定 … work_schedules に1人1日1件（事務所が入れる）
 *   予定の型     … schedule_patterns に曜日ごとの始まりと終わり（日〜土）。その日の予定が無ければこれを使う
 * 時刻は日本時間の "HH:MM"。終わりが始まり以下なら翌日（夜勤）。
 */

export interface DayPlan { start: string; end: string }
export interface Pattern {
  days: Record<string, DayPlan | null>; holidayOff: boolean;
  /** この日から型を使う（"YYYY-MM-DD"）。より前の日は型で比べない（型を入れた日より前が全部「出勤なし」にならないように） */
  from: string | null;
}
export interface Schedule {
  start: string | null; end: string | null; off: boolean; note: string | null;
  /** day＝その日の予定 / pattern＝予定の型から */
  source: "day" | "pattern";
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (s: unknown): s is string => typeof s === "string" && TIME.test(s);

export function parsePattern(raw: string | null | undefined): Pattern {
  let o: Record<string, unknown> = {};
  try { o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { o = {}; }
  const days: Record<string, DayPlan | null> = {};
  for (let d = 0; d < 7; d++) {
    const v = o[String(d)] as { start?: unknown; end?: unknown } | null | undefined;
    days[String(d)] = v && isTime(v.start) && isTime(v.end) ? { start: v.start, end: v.end } : null;
  }
  const from = typeof o.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.from) ? o.from : null;
  return { days, holidayOff: o.holidayOff !== false, from };
}

export function patternToJson(p: Pattern): string {
  return JSON.stringify({ ...p.days, holidayOff: p.holidayOff, from: p.from });
}

/** 曜日（0=日）。日付は "YYYY-MM-DD" */
export const dowOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** 予定の型から、その日の予定を作る（祝日を休みにする設定なら祝日は休み） */
export function fromPattern(p: Pattern | undefined, date: string): Schedule | null {
  if (!p) return null;
  if (p.from && date < p.from) return null;
  const plan = p.days[String(dowOf(date))];
  if (!plan) return null;
  if (p.holidayOff && holidayName(date)) return { start: null, end: null, off: true, note: holidayName(date), source: "pattern" };
  return { start: plan.start, end: plan.end, off: false, note: null, source: "pattern" };
}

/** 期間内の予定を、社員×日付で引けるようにまとめる（予定の型も当てはめる） */
export async function schedulesFor(employeeIds: number[], from: string, to: string): Promise<Map<string, Schedule>> {
  const out = new Map<string, Schedule>();
  if (employeeIds.length === 0) return out;
  const [days, pats] = await Promise.all([
    db.select().from(workSchedulesTable).where(and(inArray(workSchedulesTable.employeeId, employeeIds), gte(workSchedulesTable.workDate, from), lte(workSchedulesTable.workDate, to))),
    db.select().from(schedulePatternsTable).where(inArray(schedulePatternsTable.employeeId, employeeIds)),
  ]);
  const patOf = new Map(pats.map((p) => [p.employeeId, parsePattern(p.data)]));
  for (const id of employeeIds) {
    for (let d = from; d <= to; d = addDaysStr(d, 1)) {
      const s = fromPattern(patOf.get(id), d);
      if (s) out.set(`${id}:${d}`, s);
    }
  }
  for (const r of days) {
    out.set(`${r.employeeId}:${r.workDate}`, { start: r.startTime, end: r.endTime, off: r.isOff, note: r.note, source: "day" });
  }
  return out;
}

/** 予定の始まりと終わりの時刻（ミリ秒）。終わりが始まり以下なら翌日 */
export function planTimes(date: string, s: Schedule | null | undefined): { start: number; end: number } | null {
  if (!s || s.off || !s.start || !s.end) return null;
  const start = new Date(`${date}T${s.start}:00+09:00`).getTime();
  let end = new Date(`${date}T${s.end}:00+09:00`).getTime();
  if (end <= start) end += 24 * 3600_000;
  return { start, end };
}

export interface PlanCompare {
  /** 遅刻の分（猶予を過ぎた分だけ。猶予の中なら0） */
  lateMin: number;
  /** 早退の分 */
  earlyMin: number;
  /** 予定があるのに出勤していない（今日なら予定＋◯分を過ぎたら） */
  noShow: boolean;
  /** 予定では休みの日に出勤した */
  offWork: boolean;
}

/**
 * 予定と打刻を比べる。
 *   graceMin    … 遅刻・早退にしない猶予（分）
 *   noShowMin   … 今日のぶんは、予定の始まりから何分過ぎたら「出勤していない」とするか
 *   hasFullDayAbsence … 1日休み（欠勤・有給など）が入っていれば「出勤していない」にしない
 */
export function comparePlan(
  date: string, s: Schedule | null | undefined, clockIn: number | null, clockOut: number | null,
  opts: { now: number; today: string; graceMin: number; noShowMin: number; hasFullDayAbsence: boolean },
): PlanCompare {
  const r: PlanCompare = { lateMin: 0, earlyMin: 0, noShow: false, offWork: false };
  if (s?.off && clockIn !== null) { r.offWork = true; return r; }
  const t = planTimes(date, s);
  if (!t) return r;
  const g = opts.graceMin * 60_000;
  if (clockIn !== null) {
    if (clockIn > t.start + g) r.lateMin = Math.round((clockIn - t.start) / 60_000);
    if (clockOut !== null && clockOut < t.end - g) r.earlyMin = Math.round((t.end - clockOut) / 60_000);
  } else if (!opts.hasFullDayAbsence) {
    if (date < opts.today) r.noShow = true;
    else if (date === opts.today && opts.now > t.start + opts.noShowMin * 60_000) r.noShow = true;
  }
  return r;
}
