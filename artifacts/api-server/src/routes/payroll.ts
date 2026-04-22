import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable, companyTable, allowanceDefinitionsTable, employeeAllowancesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { calculatePayroll, calculateMikawaPayroll } from "../lib/payroll-calculator";

const router = Router();

function buildPayrollResponse(p: typeof payrollsTable.$inferSelect, emp: typeof employeesTable.$inferSelect) {
  return {
    ...p,
    employeeName: emp.name,
    employeeCode: emp.employeeCode,
  };
}

router.get("/payroll", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);
  const status = req.query.status as string | undefined;

  const conditions = [eq(payrollsTable.year, year), eq(payrollsTable.month, month)];
  if (status) conditions.push(eq(payrollsTable.status, status));

  const rows = await db.select({
    payroll: payrollsTable,
    employee: employeesTable,
  })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(and(...conditions));

  return res.json(rows.map(r => buildPayrollResponse(r.payroll, r.employee)));
});

router.post("/payroll/calculate", async (req, res) => {
  const {
    employeeId,
    year,
    month,
    // 三川ロジックフラグ（省略時 false = 既存ロジック）
    useMikawaLogic = false,
    // 三川ロジック専用パラメータ（useMikawaLogic=true の時のみ使用）
    salesAmount,
    commissionRate,
    fixedOvertimeHours = 0,
    overtimeUnitPrice = 2111,
  } = req.body;

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const [record] = await db.select().from(monthlyRecordsTable)
    .where(and(
      eq(monthlyRecordsTable.employeeId, employeeId),
      eq(monthlyRecordsTable.year, year),
      eq(monthlyRecordsTable.month, month)
    ));
  if (!record) return res.status(404).json({ error: "Monthly record not found. Please enter monthly data first." });

  const companyRows = await db.select().from(companyTable).limit(1);
  const company = companyRows[0] ?? {
    monthlyAverageWorkHours: 160,
    employmentInsuranceRate: 0.006,
  };

  // カスタム手当を取得
  const customAllowanceDefs = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true));
  const empAllowanceRows = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId));
  const customAllowances = customAllowanceDefs.map(def => {
    const row = empAllowanceRows.find(r => r.allowanceDefinitionId === def.id);
    return {
      allowanceDefinitionId: def.id,
      allowanceName: def.name,
      isTaxable: def.isTaxable,
      amount: row?.amount ?? 0,
    };
  }).filter(a => a.amount > 0);

  // ────────────────────────────────────────────────────────────────
  // 三川ロジック分岐
  // useMikawaLogic=true の場合: calculateMikawaPayroll を呼び計算結果のみ返却
  //   （現段階では DB 構造は変更しないため payrolls テーブルへの保存はしない）
  // useMikawaLogic=false の場合: 既存の calculatePayroll フローへ
  // ────────────────────────────────────────────────────────────────
  if (useMikawaLogic) {
    if (salesAmount == null || commissionRate == null) {
      return res.status(400).json({
        error: "useMikawaLogic=true の場合、salesAmount と commissionRate は必須です",
      });
    }
    const mikawaResult = calculateMikawaPayroll({
      salesAmount: Number(salesAmount),
      commissionRate: Number(commissionRate),
      workDays: record.workDays,
      overtimeHours: record.overtimeHours,
      fixedOvertimeHours: Number(fixedOvertimeHours),
      overtimeUnitPrice: Number(overtimeUnitPrice),
    });
    return res.json({
      useMikawaLogic: true,
      employeeId,
      employeeName: emp.name,
      employeeCode: emp.employeeCode,
      year,
      month,
      workDays: record.workDays,
      overtimeHours: record.overtimeHours,
      salesAmount: Number(salesAmount),
      commissionRate: Number(commissionRate),
      fixedOvertimeHours: Number(fixedOvertimeHours),
      overtimeUnitPrice: Number(overtimeUnitPrice),
      ...mikawaResult,
    });
  }

  const result = calculatePayroll({
    baseSalary: emp.baseSalary,
    salaryType: emp.salaryType,
    dailyRateWeekday: company.dailyWageWeekday,
    dailyRateSaturday: company.dailyWageSaturday,
    hourlyRateSunday: company.hourlyWageSunday,
    transportationAllowance: emp.transportationAllowance,
    safetyDrivingAllowance: emp.safetyDrivingAllowance,
    longDistanceAllowance: emp.longDistanceAllowance,
    positionAllowance: emp.positionAllowance,
    familyAllowance: emp.familyAllowance,
    earlyOvertimeAllowance: emp.earlyOvertimeAllowance,
    commissionRatePerKm: emp.commissionRatePerKm,
    commissionRatePerCase: emp.commissionRatePerCase,
    dependentCount: emp.dependentCount,
    hasSpouse: emp.hasSpouse,
    healthInsuranceMonthly: emp.healthInsuranceMonthly,
    pensionMonthly: emp.pensionMonthly,
    residentTax: emp.residentTax,
    monthlyAverageWorkHours: company.monthlyAverageWorkHours,
    employmentInsuranceRate: company.employmentInsuranceRate,
    workDays: record.workDays,
    saturdayWorkDays: record.saturdayWorkDays,
    sundayWorkHours: record.sundayWorkHours,
    overtimeHours: record.overtimeHours,
    lateNightHours: record.lateNightHours,
    holidayWorkDays: record.holidayWorkDays,
    drivingDistanceKm: record.drivingDistanceKm,
    deliveryCases: record.deliveryCases,
    absenceDays: record.absenceDays,
    customAllowances,
  });

  // Upsert payroll
  const existing = await db.select().from(payrollsTable)
    .where(and(
      eq(payrollsTable.employeeId, employeeId),
      eq(payrollsTable.year, year),
      eq(payrollsTable.month, month)
    )).limit(1);

  let payroll;
  if (existing.length > 0 && existing[0].status !== "confirmed") {
    [payroll] = await db.update(payrollsTable).set({
      ...result,
      overtimeHours: record.overtimeHours,
      lateNightHours: record.lateNightHours,
      holidayWorkDays: record.holidayWorkDays,
      workDays: record.workDays,
      status: "draft",
      updatedAt: new Date(),
    }).where(eq(payrollsTable.id, existing[0].id)).returning();
  } else if (existing.length === 0) {
    [payroll] = await db.insert(payrollsTable).values({
      employeeId,
      year,
      month,
      status: "draft",
      ...result,
      overtimeHours: record.overtimeHours,
      lateNightHours: record.lateNightHours,
      holidayWorkDays: record.holidayWorkDays,
      workDays: record.workDays,
    }).returning();
  } else {
    payroll = existing[0];
  }

  return res.json(buildPayrollResponse(payroll, emp));
});

