import { db, attendanceRecordsTable } from "@workspace/db";
import { and, gte, inArray, lte } from "drizzle-orm";
import { active, addDaysStr, jstDate, shiftStats } from "./shift";

/**
 * 改善基準告示（トラック運転者・2024年4月から）の目安で、打刻から拘束時間などを確かめる。
 *   1日の拘束時間 … 原則13時間以内、延ばしても15時間まで
 *   休息期間       … 勤務が終わってから次の勤務まで継続11時間以上が基本、9時間を下回らない
 *   1か月の拘束時間 … 284時間以内（労使協定があれば310時間まで）
 *   1年の拘束時間   … 3,300時間以内（労使協定があれば3,400時間まで）
 *   連続運転       … 4時間以内（1回おおむね10分以上・合計30分以上の中断が要る）
 * 運転と荷役などを分けて打刻していないので、連続運転は「休憩なしで続けて働いた時間」で見積もる。
 * ここで出すのは目安。本当に守れているかは運転日報・デジタコの記録で確かめる。
 */

export const LIMITS = {
  dayRestraintBase: 13 * 60,
  dayRestraintMax: 15 * 60,
  restBase: 11 * 60,
  restMin: 9 * 60,
  monthRestraint: 284 * 60,
  yearRestraint: 3300 * 60,
  continuous: 4 * 60,
};

export type FlagLevel = "danger" | "warn";
export interface ComplianceFlag { level: FlagLevel; code: string; text: string }

export interface DayCompliance {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  open: boolean;
  workMinutes: number;
  nightMinutes: number;
  restraintMinutes: number;
  restBeforeMinutes: number | null;
  maxContinuousMinutes: number;
  flags: ComplianceFlag[];
}

export interface EmployeeCompliance {
  employeeId: number;
  days: DayCompliance[];
  monthRestraintMinutes: number;
  yearRestraintMinutes: number;
  flags: ComplianceFlag[];
}

const h = (m: number) => `${Math.floor(m / 60)}時間${String(Math.round(m % 60)).padStart(2, "0")}分`;

function dayFlags(d: Omit<DayCompliance, "flags">): ComplianceFlag[] {
  const f: ComplianceFlag[] = [];
  if (d.restraintMinutes > LIMITS.dayRestraintMax) f.push({ level: "danger", code: "restraint15", text: `1日の拘束が${h(d.restraintMinutes)}です（上限15時間）` });
  else if (d.restraintMinutes > LIMITS.dayRestraintBase) f.push({ level: "warn", code: "restraint13", text: `1日の拘束が${h(d.restraintMinutes)}です（原則13時間）` });
  if (d.restBeforeMinutes !== null) {
    if (d.restBeforeMinutes < LIMITS.restMin) f.push({ level: "danger", code: "rest9", text: `前の勤務からの休息が${h(d.restBeforeMinutes)}です（最低9時間）` });
    else if (d.restBeforeMinutes < LIMITS.restBase) f.push({ level: "warn", code: "rest11", text: `前の勤務からの休息が${h(d.restBeforeMinutes)}です（基本11時間）` });
  }
  // 連続4時間は打刻（ふつうはお昼の休憩1回だけ）からの推定。至急にすると毎日・全員に出て、ほかの知らせが埋もれたので「注意」にする
  if (d.maxContinuousMinutes > LIMITS.continuous) f.push({ level: "warn", code: "cont4", text: `休憩なしで${h(d.maxContinuousMinutes)}続けて働いています（連続運転は4時間まで・推定）` });
  return f;
}

type R = { employeeId: number; eventType: string; workDate: string; recordedAt: Date };

