import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable, companyTable, allowanceDefinitionsTable, employeeAllowancesTable, employeeDeductionsTable, deductionDefinitionsTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { audit } from "../lib/audit";
import { calculatePayroll, calculateBluewingPayroll, roundJapanese, lateNightRateFor } from "../lib/payroll-calculator";
import { ensureMonthItems, getMonthItems, syncMonthItemsWithAttendance } from "../lib/month-items";
import { calculateInsuranceAndTax, EMP_INS_RATE_R8 } from "../lib/tax-tables-reiwa8";
import { absenceDeductionFor, OtsuTableMissingError } from "@workspace/tax-tables-reiwa8/core";
import { loadPayrollContext, commuteExcessOf, payrollWarnings } from "../lib/payroll-context";
import { getEffectiveInsuranceRates, getEffectiveStandardRemuneration, type EffectiveInsuranceRates } from "../lib/insurance-settings";

const router = Router();

// 厚生年金・健康保険の年齢の判定は payroll-core.ts の pensionAppliedFor / healthAppliedFor（lib/payroll-context.ts から呼ぶ）
/**
 * 明細に残す「計算に使った保険の基準」。料率・標準報酬月額は月ごとに履歴から解決するため、
 * どの値で計算したかを payrolls に複写しておく（4つの保存経路すべてで使う）。
 * ※ 子ども・子育て支援金の開始月（旧 isChildcareSupportApplicable: 2026年4月の明細から）は
 *   保険料率マスターの行（2026年4月〜 0.23%、それ以前 0%）に移した。
 */
