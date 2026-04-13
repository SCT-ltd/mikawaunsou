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
 * 月額表（甲欄）簡易計算ロジック
 * Reference: 国税庁 令和6年分 給与所得の源泉徴収税額表（月額表）
 */
export function calculateIncomeTax(
  afterInsuranceSalary: number,
  dependentCount: number
): number {
  // 扶養親族等の数に応じた控除額（月額）
  // This is a simplified version of the withholding tax table
  const dependentDeduction = 38000; // 基礎控除相当（月額）
  const perDependentDeduction = 38000; // 扶養1人あたり月額
  
  const totalDependentDeduction = dependentDeduction + (dependentCount * perDependentDeduction);
  
  // 課税給与所得金額（千円未満切り捨て）
  const taxableIncome = Math.max(0, afterInsuranceSalary - totalDependentDeduction);
  const taxableIncome1000 = Math.floor(taxableIncome / 1000) * 1000;
  
  // 月額表に基づく税率適用（甲欄）
  let tax = 0;
  
  if (taxableIncome1000 <= 0) {
    tax = 0;
  } else if (taxableIncome1000 <= 162_500) {
    // 5%
    tax = taxableIncome1000 * 0.05;
  } else if (taxableIncome1000 <= 275_000) {
    // 10% - 2,572円
    tax = taxableIncome1000 * 0.10 - 2_572;
  } else if (taxableIncome1000 <= 579_167) {
    // 20% - 17_386円
    tax = taxableIncome1000 * 0.20 - 17_386;
  } else if (taxableIncome1000 <= 750_000) {
    // 23% - 34_934円
    tax = taxableIncome1000 * 0.23 - 34_934;
  } else if (taxableIncome1000 <= 1_500_000) {
    // 33% - 109_934円
    tax = taxableIncome1000 * 0.33 - 109_934;
  } else if (taxableIncome1000 <= 3_333_333) {
    // 40% - 214_934円
    tax = taxableIncome1000 * 0.40 - 214_934;
  } else {
    // 45% - 381_934円
    tax = taxableIncome1000 * 0.45 - 381_934;
  }
  
  // 復興特別所得税：2.1%を加算
  tax = tax * 1.021;
  
  // 端数処理：50銭以下切り捨て、50銭超え切り上げ
  return roundJapanese(Math.max(0, tax));
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
