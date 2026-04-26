import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable, companyTable, allowanceDefinitionsTable, employeeAllowancesTable, deductionDefinitionsTable, employeeDeductionsTable, employeeResidentTaxesTable } from "@workspace/db";
import { eq, and, or, desc, lte } from "drizzle-orm";
import { calculatePayroll, calculateMikawaPayroll, calculateBluewingPayroll, roundJapanese } from "../lib/payroll-calculator";
import { calculateSocialInsurance, calculateIncomeTaxReiwa8 } from "../lib/tax-tables-reiwa8";

const router = Router();

/**
 * 給与計算のコアロジックを共通化
 */
async function performPayrollCalculation(params: {
  emp: any,
  record: any,
  company: any,
  customAllowances: any[],
  year: number,
  month: number
}) {
  const { emp, record, company, customAllowances, year, month } = params;
  
  // 該当月（またはそれ以前で最新）の住民税を取得
  const effectiveMonthStr = `${year}-${String(month).padStart(2, "0")}`;
  const residentTaxRows = await db.select()
    .from(employeeResidentTaxesTable)
    .where(and(
      eq(employeeResidentTaxesTable.employeeId, emp.id),
      lte(employeeResidentTaxesTable.effectiveMonth, effectiveMonthStr)
    ))
    .orderBy(desc(employeeResidentTaxesTable.effectiveMonth))
    .limit(1);
  
  const residentTax = residentTaxRows.length > 0 ? Number(residentTaxRows[0].amount) : Number(emp.residentTax) || 0;

  const isBW = !!emp.useBluewingLogic;
  const isMikawa = !!emp.mikawaCommissionRate && !isBW;

  if (isMikawa) {
    const mikawaResult = calculateMikawaPayroll({
      salesAmount: Number(record.salesAmount) || 0,
      commissionRate: Number(record.commissionRate) || Number(emp.mikawaCommissionRate) || 0,
      workDays: Number(record.workDays) || 0,
      overtimeHours: Number(record.overtimeHours) || 0,
      fixedOvertimeHours: Number(emp.fixedOvertimeHours) || 0,
      overtimeUnitPrice: Number(emp.overtimeUnitPrice) || 0,
    });

    const grossSalary = mikawaResult.finalSalary;
    const mikawaInsBase = emp.standardRemuneration ?? 0;
    const mikawaIns = calculateSocialInsurance(mikawaInsBase, { 
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      healthRate: company.healthInsuranceEmployeeRate,
      pensionRate: company.pensionEmployeeRate
    });
    const socialInsurance = mikawaIns.healthInsurance + (emp.pensionApplied ? mikawaIns.pension : 0);
    const employmentInsurance = roundJapanese(grossSalary * 0.0055);
    const nonTaxableCustomAllowancesTotal = customAllowances.reduce((s, a) => s + (a.isTaxable === false ? a.amount : 0), 0);
    const afterInsuranceSalary = grossSalary - nonTaxableCustomAllowancesTotal - socialInsurance - employmentInsurance;
    const dependentEquivCount = Number(emp.dependentCount) || 0;
    const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);
    const totalDeductions = roundJapanese(socialInsurance + employmentInsurance + incomeTax + residentTax + (Number(emp.otherDeductionMonthly) || 0));

    return {
      baseSalary: mikawaResult.minimumSalary,
      commissionPay: mikawaResult.salesSalary,
      overtimePay: mikawaResult.overtimePay,
      lateNightPay: 0,
      holidayPay: 0,
      grossSalary,
      socialInsurance,
      employmentInsurance,
      incomeTax,
      residentTax,
      totalDeductions,
      netSalary: roundJapanese(grossSalary - totalDeductions),
      salesAmount: Number(record.salesAmount) || 0,
      commissionRate: Number(record.commissionRate) || Number(emp.mikawaCommissionRate) || 0,
      performanceAllowance: mikawaResult.performanceAllowance,
      // 随時改定用スナップショット
      salaryForStandardRemunerationReview: grossSalary,
      fixedPayComponentTotal: mikawaResult.minimumSalary - mikawaResult.overtimePay,
      variablePayComponentTotal: mikawaResult.performanceAllowance + mikawaResult.overtimePay,
      workingDaysForMonthlyChange: Number(record.workDays) || 0,
      monthlyChangeTargetable: emp.fixedPayChangeFlag || false,
    };
  } else if (isBW) {
    const dailyWage = company.dailyWageWeekday ?? 9808;
    const dailySaturday = company.dailyWageSaturday ?? 12260;
    const baseSalaryCalc = Math.floor((Number(record.workDays) || 0) * dailyWage);
    const masterFixedAllowances = (Number(emp.earlyOvertimeAllowance) || 0);
    const customAllowancesFixedTotal = customAllowances.reduce((s, a) => s + a.amount, 0);
    const fixedAllowancesTotal = masterFixedAllowances + customAllowancesFixedTotal;
    const holidayPay = Math.floor((company.dailyWageSaturday ?? 12260) * (Number(record.holidayWorkDays) || 0));
    const hourlyRate = dailyWage / 8;
    const bwLateNightPay = roundJapanese(hourlyRate * 0.25 * (Number(record.lateNightHours) || 0));

    const bwResult = calculateBluewingPayroll({
      bluewingSalesAmount: Number(record.bluewingSalesAmount) || 0,
      commissionRate: Number(emp.bluewingCommissionRate) || 0,
      fixedOvertimeHours: Number(emp.bluewingFixedOvertimeHours) || 0,
      overtimeHours: Number(record.overtimeHours) || 0,
      overtimeUnitPrice: Number(record.overtimeUnitPrice) || 2111,
      baseSalary: baseSalaryCalc,
      fixedAllowancesTotal,
      holidayPay,
      fixedOvertimeAmount: Number(emp.bluewingFixedOvertimeAmount) || 0,
      lateNightPay: bwLateNightPay,
    });

    const grossSalary = bwResult.grossSalary;
    const bwInsBase = emp.standardRemuneration ?? 0;
    const bwIns = calculateSocialInsurance(bwInsBase, { 
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      healthRate: company.healthInsuranceEmployeeRate,
      pensionRate: company.pensionEmployeeRate
    });
    const socialInsurance = bwIns.healthInsurance + (emp.pensionApplied ? bwIns.pension : 0);
    const employmentInsurance = emp.employmentInsuranceApplied ? roundJapanese(grossSalary * 0.0055) : 0;
    const nonTaxableAllowancesTotal = customAllowances.reduce((s, a) => s + (a.isTaxable === false ? a.amount : 0), 0);
    const afterInsuranceSalary = grossSalary - nonTaxableAllowancesTotal - socialInsurance - employmentInsurance;
    const dependentEquivCount = Number(emp.dependentCount) || 0;
    const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);
    const totalDeductions = roundJapanese(socialInsurance + employmentInsurance + incomeTax + residentTax + (Number(emp.otherDeductionMonthly) || 0));

    return {
      baseSalary: baseSalaryCalc,
      overtimePay: bwResult.actualOvertimePay,
      lateNightPay: bwLateNightPay,
      holidayPay,
      earlyOvertimeAllowance: Number(emp.bluewingFixedOvertimeAmount) || 0,
      customAllowancesTotal: customAllowancesFixedTotal,
      grossSalary,
      socialInsurance,
      employmentInsurance,
      incomeTax,
      residentTax,
      totalDeductions,
      netSalary: roundJapanese(grossSalary - totalDeductions),
      useBluewingLogic: true,
      bluewingSalesAmount: Number(record.bluewingSalesAmount) || 0,
      performanceAllowance: bwResult.performanceAllowance,
      // 随時改定用スナップショット
      salaryForStandardRemunerationReview: grossSalary,
      fixedPayComponentTotal: baseSalaryCalc + (Number(emp.bluewingFixedOvertimeAmount) || 0) + masterFixedAllowances,
      variablePayComponentTotal: bwResult.performanceAllowance + bwResult.actualOvertimePay + holidayPay + bwLateNightPay,
      workingDaysForMonthlyChange: (Number(record.workDays) || 0) + (Number(record.saturdayWorkDays) || 0) + (Number(record.holidayWorkDays) || 0),
      monthlyChangeTargetable: emp.fixedPayChangeFlag || false,
    };
  } else {
    return calculatePayroll({
      baseSalary: Number(emp.baseSalary) || 0,
      salaryType: emp.salaryType,
      dailyRateWeekday: company.dailyWageWeekday,
      dailyRateSaturday: company.dailyWageSaturday,
      hourlyRateSunday: company.hourlyWageSunday,
      earlyOvertimeAllowance: Number(emp.earlyOvertimeAllowance) || 0,
      commissionRatePerKm: Number(emp.commissionRatePerKm) || 0,
      commissionRatePerCase: Number(emp.commissionRatePerCase) || 0,
      dependentCount: Number(emp.dependentCount) || 0,
      hasSpouse: emp.hasSpouse,
      standardRemuneration: emp.standardRemuneration ?? 0,
      healthInsuranceRate: company.healthInsuranceEmployeeRate,
      pensionInsuranceRate: company.pensionEmployeeRate,
      residentTax,
      pensionApplied: emp.pensionApplied,
      monthlyAverageWorkHours: company.monthlyAverageWorkHours,
      workDays: Number(record.workDays) || 0,
      saturdayWorkDays: Number(record.saturdayWorkDays) || 0,
      sundayWorkHours: Number(record.sundayWorkHours) || 0,
      overtimeHours: Number(record.overtimeHours) || 0,
      lateNightHours: Number(record.lateNightHours) || 0,
      holidayWorkDays: Number(record.holidayWorkDays) || 0,
      drivingDistanceKm: Number(record.drivingDistanceKm) || 0,
      deliveryCases: Number(record.deliveryCases) || 0,
      absenceDays: Number(record.absenceDays) || 0,
      customAllowances,
      otherDeductionMonthly: Number(emp.otherDeductionMonthly) || 0,
      customDeductionsTotal: 0,
    });

    return {
      ...standardResult,
      // 随時改定用スナップショット
      salaryForStandardRemunerationReview: standardResult.grossSalary,
      fixedPayComponentTotal: standardResult.baseSalary + (Number(emp.earlyOvertimeAllowance) || 0),
      variablePayComponentTotal: standardResult.overtimePay + standardResult.commissionPay + standardResult.lateNightPay + standardResult.holidayPay + standardResult.customAllowancesTotal,
      workingDaysForMonthlyChange: (Number(record.workDays) || 0) + (Number(record.saturdayWorkDays) || 0) + (Number(record.holidayWorkDays) || 0),
      monthlyChangeTargetable: emp.fixedPayChangeFlag || false,
    };
  }
}

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

