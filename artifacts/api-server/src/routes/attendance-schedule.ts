import { Router } from "express";
import {
  db, employeesTable, attendanceRecordsTable, absenceRecordsTable, workSchedulesTable, schedulePatternsTable,
} from "@workspace/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";
import { paramStr } from "../lib/params";
import { active, addDaysStr, jstDate, shiftStats } from "../lib/shift";
import { holidayName } from "../lib/jp-holidays";
import { getAttendanceSettings } from "../lib/attendance-settings";
import { ABSENCE_DAYS, isFullDayAbsence, isPaidLeave } from "./absences";
import { comparePlan, isTime, parsePattern, patternToJson, schedulesFor, type Pattern } from "../lib/schedules";
import { actorName } from "../lib/attendance-auth";
import { notifyAttendanceChanged } from "./attendance";

/**
 * 出勤の予定（シフト）と、月の勤怠表。どれも管理者だけ。
 *   GET    /attendance/schedule-patterns                 … 全員の予定の型（曜日ごと）
 *   PUT    /attendance/schedule-patterns/:employeeId     … 予定の型を保存
 *   PUT    /attendance/schedules/:employeeId/:date       … その日の予定（型より優先）
 *   DELETE /attendance/schedules/:employeeId/:date       … その日の予定を消す（型に戻る）
 *   GET    /attendance/month-grid?year=&month=           … 社員×日付の勤怠表（予定との比べ・合計つき）
 */
const router = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/attendance/schedule-patterns", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(schedulePatternsTable);
  return res.json(rows.map((r) => ({ employeeId: r.employeeId, ...parsePattern(r.data), updatedAt: r.updatedAt })));
});

router.put("/attendance/schedule-patterns/:employeeId", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  const body = (req.body ?? {}) as { days?: Record<string, { start?: unknown; end?: unknown } | null>; holidayOff?: unknown; from?: unknown };
  if (body.from != null && (typeof body.from !== "string" || !DATE.test(body.from))) return res.status(400).json({ error: "「いつから」の日付の形が違います。" });
  const [cur] = await db.select().from(schedulePatternsTable).where(eq(schedulePatternsTable.employeeId, employeeId));
  // 指定が無ければ、前に決めた日のまま（初めてなら今日から）
  const from = (body.from as string | undefined) ?? (cur ? parsePattern(cur.data).from : null) ?? jstDate();
  const days: Pattern["days"] = {};
  for (let d = 0; d < 7; d++) {
    const v = body.days?.[String(d)];
    if (v == null) { days[String(d)] = null; continue; }
    if (!isTime(v.start) || !isTime(v.end)) return res.status(400).json({ error: "時刻は「08:00」の形で入れてください。" });
    if (v.start === v.end) return res.status(400).json({ error: "始まりと終わりが同じ時刻です。" });
    days[String(d)] = { start: v.start, end: v.end };
  }
  const p: Pattern = { days, holidayOff: body.holidayOff !== false, from };
  await db.insert(schedulePatternsTable).values({ employeeId, data: patternToJson(p), updatedAt: new Date() })
    .onConflictDoUpdate({ target: schedulePatternsTable.employeeId, set: { data: patternToJson(p), updatedAt: new Date() } });
  notifyAttendanceChanged();
  return res.json({ employeeId, ...p });
});

router.put("/attendance/schedules/:employeeId/:date", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const date = paramStr(req.params.date);
  if (!DATE.test(date)) return res.status(400).json({ error: "日付の形が違います。" });
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  const { start, end, isOff, note } = (req.body ?? {}) as { start?: unknown; end?: unknown; isOff?: unknown; note?: unknown };
  const off = isOff === true;
  if (!off && (!isTime(start) || !isTime(end))) return res.status(400).json({ error: "始まりと終わりの時刻を「08:00」の形で入れてください（休みなら「休み」を選んでください）。" });
  if (!off && start === end) return res.status(400).json({ error: "始まりと終わりが同じ時刻です。" });
  const noteText = typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null;
  const values = {
    employeeId, workDate: date,
    startTime: off ? null : (start as string), endTime: off ? null : (end as string),
    isOff: off, note: noteText, updatedBy: actorName(req), updatedAt: new Date(),
  };
  const [row] = await db.insert(workSchedulesTable).values(values)
    .onConflictDoUpdate({ target: [workSchedulesTable.employeeId, workSchedulesTable.workDate], set: values })
    .returning();
  notifyAttendanceChanged();
  return res.json(row);
});

router.delete("/attendance/schedules/:employeeId/:date", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const date = paramStr(req.params.date);
  if (!DATE.test(date)) return res.status(400).json({ error: "日付の形が違います。" });
  await db.delete(workSchedulesTable).where(and(eq(workSchedulesTable.employeeId, employeeId), eq(workSchedulesTable.workDate, date)));
  notifyAttendanceChanged();
  return res.json({ ok: true });
});

/**
 * 月の勤怠表。社員ごと・日ごとに、出勤・退勤・実働・休憩・深夜・休み・予定・気になる点を返す。
 * 実働の数え方は月次実績への取り込み（monthlySummary）と同じ shiftStats（休憩を引く・1日に何回出退勤しても足す）。
 */
