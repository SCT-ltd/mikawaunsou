/**
 * 給与計算エンジン（運送業特化）
 *
 * 令和8年（2026年）対応:
 *  - 健康保険料: 協会けんぽ東京支部 9.85%（介護ありは +1.62% = 11.47%）÷ 2
 *  - 子ども・子育て支援金: 0.23% ÷ 2（健保とは別控除）
 *  - 厚生年金: 18.3% ÷ 2（上限 650,000円）
 *  - 雇用保険: 総支給額 × 0.5%（令和8年度一般事業）
 *  - 源泉所得税: 令和8年分 月額表甲欄テーブル参照方式
 */

import {
  calculateInsuranceAndTax,
  calculateIncomeTaxReiwa8,
  EMP_INS_RATE_R8,
} from "./tax-tables-reiwa8";

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
  /**
   * 標準報酬月額（健保・厚年の計算基礎）
   * > 0 の場合はその値を直接使用
   * = 0 の場合は grossSalary で計算
   */
  standardRemuneration: number;
  /** 介護保険適用（40〜64歳）*/
  careInsuranceApplied?: boolean;
  /** 雇用保険適用（false の場合は0円）*/
  employmentInsuranceApplied?: boolean;
  /** 厚生年金適用（false の場合は0円）*/
  pensionApplied?: boolean;
  /** 雇用保険料率（省略時は EMP_INS_RATE_R8 = 0.005）*/
  employmentInsuranceRate?: number;
  residentTax: number;
  monthlyAverageWorkHours: number;
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
  /** 健康保険料（介護保険込みまたはなし）*/
  healthInsurance: number;
  /** 子ども・子育て支援金 */
  childcareSupportContribution: number;
  /** 厚生年金保険料 */
  pension: number;
  /** 健保＋子育て支援金＋厚年の合計（社会保険料合計として DB に保存する値）*/
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
    standardRemuneration,
    careInsuranceApplied = false,
    employmentInsuranceApplied = true,
    pensionApplied = true,
    employmentInsuranceRate = EMP_INS_RATE_R8,
    residentTax,
    monthlyAverageWorkHours,
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
    baseSalary = roundJapanese(
      workDays * dailyRateWeekday +
      saturdayWorkDays * dailyRateSaturday +
      sundayWorkHours * hourlyRateSunday
    );
    hourlyRate = dailyRateWeekday / 8;
  } else {
    baseSalary = input.baseSalary;
    hourlyRate = baseSalary / monthlyAverageWorkHours;
  }

  // 時間外手当・深夜手当・休日手当
  const overtimePay   = roundJapanese(hourlyRate * 1.25 * overtimeHours);
  const lateNightPay  = roundJapanese(hourlyRate * 0.25 * lateNightHours);
  const holidayPay    = roundJapanese(hourlyRate * 1.35 * holidayWorkDays * 8);

  // 歩合給
  const commissionPay = roundJapanese(
    drivingDistanceKm * commissionRatePerKm + deliveryCases * commissionRatePerCase
  );

  // 欠勤控除
  let absenceDeduction: number;
  if (salaryType === "daily") {
    absenceDeduction = roundJapanese(dailyRateWeekday * absenceDays);
  } else {
    absenceDeduction = roundJapanese((baseSalary / 22) * absenceDays);
  }

  // カスタム手当合計（課税・非課税別に集計）
  const taxableCustomTotal    = customAllowances.filter(a =>  a.isTaxable).reduce((s, a) => s + a.amount, 0);
  const nonTaxableCustomTotal = customAllowances.filter(a => !a.isTaxable).reduce((s, a) => s + a.amount, 0);
  const customAllowancesTotal = taxableCustomTotal + nonTaxableCustomTotal;

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
  // 社会保険料・雇用保険・源泉所得税
  // standard_remuneration > 0 → その値を直接使用
  // standard_remuneration = 0 → grossSalary を計算基礎とする
  // ────────────────────────────────────────────────────────────────
  const insBase = (standardRemuneration ?? 0) > 0 ? standardRemuneration : grossSalary;

  // 非課税手当（通勤手当＋非課税カスタム手当）
  // transportationAllowance は非課税扱い（月15万以内の通勤手当）
  const nonTaxableAllowances = transportationAllowance + nonTaxableCustomTotal;

  const ins = calculateInsuranceAndTax({
    standardRemuneration: insBase,
    grossSalary,
    nonTaxableAllowances,
    dependentCount,
    hasSpouse,
    careInsuranceApplied,
    pensionApplied,
    employmentInsuranceApplied,
    residentTax,
    customDeductionsTotal: 0,
    employmentInsuranceRate,
  });

  const healthInsurance             = ins.healthInsurance;
  const childcareSupportContribution = ins.childcareSupportContribution;
  const pension                     = ins.pension;
  const socialInsurance             = healthInsurance + childcareSupportContribution + pension;
  const employmentInsurance         = ins.employmentInsurance;
  const incomeTax                   = ins.incomeTax;

  // 控除合計（社保＋雇保＋源泉＋住民税）
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
    healthInsurance,
    childcareSupportContribution,
    pension,
    socialInsurance,
    employmentInsurance,
    incomeTax,
    residentTax,
    totalDeductions,
    netSalary,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 三川運送専用給与計算ロジック
