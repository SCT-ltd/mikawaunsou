import { Router } from "express";
import {
  db, employeesTable, attendanceRecordsTable, absenceRecordsTable, workSchedulesTable, schedulePatternsTable,
  attendanceMonthChecksTable, attendanceCorrectionsTable, dailyInspectionsTable, alcoholChecksTable,
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
  const checks = await db.select().from(attendanceMonthChecksTable).where(eq(attendanceMonthChecksTable.ym, `${year}-${pad(month)}`));
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
    const ck = checks.find((c) => c.employeeId === e.id);
    return { employee: { ...e, isOfficeStaff: e.isOfficeStaff ?? false }, hasPattern: hasPattern.has(e.id), cells, totals: tot,
      /** 月の勤怠表で「確認済み」にした人と日時 */
      checked: ck ? { by: ck.checkedBy, at: ck.checkedAt } : null };
  });

  return res.json({ year, month, from, to, today, days, settings: { lateGraceMinutes: settings.lateGraceMinutes, noShowAlertMinutes: settings.noShowAlertMinutes }, rows });
});

// ── 月の勤怠表の「確認済み」 ──────────────────────────────
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
router.put("/attendance/month-checks/:employeeId/:ym", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const ym = paramStr(req.params.ym);
  if (!YM.test(ym)) return res.status(400).json({ error: "月の形が違います（例：2026-10）。" });
  const values = { employeeId, ym, checkedBy: actorName(req), checkedAt: new Date() };
  await db.insert(attendanceMonthChecksTable).values(values)
    .onConflictDoUpdate({ target: [attendanceMonthChecksTable.employeeId, attendanceMonthChecksTable.ym], set: values });
  return res.json({ ok: true, ...values });
});
router.delete("/attendance/month-checks/:employeeId/:ym", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const ym = paramStr(req.params.ym);
  await db.delete(attendanceMonthChecksTable).where(and(eq(attendanceMonthChecksTable.employeeId, employeeId), eq(attendanceMonthChecksTable.ym, ym)));
  return res.json({ ok: true });
});

/**
 * やること（事務所が今日片付けること）。上から順に片付ければよいよう、急ぐものから並べる。
 *   alcohol     … アルコールチェックで検知（直近2日）
 *   inspection  … 日常点検の「否」で、まだ運行の判断をしていない（直近2日）
 *   noshow      … 今日、予定の始まりを過ぎても出勤していない（1日休みが入っていれば出さない）
 *   missingOut  … 退勤の打ち忘れ（直近7日・出勤から16時間を過ぎても退勤が無い）
 *   missingIn   … 出勤が無いのに休憩・退勤だけある（直近7日）
 *   correction  … まだ決めていない打刻の修正申請
 *   conflict    … 1日休みなのに出勤もある（直近7日）
 */
