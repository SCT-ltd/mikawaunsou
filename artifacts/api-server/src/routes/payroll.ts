import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable, companyTable, allowanceDefinitionsTable, employeeAllowancesTable, employeeDeductionsTable, deductionDefinitionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { calculatePayroll, calculateMikawaPayroll, calculateBluewingPayroll, roundJapanese } from "../lib/payroll-calculator";
import { calculateInsuranceAndTax, calculateIncomeTaxReiwa7, calculateIncomeTaxReiwa8, EMP_INS_RATE_R8 } from "../lib/tax-tables-reiwa8";

const router = Router();

/**
 * 厚生年金適用判定
 * - emp.pensionApplied が null の場合: 生年月日から計算月時点の年齢を算出し、70歳以上なら false
 * - emp.pensionApplied が true/false の場合: その値をそのまま使用（手動オーバーライド）
 */
/**
 * 子ども・子育て支援金の徴収開始月。
 * 三川運送の方針：
 *   2026年4月給料明細（= 3月分の労働）から徴収開始。
 *   - year > 2026                       → 徴収
 *   - year === 2026 && month >= 4       → 徴収
 *   - それ以前                          → 0
 */
function isChildcareSupportApplicable(year: number, month: number): boolean {
  if (year > 2026) return true;
  if (year === 2026 && month >= 4) return true;
  return false;
}

