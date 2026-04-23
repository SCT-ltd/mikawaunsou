/**
 * 給与計算エンジン（運送業特化）
 * Transportation industry payroll calculation engine
 *
 * 令和8年（2026年）対応:
 *  - 社会保険料: 協会けんぽ東京支部 標準報酬月額等級テーブル方式
 *    ※ standard_remuneration が設定されている場合はその等級を使用
 *    ※ standard_remuneration = 0 の場合は grossSalary でフォールバック
 *  - 雇用保険料: grossSalary × 0.55%（全社員統一）
 *  - 源泉所得税: 国税庁 令和8年分 給与所得の源泉徴収税額表（月額表）甲欄
 *    ※ 基礎控除額が令和7年の480,000円から令和8年の580,000円に改正
 *    ※ 手動固定値優先ロジック廃止 → 常に動的計算
 */

import { calculateSocialInsurance, calculateIncomeTaxReiwa8 } from "./tax-tables-reiwa8";

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
  earlyOvertimeAllowance: number;
  commissionRatePerKm: number;
  commissionRatePerCase: number;
  dependentCount: number;
  hasSpouse: boolean;
  /**
   * 標準報酬月額（健保・厚年の計算基礎）
   * > 0 の場合はその値で等級テーブルを検索
   * = 0 の場合は grossSalary で等級を自動判定
   */
  standardRemuneration: number;
  /** 健康保険料率（従業員折半、介護保険込みの場合は合算値） */
  healthInsuranceRate?: number;
  /** 厚生年金保険料率（従業員折半） */
  pensionInsuranceRate?: number;
  residentTax: number;
  otherDeductionMonthly?: number;
  customDeductionsTotal?: number;
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
    earlyOvertimeAllowance,
    commissionRatePerKm,
    commissionRatePerCase,
    dependentCount,
    hasSpouse,
    standardRemuneration,
    healthInsuranceRate,
    pensionInsuranceRate,
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
    otherDeductionMonthly = 0,
    customDeductionsTotal = 0,
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
    earlyOvertimeAllowance +
    customAllowancesTotal -
    absenceDeduction
  );

  // ────────────────────────────────────────────────────────────────
  // 社会保険料（健康保険・厚生年金）
  // standard_remuneration > 0: その値で等級を検索（標準報酬月額ベース）
  // standard_remuneration = 0: grossSalary で等級を自動判定
  // ────────────────────────────────────────────────────────────────
  const insBase = (standardRemuneration ?? 0) > 0 ? standardRemuneration : grossSalary;
  const ins = calculateSocialInsurance(insBase, {
    healthRate: healthInsuranceRate,
    pensionRate: pensionInsuranceRate,
  });
  const healthInsurance = ins.healthInsurance;
  const pension = ins.pension;
  const socialInsurance = healthInsurance + pension;

  // 雇用保険料：grossSalary × 0.55%（全社員統一）
  const employmentInsurance = roundJapanese(grossSalary * 0.0055);

  // 社会保険等控除後の給与等の金額（月額表の検索キー）
  const nonTaxableAllowancesTotal = customAllowances.reduce((sum, a) => sum + (a.isTaxable === false ? a.amount : 0), 0);
  const afterInsuranceSalary = grossSalary - nonTaxableAllowancesTotal - socialInsurance - employmentInsurance;

  // ────────────────────────────────────────────────────────────────
  // 源泉所得税（令和8年月額表甲欄）
  // 扶養親族等の数 = 扶養人数 + 配偶者（控除対象の場合）
  // 手動固定値優先ロジック廃止 → 常に動的計算
  // ────────────────────────────────────────────────────────────────
  const dependentEquivCount = dependentCount + (hasSpouse ? 1 : 0);
  const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);

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

// ────────────────────────────────────────────────────────────────────────────
// 三川運送専用給与計算ロジック
// 既存の calculatePayroll は変更しない。フラグ useMikawaLogic で切替。
// ────────────────────────────────────────────────────────────────────────────

export interface MikawaPayrollInput {
  /** 売上金額（円） */
  salesAmount: number;
  /** 歩合率（例: 0.375 = 37.5%） */
  commissionRate: number;
  /** 実際の出勤日数 */
  workDays: number;
  /** 実績残業時間 */
  overtimeHours: number;
  /** 固定残業時間（みなし残業の含み分） */
  fixedOvertimeHours: number;
  /** 残業単価（円/時） */
  overtimeUnitPrice: number;
}

export interface MikawaPayrollResult {
  /** 売上給与（歩合計算ベース） */
  salesSalary: number;
  /** 最低保証給与 */
  minimumSalary: number;
  /** 最終給与（max(salesSalary, minimumSalary)） */
  finalSalary: number;
  /** 実残業代（固定含み時間超過分） */
  overtimePay: number;
  /** 残業調整後の実効歩合率 */
  adjustedRate: number;
  /** 業績手当（finalSalary - minimumSalary） */
  performanceAllowance: number;
}