// ────────────────────────────────────────────────────────────────────────────

export interface MikawaPayrollInput {
  salesAmount: number;
  commissionRate: number;
  workDays: number;
  overtimeHours: number;
  fixedOvertimeHours: number;
  overtimeUnitPrice: number;
}

export interface MikawaPayrollResult {
  salesSalary: number;
  minimumSalary: number;
  finalSalary: number;
  overtimePay: number;
  adjustedRate: number;
  performanceAllowance: number;
}

const MIKAWA_DAILY_BASE = 9808;

export function calculateMikawaPayroll(input: MikawaPayrollInput): MikawaPayrollResult {
  const {
    salesAmount,
    commissionRate,
    workDays,
    overtimeHours,
    fixedOvertimeHours,
    overtimeUnitPrice,
  } = input;

  const actualOvertime   = Math.max(0, overtimeHours - fixedOvertimeHours);
  const overtimePay      = actualOvertime * overtimeUnitPrice;
  const overtimeRate     = salesAmount > 0 ? overtimePay / salesAmount : 0;
  const adjustedRate     = commissionRate - overtimeRate;
  const salesSalary      = Math.floor(salesAmount * adjustedRate);
  const minimumSalary    = MIKAWA_DAILY_BASE * workDays + overtimePay;
  const finalSalary      = Math.max(salesSalary, minimumSalary);
  const performanceAllowance = finalSalary - minimumSalary;

  return { salesSalary, minimumSalary, finalSalary, overtimePay, adjustedRate, performanceAllowance };
}

// ────────────────────────────────────────────────────────────────────────────
// ブルーウィング給与計算ロジック
// ────────────────────────────────────────────────────────────────────────────

export interface BluewingPayrollInput {
  bluewingSalesAmount: number;
  commissionRate: number;
  fixedOvertimeHours: number;
  overtimeHours: number;
  overtimeUnitPrice: number;
  baseSalary: number;
  fixedAllowancesTotal: number;
  holidayPay: number;
  fixedOvertimeAmount: number;
  lateNightPay: number;
}

export interface BluewingPayrollResult {
  actualOvertimeHours: number;
  actualOvertimePay: number;
  targetAmount: number;
  baseTotal: number;
  performanceAllowance: number;
  grossSalary: number;
}

export function calculateBluewingPayroll(input: BluewingPayrollInput): BluewingPayrollResult {
  const {
    bluewingSalesAmount,
    commissionRate,
    fixedOvertimeHours,
    overtimeHours,
    overtimeUnitPrice,
    baseSalary,
    fixedAllowancesTotal,
    holidayPay,
    fixedOvertimeAmount,
    lateNightPay,
  } = input;

  const actualOvertimeHours  = Math.max(0, overtimeHours - fixedOvertimeHours);
  const actualOvertimePay    = Math.round(actualOvertimeHours * overtimeUnitPrice);
  const targetAmount         = Math.floor(bluewingSalesAmount * commissionRate);
  const baseTotal            = Math.floor(baseSalary + fixedOvertimeAmount + holidayPay);
  const rawPerformance       = Math.max(0, targetAmount - baseTotal);
  const performanceAllowance = Math.round(rawPerformance / 1000) * 1000;
  const grossSalary          = Math.floor(baseTotal + actualOvertimePay + fixedAllowancesTotal + lateNightPay + performanceAllowance);

  return {
    actualOvertimeHours,
    actualOvertimePay,
    targetAmount,
    baseTotal,
    performanceAllowance,
    grossSalary,
  };
}