function resolvePensionApplied(emp: typeof employeesTable.$inferSelect, year: number, month: number): boolean {
  if (emp.pensionApplied !== null && emp.pensionApplied !== undefined) {
    return emp.pensionApplied;
  }
  if (!emp.dateOfBirth) return true;
  const dob = new Date(emp.dateOfBirth);
  // 計算月の1日時点での年齢を算出
  const calcDate = new Date(year, month - 1, 1);
  let age = calcDate.getFullYear() - dob.getFullYear();
  const monthDiff = calcDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && calcDate.getDate() < dob.getDate())) age--;
  return age < 70;
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

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return res.status(400).json({ error: "year と month のクエリパラメータが必要です（例: ?year=2026&month=3）" });
  }

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
    useMikawaLogic = false,
    useBluewingLogic = false,
    calculationMode = "auto",
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
    employmentInsuranceRate: EMP_INS_RATE_R8,
  };

  // 雇用保険率：会社設定優先、なければ令和8年度デフォルト 0.5%
  const empInsRate = (company.employmentInsuranceRate ?? 0) > 0
    ? company.employmentInsuranceRate
    : EMP_INS_RATE_R8;

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

  // 積立金・カスタム控除を取得
  const empDeductionRows = await db.select().from(employeeDeductionsTable)
    .where(eq(employeeDeductionsTable.employeeId, employeeId));
  const customDeductionsTotal = empDeductionRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  // ────────────────────────────────────────────────────────────────
  // 手入力固定モード（calculationMode = "manual"）
  // 月次実績・Bluewing自動計算を使わず、マスター基本給＋手当設定をそのまま使用
  // ────────────────────────────────────────────────────────────────
  if (calculationMode === "manual") {
    const manualBaseSalary = emp.baseSalary ?? 0;
    const manualCustomAllowancesTotal = customAllowances.reduce((s, a) => s + a.amount, 0);
    const manualNonTaxableTotal = customAllowances.filter(a => !a.isTaxable).reduce((s, a) => s + a.amount, 0);
    const manualTransportation = emp.transportationAllowance ?? 0;
    const manualNonTaxableAllowances = manualTransportation + manualNonTaxableTotal;

    const manualGrossSalary = roundJapanese(
      manualBaseSalary +
      (emp.transportationAllowance ?? 0) +
      (emp.safetyDrivingAllowance ?? 0) +
      (emp.longDistanceAllowance ?? 0) +
      (emp.positionAllowance ?? 0) +
      (emp.familyAllowance ?? 0) +
      (emp.earlyOvertimeAllowance ?? 0) +
      manualCustomAllowancesTotal
    );

    const manualInsBase = (emp.standardRemuneration ?? 0) > 0 ? emp.standardRemuneration : manualGrossSalary;

    const manualIns = calculateInsuranceAndTax({
      standardRemuneration: manualInsBase,
      grossSalary: manualGrossSalary,
      nonTaxableAllowances: manualNonTaxableAllowances,
      dependentCount: emp.dependentCount ?? 0,
      hasSpouse: emp.hasSpouse ?? false,
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      pensionApplied: resolvePensionApplied(emp, year, month),
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
      residentTax: emp.residentTax ?? 0,
      customDeductionsTotal,
      employmentInsuranceRate: empInsRate,
    });

    if (!isChildcareSupportApplicable(year, month)) manualIns.childcareSupportContribution = 0;
    const isManualExempt = emp.taxExempt === true;
    const manualSocialInsurance = isManualExempt ? 0 : (manualIns.healthInsurance + manualIns.childcareSupportContribution + manualIns.pension);
    const manualChildcare = isManualExempt ? 0 : manualIns.childcareSupportContribution;
    const manualEmpIns = isManualExempt ? 0 : manualIns.employmentInsurance;
    const manualIncomeTax = isManualExempt ? 0 : manualIns.incomeTax;
    const manualResidentTax = emp.residentTax ?? 0;
    const manualTotalDeductions = roundJapanese(
      manualSocialInsurance + manualEmpIns + manualIncomeTax + manualResidentTax + customDeductionsTotal
    );
    const manualNetSalary = roundJapanese(manualGrossSalary - manualTotalDeductions);

    const manualPayrollData = {
      baseSalary: manualBaseSalary,
      saturdayPay: 0,
      overtimePay: 0,
      lateNightPay: 0,
      holidayPay: 0,
      commissionPay: 0,
      transportationAllowance: emp.transportationAllowance ?? 0,
      safetyDrivingAllowance: emp.safetyDrivingAllowance ?? 0,
      longDistanceAllowance: emp.longDistanceAllowance ?? 0,
      positionAllowance: emp.positionAllowance ?? 0,
      familyAllowance: emp.familyAllowance ?? 0,
      earlyOvertimeAllowance: emp.earlyOvertimeAllowance ?? 0,
      customAllowancesTotal: manualCustomAllowancesTotal,
      absenceDeduction: 0,
      grossSalary: manualGrossSalary,
      socialInsurance: manualSocialInsurance,
      childcareSupportContribution: manualChildcare,
      employmentInsurance: manualEmpIns,
      incomeTax: manualIncomeTax,
      residentTax: manualResidentTax,
      totalDeductions: manualTotalDeductions,
      netSalary: manualNetSalary,
      customDeductionsTotal,
      calculationMode: "manual",
      workDays: record.workDays ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      lateNightHours: record.lateNightHours ?? 0,
      holidayWorkDays: record.holidayWorkDays ?? 0,
      useBluewingLogic: false,
      useMikawaLogic: false,
    };

    const existingManual = await db.select().from(payrollsTable)
      .where(and(
        eq(payrollsTable.employeeId, employeeId),
        eq(payrollsTable.year, year),
        eq(payrollsTable.month, month)
      )).limit(1);

    let manualPayroll;
    if (existingManual.length > 0) {
      [manualPayroll] = await db.update(payrollsTable).set({
        ...manualPayrollData,
        status: "draft",
        updatedAt: new Date(),
      }).where(eq(payrollsTable.id, existingManual[0].id)).returning();
    } else {
      [manualPayroll] = await db.insert(payrollsTable).values({
        employeeId,
        year,
        month,
        status: "draft",
        ...manualPayrollData,
      }).returning();
    }

    return res.json(buildPayrollResponse(manualPayroll!, emp));
  }

  // ────────────────────────────────────────────────────────────────
  // 三川ロジック分岐
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

    const grossSalary = mikawaResult.finalSalary;
    const insBase = (emp.standardRemuneration ?? 0) > 0 ? emp.standardRemuneration : grossSalary;

    // 非課税手当合計: 通勤手当 + isTaxable=false のカスタム手当
    const mikawanonTaxableCustom = customAllowances
      .filter(a => !a.isTaxable)
      .reduce((sum, a) => sum + a.amount, 0);
    const mikawaNonTaxableAllowances = (emp.transportationAllowance ?? 0) + mikawanonTaxableCustom;

    const ins = calculateInsuranceAndTax({
      standardRemuneration: insBase,
      grossSalary,
      nonTaxableAllowances: mikawaNonTaxableAllowances,
      dependentCount: emp.dependentCount ?? 0,
      hasSpouse: emp.hasSpouse ?? false,
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      pensionApplied: resolvePensionApplied(emp, year, month),
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
      residentTax: emp.residentTax ?? 0,
      customDeductionsTotal,
      employmentInsuranceRate: empInsRate,
    });

    if (!isChildcareSupportApplicable(year, month)) ins.childcareSupportContribution = 0;
    const socialInsurance = ins.healthInsurance + ins.childcareSupportContribution + ins.pension;
    const totalDeductions = roundJapanese(
      socialInsurance + ins.employmentInsurance + ins.incomeTax + (emp.residentTax ?? 0) + customDeductionsTotal
    );
    const netSalary = roundJapanese(grossSalary - totalDeductions);

    const mikawaPayrollData = {
      baseSalary: mikawaResult.minimumSalary,
      saturdayPay: 0,
      commissionPay: mikawaResult.salesSalary,
      overtimePay: mikawaResult.overtimePay,
      lateNightPay: 0,
      holidayPay: 0,
      transportationAllowance: emp.transportationAllowance ?? 0,
      safetyDrivingAllowance: emp.safetyDrivingAllowance ?? 0,
      longDistanceAllowance: emp.longDistanceAllowance ?? 0,
      positionAllowance: emp.positionAllowance ?? 0,
      familyAllowance: emp.familyAllowance ?? 0,
      earlyOvertimeAllowance: emp.earlyOvertimeAllowance ?? 0,
      customAllowancesTotal: 0,
      absenceDeduction: 0,
      grossSalary,
      socialInsurance,
      childcareSupportContribution: ins.childcareSupportContribution,
      employmentInsurance: ins.employmentInsurance,
      incomeTax: ins.incomeTax,
      residentTax: emp.residentTax ?? 0,
      totalDeductions,
      netSalary,
      workDays: record.workDays,
      overtimeHours: record.overtimeHours,
      lateNightHours: 0,
      holidayWorkDays: 0,
      useMikawaLogic: true,
      salesAmount: record.salesAmount,
      commissionRate: record.commissionRate,
      performanceAllowance: mikawaResult.performanceAllowance,
      customDeductionsTotal,
      calculationMode: "mikawa_auto",
    };

    const existingMikawa = await db.select().from(payrollsTable)
      .where(and(
        eq(payrollsTable.employeeId, employeeId),
        eq(payrollsTable.year, year),
        eq(payrollsTable.month, month)
      )).limit(1);

    let mikawaPayroll;
    if (existingMikawa.length > 0) {
      [mikawaPayroll] = await db.update(payrollsTable).set({
        ...mikawaPayrollData,
        status: "draft",
        updatedAt: new Date(),
      }).where(eq(payrollsTable.id, existingMikawa[0].id)).returning();
    } else {
      [mikawaPayroll] = await db.insert(payrollsTable).values({
        employeeId,
        year,
        month,
        status: "draft",
        ...mikawaPayrollData,
      }).returning();
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

    const dailyWage    = company.dailyWageWeekday ?? 9808;
    const dailySaturday = company.dailyWageSaturday ?? 12260;
    // 基本給は平日分のみ。土曜分は saturdayPay として別出し（grossSalary には saturdayPay として加算）
    const baseSalaryCalc = Math.floor((record.workDays ?? 0) * dailyWage);
    const saturdayPay = Math.floor((record.saturdayWorkDays ?? 0) * dailySaturday);

    const masterFixedAllowances =
      (emp.transportationAllowance ?? 0) +
      (emp.safetyDrivingAllowance ?? 0) +
      (emp.longDistanceAllowance ?? 0) +
      (emp.positionAllowance ?? 0) +
      (emp.familyAllowance ?? 0) +
      (emp.earlyOvertimeAllowance ?? 0);
    const customAllowancesFixedTotal = customAllowances.reduce((s, a) => s + a.amount, 0);
    const fixedAllowancesTotal = masterFixedAllowances + customAllowancesFixedTotal;

    const holidayPay = Math.floor((company.dailyWageSaturday ?? 12260) * (record.holidayWorkDays ?? 0));

    const hourlyRate = dailyWage / 8;
    const bwLateNightPay = roundJapanese(hourlyRate * 0.25 * (record.lateNightHours ?? 0));

    const bwResult = calculateBluewingPayroll({
      bluewingSalesAmount: record.bluewingSalesAmount,
      commissionRate: emp.bluewingCommissionRate > 0 ? emp.bluewingCommissionRate : 0,
      fixedOvertimeHours: emp.bluewingFixedOvertimeHours ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      overtimeUnitPrice: record.overtimeUnitPrice ?? 2111,
      // BW業績計算上は土曜分も基礎賃金に含めるため saturdayPay を加算して渡す
      baseSalary: baseSalaryCalc + saturdayPay,
      fixedAllowancesTotal,
      holidayPay,
      fixedOvertimeAmount: emp.bluewingFixedOvertimeAmount ?? 0,
      lateNightPay: bwLateNightPay,
    });

    const grossSalary = bwResult.grossSalary;
    const bwInsBase = (emp.standardRemuneration ?? 0) > 0 ? emp.standardRemuneration : grossSalary;

    const isBwTamagawa = emp.name?.includes("玉川");
    // 非課税手当合計: 通勤手当 + isTaxable=false のカスタム手当（例: 交通費）
    const bwNonTaxableCustom = customAllowances
      .filter(a => !a.isTaxable)
      .reduce((sum, a) => sum + a.amount, 0);
    const bwNonTaxableAllowances = (emp.transportationAllowance ?? 0) + bwNonTaxableCustom;

    const bwIns = calculateInsuranceAndTax({
      standardRemuneration: bwInsBase,
      grossSalary,
      nonTaxableAllowances: bwNonTaxableAllowances,
      dependentCount: emp.dependentCount ?? 0,
      hasSpouse: emp.hasSpouse ?? false,
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      pensionApplied: resolvePensionApplied(emp, year, month),
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
      residentTax: emp.residentTax ?? 0,
      customDeductionsTotal,
      employmentInsuranceRate: empInsRate,
      enableTrace: isBwTamagawa,
      traceExpectedIncomeTax: isBwTamagawa ? 10220 : undefined,
    });

    if (!isChildcareSupportApplicable(year, month)) bwIns.childcareSupportContribution = 0;
    const socialInsurance = bwIns.healthInsurance + bwIns.childcareSupportContribution + bwIns.pension;
    const totalDeductions = roundJapanese(
      socialInsurance + bwIns.employmentInsurance + bwIns.incomeTax + (emp.residentTax ?? 0) + customDeductionsTotal
    );
    const netSalary = roundJapanese(grossSalary - totalDeductions);

    // ── 玉川さん専用 デバッグログ ─────────────────────────────────
    if (isBwTamagawa) {
      // 支給項目一覧
      const payItems = [
        { name: "日給（出勤日分）",       amount: baseSalaryCalc,                isTaxable: true,  includedInGross: true,  source: "workDays×dailyWageWeekday" },
        { name: "土曜出勤（出勤日分）",    amount: Math.floor((record.saturdayWorkDays ?? 0) * dailySaturday), isTaxable: true, includedInGross: true, source: "saturdayWorkDays×dailyWageSaturday" },
        { name: "BW固定残業手当",         amount: emp.bluewingFixedOvertimeAmount ?? 0, isTaxable: true, includedInGross: true, source: "bluewingFixedOvertimeAmount" },
        { name: "休日出勤手当（日給計算）", amount: holidayPay,                    isTaxable: true,  includedInGross: true,  source: "holidayWorkDays×dailyWageSaturday" },
        { name: "時間外手当（実績）",       amount: bwResult.actualOvertimePay,    isTaxable: true,  includedInGross: true,  source: "actualOvertimeHours×overtimeUnitPrice" },
        { name: "深夜手当",               amount: bwLateNightPay,               isTaxable: true,  includedInGross: true,  source: "lateNightHours×hourlyRate×0.25" },
        { name: "BW業績手当",             amount: bwResult.performanceAllowance, isTaxable: true,  includedInGross: true,  source: `floor(${record.bluewingSalesAmount}×${emp.bluewingCommissionRate})-baseTotal→round1000` },
        ...customAllowances.map(a => ({
          name: a.allowanceName,
          amount: a.amount,
          isTaxable: a.isTaxable,
          includedInGross: true,
          source: "employeeAllowances（固定設定）",
        })),
      ].filter(i => i.amount !== 0);

      // nonTaxAllowancesTotal: 通勤手当 + isTaxable=false カスタム手当（交通費等）
      const nonTaxAllowancesTotal = bwNonTaxableAllowances;
      const taxableAllowancesTotal = fixedAllowancesTotal + bwResult.performanceAllowance - nonTaxAllowancesTotal;

      console.log("[TAMAGAWA_PAY_ITEMS_DETAIL]", {
        employeeId: emp.id,
        employeeName: emp.name,
        year,
        month,
        calculationType: "Bluewing",
        isBluewing: true,
        payItems,
        baseSalary: baseSalaryCalc,
        fixedAllowancesTotal,
        bwPerformanceAllowance: bwResult.performanceAllowance,
        bwTargetAmount: bwResult.targetAmount,
        bwBaseTotal: bwResult.baseTotal,
        nonTaxableAllowancesTotal: nonTaxAllowancesTotal,
        taxableAllowancesTotal,
        grossSalary,
      });

      // 雇用保険詳細
      const rawEmpIns = grossSalary * empInsRate;
      console.log("[TAMAGAWA_EMPLOYMENT_INSURANCE_DETAIL]", {
        grossSalary,
        employmentInsuranceRate: empInsRate,
        employmentInsuranceRaw: rawEmpIns,
        employmentInsuranceRounded: bwIns.employmentInsurance,
        companySettingsEmploymentInsuranceRate: company.employmentInsuranceRate,
        employeeEmploymentInsuranceApplied: emp.employmentInsuranceApplied,
      });

      // 所得税差異分析（非課税手当を正しく反映）
      const taxableSalaryExcludingChildcareSupport = grossSalary
        - bwNonTaxableAllowances
        - bwIns.healthInsurance
        - bwIns.pension
        - bwIns.employmentInsurance;
      const taxableSalaryIncludingChildcareSupport = taxableSalaryExcludingChildcareSupport
        - bwIns.childcareSupportContribution;
      const depEquivCount = (emp.dependentCount ?? 0) + ((emp.hasSpouse ?? false) ? 1 : 0);

      // R7/R8 × A(子育て支援金なし)/B(子育て支援金あり) の4パターン
      const taxR7A = calculateIncomeTaxReiwa7(taxableSalaryExcludingChildcareSupport, depEquivCount);
      const taxR7B = calculateIncomeTaxReiwa7(taxableSalaryIncludingChildcareSupport, depEquivCount);
      const taxR8A = calculateIncomeTaxReiwa8(taxableSalaryExcludingChildcareSupport, depEquivCount);
      const taxR8B = calculateIncomeTaxReiwa8(taxableSalaryIncludingChildcareSupport, depEquivCount);

      console.log("[TAMAGAWA_INCOME_TAX_DIFF_ANALYSIS]", {
        grossSalary,
        nonTaxableAllowances: bwNonTaxableAllowances,
        nonTaxableBreakdown: {
          transportationAllowance: emp.transportationAllowance ?? 0,
          nonTaxableCustomAllowances: bwNonTaxableCustom,
          customNonTaxableItems: customAllowances.filter(a => !a.isTaxable).map(a => ({ name: a.allowanceName, amount: a.amount })),
        },
        healthInsurance: bwIns.healthInsurance,
        pension: bwIns.pension,
        employmentInsurance: bwIns.employmentInsurance,
        childcareSupportContribution: bwIns.childcareSupportContribution,
        taxableSalaryExcludingChildcareSupport,
        taxableSalaryIncludingChildcareSupport,
        dependentCount: emp.dependentCount ?? 0,
        hasSpouse: emp.hasSpouse ?? false,
        dependentEquivalentCount: depEquivCount,
        incomeTaxTableYear: "R8（令和8年分公式月額表・甲欄）",
        incomeTaxTableType: "甲欄",
        incomeTaxAfterInsuranceSalary: bwIns.afterInsuranceSalary,
        matchedIncomeTaxBracket: bwIns.afterInsuranceSalary,
        calculatedIncomeTax: bwIns.incomeTax,
        expectedIncomeTax: 10220,
        isMatch: bwIns.incomeTax === 10220,
      });

      console.log("[TAMAGAWA_INCOME_TAX_TABLE_COMPARISON]", {
        "A_taxableSalary（子育て支援金なし）": taxableSalaryExcludingChildcareSupport,
        "B_taxableSalary（子育て支援金あり）": taxableSalaryIncludingChildcareSupport,
        dependentEquivalentCount: depEquivCount,
        "R7_A（子育て支援金なし）": taxR7A,
        "R7_B（子育て支援金あり）": taxR7B,
        "R8_A（子育て支援金なし）": taxR8A,
        "R8_B（子育て支援金あり）": taxR8B,
        clientOfficialTax: 10220,
      });

      const rawEmpInsFinal = grossSalary * empInsRate;
      console.log("[TAMAGAWA_EMPLOYMENT_INSURANCE_FINAL_CHECK]", {
        employeeName: emp.name,
        grossSalary,
        companySettingsEmploymentInsuranceRate: company.employmentInsuranceRate,
        employmentInsuranceRateUsed: empInsRate,
        rawEmploymentInsurance: rawEmpInsFinal,
        roundedEmploymentInsurance: bwIns.employmentInsurance,
        expectedEmploymentInsurance: 2414,
      });

      console.log("[TAMAGAWA_DEPENDENT_FINAL_CHECK]", {
        employeeName: emp.name,
        dependentCount: emp.dependentCount ?? 0,
        hasSpouse: emp.hasSpouse ?? false,
        dependentEquivalentCount: depEquivCount,
        expectedDependentEquivalentCount: 1,
      });
    }
    // ─────────────────────────────────────────────────────────────

    const bwPayrollData = {
      baseSalary: baseSalaryCalc,
      saturdayPay,
      commissionPay: 0,
      overtimePay: bwResult.actualOvertimePay,
      lateNightPay: bwLateNightPay,
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
      childcareSupportContribution: bwIns.childcareSupportContribution,
      employmentInsurance: bwIns.employmentInsurance,
      incomeTax: bwIns.incomeTax,
      residentTax: emp.residentTax ?? 0,
      totalDeductions,
      netSalary,
      workDays: record.workDays ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      lateNightHours: record.lateNightHours ?? 0,
      holidayWorkDays: record.holidayWorkDays ?? 0,
      useBluewingLogic: true,
      bluewingSalesAmount: record.bluewingSalesAmount,
      bluewingPerformanceAllowance: bwResult.performanceAllowance,
      performanceAllowance: bwResult.performanceAllowance,
      customDeductionsTotal,
      calculationMode: "bluewing_auto",
    };

    const existingBw = await db.select().from(payrollsTable)
      .where(and(
        eq(payrollsTable.employeeId, employeeId),
        eq(payrollsTable.year, year),
        eq(payrollsTable.month, month)
      )).limit(1);

    let bwPayroll;
    if (existingBw.length > 0) {
      [bwPayroll] = await db.update(payrollsTable).set({
        ...bwPayrollData,
        status: "draft",
        updatedAt: new Date(),
      }).where(eq(payrollsTable.id, existingBw[0].id)).returning();
    } else {
      [bwPayroll] = await db.insert(payrollsTable).values({
        employeeId,
        year,
        month,
        status: "draft",
        ...bwPayrollData,
      }).returning();
    }

    return res.json(buildPayrollResponse(bwPayroll!, emp));
  }

  // ────────────────────────────────────────────────────────────────
  // 標準ロジック
  // ────────────────────────────────────────────────────────────────
  const isTamagawa = emp.name?.includes("玉川");
  const result = calculatePayroll({
    baseSalary: emp.baseSalary,
    salaryType: emp.salaryType,
    dailyRateWeekday: company.dailyWageWeekday,
    dailyRateSaturday: company.dailyWageSaturday,
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
    standardRemuneration: emp.standardRemuneration ?? 0,
    careInsuranceApplied: emp.careInsuranceApplied ?? false,
    employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
    pensionApplied: resolvePensionApplied(emp, year, month),
    employmentInsuranceRate: empInsRate,
    residentTax: emp.residentTax,
    monthlyAverageWorkHours: company.monthlyAverageWorkHours,
    workDays: record.workDays,
    saturdayWorkDays: record.saturdayWorkDays,
    sundayWorkDays: record.sundayWorkDays,
    overtimeHours: record.overtimeHours,
    lateNightHours: record.lateNightHours,
    holidayWorkDays: record.holidayWorkDays,
    drivingDistanceKm: record.drivingDistanceKm,
    deliveryCases: record.deliveryCases,
    absenceDays: record.absenceDays,
    actualWorkHours: record.actualWorkHours ?? 0,
    dailyRateOverride: emp.dailyRateOverride ?? 0,
    empDailyRateWeekday: emp.dailyRateWeekday ?? 0,
    empDailyRateSaturday: emp.dailyRateSaturday ?? 0,
    empOvertimeHourlyRate: emp.overtimeHourlyRate ?? 0,
    overtimeUnitMinutes: emp.overtimeUnitMinutes ?? null,
    overtimeUnitRate: emp.overtimeUnitRate ?? 0,
    taxExempt: emp.taxExempt ?? false,
    customAllowances,
    enableTrace: isTamagawa,
    traceExpectedIncomeTax: isTamagawa ? 10220 : undefined,
  });

  // 子育て支援金：2026年5月以前は0にする
  if (!isChildcareSupportApplicable(year, month)) {
    const csc = result.childcareSupportContribution;
    result.childcareSupportContribution = 0;
    result.socialInsurance -= csc;
    result.totalDeductions -= csc;
    result.netSalary += csc;
  }

  // カスタム控除（積立金等）を totalDeductions / netSalary に反映
  const stdTotalDeductions = roundJapanese(result.totalDeductions + customDeductionsTotal);
  const stdNetSalary = roundJapanese(result.grossSalary - stdTotalDeductions);

  // Upsert payroll
  const existing = await db.select().from(payrollsTable)
    .where(and(
      eq(payrollsTable.employeeId, employeeId),
      eq(payrollsTable.year, year),
      eq(payrollsTable.month, month)
    )).limit(1);

  let payroll;
  if (existing.length > 0) {
    [payroll] = await db.update(payrollsTable).set({
      baseSalary: result.baseSalary,
      saturdayPay: result.saturdayPay,
      overtimePay: result.overtimePay,
      lateNightPay: result.lateNightPay,
      holidayPay: result.holidayPay,
      commissionPay: result.commissionPay,
      transportationAllowance: result.transportationAllowance,
      safetyDrivingAllowance: result.safetyDrivingAllowance,
      longDistanceAllowance: result.longDistanceAllowance,
      positionAllowance: result.positionAllowance,
      familyAllowance: result.familyAllowance,
      earlyOvertimeAllowance: result.earlyOvertimeAllowance,
      customAllowancesTotal: result.customAllowancesTotal,
      absenceDeduction: result.absenceDeduction,
      grossSalary: result.grossSalary,
      socialInsurance: result.socialInsurance,
      childcareSupportContribution: result.childcareSupportContribution,
      employmentInsurance: result.employmentInsurance,
      incomeTax: result.incomeTax,
      residentTax: result.residentTax,
      totalDeductions: stdTotalDeductions,
      netSalary: stdNetSalary,
      overtimeHours: record.overtimeHours,
      lateNightHours: record.lateNightHours,
      holidayWorkDays: record.holidayWorkDays,
      workDays: record.workDays,
      customDeductionsTotal,
      calculationMode: "auto",
      status: "draft",
      updatedAt: new Date(),
    }).where(eq(payrollsTable.id, existing[0].id)).returning();
  } else {
    [payroll] = await db.insert(payrollsTable).values({
      employeeId,
      year,
      month,
      status: "draft",
      baseSalary: result.baseSalary,
      saturdayPay: result.saturdayPay,
      overtimePay: result.overtimePay,
      lateNightPay: result.lateNightPay,
      holidayPay: result.holidayPay,
      commissionPay: result.commissionPay,
      transportationAllowance: result.transportationAllowance,
      safetyDrivingAllowance: result.safetyDrivingAllowance,
      longDistanceAllowance: result.longDistanceAllowance,
      positionAllowance: result.positionAllowance,
      familyAllowance: result.familyAllowance,
      earlyOvertimeAllowance: result.earlyOvertimeAllowance,
      customAllowancesTotal: result.customAllowancesTotal,
      absenceDeduction: result.absenceDeduction,
      grossSalary: result.grossSalary,
      socialInsurance: result.socialInsurance,
      childcareSupportContribution: result.childcareSupportContribution,
      employmentInsurance: result.employmentInsurance,
      incomeTax: result.incomeTax,
      residentTax: result.residentTax,
      totalDeductions: stdTotalDeductions,
      netSalary: stdNetSalary,
      overtimeHours: record.overtimeHours,
      lateNightHours: record.lateNightHours,
      holidayWorkDays: record.holidayWorkDays,
      workDays: record.workDays,
      customDeductionsTotal,
      calculationMode: "auto",
    }).returning();
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
    ["土曜出勤手当", (p as Record<string, unknown>).saturdayPay ?? 0].join(","),
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
    ["健康保険料（子育て支援金含む）", p.socialInsurance].join(","),
    ["  うち子ども・子育て支援金", p.childcareSupportContribution ?? 0].join(","),
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
