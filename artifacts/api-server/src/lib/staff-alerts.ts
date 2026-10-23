import { db, employeesTable, attendanceRecordsTable, absenceRecordsTable } from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { active, addDaysStr, jstDate } from "./shift";
import { pushOnce, pushToEmployee } from "./push";
import { getAttendanceSettings } from "./attendance-settings";
import { schedulesFor, planTimes } from "./schedules";
import { isFullDayAbsence } from "../routes/absences";
import { logger } from "./logger";

/**
 * 本人のスマホへの知らせ（5分ごと）。同じ出来事は1回だけ（pushOnce）。
 *   休憩なしの時間 … 出勤／休憩終了から3時間45分で「あと15分で4時間」、4時間で「超えました」（改善基準告示：連続運転4時間まで）
 *   拘束時間       … 出勤から12時間30分（原則13時間）・14時間30分（上限15時間）
 *   出勤の押し忘れ … 出勤の予定（シフト）の始まりから◯分たっても出勤が無い（1日休みの日は出さない）
 *   退勤の押し忘れ … 予定の終わりから◯分たっても退勤が無い
 * 打刻からの推定（運転と荷役を分けて打刻していない）。本当に守れているかは日報・デジタコで確かめる。
 */
const hm = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(11, 16);

export async function staffAlertsTick(now = new Date()): Promise<number> {
  const s = await getAttendanceSettings();
  if (!s.staffWorkAlerts && !s.punchReminders) return 0;
  const t = now.getTime();
  const today = jstDate(now);
  const emps = await db.select({ id: employeesTable.id, isOfficeStaff: employeesTable.isOfficeStaff }).from(employeesTable).where(eq(employeesTable.isActive, true));
  if (emps.length === 0) return 0;
  const recs = await db.select({ employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType, workDate: attendanceRecordsTable.workDate, recordedAt: attendanceRecordsTable.recordedAt })
    .from(attendanceRecordsTable).where(and(gte(attendanceRecordsTable.workDate, addDaysStr(today, -1)), lte(attendanceRecordsTable.workDate, today), active));
  const ids = emps.map((e) => e.id);
  const schedules = s.punchReminders ? await schedulesFor(ids, addDaysStr(today, -1), today) : new Map();
  const absences = s.punchReminders ? await db.select().from(absenceRecordsTable).where(eq(absenceRecordsTable.workDate, today)) : [];
  let sent = 0;
  const send = async (key: string, empId: number, office: boolean, title: string, body: string) => {
    if (await pushOnce(key, () => pushToEmployee(empId, { title, body, url: office ? `/office/${empId}` : `/driver/${empId}` }))) sent++;
  };

  for (const e of emps) {
    const mine = recs.filter((r) => r.employeeId === e.id).sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    // いま開いている勤務（出勤から16時間以内・退勤なし）
    const dates = [...new Set(mine.map((r) => r.workDate))].sort().reverse();
    let open: { date: string; inAt: number; evs: typeof mine } | null = null;
    for (const d of dates) {
      const evs = mine.filter((r) => r.workDate === d);
      const inRec = evs.find((r) => r.eventType === "clock_in");
      if (!inRec || evs.some((r) => r.eventType === "clock_out")) continue;
      const inAt = new Date(inRec.recordedAt).getTime();
      if (t - inAt < 16 * 3600_000) { open = { date: d, inAt, evs }; break; }
    }

    if (open && s.staffWorkAlerts && !e.isOfficeStaff) {
      const last = open.evs[open.evs.length - 1]!;
      if (last.eventType !== "break_start") {
        const resume = [...open.evs].reverse().find((r) => r.eventType === "clock_in" || r.eventType === "break_end")!;
        const resumeAt = new Date(resume.recordedAt).getTime();
        const cont = (t - resumeAt) / 60000;
        if (cont >= 240) {
          await send(`staff-cont:${e.id}:${resumeAt}:240`, e.id, false, "休憩なしで4時間を超えました",
            `${hm(resumeAt)}から休憩なしで続いています。トラックの運転は4時間ごとに合計30分以上の休憩が要ります。安全な所に止めて休憩し、「休憩開始」を押してください。`);
        } else if (cont >= 225) {
          await send(`staff-cont:${e.id}:${resumeAt}:225`, e.id, false, "あと15分で、休憩なしの4時間です",
            `${hm(resumeAt)}から休憩なしで続いています。区切りのよい所で休憩を取って、「休憩開始」を押してください（4時間ごとに合計30分以上）。`);
        }
      }
      const restraint = (t - open.inAt) / 60000;
      if (restraint >= 14.5 * 60) {
        await send(`staff-restr:${e.id}:${open.date}:15`, e.id, false, "拘束時間が14時間30分になりました",
          `出勤（${hm(open.inAt)}）から14時間30分です。1日の拘束時間は15時間までです。事務所に連絡して、帰りの運行を相談してください。`);
      } else if (restraint >= 12.5 * 60) {
        await send(`staff-restr:${e.id}:${open.date}:13`, e.id, false, "拘束時間が12時間30分になりました",
          `出勤（${hm(open.inAt)}）から12時間30分です。1日の拘束時間は原則13時間までです（延ばしても15時間）。`);
      }
    }

    if (s.punchReminders) {
      // 出勤の押し忘れ（今日の予定）
      const sch = schedules.get(`${e.id}:${today}`);
      const plan = planTimes(today, sch);
      const hasIn = mine.some((r) => r.workDate === today && r.eventType === "clock_in");
      const off = absences.some((a) => a.employeeId === e.id && isFullDayAbsence(a.absenceType));
      if (plan && !hasIn && !open && !off && t > plan.start + s.noShowAlertMinutes * 60_000 && t < plan.end) {
        await send(`staff-noin:${e.id}:${today}`, e.id, !!e.isOfficeStaff, "出勤の打刻がまだです",
          `今日の予定は ${sch!.start}〜です。もう仕事を始めていたら「出勤」を押してください。休むときは事務所に連絡してください。`);
      }
      // 退勤の押し忘れ（開いている勤務の日の予定）
      if (open) {
        const sch2 = schedules.get(`${e.id}:${open.date}`);
        const plan2 = planTimes(open.date, sch2);
        if (plan2 && t > plan2.end + s.clockOutReminderMinutes * 60_000) {
          await send(`staff-noout:${e.id}:${open.date}`, e.id, !!e.isOfficeStaff, "退勤の押し忘れはありませんか",
            `予定の終わり（${sch2!.end}）を過ぎています。仕事が終わっていたら「退勤」を押してください。`);
        }
      }
    }
  }
  return sent;
}

let started = false;
export function startStaffAlertJobs(): void {
  if (started) return;
  started = true;
  const run = () => { staffAlertsTick().catch((err) => logger.warn({ err }, "本人への知らせに失敗")); };
  setTimeout(run, 60_000);
  setInterval(run, 5 * 60_000);
}