function appliedInsuranceSnapshot(
  rates: EffectiveInsuranceRates,
  insBase: number,
  careInsuranceApplied: boolean,
) {
  return {
    appliedStandardRemuneration: insBase,
    appliedHealthInsuranceRate: rates.healthInsuranceRate,
    appliedCareInsuranceRate: careInsuranceApplied ? rates.careInsuranceRate : 0,
    appliedChildcareSupportRate: rates.childcareSupportRate,
    appliedPensionRate: rates.pensionRate,
    appliedEmploymentInsuranceRate: rates.employmentInsuranceRate,
  };
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
    useBluewingLogic = false,
  } = req.body;

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });

  const [record] = await db.select().from(monthlyRecordsTable)
    .where(and(
      eq(monthlyRecordsTable.employeeId, employeeId),
      eq(monthlyRecordsTable.year, year),
      eq(monthlyRecordsTable.month, month)
    ));
  if (!record) return res.status(404).json({ error: "該当の月次実績がありません。先に月次実績を入力・保存してください。" });

  // 確定済みの給与明細は再計算で上書きしない（全計算モード共通のガード）。
  const [existingPayrollForGuard] = await db.select().from(payrollsTable)
    .where(and(
      eq(payrollsTable.employeeId, employeeId),
      eq(payrollsTable.year, year),
      eq(payrollsTable.month, month)
    )).limit(1);
  if (existingPayrollForGuard?.status === "confirmed") {
    return res.status(409).json({ error: "確定済みの給与明細は再計算できません。" });
  }

  // 計算モードは、指定が無ければ「その明細が前回どのモードで作られたか」を引き継ぐ。
  // 月次実績入力の「実績を保存」はモードを送らないため、既定の "auto" のままだと
  // 事務所が manual で組み立てた明細が BW/標準の自動計算で上書きされ、
  // 手当ベースの支給額が消えてしまう（実際に 2026-08 の明細が manual → bluewing_auto に
  // 化けていた）。既存が無い新規のときだけ "auto" にフォールバックする。
  //
  // 明細がまだ無い社員は "manual"（月次実績入力の「保存して計算」と同じ方法）で作る。
  // 以前は "auto" だったため、給与明細の「一括計算」で初めて作られた明細だけが自動計算になり、
  // 残業代が「時間外手当」と手当マスターの「早出残業手当」の両方に入って二重になっていた。
  const calculationMode: string =
    req.body.calculationMode ?? existingPayrollForGuard?.calculationMode ?? "manual";

  const companyRows = await db.select().from(companyTable).limit(1);
  const company = (companyRows[0] ?? {
    monthlyAverageWorkHours: 160,
    employmentInsuranceRate: EMP_INS_RATE_R8,
  }) as Partial<typeof companyTable.$inferSelect> & { monthlyAverageWorkHours: number };

  // 日曜・祝日の時給（会社設定。既定 1,655円/h）。2026-08 から日曜出勤は「時間 × この単価」。
  const sundayHourlyRate = company.hourlyWageSunday ?? 1655;

  // 保険料率（健保・介護・子育て支援金・厚年・雇用保険）と標準報酬月額は、
  // マスターの履歴から「この明細の年月」に効く値を使う。
  const insuranceRates = await getEffectiveInsuranceRates(year, month);
  const empInsRate = insuranceRates.employmentInsuranceRate;
  const stdRemuneration = (await getEffectiveStandardRemuneration(emp, year, month)).standardRemuneration;

  // 法令まわりの前提（スイッチ・75歳/70歳・止める印・甲欄乙欄・その月の住民税）。lib/payroll-context.ts
  const ctx = await loadPayrollContext(emp, company, year, month);
  const residentTax = ctx.residentTax;
  const deductionFlags = {
    healthApplied: ctx.healthApplied,
    pensionApplied: ctx.pensionApplied,
    socialInsuranceExempt: ctx.socialInsuranceExempt,
    employmentInsuranceExempt: ctx.employmentInsuranceExempt,
    incomeTaxExempt: ctx.incomeTaxExempt,
    withholding: ctx.withholding,
    rounding: ctx.rules.healthChildcareRounding,
  };

  // 手当・控除は「その月」の内容を使う（lib/month-items.ts）。
  // 以前は月を持たない社員ごとの手当を読んでいたため、ほかの月の作業で書き換わった金額が
  // そのまま計算に入っていた。その月の控えがまだ無ければ、ここで今の内容から作る。
  // 手入力固定では、勤怠で決まる手当（有給・休日出勤・早出残業・深夜）と日給の基本給を、
  // ここでこの月の勤怠から入れ直す（手で直した金額は変えない）。以前は画面だけが計算していたため、
  // 画面を開かずに計算した社員は前の月の金額のままになっていた。
  // 自動計算の2つは残業などを自分で計算するので、従来どおり手当の行はそのまま使う。
  const monthItems = calculationMode === "manual"
    ? await syncMonthItemsWithAttendance(emp, record, company, year, month)
    : await ensureMonthItems(emp, year, month);
  const customAllowances = monthItems.allowances
    .map(a => ({
      allowanceDefinitionId: a.allowanceDefinitionId,
      allowanceName: a.allowanceName,
      isTaxable: a.isTaxable,
      excludeFromEmploymentInsurance: a.excludeFromEmploymentInsurance,
      amount: a.amount,
    }))
    .filter(a => a.amount > 0);

  // 雇用保険の計算基礎から除外する手当合計（携帯代など「雇用保険の対象外」ON の手当）
  const empInsExcludedTotal = customAllowances
    .filter(a => a.excludeFromEmploymentInsurance)
    .reduce((s, a) => s + a.amount, 0);

  // 通勤手当のうち、非課税の上限（マイカー通勤の距離ごとの額）を超えた分は課税にする。
  // 社員マスターで通勤の手段を入れていない人は 0（今までどおり全額非課税）。
  const commuteExcess = commuteExcessOf(emp, customAllowances);

  // 割増の基礎・最低賃金の比較に入れる手当（手当マスターの「割増の基礎に入れる」）
  const premiumDefIds = new Set((await db.select({ id: allowanceDefinitionsTable.id, on: allowanceDefinitionsTable.includeInPremiumBase }).from(allowanceDefinitionsTable)).filter((d) => d.on).map((d) => d.id));
  const includedAllowances = customAllowances.filter((a) => premiumDefIds.has(a.allowanceDefinitionId)).reduce((s, a) => s + a.amount, 0);

  // 積立金・カスタム控除（その月の内容）
  const customDeductionsTotal = monthItems.deductions.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const warningsJson = (extra: string[] = []) => {
    const w = [...payrollWarnings(emp, company, year, month, { includedAllowances, calculationMode }), ...extra];
    return w.length ? JSON.stringify(w) : null;
  };

  // ────────────────────────────────────────────────────────────────
  // 手入力固定モード（calculationMode = "manual"）
  // 月次実績・Bluewing自動計算を使わず、マスター基本給＋手当設定をそのまま使用
  // ────────────────────────────────────────────────────────────────
  if (calculationMode === "manual") {
    // 時給制はマスターの「基本給」欄が時給なので、実働時間を掛けて月の基本給にする。
    // 掛けないと時給そのもの（例 1,500円）が1か月分の基本給として明細に出てしまう。
    // 月給・日給はこれまでどおりマスターの金額をそのまま使う。
    // 日給制の基本給は月ごとに違う（勤怠から計算、または手で直した額）ので、その月の控えを使う。
    // マスターの基本給は「最後に保存した月」の額で、ほかの月には当てはまらない。
    const manualBaseSalary = emp.salaryType === "hourly"
      ? roundJapanese((emp.baseSalary ?? 0) * (record.actualWorkHours ?? 0))
      : emp.salaryType === "daily"
      ? (monthItems.baseSalary ?? emp.baseSalary ?? 0)
      : (emp.baseSalary ?? 0);
    // ⑨ 月給の人の欠勤控除（会社設定のスイッチが ON のときだけ。既定は今までどおり 0）
    const manualAbsenceDeduction = emp.salaryType === "fixed"
      ? absenceDeductionFor(manualBaseSalary, record.absenceDays ?? 0, ctx.rules, ctx.scheduledDaysInMonth)
      : 0;
    const manualCustomAllowancesTotal = customAllowances.reduce((s, a) => s + a.amount, 0);
    const manualNonTaxableTotal = customAllowances.filter(a => !a.isTaxable).reduce((s, a) => s + a.amount, 0);
    const manualTransportation = emp.transportationAllowance ?? 0;
    const manualNonTaxableAllowances = manualTransportation + manualNonTaxableTotal - commuteExcess;

    const manualGrossSalary = roundJapanese(
      manualBaseSalary +
      (emp.transportationAllowance ?? 0) +
      (emp.safetyDrivingAllowance ?? 0) +
      (emp.longDistanceAllowance ?? 0) +
      (emp.positionAllowance ?? 0) +
      (emp.familyAllowance ?? 0) +
      (emp.earlyOvertimeAllowance ?? 0) +
      manualCustomAllowancesTotal -
      manualAbsenceDeduction
    );

    let manualIns;
    try {
      manualIns = calculateInsuranceAndTax({
        standardRemuneration: stdRemuneration,
        grossSalary: manualGrossSalary,
        nonTaxableAllowances: manualNonTaxableAllowances,
        employmentInsuranceExcludedAllowances: empInsExcludedTotal,
        dependentCount: emp.dependentCount ?? 0,
        hasSpouse: emp.hasSpouse ?? false,
        careInsuranceApplied: emp.careInsuranceApplied ?? false,
        employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
        residentTax,
        customDeductionsTotal,
        employmentInsuranceRate: empInsRate,
        employmentInsuranceOverride: monthItems.employmentInsuranceOverride,
        insuranceRates,
        ...deductionFlags,
      });
    } catch (e) {
      if (e instanceof OtsuTableMissingError) return res.status(400).json({ error: `${emp.name}さんは乙欄（扶養控除等申告書なし）ですが、乙欄の税額表が入っていないため計算できません。` });
      throw e;
    }

    const manualSocialInsurance = manualIns.healthInsurance + manualIns.childcareSupportContribution + manualIns.pension;
    const manualChildcare = manualIns.childcareSupportContribution;
    const manualEmpIns = manualIns.employmentInsurance;
    const manualIncomeTax = manualIns.incomeTax;
    const manualResidentTax = residentTax;
    const manualTotalDeductions = roundJapanese(
      manualSocialInsurance + manualEmpIns + manualIncomeTax + manualResidentTax + customDeductionsTotal
      + (emp.otherDeductionMonthly ?? 0) // その他控除（積立金等）: フロント/仕様書に合わせ控除合計へ算入
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
      absenceDeduction: manualAbsenceDeduction,
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
      // 表示用: 「日曜/祝日」列を休日として保存（時間が主、日数は過去データ互換）、土曜日数も保存
      holidayWorkDays: record.sundayWorkDays ?? 0,
      holidayWorkHours: record.sundayWorkHours ?? 0,
      publicHolidayWorkDays: record.holidayWorkDays ?? 0,
      paidLeaveDays: record.paidLeaveDays ?? 0,
      saturdayWorkDays: record.saturdayWorkDays ?? 0,
      useBluewingLogic: false,
      healthInsuranceAmount: manualIns.healthInsurance,
      pensionAmount: manualIns.pension,
      calcWarnings: warningsJson(),
      ...appliedInsuranceSnapshot(insuranceRates, manualIns.insuranceBase, emp.careInsuranceApplied ?? false),
    };

    const existingManual = await db.select().from(payrollsTable)
      .where(and(
        eq(payrollsTable.employeeId, employeeId),
        eq(payrollsTable.year, year),
        eq(payrollsTable.month, month)
      )).limit(1);

    let manualPayroll;
    if (existingManual.length > 0) {
      // 確定済みでない行だけを書き換える（確かめてから書くまでの間に確定されたら、確定を消さない）
      [manualPayroll] = await db.update(payrollsTable).set({
        ...manualPayrollData,
        status: "draft",
        updatedAt: new Date(),
      }).where(and(eq(payrollsTable.id, existingManual[0].id), ne(payrollsTable.status, "confirmed"))).returning();
      if (!manualPayroll) return res.status(409).json({ error: "確定済みの給与明細は再計算できません。" });
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

    // 休日出勤: 「日曜/祝日」は 2026-08 から時間入力（sundayWorkHours × 日曜時給）
    const holidayPay = Math.round(sundayHourlyRate * (record.sundayWorkHours ?? 0));

    // BW深夜手当: 残業単価から素の時給を復元して25%（標準計算と共通の lateNightPremiumPerHour）
    //   例) 2111 → 1689 → 422円/h、4.5h × 422 = 1,899円
    const bwOtUnitPrice = record.overtimeUnitPrice ?? 2111;
    const bwLateNightPay = Math.floor(lateNightRateFor(emp.lateNightHourlyRate, bwOtUnitPrice) * (record.lateNightHours ?? 0));

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
    }, { v2: ctx.rules.bluewingPerformanceV2, over60: ctx.rules.bluewingOver60 });

    const grossSalary = bwResult.grossSalary;

    // 非課税手当合計: 通勤手当 + isTaxable=false のカスタム手当（例: 交通費）
    const bwNonTaxableCustom = customAllowances
      .filter(a => !a.isTaxable)
      .reduce((sum, a) => sum + a.amount, 0);
    const bwNonTaxableAllowances = (emp.transportationAllowance ?? 0) + bwNonTaxableCustom - commuteExcess;

    let bwIns;
    try {
      bwIns = calculateInsuranceAndTax({
        standardRemuneration: stdRemuneration,
        grossSalary,
        nonTaxableAllowances: bwNonTaxableAllowances,
        employmentInsuranceExcludedAllowances: empInsExcludedTotal,
        dependentCount: emp.dependentCount ?? 0,
        hasSpouse: emp.hasSpouse ?? false,
        careInsuranceApplied: emp.careInsuranceApplied ?? false,
        employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
        residentTax,
        customDeductionsTotal,
        employmentInsuranceRate: empInsRate,
        employmentInsuranceOverride: monthItems.employmentInsuranceOverride,
        insuranceRates,
        ...deductionFlags,
      });
    } catch (e) {
      if (e instanceof OtsuTableMissingError) return res.status(400).json({ error: `${emp.name}さんは乙欄（扶養控除等申告書なし）ですが、乙欄の税額表が入っていないため計算できません。` });
      throw e;
    }

    const socialInsurance = bwIns.healthInsurance + bwIns.childcareSupportContribution + bwIns.pension;
    const totalDeductions = roundJapanese(
      socialInsurance + bwIns.employmentInsurance + bwIns.incomeTax + residentTax + customDeductionsTotal
      + (emp.otherDeductionMonthly ?? 0) // その他控除（積立金等）: フロント/仕様書に合わせ控除合計へ算入
    );
    const netSalary = roundJapanese(grossSalary - totalDeductions);

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
      residentTax,
      totalDeductions,
      netSalary,
      workDays: record.workDays ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      lateNightHours: record.lateNightHours ?? 0,
      // 表示用: 「日曜/祝日」列を休日として保存（時間が主、日数は過去データ互換）、土曜日数も保存
      holidayWorkDays: record.sundayWorkDays ?? 0,
      holidayWorkHours: record.sundayWorkHours ?? 0,
      publicHolidayWorkDays: record.holidayWorkDays ?? 0,
      paidLeaveDays: record.paidLeaveDays ?? 0,
      saturdayWorkDays: record.saturdayWorkDays ?? 0,
      useBluewingLogic: true,
      bluewingSalesAmount: record.bluewingSalesAmount,
      bluewingPerformanceAllowance: bwResult.performanceAllowance,
      performanceAllowance: bwResult.performanceAllowance,
      customDeductionsTotal,
      calculationMode: "bluewing_auto",
      healthInsuranceAmount: bwIns.healthInsurance,
      pensionAmount: bwIns.pension,
      calcWarnings: warningsJson(),
      ...appliedInsuranceSnapshot(insuranceRates, bwIns.insuranceBase, emp.careInsuranceApplied ?? false),
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
      }).where(and(eq(payrollsTable.id, existingBw[0].id), ne(payrollsTable.status, "confirmed"))).returning();
      if (!bwPayroll) return res.status(409).json({ error: "確定済みの給与明細は再計算できません。" });
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
  let result;
  try {
    result = calculatePayroll({
      baseSalary: emp.baseSalary,
      salaryType: emp.salaryType,
      dailyRateWeekday: company.dailyWageWeekday ?? 9808,
      dailyRateSaturday: company.dailyWageSaturday ?? 12260,
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
      standardRemuneration: stdRemuneration,
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
      employmentInsuranceRate: empInsRate,
      employmentInsuranceOverride: monthItems.employmentInsuranceOverride,
      insuranceRates,
      residentTax,
      monthlyAverageWorkHours: company.monthlyAverageWorkHours,
      workDays: record.workDays,
      saturdayWorkDays: record.saturdayWorkDays,
      sundayWorkHours: record.sundayWorkHours ?? 0,
      sundayHourlyRate,
      overtimeHours: record.overtimeHours,
      lateNightHours: record.lateNightHours,
      holidayWorkDays: record.holidayWorkDays,
      drivingDistanceKm: record.drivingDistanceKm,
      deliveryCases: record.deliveryCases,
      absenceDays: record.absenceDays,
      actualWorkHours: record.actualWorkHours ?? 0,
      empDailyRateWeekday: emp.dailyRateWeekday ?? 0,
      empDailyRateSaturday: emp.dailyRateSaturday ?? 0,
      empOvertimeHourlyRate: emp.overtimeHourlyRate ?? 0,
      empLateNightHourlyRate: emp.lateNightHourlyRate ?? 0,
      overtimeUnitMinutes: emp.overtimeUnitMinutes ?? null,
      overtimeUnitRate: emp.overtimeUnitRate ?? 0,
      taxExempt: emp.taxExempt ?? false,
      customAllowances: customAllowances.map((a) => a),
      ...deductionFlags,
    });
  } catch (e) {
    if (e instanceof OtsuTableMissingError) return res.status(400).json({ error: `${emp.name}さんは乙欄（扶養控除等申告書なし）ですが、乙欄の税額表が入っていないため計算できません。` });
    throw e;
  }
  // 通勤手当の非課税の上限を超えた分は、標準の自動計算では源泉税に入れていない（manual・BW だけ）。
  // 自動計算は本番では使っていないため、超過があるときは注意として残す。
  const stdExtraWarnings = commuteExcess > 0 ? [`通勤手当のうち ${commuteExcess.toLocaleString("ja-JP")}円 が非課税の上限を超えていますが、自動計算では源泉税に反映していません。`] : [];

  const stdSnapshot = appliedInsuranceSnapshot(
    insuranceRates,
    result.insuranceBase,
    emp.careInsuranceApplied ?? false,
  );

  // カスタム控除（積立金等）を totalDeductions / netSalary に反映
  const stdTotalDeductions = roundJapanese(
    result.totalDeductions + customDeductionsTotal
    + (emp.otherDeductionMonthly ?? 0) // その他控除（積立金等）: フロント/仕様書に合わせ控除合計へ算入
  );
  const stdNetSalary = roundJapanese(result.grossSalary - stdTotalDeductions);

  const stdData = {
    baseSalary: result.baseSalary,
    saturdayPay: result.saturdayPay,
    overtimePay: result.overtimePay,
    lateNightPay: result.lateNightPay,
    // 休日出勤手当の表示行は「休日(holidayWorkDays)＋日曜(sundayWorkDays)」分を合算。
    // grossSalary は不変（エンジンが両者を別々に既に合算済み）。
    holidayPay: (result.holidayPay ?? 0) + (result.sundayPay ?? 0),
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
    // 表示用: 「日曜/祝日」列を休日として保存（時間が主、日数は過去データ互換）、土曜日数も保存
    holidayWorkDays: record.sundayWorkDays,
    holidayWorkHours: record.sundayWorkHours ?? 0,
    publicHolidayWorkDays: record.holidayWorkDays ?? 0,
    paidLeaveDays: record.paidLeaveDays ?? 0,
    saturdayWorkDays: record.saturdayWorkDays,
    workDays: record.workDays,
    customDeductionsTotal,
    calculationMode: "auto",
    healthInsuranceAmount: result.healthInsurance,
    pensionAmount: result.pension,
    calcWarnings: warningsJson(stdExtraWarnings),
    ...stdSnapshot,
  };

  // Upsert payroll（確定済みの行は書き換えない）
  const existing = await db.select().from(payrollsTable)
    .where(and(
      eq(payrollsTable.employeeId, employeeId),
      eq(payrollsTable.year, year),
      eq(payrollsTable.month, month)
    )).limit(1);

  let payroll;
  if (existing.length > 0) {
    [payroll] = await db.update(payrollsTable).set({
      ...stdData,
      status: "draft",
      updatedAt: new Date(),
    }).where(and(eq(payrollsTable.id, existing[0].id), ne(payrollsTable.status, "confirmed"))).returning();
    if (!payroll) return res.status(409).json({ error: "確定済みの給与明細は再計算できません。" });
  } else {
    [payroll] = await db.insert(payrollsTable).values({
      employeeId,
      year,
      month,
      status: "draft",
      ...stdData,
    }).returning();
  }

  return res.json(buildPayrollResponse(payroll!, emp));
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
  if (!row) return res.status(404).json({ error: "給与明細が見つかりません。" });
  return res.json(buildPayrollResponse(row.payroll, row.employee));
});

