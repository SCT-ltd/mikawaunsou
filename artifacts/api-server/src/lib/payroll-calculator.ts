/**
 * 給与計算エンジン（運送業特化）
 * Transportation industry payroll calculation engine
 *
 * 令和7年（2025年）対応:
 *  - 社会保険料: 協会けんぽ東京支部 標準報酬月額等級テーブル方式
 *  - 源泉所得税: 国税庁 令和7年分 給与所得の源泉徴収税額表（月額表）甲欄
 */

import { calculateSocialInsurance, calculateIncomeTaxReiwa7 } from "./tax-tables-reiwa8";

/**
 * 端数処理：50銭以下切り捨て、50銭超え切り上げ
 */
export function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  return fraction <= 0.5 ? Math.floor(amount) : Math.ceil(amount);
}

export interface CustomAllowanceItem {
  allowanceDefinitionId: number;
  allowanceName: string;
  isTaxable: boolean;
  amount: number;
}

export interface PayrollCalculationInput {
  /** 固定給の場合: 月額固定給。日給制の場合: 計算に使用しない（0でよい） */
  baseSalary: number;
  /** 'fixed' = 月額固定, 'daily' = 日給制 */
  salaryType: string;
  /** 日給制: 平日日給 */
  dailyRateWeekday: number;
  /** 日給制: 土曜日給 */
  dailyRateSaturday: number;
  /** 日給制: 日曜時給 */
  hourlyRateSunday: number;
  transportationAllowance: number;
  safetyDrivingAllowance: number;
  longDistanceAllowance: number;
  positionAllowance: number;
  familyAllowance: number;
  earlyOvertimeAllowance: number;
  commissionRatePerKm: number;
  commissionRatePerCase: number;
  dependentCount: number;
  hasSpouse: boolean;
  /** 社会保険料の手動設定（> 0 の場合はテーブル計算を上書き） */
  healthInsuranceMonthly: number;
  pensionMonthly: number;
  residentTax: number;
  monthlyAverageWorkHours: number;
  employmentInsuranceRate: number;
  // Monthly record
  workDays: number;
  saturdayWorkDays: number;
  sundayWorkHours: number;
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
    salaryType,
    dailyRateWeekday,
    dailyRateSaturday,
    hourlyRateSunday,
    transportationAllowance,
    safetyDrivingAllowance,
    longDistanceAllowance,
    positionAllowance,
    familyAllowance,
    earlyOvertimeAllowance,
    commissionRatePerKm,
    commissionRatePerCase,
    dependentCount,
    hasSpouse,
    healthInsuranceMonthly,
    pensionMonthly,
    residentTax,
    monthlyAverageWorkHours,
    employmentInsuranceRate,
    workDays,
    saturdayWorkDays,
    sundayWorkHours,
    overtimeHours,
    lateNightHours,
    holidayWorkDays,
    drivingDistanceKm,
    deliveryCases,
    absenceDays,
    customAllowances = [],
  } = input;

  // ────────────────────────────────────────────────────────────────
  // 基本給・時給単価の決定
  // ────────────────────────────────────────────────────────────────
  let baseSalary: number;
  let hourlyRate: number;

  if (salaryType === "daily") {
    // 日給制: 出勤日数 × 日給で基本給を算出
    baseSalary = roundJapanese(
      workDays * dailyRateWeekday +
      saturdayWorkDays * dailyRateSaturday +
      sundayWorkHours * hourlyRateSunday
    );
    // 時間外計算用時給: 平日日給 ÷ 8時間
    hourlyRate = dailyRateWeekday / 8;
  } else {
    // 固定給: 月額固定
    baseSalary = input.baseSalary;
    hourlyRate = baseSalary / monthlyAverageWorkHours;
  }

  // 時間外手当：時給 × 1.25 × 残業時間
  const overtimePay = roundJapanese(hourlyRate * 1.25 * overtimeHours);

  // 深夜手当：時給 × 0.25 × 深夜時間
  const lateNightPay = roundJapanese(hourlyRate * 0.25 * lateNightHours);

  // 休日手当：時給 × 1.35 × (休日出勤数 × 8時間)
  const holidayPay = roundJapanese(hourlyRate * 1.35 * holidayWorkDays * 8);

  // 歩合給：走行距離 × km単価 + 件数 × 件単価
  const commissionPay = roundJapanese(
    drivingDistanceKm * commissionRatePerKm + deliveryCases * commissionRatePerCase
  );

  // 欠勤控除（日給制は1日分そのまま、固定給は ÷22日）
  let absenceDeduction: number;
  if (salaryType === "daily") {
    absenceDeduction = roundJapanese(dailyRateWeekday * absenceDays);
  } else {
    absenceDeduction = roundJapanese((baseSalary / 22) * absenceDays);
  }

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

  // ────────────────────────────────────────────────────────────────
  // 社会保険料（健康保険・厚生年金）
  // 手動設定がある場合はそちらを優先、ない場合は令和8年等級テーブルで算出
  // ────────────────────────────────────────────────────────────────
  let healthInsurance: number;
  let pension: number;

  if (healthInsuranceMonthly > 0 && pensionMonthly > 0) {
    healthInsurance = healthInsuranceMonthly;
    pension = pensionMonthly;
  } else {
    const ins = calculateSocialInsurance(grossSalary);
    healthInsurance = ins.healthInsurance;
    pension = ins.pension;
  }

  const socialInsurance = healthInsurance + pension;

  // 雇用保険料：支給合計ベース
  const employmentInsurance = roundJapanese(grossSalary * employmentInsuranceRate);

  // 社会保険等控除後の給与等の金額（月額表の検索キー）
  const afterInsuranceSalary = grossSalary - socialInsurance - employmentInsurance;

  // ────────────────────────────────────────────────────────────────
  // 源泉所得税（令和7年月額表甲欄）
  // 扶養親族等の数 = 扶養人数 + 配偶者（控除対象の場合）
  // ────────────────────────────────────────────────────────────────
  const dependentEquivCount = dependentCount + (hasSpouse ? 1 : 0);
  const incomeTax = calculateIncomeTaxReiwa7(afterInsuranceSalary, dependentEquivCount);

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
