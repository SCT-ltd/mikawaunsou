import { Router } from "express";
import {
  db,
  employeesTable,
  attendanceRecordsTable,
  absenceRecordsTable,
  attendanceDraftsTable,
  liveLocationsTable,
  messagesTable,
  pushSubscriptionsTable,
  monthlyRecordsTable,
  payrollsTable,
  employeeAllowancesTable,
  employeeDeductionsTable,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { issueDriverToken } from "../lib/driver-token";

const router = Router();

// 暗証番号の照合の回数制限（社員＋接続元ごと）。api は1プロセスなのでメモリで足りる。
const PIN_MAX_FAILURES = 5;
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_LOCK_MS = 10 * 60 * 1000;
const pinAttempts = new Map<string, { failures: number; firstFailureAt: number; lockedUntil: number }>();

/**
 * 社員行から機密の `pin` を除去し、代わりに `hasPin`（設定有無）を付与する。
 * PIN は打刻認証の秘密情報なので、API レスポンスに値を含めない。
 */
function sanitizeEmployee(row: typeof employeesTable.$inferSelect) {
  const { pin, ...rest } = row;
  return { ...rest, hasPin: !!pin };
}

router.get("/employees", async (req, res) => {
  const { active } = req.query;
  if (active !== undefined) {
    const activeFilter = active === "true";
    const rows = await db.select().from(employeesTable)
      .where(eq(employeesTable.isActive, activeFilter))
      .orderBy(asc(employeesTable.employeeCode));
    return res.json(rows.map(sanitizeEmployee));
  }
  const rows = await db.select().from(employeesTable)
    .orderBy(asc(employeesTable.employeeCode));
  return res.json(rows.map(sanitizeEmployee));
});

router.post("/employees", async (req, res) => {
  const body = req.body;
  const fields = {
    name: body.name,
    nameKana: body.nameKana,
    department: body.department,
    position: body.position ?? "",
    baseSalary: body.baseSalary,
    salaryType: body.salaryType ?? "fixed",
    isOfficeStaff: body.isOfficeStaff ?? false,
    transportationAllowance: body.transportationAllowance ?? 0,
    safetyDrivingAllowance: body.safetyDrivingAllowance ?? 0,
    longDistanceAllowance: body.longDistanceAllowance ?? 0,
    positionAllowance: body.positionAllowance ?? 0,
    familyAllowance: body.familyAllowance ?? 0,
    earlyOvertimeAllowance: body.earlyOvertimeAllowance ?? 0,
    commissionRatePerKm: body.commissionRatePerKm ?? 0,
    commissionRatePerCase: body.commissionRatePerCase ?? 0,
    mikawaCommissionRate: body.mikawaCommissionRate ?? 0,
    useBluewingLogic: body.useBluewingLogic ?? false,
    bluewingCommissionRate: body.bluewingCommissionRate ?? 0,
    bluewingFixedOvertimeHours: body.bluewingFixedOvertimeHours ?? 0,
    bluewingFixedOvertimeAmount: body.bluewingFixedOvertimeAmount ?? 0,
    dependentCount: body.dependentCount ?? 0,
    hasSpouse: body.hasSpouse ?? false,
    standardRemuneration: body.standardRemuneration ?? 0,
    careInsuranceApplied: body.careInsuranceApplied ?? false,
    healthInsuranceMonthly: body.healthInsuranceMonthly ?? 0,
    pensionMonthly: body.pensionMonthly ?? 0,
    employmentInsuranceApplied: body.employmentInsuranceApplied ?? true,
    pensionApplied: body.pensionApplied ?? null,
    taxExempt: body.taxExempt ?? false,
    residentTax: body.residentTax ?? 0,
    dateOfBirth: body.dateOfBirth || null,
    hireDate: body.hireDate,
    isActive: true,
    scheduledWorkStart: body.scheduledWorkStart || null,
    scheduledWorkEnd: body.scheduledWorkEnd || null,
    dailyRateWeekday: body.dailyRateWeekday ?? 0,
    dailyRateSaturday: body.dailyRateSaturday ?? 0,
    overtimeHourlyRate: body.overtimeHourlyRate ?? 0,
    lateNightHourlyRate: body.lateNightHourlyRate ?? 0,
    overtimeUnitMinutes: body.overtimeUnitMinutes ?? null,
    overtimeUnitRate: body.overtimeUnitRate ?? 0,
    updatedAt: new Date(),
  };

  // 同じ社員コードでソフト削除済みレコードがあれば再有効化する
  const [existing] = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.employeeCode, body.employeeCode));

  if (existing) {
    const [emp] = await db.update(employeesTable)
      .set(fields)
      .where(eq(employeesTable.id, existing.id))
      .returning();
    return res.status(200).json(sanitizeEmployee(emp));
  }

  const [emp] = await db.insert(employeesTable).values({
    employeeCode: body.employeeCode,
    ...fields,
  }).returning();
  return res.status(201).json(sanitizeEmployee(emp));
});