router.put("/payroll/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  // 確定済みの明細は変えない。以前は確定済みでも手当を書き換えられ、合計は計算し直さなかった。
  // いまの画面はこの経路を使っていない。メモ（notes）だけは確定後も直せるようにしておく。
  const [cur] = await db.select().from(payrollsTable).where(eq(payrollsTable.id, id));
  if (!cur) return res.status(404).json({ error: "給与明細が見つかりません。" });
  const touchesMoney = body.safetyDrivingAllowance !== undefined || body.longDistanceAllowance !== undefined || body.positionAllowance !== undefined;
  if (touchesMoney) {
    return res.status(409).json({ error: "明細の金額はここでは直せません。手当・控除を直して「再計算」してください。" });
  }
  const [updated] = await db.update(payrollsTable).set({
    ...(body.safetyDrivingAllowance !== undefined && { safetyDrivingAllowance: body.safetyDrivingAllowance }),
    ...(body.longDistanceAllowance !== undefined && { longDistanceAllowance: body.longDistanceAllowance }),
    ...(body.positionAllowance !== undefined && { positionAllowance: body.positionAllowance }),
    ...(body.notes !== undefined && { notes: body.notes }),
    updatedAt: new Date(),
  }).where(eq(payrollsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "給与明細が見つかりません。" });
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId));
  return res.json(buildPayrollResponse(updated, emp));
});