router.get("/attendance/todo", requireAdmin, async (_req, res) => {
  const now = new Date();
  const today = jstDate(now);
  const from = addDaysStr(today, -7);
  const emps = await db.select({ id: employeesTable.id, name: employeesTable.name, phone: employeesTable.phone, isOfficeStaff: employeesTable.isOfficeStaff })
    .from(employeesTable).where(eq(employeesTable.isActive, true)).orderBy(asc(employeesTable.employeeCode));
  const ids = emps.map((e) => e.id);
  const [recs, absences, schedules, settings, corrections, inspections, alcohols] = await Promise.all([
    db.select().from(attendanceRecordsTable).where(and(gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, today), active)).orderBy(attendanceRecordsTable.recordedAt),
    db.select().from(absenceRecordsTable).where(and(gte(absenceRecordsTable.workDate, from), lte(absenceRecordsTable.workDate, today))),
    schedulesFor(ids, from, today),
    getAttendanceSettings(),
    db.select().from(attendanceCorrectionsTable).where(eq(attendanceCorrectionsTable.status, "pending")).orderBy(attendanceCorrectionsTable.createdAt),
    db.select().from(dailyInspectionsTable).where(gte(dailyInspectionsTable.workDate, addDaysStr(today, -2))),
    db.select().from(alcoholChecksTable).where(and(gte(alcoholChecksTable.workDate, addDaysStr(today, -2)), eq(alcoholChecksTable.detected, true))),
  ]);
  type Item = { key: string; kind: string; date: string; employee: { id: number; name: string; phone: string | null }; title: string; detail: string; data?: Record<string, unknown> };
  const items: Item[] = [];
  const empOf = (id: number) => emps.find((e) => e.id === id);
  const who = (id: number) => { const e = empOf(id)!; return { id: e.id, name: e.name.replace(/[\s　]+/g, " ").trim(), phone: e.phone ?? null }; };
  const hm = (d: Date | string) => new Date(new Date(d).getTime() + 9 * 3600_000).toISOString().slice(11, 16);
  for (const a of alcohols) {
    if (!empOf(a.employeeId)) continue;
    items.push({ key: `alcohol:${a.id}`, kind: "alcohol", date: a.workDate, employee: who(a.employeeId), title: "アルコールチェックで検知",
      detail: `${a.phase === "before" ? "乗る前" : "乗った後"} ${a.valueMg ?? "?"} mg/L（${hm(a.checkedAt)}）。乗務させないでください。` });
  }
  for (const i of inspections) {
    let ng: string[] = []; try { ng = JSON.parse(i.ng) as string[]; } catch { ng = []; }
    if (ng.length === 0 || i.officeDecision || !empOf(i.employeeId)) continue;
    items.push({ key: `inspection:${i.id}`, kind: "inspection", date: i.workDate, employee: who(i.employeeId), title: "日常点検に「否」",
      detail: `${ng.join("・")}${i.vehicle ? `（${i.vehicle}）` : ""}。処置と、運行してよいかを決めてください。`, data: { inspectionId: i.id } });
  }
  for (const e of emps) {
    const sch = schedules.get(`${e.id}:${today}`);
    const inRec = recs.find((r) => r.employeeId === e.id && r.workDate === today && r.eventType === "clock_in");
    const cmp = comparePlan(today, sch, inRec ? new Date(inRec.recordedAt).getTime() : null, null, {
      now: now.getTime(), today, graceMin: settings.lateGraceMinutes, noShowMin: settings.noShowAlertMinutes,
      hasFullDayAbsence: absences.some((a) => a.employeeId === e.id && a.workDate === today && isFullDayAbsence(a.absenceType)),
    });
    if (cmp.noShow) items.push({ key: `noshow:${e.id}:${today}`, kind: "noshow", date: today, employee: who(e.id), title: `出勤していません（予定 ${sch?.start}〜）`,
      detail: "連絡を取ってください。休みなら「休みを入れる」で消えます。", data: { scheduleStart: sch?.start ?? null } });
  }
  const byEmpDate = new Map<string, typeof recs>();
  for (const r of recs) { const k = `${r.employeeId}:${r.workDate}`; if (!byEmpDate.has(k)) byEmpDate.set(k, []); byEmpDate.get(k)!.push(r); }
  for (const [k, rs] of byEmpDate) {
    const [idS, date] = k.split(":") as [string, string];
    const id = Number(idS);
    if (!empOf(id)) continue;
    const inR = rs.find((r) => r.eventType === "clock_in");
    const hasOut = rs.some((r) => r.eventType === "clock_out");
    if (inR && !hasOut && now.getTime() - new Date(inR.recordedAt).getTime() > 16 * 3600_000) {
      const sch = schedules.get(k);
      items.push({ key: `missingOut:${id}:${date}`, kind: "missingOut", date, employee: who(id), title: "退勤が押されていません",
        detail: `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${hm(inR.recordedAt)}に出勤したまま。退勤の時刻を入れてください。`,
        data: { clockIn: inR.recordedAt, scheduleEnd: sch && !sch.off ? sch.end : null } });
    } else if (!inR) {
      items.push({ key: `missingIn:${id}:${date}`, kind: "missingIn", date, employee: who(id), title: "出勤が押されていません",
        detail: `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日：休憩・退勤だけが打刻されています。勤怠管理で出勤を入れてください。` });
    }
    if (inR && absences.some((a) => a.employeeId === id && a.workDate === date && isFullDayAbsence(a.absenceType))) {
      items.push({ key: `conflict:${id}:${date}`, kind: "conflict", date, employee: who(id), title: "休みと出勤の両方が入っています",
        detail: "どちらが正しいか確かめて、違う方を消してください。" });
    }
  }
  for (const c of corrections) {
    if (!empOf(c.employeeId)) continue;
    const KIND: Record<string, string> = { add: "打ち忘れを足す", change: "時刻を直す", cancel: "取り消す" };
    const EV: Record<string, string> = { clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了" };
    items.push({ key: `correction:${c.id}`, kind: "correction", date: c.workDate, employee: who(c.employeeId), title: `打刻の修正申請（${KIND[c.kind] ?? c.kind}）`,
      detail: `${c.eventType ? EV[c.eventType] ?? c.eventType : ""}${c.requestedAt ? ` → ${hm(c.requestedAt)}` : ""}　理由：${c.reason}`, data: { correctionId: c.id } });
  }
  const ORDER = ["alcohol", "inspection", "noshow", "missingOut", "missingIn", "correction", "conflict"];
  items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return res.json({ today, items });
});

export default router;