const MIKAWA_DAILY_BASE = 9808; // 最低保証計算用日給基礎単価（円）

// ────────────────────────────────────────────────────────────────────────────
// ブルーウィング給与計算ロジック
// ────────────────────────────────────────────────────────────────────────────

export interface BluewingPayrollInput {
  /** ブルーウィングからの売上金額（円） */
  bluewingSalesAmount: number;
  /** 歩合率（例: 0.375 = 37.5%） */
  commissionRate: number;
  /** 固定残業時間（職務手当に含まれるみなし残業時間） */
  fixedOvertimeHours: number;
  /** 実残業時間（日報ベースの総残業時間） */
  overtimeHours: number;
  /** 残業単価（円/時） */
  overtimeUnitPrice: number;
  /** 基本給（日給×出勤日数 等） */
  baseSalary: number;
  /** 固定手当合計（燃料・駐車等）※残業代・休日除く */
  fixedAllowancesTotal: number;
  /** 休日出勤代 */
  holidayPay: number;
  /** 固定残業代（職務手当）として支給する金額 */
  fixedOvertimeAmount: number;
  /** 深夜手当（計算済み金額） */
  lateNightPay: number;
}

export interface BluewingPayrollResult {
  /** 実残業時間（固定みなし超過分） */
  actualOvertimeHours: number;
  /** 実残業代（超過分のみ） */
  actualOvertimePay: number;
  /** A = 売上×歩合率 − 実残業代 */
  targetAmount: number;
  /** B = 基本給 + 固定手当 + 休日出勤 + 深夜手当 */
  baseTotal: number;
  /** 業績手当 = max(0, A − B)  ※マイナスの場合は0 */
  performanceAllowance: number;
  /** 最終支給総額 = B + 実残業代 + 固定残業代(職務手当) + 業績手当 */
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

  // ① 実残業時間（固定みなしを超えた分）
  const actualOvertimeHours = Math.max(0, overtimeHours - fixedOvertimeHours);

  // ② 実残業代（超過分 × 単価、四捨五入）
  const actualOvertimePay = Math.round(actualOvertimeHours * overtimeUnitPrice);

  // ③ A = 売上×歩合率（実残業代を引かない）
  const targetAmount = Math.floor(bluewingSalesAmount * commissionRate);

  // ④ B = 基本給 + 固定残業代 + 休日出勤（カスタム手当・深夜手当は含めない）
  const baseTotal = Math.floor(baseSalary + fixedOvertimeAmount + holidayPay);

  // ⑤ 業績手当 = max(0, A - B)を1,000円単位で四捨五入
  const rawPerformance = Math.max(0, targetAmount - baseTotal);
  const performanceAllowance = Math.round(rawPerformance / 1000) * 1000;

  // ⑥ 最終支給総額 = B + 実残業代 + カスタム手当合計 + 深夜手当 + 業績手当
  const grossSalary = Math.floor(baseTotal + actualOvertimePay + fixedAllowancesTotal + lateNightPay + performanceAllowance);

  return {
    actualOvertimeHours,
    actualOvertimePay,
    targetAmount,
    baseTotal,
    performanceAllowance,
    grossSalary,
  };
}

export function calculateMikawaPayroll(input: MikawaPayrollInput): MikawaPayrollResult {
  const {
    salesAmount,
    commissionRate,
    workDays,
    overtimeHours,
    fixedOvertimeHours,
    overtimeUnitPrice,
  } = input;

  // ① 実残業時間（固定含み時間を超えた分のみ）
  const actualOvertime = Math.max(0, overtimeHours - fixedOvertimeHours);

  // ② 残業金額
  const overtimePay = actualOvertime * overtimeUnitPrice;

  // ③ 残業率（売上に対する残業代の割合）
  const overtimeRate = salesAmount > 0 ? overtimePay / salesAmount : 0;

  // ④ 調整後歩合率
  const adjustedRate = commissionRate - overtimeRate;

  // ⑤ 売上給与
  const salesSalary = Math.floor(salesAmount * adjustedRate);

  // ⑥ 最低保証給与
  const minimumSalary = MIKAWA_DAILY_BASE * workDays + overtimePay;

  // ⑦ 最終給与
  const finalSalary = Math.max(salesSalary, minimumSalary);

  // ⑧ 業績手当
  const performanceAllowance = finalSalary - minimumSalary;

  return {
    salesSalary,
    minimumSalary,
    finalSalary,
    overtimePay,
    adjustedRate,
    performanceAllowance,
  };
}