/**
 * 概算プレビューAPI
 */
router.post("/payroll/preview", async (req, res) => {
  const { employeeId, year, month, record: recordOverride } = req.body;

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const companyRows = await db.select().from(companyTable).limit(1);
  const company = companyRows[0] ?? { monthlyAverageWorkHours: 160 };

  const customAllowanceDefs = await db.select().from(allowanceDefinitionsTable).where(eq(allowanceDefinitionsTable.isActive, true));
  const empAllowanceRows = await db.select().from(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, employeeId));
  const customAllowances = customAllowanceDefs.map(def => {
    const row = empAllowanceRows.find(r => r.allowanceDefinitionId === def.id);
    return { allowanceDefinitionId: def.id, allowanceName: def.name, isTaxable: def.isTaxable, amount: row?.amount ?? 0 };
  }).filter(a => a.amount > 0);

  try {
    const result = await performPayrollCalculation({
      emp,
      record: recordOverride,
      company,
      customAllowances,
      year,
      month
    });

    return res.json({
      status: "success",
      result,
      warnings: []
    });
  } catch (error: any) {
    return res.status(400).json({ status: "error", error: error.message });
  }
});

router.post("/payroll/calculate", async (req, res) => {
  const { employeeId, year, month } = req.body;

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const [record] = await db.select().from(monthlyRecordsTable)
    .where(and(
      eq(monthlyRecordsTable.employeeId, employeeId),
      eq(monthlyRecordsTable.year, year),
      eq(monthlyRecordsTable.month, month)
    ));
  if (!record) return res.status(404).json({ error: "Monthly record not found." });

  const companyRows = await db.select().from(companyTable).limit(1);
  const company = companyRows[0] ?? { monthlyAverageWorkHours: 160 };

  const customAllowanceDefs = await db.select().from(allowanceDefinitionsTable).where(eq(allowanceDefinitionsTable.isActive, true));
  const empAllowanceRows = await db.select().from(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, employeeId));
  const customAllowances = customAllowanceDefs.map(def => {
    const row = empAllowanceRows.find(r => r.allowanceDefinitionId === def.id);
    return { allowanceDefinitionId: def.id, allowanceName: def.name, isTaxable: def.isTaxable, amount: row?.amount ?? 0 };
  }).filter(a => a.amount > 0);

  const result = await performPayrollCalculation({ emp, record, company, customAllowances, year: Number(year), month: Number(month) });

  // Upsert
  const existing = await db.select().from(payrollsTable)
    .where(and(
      eq(payrollsTable.employeeId, Number(employeeId)),
      eq(payrollsTable.year, Number(year)),
      eq(payrollsTable.month, Number(month))
    )).limit(1);

  let payroll;
  const payrollData = {
    ...result,
    workDays: record.workDays,
    overtimeHours: record.overtimeHours,
    lateNightHours: record.lateNightHours || 0,
    holidayWorkDays: record.holidayWorkDays || 0,
    updatedAt: new Date(),
  };

  // NaN チェック: doublePrecision 列に NaN が渡るとDBエラーになるため 0 に置換
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(payrollData)) {
    sanitized[k] = (typeof v === "number" && isNaN(v)) ? 0 : v;
  }

  try {
    if (existing.length > 0 && existing[0].status !== "confirmed") {
      [payroll] = await db.update(payrollsTable).set({ ...sanitized, status: "draft" }).where(eq(payrollsTable.id, existing[0].id)).returning();
    } else if (existing.length === 0) {
      [payroll] = await db.insert(payrollsTable).values({
        employeeId: Number(employeeId), year: Number(year), month: Number(month), status: "draft", ...sanitized
      }).returning();
    } else {
      payroll = existing[0];
    }
  } catch (dbErr: any) {
    const pgMsg = dbErr?.cause?.message ?? dbErr?.message ?? String(dbErr);
    console.error("[payroll/calculate] DB error:", pgMsg, "\nData:", JSON.stringify(sanitized));
    return res.status(500).json({ error: `給与計算の保存に失敗しました: ${pgMsg}` });
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

/**
 * 随時改定（月変）候補抽出API
 */
router.get("/payroll/gekkei/candidates", async (req, res) => {
  // 固定的賃金変動があった社員を取得
  const targets = await db.select().from(employeesTable)
    .where(eq(employeesTable.fixedPayChangeFlag, true));

  const results = [];

  for (const emp of targets) {
    if (!emp.fixedPayChangeEffectiveMonth) continue;
    const [startYear, startMonth] = emp.fixedPayChangeEffectiveMonth.split("-").map(Number);
    
    // 変動実施月から3ヶ月分の確定済み給与を取得
    // 実際には「変動後最初の給与支払月」から3ヶ月
    const targetMonths = [];
    let currY = startYear;
    let currM = startMonth;
    for (let i = 0; i < 3; i++) {
      targetMonths.push({ year: currY, month: currM });
      currM++;
      if (currM > 12) { currM = 1; currY++; }
    }

    const payrolls = await db.select().from(payrollsTable).where(
      and(
        eq(payrollsTable.employeeId, emp.id),
        eq(payrollsTable.status, "confirmed"),
        and(
          // 簡易的な月範囲指定（実際にはIN句などが望ましい）
          or(
            and(eq(payrollsTable.year, targetMonths[0].year), eq(payrollsTable.month, targetMonths[0].month)),
            and(eq(payrollsTable.year, targetMonths[1].year), eq(payrollsTable.month, targetMonths[1].month)),
            and(eq(payrollsTable.year, targetMonths[2].year), eq(payrollsTable.month, targetMonths[2].month))
          )
        )
      )
    );

    if (payrolls.length < 3) {
      results.push({
        employee: emp,
        status: "monitoring",
        reason: "実績データ不足",
        currentPayrolls: payrolls
      });
      continue;
    }

    // 判定ロジック
    const totalSalary = payrolls.reduce((s, p) => s + p.salaryForStandardRemunerationReview, 0);
    const avgSalary = Math.floor(totalSalary / 3);
    const hasEnoughDays = payrolls.every(p => p.workingDaysForMonthlyChange >= 17);

    if (!hasEnoughDays) {
      results.push({
        employee: emp,
        status: "excluded",
        reason: "支払基礎日数不足 (17日未満の月あり)",
        currentPayrolls: payrolls
      });
      continue;
    }

    // 等級判定（簡易的に、社保額表のamountを使って判定）
    // 本来は等級テーブルを引く必要がある
    const currentStd = emp.standardRemuneration;
    // ... 実際にはここで等級差を計算 ...
    // 今回は簡易的に「2等級以上の差がある」とするフラグや値を返す
    
    results.push({
      employee: emp,
      status: "eligible",
      avgSalary,
      currentStd,
      payrolls,
      // 改定予定月（変動月から4ヶ月目）の算出
      revisionEffectiveMonth: (() => {
        let [y, m] = emp.fixedPayChangeEffectiveMonth.split("-").map(Number);
        m += 3; // 1月変動なら4月
        if (m > 12) { m -= 12; y += 1; }
        return `${y}-${String(m).padStart(2, "0")}`;
      })()
    });
  }

  return res.json(results);
});

/**
 * 随時改定（月変）承認・反映API
 */
router.post("/payroll/gekkei/approve", async (req, res) => {
  const { employeeId, nextStandardRemuneration, revisionEffectiveDate } = req.body;
  const userId = (req.session as any).userId;

  const [updated] = await db.update(employeesTable)
    .set({
      standardRemuneration: nextStandardRemuneration,
      standardRemunerationAppliedFrom: revisionEffectiveDate, // 改定日
      monthlyChangeReviewStatus: "approved",
      fixedPayChangeFlag: false,
      monthlyChangeApprovedAt: new Date(),
      monthlyChangeApprovedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(employeesTable.id, employeeId))
    .returning();

  if (!updated) return res.status(404).json({ error: "Employee not found" });

  return res.json({ success: true, employee: updated });
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