router.get("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  // この経路は QR 打刻ページのためにログインなしで開けてある。管理者以外には、打刻画面の
  // 表示に要る項目だけを返す（以前は基本給・標準報酬・住民税・生年月日まで返していた）。
  if (req.session?.role !== "admin") {
    return res.json({
      id: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: emp.department,
      isOfficeStaff: emp.isOfficeStaff,
      scheduledWorkStart: emp.scheduledWorkStart,
      scheduledWorkEnd: emp.scheduledWorkEnd,
    });
  }
  return res.json(sanitizeEmployee(emp));
});

router.put("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  const [updated] = await db.update(employeesTable)
    .set({
      ...(body.employeeCode !== undefined && { employeeCode: body.employeeCode }),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.nameKana !== undefined && { nameKana: body.nameKana }),
      ...(body.department !== undefined && { department: body.department }),
      ...(body.position !== undefined && { position: body.position }),
      ...(body.salaryType !== undefined && { salaryType: body.salaryType }),
      ...(body.baseSalary !== undefined && { baseSalary: body.baseSalary }),
      ...(body.transportationAllowance !== undefined && { transportationAllowance: body.transportationAllowance }),
      ...(body.safetyDrivingAllowance !== undefined && { safetyDrivingAllowance: body.safetyDrivingAllowance }),
      ...(body.longDistanceAllowance !== undefined && { longDistanceAllowance: body.longDistanceAllowance }),
      ...(body.positionAllowance !== undefined && { positionAllowance: body.positionAllowance }),
      ...(body.familyAllowance !== undefined && { familyAllowance: body.familyAllowance }),
      ...(body.earlyOvertimeAllowance !== undefined && { earlyOvertimeAllowance: body.earlyOvertimeAllowance }),
      ...(body.commissionRatePerKm !== undefined && { commissionRatePerKm: body.commissionRatePerKm }),
      ...(body.commissionRatePerCase !== undefined && { commissionRatePerCase: body.commissionRatePerCase }),
      ...(body.mikawaCommissionRate !== undefined && { mikawaCommissionRate: body.mikawaCommissionRate }),
      ...(body.useBluewingLogic !== undefined && { useBluewingLogic: body.useBluewingLogic }),
      ...(body.bluewingCommissionRate !== undefined && { bluewingCommissionRate: body.bluewingCommissionRate }),
      ...(body.bluewingFixedOvertimeHours !== undefined && { bluewingFixedOvertimeHours: body.bluewingFixedOvertimeHours }),
      ...(body.bluewingFixedOvertimeAmount !== undefined && { bluewingFixedOvertimeAmount: body.bluewingFixedOvertimeAmount }),
      ...(body.dependentCount !== undefined && { dependentCount: body.dependentCount }),
      ...(body.hasSpouse !== undefined && { hasSpouse: body.hasSpouse }),
      ...(body.standardRemuneration !== undefined && { standardRemuneration: body.standardRemuneration }),
      ...(body.careInsuranceApplied !== undefined && { careInsuranceApplied: body.careInsuranceApplied }),
      ...(body.healthInsuranceMonthly !== undefined && { healthInsuranceMonthly: body.healthInsuranceMonthly }),
      ...(body.pensionMonthly !== undefined && { pensionMonthly: body.pensionMonthly }),
      ...(body.incomeTaxMonthly !== undefined && { incomeTaxMonthly: body.incomeTaxMonthly }),
      ...(body.otherDeductionMonthly !== undefined && { otherDeductionMonthly: body.otherDeductionMonthly }),
      ...(body.employmentInsuranceApplied !== undefined && { employmentInsuranceApplied: body.employmentInsuranceApplied }),
      ...('pensionApplied' in body && { pensionApplied: body.pensionApplied ?? null }),
      ...(body.taxExempt !== undefined && { taxExempt: body.taxExempt }),
      ...(body.residentTax !== undefined && { residentTax: body.residentTax }),
      ...(body.dateOfBirth !== undefined && { dateOfBirth: body.dateOfBirth || null }),
      ...(body.hireDate !== undefined && { hireDate: body.hireDate }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.isOfficeStaff !== undefined && { isOfficeStaff: body.isOfficeStaff }),
      ...(body.scheduledWorkStart !== undefined && { scheduledWorkStart: body.scheduledWorkStart || null }),
      ...(body.scheduledWorkEnd !== undefined && { scheduledWorkEnd: body.scheduledWorkEnd || null }),
      ...(body.dailyRateWeekday !== undefined && { dailyRateWeekday: body.dailyRateWeekday }),
      ...(body.dailyRateSaturday !== undefined && { dailyRateSaturday: body.dailyRateSaturday }),
      ...(body.overtimeHourlyRate !== undefined && { overtimeHourlyRate: body.overtimeHourlyRate }),
      ...(body.lateNightHourlyRate !== undefined && { lateNightHourlyRate: body.lateNightHourlyRate }),
      ...(body.overtimeUnitMinutes !== undefined && { overtimeUnitMinutes: body.overtimeUnitMinutes ?? null }),
      ...(body.overtimeUnitRate !== undefined && { overtimeUnitRate: body.overtimeUnitRate }),
      updatedAt: new Date(),
    })
    .where(eq(employeesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  return res.json(sanitizeEmployee(updated));
});

