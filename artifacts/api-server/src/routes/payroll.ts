import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable, companyTable, allowanceDefinitionsTable, employeeAllowancesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { calculatePayroll, calculateMikawaPayroll, calculateBluewingPayroll, roundJapanese } from "../lib/payroll-calculator";
import { calculateSocialInsurance, calculateIncomeTaxReiwa8 } from "../lib/tax-tables-reiwa8";

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
    // ブルーウィングロジックフラグ
    useBluewingLogic = false,
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
  // useMikawaLogic=true: monthly_records の売上・歩合率を使い計算後 DB 保存
  // useMikawaLogic=false: 既存の calculatePayroll フロー
  // ────────────────────────────────────────────────────────────────
  if (useMikawaLogic) {
    if (record.salesAmount <= 0 || record.commissionRate <= 0) {
      return res.status(400).json({
        error: "月次実績に売上金額（salesAmount）と歩合率（commissionRate）を入力してください。",
      });
    }

    const mikawaResult = calculateMikawaPayroll({
      salesAmount: record.salesAmount,
      commissionRate: record.commissionRate,
      workDays: record.workDays,
      overtimeHours: record.overtimeHours,
      fixedOvertimeHours: record.fixedOvertimeHours,
      overtimeUnitPrice: record.overtimeUnitPrice,
    });

    // 支給合計 = 最終給与（最低保証 or 売上給与の大きい方）
    const grossSalary = mikawaResult.finalSalary;

    // 社会保険料（手動設定優先）
    let healthInsurance: number;
    let pension: number;
    if (emp.healthInsuranceMonthly > 0 && emp.pensionMonthly > 0) {
      healthInsurance = emp.healthInsuranceMonthly;
      pension = emp.pensionMonthly;
    } else {
      const ins = calculateSocialInsurance(grossSalary);
      healthInsurance = ins.healthInsurance;
      pension = ins.pension;
    }
    const socialInsurance = healthInsurance + pension;

    // 雇用保険料
    const employmentInsurance = roundJapanese(grossSalary * company.employmentInsuranceRate);

    // 源泉所得税（令和8年月額表甲欄）
    const afterInsuranceSalary = grossSalary - socialInsurance - employmentInsurance;
    const dependentEquivCount = emp.dependentCount + (emp.hasSpouse ? 1 : 0);
    const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);

    const totalDeductions = roundJapanese(socialInsurance + employmentInsurance + incomeTax + emp.residentTax);
    const netSalary = roundJapanese(grossSalary - totalDeductions);

    const mikawaPayrollData = {
      // 支給内訳
      baseSalary: mikawaResult.minimumSalary,
      commissionPay: mikawaResult.salesSalary,
      overtimePay: mikawaResult.overtimePay,
      lateNightPay: 0,
      holidayPay: 0,
      transportationAllowance: emp.transportationAllowance,
      safetyDrivingAllowance: emp.safetyDrivingAllowance,
      longDistanceAllowance: emp.longDistanceAllowance,
      positionAllowance: emp.positionAllowance,
      familyAllowance: emp.familyAllowance,
      earlyOvertimeAllowance: emp.earlyOvertimeAllowance,
      customAllowancesTotal: 0,
      absenceDeduction: 0,
      grossSalary,
      // 控除
      socialInsurance,
      employmentInsurance,
      incomeTax,
      residentTax: emp.residentTax,
      totalDeductions,
      netSalary,
      // 勤怠実績
      workDays: record.workDays,
      overtimeHours: record.overtimeHours,
      lateNightHours: 0,
      holidayWorkDays: 0,
      // 三川専用
      useMikawaLogic: true,
      salesAmount: record.salesAmount,
      commissionRate: record.commissionRate,
      performanceAllowance: mikawaResult.performanceAllowance,
    };

    // DB 保存（upsert）
    const existingMikawa = await db.select().from(payrollsTable)
      .where(and(
        eq(payrollsTable.employeeId, employeeId),
        eq(payrollsTable.year, year),
        eq(payrollsTable.month, month)
      )).limit(1);

    let mikawaPayroll;
    if (existingMikawa.length > 0 && existingMikawa[0].status !== "confirmed") {
      [mikawaPayroll] = await db.update(payrollsTable).set({
        ...mikawaPayrollData,
        status: "draft",
        updatedAt: new Date(),
      }).where(eq(payrollsTable.id, existingMikawa[0].id)).returning();
    } else if (existingMikawa.length === 0) {
      [mikawaPayroll] = await db.insert(payrollsTable).values({
        employeeId,
        year,
        month,
        status: "draft",
        ...mikawaPayrollData,
      }).returning();
    } else {
      mikawaPayroll = existingMikawa[0];
    }

    return res.json(buildPayrollResponse(mikawaPayroll, emp));
  }

  // ────────────────────────────────────────────────────────────────
  // ブルーウィングロジック分岐
  // ────────────────────────────────────────────────────────────────
  if (useBluewingLogic || emp.useBluewingLogic) {
    if ((record.bluewingSalesAmount ?? 0) <= 0) {
      return res.status(400).json({
        error: "月次実績にブルーウィング売上金額（bluewingSalesAmount）を入力してください。",
      });
    }

    // 日給計算（日給制前提）
    const dailyWage = company.dailyWageWeekday ?? 9808;
    const dailySaturday = company.dailyWageSaturday ?? 12260;
    const baseSalaryCalc = Math.floor(
      (record.workDays ?? 0) * dailyWage +
      (record.saturdayWorkDays ?? 0) * dailySaturday
    );

    // 固定手当合計（カスタム手当 + マスタ固定手当）
    const masterFixedAllowances =
      (emp.transportationAllowance ?? 0) +
      (emp.safetyDrivingAllowance ?? 0) +
      (emp.longDistanceAllowance ?? 0) +
      (emp.positionAllowance ?? 0) +
      (emp.familyAllowance ?? 0) +
      (emp.earlyOvertimeAllowance ?? 0);
    const customAllowancesFixedTotal = customAllowances.reduce((s, a) => s + a.amount, 0);
    const fixedAllowancesTotal = masterFixedAllowances + customAllowancesFixedTotal;

    // 休日出勤代（日給制: 休日単価 × 休日出勤日数）
    const holidayPay = Math.floor((company.dailyWageSaturday ?? 12260) * (record.holidayWorkDays ?? 0));

    const bwResult = calculateBluewingPayroll({
      bluewingSalesAmount: record.bluewingSalesAmount,
      commissionRate: emp.bluewingCommissionRate > 0 ? emp.bluewingCommissionRate : 0,
      fixedOvertimeHours: emp.bluewingFixedOvertimeHours ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      overtimeUnitPrice: record.overtimeUnitPrice ?? 2111,
      baseSalary: baseSalaryCalc,
      fixedAllowancesTotal,
      holidayPay,
      fixedOvertimeAmount: emp.bluewingFixedOvertimeAmount ?? 0,
    });

    const grossSalary = bwResult.grossSalary;

    // 社会保険料（手動設定優先）
    let healthInsurance: number;
    let pension: number;
    if (emp.healthInsuranceMonthly > 0 && emp.pensionMonthly > 0) {
      healthInsurance = emp.healthInsuranceMonthly;
      pension = emp.pensionMonthly;
    } else {
      const ins = calculateSocialInsurance(grossSalary);
      healthInsurance = ins.healthInsurance;
      pension = ins.pension;
    }
    const socialInsurance = healthInsurance + pension;

    const employmentInsurance = emp.employmentInsuranceApplied
      ? roundJapanese(grossSalary * (company.employmentInsuranceRate ?? 0.006))
      : 0;

    const afterInsuranceSalary = grossSalary - socialInsurance - employmentInsurance;
    const dependentEquivCount = (emp.dependentCount ?? 0) + (emp.hasSpouse ? 1 : 0);
    const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);

    const totalDeductions = roundJapanese(socialInsurance + employmentInsurance + incomeTax + (emp.residentTax ?? 0));
    const netSalary = roundJapanese(grossSalary - totalDeductions);

    const bwPayrollData = {
      baseSalary: baseSalaryCalc,
      commissionPay: 0,
      overtimePay: bwResult.actualOvertimePay,
      lateNightPay: 0,
      holidayPay,
      transportationAllowance: emp.transportationAllowance ?? 0,
      safetyDrivingAllowance: emp.safetyDrivingAllowance ?? 0,
      longDistanceAllowance: emp.longDistanceAllowance ?? 0,
      positionAllowance: emp.positionAllowance ?? 0,
      familyAllowance: emp.familyAllowance ?? 0,
      earlyOvertimeAllowance: emp.bluewingFixedOvertimeAmount ?? 0,
      customAllowancesTotal: customAllowancesFixedTotal,
      absenceDeduction: 0,
      grossSalary,
      socialInsurance,
      employmentInsurance,
      incomeTax,
      residentTax: emp.residentTax ?? 0,
      totalDeductions,
      netSalary,
      workDays: record.workDays ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      lateNightHours: 0,
      holidayWorkDays: record.holidayWorkDays ?? 0,
      useBluewingLogic: true,
      bluewingSalesAmount: record.bluewingSalesAmount,
      bluewingPerformanceAllowance: bwResult.performanceAllowance,
      performanceAllowance: bwResult.performanceAllowance,
    };

    const existingBw = await db.select().from(payrollsTable)
      .where(and(
        eq(payrollsTable.employeeId, employeeId),
        eq(payrollsTable.year, year),
        eq(payrollsTable.month, month)
      )).limit(1);

    let bwPayroll;
    if (existingBw.length > 0 && existingBw[0].status !== "confirmed") {
      [bwPayroll] = await db.update(payrollsTable).set({
        ...bwPayrollData,
        status: "draft",
        updatedAt: new Date(),
      }).where(eq(payrollsTable.id, existingBw[0].id)).returning();
    } else if (existingBw.length === 0) {
      [bwPayroll] = await db.insert(payrollsTable).values({
        employeeId,
        year,
        month,
        status: "draft",
        ...bwPayrollData,
      }).returning();
    } else {
      bwPayroll = existingBw[0];
    }

    return res.json(buildPayrollResponse(bwPayroll!, emp));
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
