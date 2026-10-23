import express, { Router } from "express";
import {
  db, employeesTable, staffFilesTable, expenseClaimsTable, leaveRequestsTable, absenceRecordsTable,
  payrollsTable, attendanceRecordsTable, dailyReportsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { paramStr } from "../lib/params";
import { requireOwnerOrAdmin, requireAdmin } from "../lib/auth-middleware";
import { actorName, isUniqueViolation } from "../lib/attendance-auth";
import { getAttendanceSettings } from "../lib/attendance-settings";
import { later, pushToOffice, pushToEmployee } from "../lib/push";
import { adjustReimbursement, getMonthItems, MonthLockedError, REIMBURSE_NAME } from "../lib/month-items";
import { monthlySummary, notifyAttendanceChanged } from "./attendance";
import { ABSENCE_DAYS, ABSENCE_LABELS } from "./absences";
import { monthCompliance } from "../lib/compliance";
import { paidLeaveFor } from "../lib/paid-leave";
import { active, addDaysStr, jstDate } from "../lib/shift";
import { audit } from "../lib/audit";

/**
 * スタッフの打刻ページ（/driver/:id）から使う機能。本人（暗証番号を確かめた端末）と管理者だけ。
 *   写真         … POST /staff/:id/files?kind=receipt|alcohol（中身をそのまま送る）・GET /staff/:id/files/:fileId
 *   経費・立替   … GET/POST /staff/:id/expenses・POST /staff/:id/expenses/:eid/cancel
 *   休みの申請   … GET/POST /staff/:id/leaves・POST /staff/:id/leaves/:lid/cancel
 *   わたしの記録 … GET /staff/:id/summary?year&month（日数・時間・拘束・有給の残り）
 *   給与明細     … GET /staff/:id/payslips・GET /staff/:id/payslips/:pid（確定したものだけ・設定で止められる）
 *   前回の値     … GET /staff/:id/last-values（車両・メーター・発地）
 * 事務所（管理画面）
 *   GET /staff-admin/expenses・POST /staff-admin/expenses/:id/decide・POST /staff-admin/expenses/:id/revoke
 *   GET /staff-admin/leaves・POST /staff-admin/leaves/:id/decide・POST /staff-admin/leaves/:id/revoke
 */
const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const idOf = (req: { params: Record<string, unknown> }) => parseInt(paramStr(req.params["id"] as string), 10);
const owner = requireOwnerOrAdmin(idOf, { requirePin: true });
const nameOf = async (id: number) => (await db.select({ name: employeesTable.name }).from(employeesTable).where(eq(employeesTable.id, id)))[0]?.name?.replace(/[\s　]+/g, " ").trim() ?? "従業員";
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

export const EXPENSE_LABELS: Record<string, string> = { fuel: "ガソリン", toll: "高速代", parking: "駐車場", other: "その他" };

// ── 写真 ───────────────────────────────────────────────
const FILE_MAX = 8 * 1024 * 1024;
const FILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const rawParser = express.raw({ type: () => true, limit: FILE_MAX + 1024 });
const rawBody = (req: express.Request, res: express.Response, next: express.NextFunction) =>
  rawParser(req, res, (err?: unknown) => {
    if (!err) return next();
    const st = (err as { status?: number }).status;
    return res.status(st === 413 ? 413 : 400).json({ error: st === 413 ? "写真が大きすぎます（8MBまで）" : "写真を受け取れませんでした" });
  });
/** 中身の先頭を見て、名乗った種類と合っているか */
function looksLike(mime: string, b: Buffer): boolean {
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8;
  if (mime === "image/png") return b.subarray(0, 4).toString("hex") === "89504e47";
  if (mime === "image/webp") return b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
  if (mime === "application/pdf") return b.subarray(0, 4).toString() === "%PDF";
  return false;
}

router.post("/staff/:id/files", owner, rawBody, async (req, res) => {
  const employeeId = idOf(req);
  const kind = req.query.kind === "alcohol" ? "alcohol" : req.query.kind === "receipt" ? "receipt" : null;
  if (!kind) return res.status(400).json({ error: "写真の種類が正しくありません" });
  const mime = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  const data = req.body as Buffer;
  if (!FILE_TYPES.has(mime) || (kind === "alcohol" && mime === "application/pdf")) return res.status(400).json({ error: "送れるのは写真（JPEG・PNG・WebP）とPDF（レシートのみ）です" });
  if (!Buffer.isBuffer(data) || data.length === 0) return res.status(400).json({ error: "写真が空です" });
  if (!looksLike(mime, data)) return res.status(400).json({ error: "写真の中身を読めませんでした" });
  const [row] = await db.insert(staffFilesTable).values({ employeeId, kind, mime, size: data.length, data }).returning({ id: staffFilesTable.id });
  return res.status(201).json({ id: row!.id });
});

router.get("/staff/:id/files/:fileId", owner, async (req, res) => {
  const employeeId = idOf(req);
  const fileId = parseInt(paramStr(req.params.fileId), 10);
  const [f] = await db.select().from(staffFilesTable).where(and(eq(staffFilesTable.id, fileId), eq(staffFilesTable.employeeId, employeeId)));
  if (!f) return res.status(404).json({ error: "見つかりません" });
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="${f.kind}-${f.id}.${f.mime === "application/pdf" ? "pdf" : "jpg"}"`);
  return res.send(f.data);
});

/** その写真が本人の物か（申請・アルコールチェックにつなぐ前に確かめる） */
export async function ownFile(employeeId: number, fileId: unknown, kind: string): Promise<number | null> {
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [f] = await db.select({ id: staffFilesTable.id }).from(staffFilesTable)
    .where(and(eq(staffFilesTable.id, id), eq(staffFilesTable.employeeId, employeeId), eq(staffFilesTable.kind, kind)));
  return f?.id ?? null;
}

// ── 経費・立替 ───────────────────────────────────────────
router.get("/staff/:id/expenses", owner, async (req, res) => {
  const rows = await db.select().from(expenseClaimsTable).where(eq(expenseClaimsTable.employeeId, idOf(req)))
    .orderBy(desc(expenseClaimsTable.createdAt)).limit(40);
  return res.json(rows);
});

router.post("/staff/:id/expenses", owner, async (req, res) => {
  const employeeId = idOf(req);
  const b = (req.body ?? {}) as { useDate?: string; category?: string; amount?: unknown; note?: string; fileId?: unknown; clientId?: string };
  const useDate = typeof b.useDate === "string" && DATE_RE.test(b.useDate) ? b.useDate : null;
  if (!useDate) return res.status(400).json({ error: "使った日を入れてください" });
  if (useDate > jstDate()) return res.status(400).json({ error: "先の日付は申請できません" });
  if (useDate < addDaysStr(jstDate(), -93)) return res.status(400).json({ error: "3か月より前の分は事務所に直接相談してください" });
  if (!b.category || !(b.category in EXPENSE_LABELS)) return res.status(400).json({ error: "種類を選んでください" });
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) return res.status(400).json({ error: "金額を正しく入れてください（1〜500,000円）" });
  const fileId = b.fileId == null || b.fileId === "" ? null : await ownFile(employeeId, b.fileId, "receipt");
  if (b.fileId != null && b.fileId !== "" && !fileId) return res.status(400).json({ error: "レシートの写真が見つかりません。もう一度撮ってください" });
  const note = str(b.note, 300);
  if (b.category === "other" && !note) return res.status(400).json({ error: "「その他」のときは何に使ったかを書いてください" });
  const clientId = typeof b.clientId === "string" && CLIENT_RE.test(b.clientId) ? b.clientId : null;
  try {
    const [row] = await db.insert(expenseClaimsTable).values({ employeeId, useDate, category: b.category, amount, note, fileId, clientId }).returning();
    later(async () => pushToOffice({ title: `経費・立替の申請：${await nameOf(employeeId)}`, body: `${useDate} ${EXPENSE_LABELS[b.category!]} ${yen(amount)}${note ? `（${note.slice(0, 40)}）` : ""}`, url: "/attendance-records?tab=expenses" }));
    notifyAttendanceChanged();
    return res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err) && clientId) {
      const [dup] = await db.select().from(expenseClaimsTable).where(and(eq(expenseClaimsTable.employeeId, employeeId), eq(expenseClaimsTable.clientId, clientId)));
      if (dup) return res.status(200).json(dup);
    }
    throw err;
  }
});

router.post("/staff/:id/expenses/:eid/cancel", owner, async (req, res) => {
  const eid = parseInt(paramStr(req.params.eid), 10);
  const [u] = await db.update(expenseClaimsTable).set({ status: "canceled", decidedAt: new Date(), decidedBy: actorName(req) })
    .where(and(eq(expenseClaimsTable.id, eid), eq(expenseClaimsTable.employeeId, idOf(req)), eq(expenseClaimsTable.status, "pending"))).returning();
  if (!u) return res.status(409).json({ error: "取り下げられるのは確認待ちの申請だけです" });
  notifyAttendanceChanged();
  return res.json(u);
});

// ── 休みの申請 ───────────────────────────────────────────
/** 打刻ページから選べる休みの種類 */
export const LEAVE_TYPES = ["paid_leave", "paid_leave_am", "paid_leave_pm", "other", "morning_half", "afternoon_half", "sick", "bereavement"];

router.get("/staff/:id/leaves", owner, async (req, res) => {
  const rows = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.employeeId, idOf(req)))
    .orderBy(desc(leaveRequestsTable.workDate)).limit(40);
  return res.json(rows);
});

router.post("/staff/:id/leaves", owner, async (req, res) => {
  const employeeId = idOf(req);
  const b = (req.body ?? {}) as { workDate?: string; absenceType?: string; reason?: string; clientId?: string };
  const workDate = typeof b.workDate === "string" && DATE_RE.test(b.workDate) ? b.workDate : null;
  if (!workDate) return res.status(400).json({ error: "日付を選んでください" });
  if (workDate < addDaysStr(jstDate(), -31)) return res.status(400).json({ error: "1か月より前の日は事務所に直接相談してください" });
  if (workDate > addDaysStr(jstDate(), 366)) return res.status(400).json({ error: "1年より先の日は申請できません" });
  if (!b.absenceType || !LEAVE_TYPES.includes(b.absenceType)) return res.status(400).json({ error: "休みの種類を選んでください" });
  const reason = str(b.reason, 300);
  const same = await db.select({ id: leaveRequestsTable.id }).from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.employeeId, employeeId), eq(leaveRequestsTable.workDate, workDate), inArray(leaveRequestsTable.status, ["pending", "approved"])));
  if (same.length) return res.status(409).json({ error: "この日はもう申請しています" });
  const clientId = typeof b.clientId === "string" && CLIENT_RE.test(b.clientId) ? b.clientId : null;
  try {
    const [row] = await db.insert(leaveRequestsTable).values({ employeeId, workDate, absenceType: b.absenceType, reason, clientId }).returning();
    later(async () => pushToOffice({ title: `休みの申請：${await nameOf(employeeId)}`, body: `${workDate} ${ABSENCE_LABELS[b.absenceType!] ?? b.absenceType}${reason ? `（${reason.slice(0, 40)}）` : ""}`, url: "/attendance-records?tab=leaves" }));
    notifyAttendanceChanged();
    return res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err) && clientId) {
      const [dup] = await db.select().from(leaveRequestsTable).where(and(eq(leaveRequestsTable.employeeId, employeeId), eq(leaveRequestsTable.clientId, clientId)));
      if (dup) return res.status(200).json(dup);
    }
    throw err;
  }
});

router.post("/staff/:id/leaves/:lid/cancel", owner, async (req, res) => {
  const lid = parseInt(paramStr(req.params.lid), 10);
  const [u] = await db.update(leaveRequestsTable).set({ status: "canceled", decidedAt: new Date(), decidedBy: actorName(req) })
    .where(and(eq(leaveRequestsTable.id, lid), eq(leaveRequestsTable.employeeId, idOf(req)), eq(leaveRequestsTable.status, "pending"))).returning();
  if (!u) return res.status(409).json({ error: "取り下げられるのは確認待ちの申請だけです" });
  notifyAttendanceChanged();
  return res.json(u);
});

// ── わたしの記録 ─────────────────────────────────────────
router.get("/staff/:id/summary", owner, async (req, res) => {
  const employeeId = idOf(req);
  const today = jstDate();
  const year = parseInt(String(req.query.year), 10) || Number(today.slice(0, 4));
  const month = parseInt(String(req.query.month), 10) || Number(today.slice(5, 7));
  const [sum, comp, emp] = await Promise.all([
    monthlySummary(year, month),
    monthCompliance(year, month, [employeeId]),
    db.select().from(employeesTable).where(eq(employeesTable.id, employeeId)),
  ]);
  const s = sum.find((x) => x.employeeId === employeeId) ?? null;
  const c = comp.find((x) => x.employeeId === employeeId) ?? null;
  let paidLeave: { remaining: number; obligation: { deadline: string; taken: number; shortage: number } | null } | null = null;
  try {
    const [l] = emp[0] ? await paidLeaveFor([emp[0]], today) : [];
    if (l) {
      const ob = l.ledger.obligations.filter((o) => o.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline))[0] ?? null;
      paidLeave = { remaining: l.ledger.remaining, obligation: ob ? { deadline: ob.deadline, taken: ob.taken, shortage: ob.shortage } : null };
    }
  } catch { paidLeave = null; }
  return res.json({
    year, month,
    days: c?.days.map((d) => ({ date: d.date, clockIn: d.clockIn, clockOut: d.clockOut, open: d.open, workMinutes: d.workMinutes, restraintMinutes: d.restraintMinutes, flags: d.flags.map((f) => f.text) })) ?? [],
    totals: s ? {
      workDays: s.workDays + s.saturdayWorkDays + s.sundayWorkDays + s.holidayWorkDays,
      actualWorkHours: s.actualWorkHours, overtimeHours: s.overtimeHours, restDayOvertimeHours: s.restDayOvertimeHours,
      lateNightHours: s.lateNightHours, drivingDistanceKm: s.drivingDistanceKm, absenceDays: s.absenceDays, paidLeaveDays: s.paidLeaveDays,
      missingClockOut: s.missingClockOut,
    } : { workDays: 0, actualWorkHours: 0, overtimeHours: 0, restDayOvertimeHours: 0, lateNightHours: 0, drivingDistanceKm: 0, absenceDays: 0, paidLeaveDays: 0, missingClockOut: [] },
    restraintMinutes: c?.monthRestraintMinutes ?? 0,
    paidLeave,
  });
});

// ── 給与明細（確定したものだけ） ─────────────────────────────
router.get("/staff/:id/payslips", owner, async (req, res) => {
  if (!(await getAttendanceSettings()).staffPayslip) return res.json({ enabled: false, items: [] });
  const rows = await db.select({ id: payrollsTable.id, year: payrollsTable.year, month: payrollsTable.month, grossSalary: payrollsTable.grossSalary, netSalary: payrollsTable.netSalary })
    .from(payrollsTable).where(and(eq(payrollsTable.employeeId, idOf(req)), eq(payrollsTable.status, "confirmed")))
    .orderBy(desc(payrollsTable.year), desc(payrollsTable.month)).limit(24);
  return res.json({ enabled: true, items: rows });
});

router.get("/staff/:id/payslips/:pid", owner, async (req, res) => {
  if (!(await getAttendanceSettings()).staffPayslip) return res.status(403).json({ error: "給与明細は事務所で受け取ってください" });
  const employeeId = idOf(req);
  const pid = parseInt(paramStr(req.params.pid), 10);
  const [p] = await db.select().from(payrollsTable).where(and(eq(payrollsTable.id, pid), eq(payrollsTable.employeeId, employeeId), eq(payrollsTable.status, "confirmed")));
  if (!p) return res.status(404).json({ error: "見つかりません（確定した明細だけ見られます）" });
  const items = await getMonthItems(employeeId, p.year, p.month);
  // 本人が見た記録を残す（だれがいつ見たか）
  await audit(req, "staff.payslip.view", "payrolls", { id: p.id, year: p.year, month: p.month }, { summary: `給与明細を見た（${p.year}年${p.month}月分）`, category: "給与", employeeId });
  const pay: Array<[string, number]> = [
    ["基本給", p.baseSalary], ["残業手当", p.overtimePay], ["深夜手当", p.lateNightPay], ["休日手当", p.holidayPay], ["土曜手当", p.saturdayPay],
    ["歩合", p.commissionPay], ["交通費", p.transportationAllowance], ["無事故手当", p.safetyDrivingAllowance], ["長距離手当", p.longDistanceAllowance],
    ["役職手当", p.positionAllowance], ["家族手当", p.familyAllowance], ["早出残業手当", p.earlyOvertimeAllowance],
    ["業績手当", p.performanceAllowance + p.bluewingPerformanceAllowance],
  ];
  const custom = items.allowances.filter((a) => a.amount);
  const earnings = [...pay.filter(([, v]) => v).map(([label, amount]) => ({ label, amount })), ...custom.map((a) => ({ label: a.allowanceName, amount: a.amount }))];
  // 手当の行の合計が総支給と合わない分（計算の内訳に出ないもの）は「その他」でそろえる
  const absence = p.absenceDeduction ? [{ label: "欠勤控除", amount: -p.absenceDeduction }] : [];
  const gap = Math.round(p.grossSalary - earnings.reduce((s, e) => s + e.amount, 0) - absence.reduce((s, e) => s + e.amount, 0));
  if (gap) earnings.push({ label: "その他", amount: gap });
  const deductions = [
    { label: "社会保険料", amount: p.socialInsurance - (p.childcareSupportContribution ?? 0) },
    { label: "子ども・子育て支援金", amount: p.childcareSupportContribution ?? 0 },
    { label: "雇用保険料", amount: p.employmentInsurance },
    { label: "所得税", amount: p.incomeTax },
    { label: "住民税", amount: p.residentTax },
    ...items.deductions.filter((d) => d.amount).map((d) => ({ label: d.deductionName, amount: d.amount })),
  ].filter((d) => d.amount);
  return res.json({
    id: p.id, year: p.year, month: p.month,
    workDays: p.workDays + p.saturdayWorkDays + p.holidayWorkDays + p.publicHolidayWorkDays, overtimeHours: p.overtimeHours, lateNightHours: p.lateNightHours, paidLeaveDays: p.paidLeaveDays,
    earnings: [...earnings, ...absence], deductions,
    grossSalary: p.grossSalary, totalDeductions: p.totalDeductions, netSalary: p.netSalary,
  });
});

// ── 前回の値（車両・メーター・発地を入れておくため） ───────────────
router.get("/staff/:id/last-values", owner, async (req, res) => {
  const employeeId = idOf(req);
  const [rep] = await db.select().from(dailyReportsTable).where(eq(dailyReportsTable.employeeId, employeeId)).orderBy(desc(dailyReportsTable.workDate)).limit(1);
  const [out] = await db.select({ endOdometer: attendanceRecordsTable.endOdometer, workDate: attendanceRecordsTable.workDate })
    .from(attendanceRecordsTable).where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.eventType, "clock_out"), isNotNull(attendanceRecordsTable.endOdometer), active))
    .orderBy(desc(attendanceRecordsTable.recordedAt)).limit(1);
  const lastArrival = (rep?.arrival ?? "").split("\n").map((x) => x.trim()).filter(Boolean).pop() ?? null;
  return res.json({ vehicle: rep?.vehicle ?? null, endOdometer: out?.endOdometer ?? null, endOdometerDate: out?.workDate ?? null, departure: lastArrival });
});

// ── 事務所：経費・立替 ───────────────────────────────────────
router.get("/staff-admin/expenses", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows = await db.select({ e: expenseClaimsTable, name: employeesTable.name, code: employeesTable.employeeCode })
    .from(expenseClaimsTable).leftJoin(employeesTable, eq(employeesTable.id, expenseClaimsTable.employeeId))
    .where(status === "all" ? undefined : eq(expenseClaimsTable.status, status))
    .orderBy(desc(expenseClaimsTable.createdAt)).limit(300);
  return res.json(rows.map((r) => ({ ...r.e, employeeName: r.name, employeeCode: r.code })));
});

router.post("/staff-admin/expenses/:id/decide", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const b = (req.body ?? {}) as { approve?: boolean; note?: string; year?: number; month?: number };
  const [c] = await db.select().from(expenseClaimsTable).where(eq(expenseClaimsTable.id, id));
  if (!c) return res.status(404).json({ error: "申請が見つかりません" });
  if (c.status !== "pending") return res.status(409).json({ error: "この申請はもう決まっています" });
  const decided = { decidedBy: actorName(req), decidedAt: new Date(), decisionNote: str(b.note, 300) };
  if (!b.approve) {
    const [u] = await db.update(expenseClaimsTable).set({ ...decided, status: "rejected" }).where(eq(expenseClaimsTable.id, id)).returning();
    later(() => pushToEmployee(c.employeeId, { title: "経費・立替の申請が見送られました", body: `${c.useDate} ${EXPENSE_LABELS[c.category]} ${yen(c.amount)}${u!.decisionNote ? `：${u!.decisionNote}` : ""}`, url: `/driver/${c.employeeId}` }));
    notifyAttendanceChanged();
    return res.json(u);
  }
  const year = Number(b.year), month = Number(b.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ error: "どの月の給与で払うかを選んでください" });
  try {
    await adjustReimbursement(c.employeeId, year, month, c.amount);
  } catch (err) {
    if (err instanceof MonthLockedError) return res.status(409).json({ error: `${year}年${month}月の給与明細は確定済みです。次の月を選んでください（または確定を解除してから）。` });
    throw err;
  }
  const [u] = await db.update(expenseClaimsTable).set({ ...decided, status: "approved", settleYear: year, settleMonth: month }).where(eq(expenseClaimsTable.id, id)).returning();
  later(() => pushToEmployee(c.employeeId, { title: "経費・立替の申請が承認されました", body: `${yen(c.amount)}を${month}月分の給与と一緒に払います（${EXPENSE_LABELS[c.category]}・${c.useDate}）`, url: `/driver/${c.employeeId}` }));
  notifyAttendanceChanged();
  return res.json(u);
});

/** 承認を取り消す（給与の「立替金精算」からも引く。確定済みの月なら取り消せない） */
router.post("/staff-admin/expenses/:id/revoke", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const [c] = await db.select().from(expenseClaimsTable).where(eq(expenseClaimsTable.id, id));
  if (!c) return res.status(404).json({ error: "申請が見つかりません" });
  if (c.status !== "approved" || !c.settleYear || !c.settleMonth) return res.status(409).json({ error: "承認した申請だけ取り消せます" });
  try {
    await adjustReimbursement(c.employeeId, c.settleYear, c.settleMonth, -c.amount);
  } catch (err) {
    if (err instanceof MonthLockedError) return res.status(409).json({ error: `${c.settleYear}年${c.settleMonth}月の給与明細は確定済みのため取り消せません。` });
    throw err;
  }
  const [u] = await db.update(expenseClaimsTable).set({ status: "pending", settleYear: null, settleMonth: null, decidedBy: null, decidedAt: null, decisionNote: null }).where(eq(expenseClaimsTable.id, id)).returning();
  notifyAttendanceChanged();
  return res.json(u);
});

// ── 事務所：休みの申請 ───────────────────────────────────────
router.get("/staff-admin/leaves", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows = await db.select({ l: leaveRequestsTable, name: employeesTable.name, code: employeesTable.employeeCode })
    .from(leaveRequestsTable).leftJoin(employeesTable, eq(employeesTable.id, leaveRequestsTable.employeeId))
    .where(status === "all" ? undefined : eq(leaveRequestsTable.status, status))
    .orderBy(desc(leaveRequestsTable.createdAt)).limit(300);
  return res.json(rows.map((r) => ({ ...r.l, employeeName: r.name, employeeCode: r.code })));
});

router.post("/staff-admin/leaves/:id/decide", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const b = (req.body ?? {}) as { approve?: boolean; note?: string };
  const [l] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!l) return res.status(404).json({ error: "申請が見つかりません" });
  if (l.status !== "pending") return res.status(409).json({ error: "この申請はもう決まっています" });
  const decided = { decidedBy: actorName(req), decidedAt: new Date(), decisionNote: str(b.note, 300) };
  let absenceId: number | null = null;
  if (b.approve) {
    const [a] = await db.insert(absenceRecordsTable).values({ employeeId: l.employeeId, absenceType: l.absenceType, workDate: l.workDate, note: `休みの申請 #${l.id}${l.reason ? `：${l.reason}` : ""}` }).returning();
    absenceId = a!.id;
  }
  const [u] = await db.update(leaveRequestsTable).set({ ...decided, status: b.approve ? "approved" : "rejected", absenceId }).where(eq(leaveRequestsTable.id, id)).returning();
  later(() => pushToEmployee(l.employeeId, {
    title: b.approve ? "休みの申請が承認されました" : "休みの申請が見送られました",
    body: `${l.workDate} ${ABSENCE_LABELS[l.absenceType] ?? l.absenceType}${u!.decisionNote ? `：${u!.decisionNote}` : ""}`, url: `/driver/${l.employeeId}`,
  }));
  notifyAttendanceChanged();
  return res.json(u);
});

router.post("/staff-admin/leaves/:id/revoke", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const [l] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!l) return res.status(404).json({ error: "申請が見つかりません" });
  if (l.status !== "approved") return res.status(409).json({ error: "承認した申請だけ取り消せます" });
  if (l.absenceId) await db.delete(absenceRecordsTable).where(eq(absenceRecordsTable.id, l.absenceId));
  const [u] = await db.update(leaveRequestsTable).set({ status: "pending", absenceId: null, decidedBy: null, decidedAt: null, decisionNote: null }).where(eq(leaveRequestsTable.id, id)).returning();
  notifyAttendanceChanged();
  return res.json(u);
});

// 経費の種類・休みの種類（画面の選択肢）
router.get("/staff/:id/options", owner, async (_req, res) => {
  return res.json({
    expenseTypes: Object.entries(EXPENSE_LABELS).map(([value, label]) => ({ value, label })),
    leaveTypes: LEAVE_TYPES.map((value) => ({ value, label: ABSENCE_LABELS[value] ?? value, days: ABSENCE_DAYS[value] ?? 1 })),
    reimburseName: REIMBURSE_NAME,
  });
});

export default router;