router.post("/payroll/:id/confirm", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // 確定する前に、その月の手当・控除の控えを作っておく（確定後は内訳が変わらないようにする）。
  // 月ごとの控えを持つ前に計算した明細は控えが無い。いまの手当・控除の合計が明細の合計と
  // 同じときだけ、その内容を控えにする（違う場合は当時の内訳が分からないので作らない）。
  const [target] = await db.select().from(payrollsTable).where(eq(payrollsTable.id, id));
  if (target) {
    const items = await getMonthItems(target.employeeId, target.year, target.month);
    if (!items.exists) {
      const aSum = items.allowances.filter(a => a.amount > 0).reduce((t, a) => t + a.amount, 0);
      const dSum = items.deductions.reduce((t, d) => t + d.amount, 0);
      const [targetEmp] = await db.select().from(employeesTable).where(eq(employeesTable.id, target.employeeId));
      if (targetEmp && aSum === (target.customAllowancesTotal ?? 0) && dSum === (target.customDeductionsTotal ?? 0)) {
        await ensureMonthItems({ id: targetEmp.id, salaryType: targetEmp.salaryType, baseSalary: target.baseSalary }, target.year, target.month);
      }
    }
  }
  const [updated] = await db.update(payrollsTable)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(payrollsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "給与明細が見つかりません。" });
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId));
  await audit(req, "payroll.confirm", `payroll:${id}`, { employee: emp?.name, year: updated.year, month: updated.month, gross: updated.grossSalary, net: updated.netSalary });
  return res.json(buildPayrollResponse(updated, emp));
});

