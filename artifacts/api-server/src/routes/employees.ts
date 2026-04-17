import { Router } from "express";
import { db, employeesTable } from "@workspace/db";
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
  const [emp] = await db.insert(employeesTable).values({
    employeeCode: body.employeeCode,
    name: body.name,
    nameKana: body.nameKana,
    department: body.department,
    position: body.position ?? "",
    baseSalary: body.baseSalary,
    transportationAllowance: body.transportationAllowance ?? 0,
    safetyDrivingAllowance: body.safetyDrivingAllowance ?? 0,
    longDistanceAllowance: body.longDistanceAllowance ?? 0,
    positionAllowance: body.positionAllowance ?? 0,
    familyAllowance: body.familyAllowance ?? 0,
    earlyOvertimeAllowance: body.earlyOvertimeAllowance ?? 0,
    commissionRatePerKm: body.commissionRatePerKm ?? 0,
    commissionRatePerCase: body.commissionRatePerCase ?? 0,
    dependentCount: body.dependentCount ?? 0,
    hasSpouse: body.hasSpouse ?? false,
    standardRemuneration: body.standardRemuneration ?? 0,
    careInsuranceApplied: body.careInsuranceApplied ?? false,
    healthInsuranceMonthly: body.healthInsuranceMonthly ?? 0,
    pensionMonthly: body.pensionMonthly ?? 0,
    employmentInsuranceApplied: body.employmentInsuranceApplied ?? true,
    residentTax: body.residentTax ?? 0,
    hireDate: body.hireDate,
    isActive: true,
    scheduledWorkStart: body.scheduledWorkStart ?? "08:00",
    scheduledWorkEnd: body.scheduledWorkEnd ?? "17:00",
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
      ...(body.baseSalary !== undefined && { baseSalary: body.baseSalary }),
      ...(body.transportationAllowance !== undefined && { transportationAllowance: body.transportationAllowance }),
      ...(body.safetyDrivingAllowance !== undefined && { safetyDrivingAllowance: body.safetyDrivingAllowance }),
      ...(body.longDistanceAllowance !== undefined && { longDistanceAllowance: body.longDistanceAllowance }),
      ...(body.positionAllowance !== undefined && { positionAllowance: body.positionAllowance }),
      ...(body.familyAllowance !== undefined && { familyAllowance: body.familyAllowance }),
      ...(body.earlyOvertimeAllowance !== undefined && { earlyOvertimeAllowance: body.earlyOvertimeAllowance }),
      ...(body.commissionRatePerKm !== undefined && { commissionRatePerKm: body.commissionRatePerKm }),
      ...(body.commissionRatePerCase !== undefined && { commissionRatePerCase: body.commissionRatePerCase }),
      ...(body.dependentCount !== undefined && { dependentCount: body.dependentCount }),
      ...(body.hasSpouse !== undefined && { hasSpouse: body.hasSpouse }),
      ...(body.standardRemuneration !== undefined && { standardRemuneration: body.standardRemuneration }),
      ...(body.careInsuranceApplied !== undefined && { careInsuranceApplied: body.careInsuranceApplied }),
      ...(body.healthInsuranceMonthly !== undefined && { healthInsuranceMonthly: body.healthInsuranceMonthly }),
      ...(body.pensionMonthly !== undefined && { pensionMonthly: body.pensionMonthly }),
      ...(body.employmentInsuranceApplied !== undefined && { employmentInsuranceApplied: body.employmentInsuranceApplied }),
      ...(body.residentTax !== undefined && { residentTax: body.residentTax }),
      ...(body.hireDate !== undefined && { hireDate: body.hireDate }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.scheduledWorkStart !== undefined && { scheduledWorkStart: body.scheduledWorkStart }),
      ...(body.scheduledWorkEnd !== undefined && { scheduledWorkEnd: body.scheduledWorkEnd }),
      updatedAt: new Date(),
    })
    .where(eq(employeesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Employee not found" });
  return res.json(updated);
});

router.delete("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.update(employeesTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(employeesTable.id, id));
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
