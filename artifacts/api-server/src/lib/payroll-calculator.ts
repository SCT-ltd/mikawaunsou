/**
 * 給与計算エンジン（運送業特化）
 * Transportation industry payroll calculation engine
 */

/**
 * 源泉所得税（月額表）ルックアップ
 * Based on 国税庁 給与所得の源泉徴収税額表（月額表）甲欄
 * 
 * Tax brackets are applied on: taxableMonthlyIncome = grossSalary - socialInsurance - employmentInsurance
 * Then dependentCount determines which bracket column applies.
 */

interface TaxBracket {
  min: number;
  max: number;
  // tax per dependent count [0, 1, 2, 3, 4, 5, 6, 7+]
  // Using simplified formula approach for correctness
  baseRate: number;      // 基本税率
  baseDeduction: number; // 定額控除
}

/**
 * 源泉所得税計算（月額表甲欄）
 * 国税庁 令和6年分 給与所得の源泉徴収税額表（月額表）に準拠
 *
 * 計算方法:
 *   1. 社会保険料等控除後の給与等の月額 X に対して税率・定額を適用 → tax_0（扶養0人分）
 *   2. 扶養親族等1人につき 3,750円を減算
 *   3. 復興特別所得税（×1.021）を乗算
 *
 * 参考: 月額表甲欄の実態を回帰分析した速算式
 *   税額(0扶養) = X × 税率 - 定額
 *   税額(B扶養) = max(0, tax_0 - B × 3,750) × 1.021
 */
export function calculateIncomeTax(
  afterInsuranceSalary: number,
  dependentCount: number
): number {
  const X = afterInsuranceSalary;

  // 扶養0人の税額（復興税前）を月額表の速算式で計算
  let tax0: number;

  if (X < 88_000) {
    tax0 = 0;
  } else if (X < 257_700) {
    // 5%帯 (88,000 ≤ X < 257,700)
    tax0 = X * 0.05 - 4_273;
  } else if (X < 429_460) {
    // 10%帯 (257,700 ≤ X < 429,460)
    tax0 = X * 0.10 - 17_158;
  } else if (X < 695_000) {
    // 20%帯 (429,460 ≤ X < 695,000)
    tax0 = X * 0.20 - 60_104;
  } else if (X < 900_000) {
    // 23%帯 (695,000 ≤ X < 900,000)
    tax0 = X * 0.23 - 80_954;
  } else if (X < 1_800_000) {
    // 33%帯 (900,000 ≤ X < 1,800,000)
    tax0 = X * 0.33 - 170_954;
  } else if (X < 4_000_000) {
    // 40%帯 (1,800,000 ≤ X < 4,000,000)
    tax0 = X * 0.40 - 296_954;
  } else {
    // 45%帯 (4,000,000 ≤ X)
    tax0 = X * 0.45 - 496_954;
  }

  // 扶養親族等の数に応じた控除：1人につき月額 3,750円
  const taxB = Math.max(0, tax0 - dependentCount * 3_750);

  // 復興特別所得税（2.1%）加算・端数処理
  return roundJapanese(Math.max(0, taxB * 1.021));
}

/**
 * 端数処理：50銭以下切り捨て、50銭超え切り上げ（運送業規定）
 */
export function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  if (fraction <= 0.5) {
    return Math.floor(amount);
  } else {
    return Math.ceil(amount);
  }
}

export interface CustomAllowanceItem {
  allowanceDefinitionId: number;
  allowanceName: string;
  isTaxable: boolean;
  amount: number;
}

export interface PayrollCalculationInput {
  baseSalary: number;
  transportationAllowance: number;
  safetyDrivingAllowance: number;
  longDistanceAllowance: number;
  positionAllowance: number;
  familyAllowance: number;
  earlyOvertimeAllowance: number;
  commissionRatePerKm: number;
  commissionRatePerCase: number;
  dependentCount: number;
  residentTax: number;
  monthlyAverageWorkHours: number;
  socialInsuranceRate: number;
  employmentInsuranceRate: number;
  // Monthly record
  workDays: number;
  overtimeHours: number;
  lateNightHours: number;
  holidayWorkDays: number;
  drivingDistanceKm: number;
  deliveryCases: number;
  absenceDays: number;
  // Custom allowances
  customAllowances?: CustomAllowanceItem[];
}