// 確定解除：確定済みを draft に戻し、再計算・訂正を可能にする
router.post("/payroll/:id/unconfirm", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
  const [updated] = await db.update(payrollsTable)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(payrollsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "給与明細が見つかりません。" });
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId));
  await audit(req, "payroll.unconfirm", `payroll:${id}`, { employee: emp?.name, year: updated.year, month: updated.month, gross: updated.grossSalary, net: updated.netSalary, reason });
  return res.json(buildPayrollResponse(updated, emp));
});

// ── 月まとめの CSV（給与明細の「CSV出力」）──────────────────────────────
// 以前は画面が /payrolls/export/csv を呼んでいたのに、サーバーにその入口が無く、エラーの中身が
// CSV として落ちていた。表計算ソフトで開けるよう BOM 付き UTF-8・値は引用符で囲む。
router.get("/payrolls/export/csv", async (req, res) => {
  const year = parseInt(String(req.query.year), 10);
  const month = parseInt(String(req.query.month), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "年と月を指定してください" });
  }
  const rows = await db.select({ payroll: payrollsTable, employee: employeesTable })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)))
    .orderBy(employeesTable.employeeCode);
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // 先頭が = + - @ の文字は表計算ソフトが式として動かすので、頭に ' を付ける
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ["社員番号", "氏名", "年月", "状態", "基本給", "土曜出勤手当", "時間外手当", "深夜手当", "休日手当", "歩合給", "通勤手当", "その他の手当合計", "欠勤控除", "総支給額",
    "社会保険料（健保・子育て支援金・厚年）", "うち子ども・子育て支援金", "雇用保険料", "源泉所得税", "住民税", "その他の控除合計", "控除合計", "差引支給額",
    "出勤日数", "土曜出勤日数", "日曜出勤時間", "祝日出勤日数", "残業時間", "深夜時間", "有給日数"];
  const lines = [head.map(q).join(",")];
  for (const { payroll: p, employee: e } of rows) {
    lines.push([e.employeeCode, e.name, `${p.year}年${p.month}月`, p.status === "confirmed" ? "確定" : "未確定",
      p.baseSalary, p.saturdayPay ?? 0, p.overtimePay, p.lateNightPay, p.holidayPay, p.commissionPay, p.transportationAllowance,
      p.customAllowancesTotal ?? 0, p.absenceDeduction, p.grossSalary,
      p.socialInsurance, p.childcareSupportContribution ?? 0, p.employmentInsurance, p.incomeTax, p.residentTax, p.customDeductionsTotal ?? 0, p.totalDeductions, p.netSalary,
      p.workDays, p.saturdayWorkDays ?? 0, p.holidayWorkHours ?? 0, p.publicHolidayWorkDays ?? 0, p.overtimeHours, p.lateNightHours, p.paidLeaveDays ?? 0].map(q).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="payroll_${year}${String(month).padStart(2, "0")}.csv"`);
  return res.send("\uFEFF" + lines.join("\r\n"));
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
  if (!row) return res.status(404).json({ error: "給与明細が見つかりません。" });

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
    ["社会保険料（健保・子育て支援金・厚年）", p.socialInsurance].join(","),
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
  return res.send("\uFEFF" + lines.map((l) => (Array.isArray(l) ? l : [l]).join("")).map((l) => l.split(",").map((c) => (c === "" ? "" : `"${c.replace(/"/g, '""')}"`)).join(",")).join("\r\n"));
});

export default router;
