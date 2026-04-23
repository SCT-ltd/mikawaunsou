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

const router = Router();

router.get("/employees", async (req, res) => {
  const { active } = req.query;
  if (active !== undefined) {
    const activeFilter = active === "true";
    const rows = await db.select().from(employeesTable)
      .where(eq(employeesTable.isActive, activeFilter))
      .orderBy(asc(employeesTable.employeeCode));
    return res.json(rows);
  }
  const rows = await db.select().from(employeesTable)
    .orderBy(asc(employeesTable.employeeCode));
  return res.json(rows);
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
    employmentInsuranceApplied: body.employmentInsuranceApplied ?? true,
    residentTax: body.residentTax ?? 0,
    dateOfBirth: body.dateOfBirth || null,
    hireDate: body.hireDate,
    isActive: true,
    scheduledWorkStart: body.scheduledWorkStart || null,
    scheduledWorkEnd: body.scheduledWorkEnd || null,
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
    return res.status(200).json(emp);
  }

  const [emp] = await db.insert(employeesTable).values({
    employeeCode: body.employeeCode,
    ...fields,
  }).returning();
  return res.status(201).json(emp);
});

router.get("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  return res.json(emp);
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
      ...(body.employmentInsuranceApplied !== undefined && { employmentInsuranceApplied: body.employmentInsuranceApplied }),
      ...(body.residentTax !== undefined && { residentTax: body.residentTax }),
      ...(body.dateOfBirth !== undefined && { dateOfBirth: body.dateOfBirth || null }),
      ...(body.hireDate !== undefined && { hireDate: body.hireDate }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.scheduledWorkStart !== undefined && { scheduledWorkStart: body.scheduledWorkStart || null }),
      ...(body.scheduledWorkEnd !== undefined && { scheduledWorkEnd: body.scheduledWorkEnd || null }),
      updatedAt: new Date(),
    })
    .where(eq(employeesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Employee not found" });
  return res.json(updated);
});

router.delete("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  // 社員が存在するか確認
  const [emp] = await db.select({ id: employeesTable.id })
    .from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません" });

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
  if (!updated) return res.status(404).json({ error: "Employee not found" });
  return res.json({ ok: true });
});

// PINリセット（管理者用）
router.delete("/employees/:id/pin", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [updated] = await db.update(employeesTable)
    .set({ pin: null, updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning({ id: employeesTable.id });
  if (!updated) return res.status(404).json({ error: "Employee not found" });
  return res.json({ ok: true });
});

// PIN照合（ドライバー用）
router.post("/employees/:id/pin/verify", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { pin } = req.body;
  const [emp] = await db.select({ pin: employeesTable.pin }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!emp.pin) return res.json({ ok: true, pinRequired: false });
  const ok = emp.pin === String(pin);
  return res.json({ ok, pinRequired: true });
});

// PIN設定有無の確認（ドライバー用）
router.get("/employees/:id/pin/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp] = await db.select({ pin: employeesTable.pin }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  return res.json({ pinSet: !!emp.pin });
});

export default router;