/** 打刻の一覧から、日ごとの数字を作る（前の勤務の退勤も見るので、範囲の前の日の打刻も渡す） */
export function daysFrom(recs: R[], from: string, to: string, now: number = Date.now()): DayCompliance[] {
  const byDate = new Map<string, R[]>();
  for (const r of recs) { if (!byDate.has(r.workDate)) byDate.set(r.workDate, []); byDate.get(r.workDate)!.push(r); }
  const dates = [...byDate.keys()].sort();
  const out: DayCompliance[] = [];
  let prevOut: number | null = null;
  const today = jstDate(new Date(now));
  for (const date of dates) {
    const evs = byDate.get(date)!;
    if (!evs.some(e => e.eventType === "clock_in")) continue;
    const hasOut = evs.some(e => e.eventType === "clock_out");
    // 退勤していない勤務は、出勤から16時間までなら「いま続いている」として今までで数え、それより前は数えない（退勤の打ち忘れ）。
    // 以前は前の日の打ち忘れも今まで数えたため、拘束27時間・休憩なしで21時間などと出ていた。
    const inAt = evs.filter(e => e.eventType === "clock_in").map(e => new Date(e.recordedAt).getTime()).sort((a, b) => a - b)[0] ?? now;
    const until = !hasOut && date >= addDaysStr(today, -1) && now - inAt < 16 * 3600_000 ? now : undefined;
    const st = shiftStats(evs, until);
    const restBefore = prevOut !== null && st.clockIn !== null && st.clockIn - prevOut < 3 * 24 * 3600_000 ? Math.max(0, (st.clockIn - prevOut) / 60000) : null;
    if (st.clockOut !== null) prevOut = st.clockOut;
    if (date < from || date > to) continue;
    const base = {
      date,
      clockIn: st.clockIn !== null ? new Date(st.clockIn).toISOString() : null,
      clockOut: st.clockOut !== null ? new Date(st.clockOut).toISOString() : null,
      open: !hasOut,
      workMinutes: Math.round(st.workMinutes),
      nightMinutes: Math.round(st.nightMinutes),
      restraintMinutes: Math.round(hasOut || until !== undefined ? st.restraintMinutes : 0),
      restBeforeMinutes: restBefore !== null ? Math.round(restBefore) : null,
      maxContinuousMinutes: st.maxContinuousMinutes,
    };
    out.push({ ...base, flags: dayFlags(base) });
  }
  return out;
}

async function load(employeeIds: number[] | null, from: string, to: string): Promise<Map<number, R[]>> {
  const conds = [gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, to), active];
  if (employeeIds) conds.push(inArray(attendanceRecordsTable.employeeId, employeeIds.length ? employeeIds : [-1]));
  const rows = await db.select({
    employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType,
    workDate: attendanceRecordsTable.workDate, recordedAt: attendanceRecordsTable.recordedAt,
  }).from(attendanceRecordsTable).where(and(...conds));
  const m = new Map<number, R[]>();
  for (const r of rows) { if (!m.has(r.employeeId)) m.set(r.employeeId, []); m.get(r.employeeId)!.push(r); }
  return m;
}

/** その月（year, month）の、社員ごとの改善基準の目安。年は「その月までの12か月」で数える。 */
export async function monthCompliance(year: number, month: number, employeeIds: number[] | null = null): Promise<EmployeeCompliance[]> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
  const yFromD = new Date(Date.UTC(year, month - 12, 1));
  const yearFrom = yFromD.toISOString().slice(0, 10);
  const all = await load(employeeIds, addDaysStr(yearFrom, -3), to);
  const out: EmployeeCompliance[] = [];
  for (const [employeeId, recs] of all) {
    const yearDays = daysFrom(recs, yearFrom, to);
    const days = yearDays.filter(d => d.date >= from);
    const monthRestraintMinutes = days.reduce((s, d) => s + d.restraintMinutes, 0);
    const yearRestraintMinutes = yearDays.reduce((s, d) => s + d.restraintMinutes, 0);
    const flags: ComplianceFlag[] = [];
    if (monthRestraintMinutes > LIMITS.monthRestraint) flags.push({ level: "danger", code: "month284", text: `${month}月の拘束が${h(monthRestraintMinutes)}です（月284時間まで・労使協定で310時間）` });
    if (yearRestraintMinutes > LIMITS.yearRestraint) flags.push({ level: "danger", code: "year3300", text: `直近12か月の拘束が${h(yearRestraintMinutes)}です（年3,300時間まで・労使協定で3,400時間）` });
    out.push({ employeeId, days, monthRestraintMinutes, yearRestraintMinutes, flags });
  }
  return out;
}

/** ある勤務日1日分（画面の詳細用） */
export async function dayCompliance(employeeId: number, date: string): Promise<DayCompliance | null> {
  const recs = (await load([employeeId], addDaysStr(date, -3), date)).get(employeeId) ?? [];
  return daysFrom(recs, date, date).find(d => d.date === date) ?? null;
}