router.get("/attendance/month-grid", requireAdmin, async (req, res) => {
  const now = new Date();
  const today = jstDate(now);
  const year = parseInt(String(req.query.year ?? ""), 10) || Number(today.slice(0, 4));
  const month = parseInt(String(req.query.month ?? ""), 10) || Number(today.slice(5, 7));
  if (month < 1 || month > 12) return res.status(400).json({ error: "月が正しくありません。" });
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const employees = await db.select({
    id: employeesTable.id, employeeCode: employeesTable.employeeCode, name: employeesTable.name,
    department: employeesTable.department, isOfficeStaff: employeesTable.isOfficeStaff,
  }).from(employeesTable).where(eq(employeesTable.isActive, true)).orderBy(asc(employeesTable.employeeCode));
  const ids = employees.map((e) => e.id);
  const [recs, absences, schedules, settings, pats] = await Promise.all([
    db.select().from(attendanceRecordsTable)
      .where(and(gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, to), active))
      .orderBy(attendanceRecordsTable.recordedAt),
    db.select().from(absenceRecordsTable).where(and(gte(absenceRecordsTable.workDate, from), lte(absenceRecordsTable.workDate, to))),
    schedulesFor(ids, from, to),
    getAttendanceSettings(),
    db.select({ employeeId: schedulePatternsTable.employeeId }).from(schedulePatternsTable),
  ]);
  const hasPattern = new Set(pats.map((p) => p.employeeId));

  const days: Array<{ date: string; day: number; dow: number; holiday: string | null }> = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    days.push({ date: d, day: Number(d.slice(8, 10)), dow: new Date(`${d}T00:00:00Z`).getUTCDay(), holiday: holidayName(d) });
  }

  const rows = employees.map((e) => {
    const mine = recs.filter((r) => r.employeeId === e.id);
    const tot = { workDays: 0, workMin: 0, overtimeMin: 0, nightMin: 0, breakMin: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, noShow: 0, missingOut: 0, offWork: 0, absenceDays: 0, paidLeaveDays: 0 };
    const cells: Record<string, unknown> = {};
    for (const day of days) {
      const dr = mine.filter((r) => r.workDate === day.date);
      const abs = absences.filter((a) => a.employeeId === e.id && a.workDate === day.date);
      const sch = schedules.get(`${e.id}:${day.date}`) ?? null;
      const hasIn = dr.some((r) => r.eventType === "clock_in");
      const hasOut = dr.some((r) => r.eventType === "clock_out");
      const live = day.date === today || (hasIn && !hasOut && now.getTime() - new Date(dr.find((r) => r.eventType === "clock_in")!.recordedAt).getTime() < 16 * 3600_000);
      const st = hasIn ? shiftStats(dr, hasOut ? undefined : live ? now.getTime() : undefined) : null;
      const cmp = comparePlan(day.date, sch, st?.clockIn ?? null, hasOut ? st?.clockOut ?? null : null, {
        now: now.getTime(), today, graceMin: settings.lateGraceMinutes, noShowMin: settings.noShowAlertMinutes,
        hasFullDayAbsence: abs.some((a) => isFullDayAbsence(a.absenceType)),
      });
      const missingOut = hasIn && !hasOut && !live;
      const flags: string[] = [];
      if (cmp.lateMin > 0) flags.push("late");
      if (cmp.earlyMin > 0) flags.push("early");
      if (cmp.noShow) flags.push("noshow");
      if (cmp.offWork) flags.push("offwork");
      if (missingOut) flags.push("missingOut");
      if (!hasIn && dr.length > 0) flags.push("missingIn");
      if (hasIn && abs.some((a) => isFullDayAbsence(a.absenceType))) flags.push("conflict");
      if (hasIn) {
        // 退勤が無い日は月次実績と同じく0時間で数える（勤務中の今日だけは「いま」まで）
        const work = missingOut ? 0 : Math.round(st!.workMinutes);
        tot.workDays += 1;
        tot.workMin += work;
        tot.overtimeMin += Math.max(0, work - 480);
        tot.nightMin += missingOut ? 0 : Math.round(st!.nightMinutes);
        tot.breakMin += Math.round(st!.breakMinutes);
      }
      if (cmp.lateMin > 0) { tot.late += 1; tot.lateMin += cmp.lateMin; }
      if (cmp.earlyMin > 0) { tot.early += 1; tot.earlyMin += cmp.earlyMin; }
      if (cmp.noShow) tot.noShow += 1;
      if (cmp.offWork) tot.offWork += 1;
      if (missingOut) tot.missingOut += 1;
      for (const a of abs) {
        const n = ABSENCE_DAYS[a.absenceType] ?? 1;
        if (isPaidLeave(a.absenceType)) tot.paidLeaveDays += n; else tot.absenceDays += n;
      }
      if (!hasIn && dr.length === 0 && abs.length === 0 && !sch) continue; // 何も無い日は送らない
      cells[day.date] = {
        clockIn: st?.clockIn ? new Date(st.clockIn).toISOString() : null,
        clockOut: hasOut && st?.clockOut ? new Date(st.clockOut).toISOString() : null,
        workMin: st ? (missingOut ? 0 : Math.round(st.workMinutes)) : 0,
        breakMin: st ? Math.round(st.breakMinutes) : 0,
        nightMin: st && !missingOut ? Math.round(st.nightMinutes) : 0,
        open: hasIn && !hasOut && live,
        punches: dr.length,
        absences: abs.map((a) => ({ id: a.id, type: a.absenceType, note: a.note })),
        schedule: sch,
        lateMin: cmp.lateMin,
        earlyMin: cmp.earlyMin,
        flags,
      };
    }
    return { employee: { ...e, isOfficeStaff: e.isOfficeStaff ?? false }, hasPattern: hasPattern.has(e.id), cells, totals: tot };
  });

  return res.json({ year, month, from, to, today, days, settings: { lateGraceMinutes: settings.lateGraceMinutes, noShowAlertMinutes: settings.noShowAlertMinutes }, rows });
});

export default router;