export interface PayrollCalculationResult {
  baseSalary: number;
  overtimePay: number;
  lateNightPay: number;
  holidayPay: number;
  commissionPay: number;
  transportationAllowance: number;
  safetyDrivingAllowance: number;
  longDistanceAllowance: number;
  positionAllowance: number;
  familyAllowance: number;
  earlyOvertimeAllowance: number;
  customAllowancesTotal: number;
  absenceDeduction: number;
  grossSalary: number;
  socialInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  totalDeductions: number;
  netSalary: number;
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const {
    baseSalary,
    transportationAllowance,
    safetyDrivingAllowance,
    longDistanceAllowance,
    positionAllowance,
    familyAllowance,
    earlyOvertimeAllowance,
    commissionRatePerKm,
    commissionRatePerCase,
    dependentCount,
    residentTax,
    monthlyAverageWorkHours,
    socialInsuranceRate,
    employmentInsuranceRate,
    workDays,
    overtimeHours,
    lateNightHours,
    holidayWorkDays,
    drivingDistanceKm,
    deliveryCases,
    absenceDays,
    customAllowances = [],
  } = input;

  // 時給単価（時間外計算の基準）
  const hourlyRate = baseSalary / monthlyAverageWorkHours;

  // 時間外手当：(基本給 ÷ 月平均労働時間) × 1.25 × 残業時間
  const overtimePay = roundJapanese(hourlyRate * 1.25 * overtimeHours);

  // 深夜手当：(基本給 ÷ 月平均労働時間) × 0.25 × 深夜時間
  const lateNightPay = roundJapanese(hourlyRate * 0.25 * lateNightHours);

  // 休日手当：(基本給 ÷ 月平均労働時間) × 1.35 × (休日出勤数 × 8時間)
  const holidayPay = roundJapanese(hourlyRate * 1.35 * holidayWorkDays * 8);

  // 歩合給：走行距離 × km単価 + 件数 × 件単価
  const commissionPay = roundJapanese(
    drivingDistanceKm * commissionRatePerKm + deliveryCases * commissionRatePerCase
  );

  // 欠勤控除：1日あたり基本給/月平均所定労働日数（22日で計算）
  const dailyRate = baseSalary / 22;
  const absenceDeduction = roundJapanese(dailyRate * absenceDays);

  // カスタム手当合計
  const customAllowancesTotal = customAllowances.reduce((sum, a) => sum + a.amount, 0);

  // 支給合計
  const grossSalary = roundJapanese(
    baseSalary +
    overtimePay +
    lateNightPay +
    holidayPay +
    commissionPay +
    transportationAllowance +
    safetyDrivingAllowance +
    longDistanceAllowance +
    positionAllowance +
    familyAllowance +
    earlyOvertimeAllowance +
    customAllowancesTotal -
    absenceDeduction
  );

  // 社会保険料（健康保険＋厚生年金）：基本給ベースで計算
  const socialInsurance = roundJapanese(baseSalary * socialInsuranceRate);

  // 雇用保険料：支給合計ベース
  const employmentInsurance = roundJapanese(grossSalary * employmentInsuranceRate);

  // 社会保険控除後の給与額
  const afterInsuranceSalary = grossSalary - socialInsurance - employmentInsurance;

  // 源泉所得税
  const incomeTax = calculateIncomeTax(afterInsuranceSalary, dependentCount);

  // 控除合計
  const totalDeductions = roundJapanese(
    socialInsurance + employmentInsurance + incomeTax + residentTax
  );

  // 差引支給額
  const netSalary = roundJapanese(grossSalary - totalDeductions);

  return {
    baseSalary,
    overtimePay,
    lateNightPay,
    holidayPay,
    commissionPay,
    transportationAllowance,
    safetyDrivingAllowance,
    longDistanceAllowance,
    positionAllowance,
    familyAllowance,
    earlyOvertimeAllowance,
    customAllowancesTotal,
    absenceDeduction,
    grossSalary,
    socialInsurance,
    employmentInsurance,
    incomeTax,
    residentTax,
    totalDeductions,
    netSalary,
  };
}