router.get("/payroll/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select({
    payroll: payrollsTable,
    employee: employeesTable,
  })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(eq(payrollsTable.id, id));
  if (!row) return res.status(404).json({ error: "Payroll not found" });
  return res.json(buildPayrollResponse(row.payroll, row.employee));
});

router.put("/payroll/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  const [updated] = await db.update(payrollsTable).set({
    ...(body.safetyDrivingAllowance !== undefined && { safetyDrivingAllowance: body.safetyDrivingAllowance }),
    ...(body.longDistanceAllowance !== undefined && { longDistanceAllowance: body.longDistanceAllowance }),
    ...(body.positionAllowance !== undefined && { positionAllowance: body.positionAllowance }),
    ...(body.notes !== undefined && { notes: body.notes }),
    updatedAt: new Date(),
  }).where(eq(payrollsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Payroll not found" });
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId));
  return res.json(buildPayrollResponse(updated, emp));
});

router.post("/payroll/:id/confirm", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [updated] = await db.update(payrollsTable)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(payrollsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Payroll not found" });
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId));
  return res.json(buildPayrollResponse(updated, emp));
});

router.get("/payroll/:id/csv", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select({
    payroll: payrollsTable,
    employee: employeesTable,
  })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(eq(payrollsTable.id, id));
  if (!row) return res.status(404).json({ error: "Payroll not found" });

  const p = row.payroll;
  const e = row.employee;
  const lines = [
    ["項目", "金額"].join(","),
    ["社員番号", e.employeeCode].join(","),
    ["氏名", e.name].join(","),
    ["年月", `${p.year}年${p.month}月`].join(","),
    [""],
    ["【支給】", ""].join(","),
    ["基本給", p.baseSalary].join(","),
    ["時間外手当", p.overtimePay].join(","),
    ["深夜手当", p.lateNightPay].join(","),
    ["休日手当", p.holidayPay].join(","),
    ["歩合給", p.commissionPay].join(","),
    ["通勤手当", p.transportationAllowance].join(","),
    ["無事故手当", p.safetyDrivingAllowance].join(","),
    ["長距離手当", p.longDistanceAllowance].join(","),
    ["役職手当", p.positionAllowance].join(","),
    ["家族手当", p.familyAllowance].join(","),
    ["早出残業手当", p.earlyOvertimeAllowance].join(","),
    ["欠勤控除", `-${p.absenceDeduction}`].join(","),
    ["支給合計", p.grossSalary].join(","),
    [""],
    ["【控除】", ""].join(","),
    ["社会保険料", p.socialInsurance].join(","),
    ["雇用保険料", p.employmentInsurance].join(","),
    ["源泉所得税", p.incomeTax].join(","),
    ["住民税", p.residentTax].join(","),
    ["控除合計", p.totalDeductions].join(","),
    [""],
    ["差引支給額", p.netSalary].join(","),
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="payslip_${e.employeeCode}_${p.year}${String(p.month).padStart(2, "0")}.csv"`);
  return res.send("\uFEFF" + lines.join("\n"));
});

export default router;