router.delete("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  // 社員が存在するか確認
  const [emp] = await db.select({ id: employeesTable.id })
    .from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません" });

  // 給与明細・月次実績がある社員は物理削除を禁止（賃金台帳等の法定保存記録を守る）。
  // 退職の場合は在籍を OFF（論理削除）にする運用へ誘導する。
  const [existingPayroll] = await db.select({ id: payrollsTable.id })
    .from(payrollsTable).where(eq(payrollsTable.employeeId, id)).limit(1);
  const [existingRecord] = await db.select({ id: monthlyRecordsTable.id })
    .from(monthlyRecordsTable).where(eq(monthlyRecordsTable.employeeId, id)).limit(1);
  if (existingPayroll || existingRecord) {
    return res.status(409).json({
      error: "給与明細または月次実績がある社員は削除できません。退職の場合は「在籍」をOFFにしてください。",
    });
  }

  // 関連データを順番に完全削除（外部キー制約順）
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.employeeId, id));
  await db.delete(liveLocationsTable).where(eq(liveLocationsTable.employeeId, id));
  await db.delete(attendanceDraftsTable).where(eq(attendanceDraftsTable.employeeId, id));
  await db.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, id));
  await db.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.employeeId, id));
  await db.delete(absenceRecordsTable).where(eq(absenceRecordsTable.employeeId, id));
  await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.employeeId, id));
  await db.delete(monthlyRecordsTable).where(eq(monthlyRecordsTable.employeeId, id));
  await db.delete(payrollsTable).where(eq(payrollsTable.employeeId, id));
  await db.delete(messagesTable).where(eq(messagesTable.employeeId, id));
  await db.delete(employeesTable).where(eq(employeesTable.id, id));

  return res.status(204).send();
});

// ── PIN管理 ───────────────────────────────────────────────────────

// PIN設定・変更（管理者用）
router.put("/employees/:id/pin", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ error: "PINは4桁の数字で入力してください" });
  }
  const [updated] = await db.update(employeesTable)
    .set({ pin: String(pin), updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning({ id: employeesTable.id });
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  return res.json({ ok: true });
});

// PINリセット（管理者用）
router.delete("/employees/:id/pin", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [updated] = await db.update(employeesTable)
    .set({ pin: null, updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning({ id: employeesTable.id });
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  return res.json({ ok: true });
});

// PIN照合（ドライバー用）
router.post("/employees/:id/pin/verify", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { pin } = req.body ?? {};
  const [emp] = await db.select({ pin: employeesTable.pin }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  if (!emp.pin) return res.json({ ok: true, pinRequired: false });

  // 4桁（1万通り）なので、回数を制限しないと総当たりで当てられる。
  const now = Date.now();
  const key = `${id}|${req.header("cf-connecting-ip") || req.ip || "unknown"}`;
  for (const [k, a] of pinAttempts) {
    if (a.lockedUntil < now && now - a.firstFailureAt > PIN_WINDOW_MS) pinAttempts.delete(k);
  }
  const attempt = pinAttempts.get(key);
  if (attempt && attempt.lockedUntil > now) {
    const minutes = Math.ceil((attempt.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `暗証番号を続けて間違えたため、あと${minutes}分は入力できません。` });
  }

  const ok = emp.pin === String(pin);
  if (!ok) {
    const a = attempt && now - attempt.firstFailureAt <= PIN_WINDOW_MS
      ? attempt
      : { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    a.failures += 1;
    if (a.failures >= PIN_MAX_FAILURES) a.lockedUntil = now + PIN_LOCK_MS;
    pinAttempts.set(key, a);
    return res.json({ ok: false, pinRequired: true });
  }
  pinAttempts.delete(key);
  // 合った端末に印を渡す。以後の打刻・履歴・メッセージの API はこの印を見て本人と判断する。
  issueDriverToken(res, id, emp.pin);
  return res.json({ ok: true, pinRequired: true });
});

// PIN設定有無の確認（ドライバー用）
router.get("/employees/:id/pin/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp] = await db.select({ pin: employeesTable.pin }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  return res.json({ pinSet: !!emp.pin });
});

export default router;
