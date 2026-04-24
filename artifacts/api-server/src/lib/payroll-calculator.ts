/**
 * 給与計算エンジン（運送業特化）
 * Transportation industry payroll calculation engine
 *
 * 令和8年（2026年）対応:
 *  - 社会保険料: 協会けんぽ東京支部 標準報酬月額等級テーブル方式
 *    ※ 社員マスタの standard_remuneration を固定の計算基礎とする
 *  - 雇用保険料: grossSalary × 0.55%（全社員統一）
 *  - 源泉所得税: 国税庁 令和8年分 給与所得の源泉徴収税額表（月額表）甲欄
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
  baseSalary: number;
  salaryType: string;
  dailyRateWeekday: number;
  dailyRateSaturday: number;
  hourlyRateSunday: number;
  earlyOvertimeAllowance: number;
  commissionRatePerKm: number;
  commissionRatePerCase: number;
  dependentCount: number;
  hasSpouse: boolean;
  standardRemuneration: number;
  healthInsuranceRate?: number;
  pensionInsuranceRate?: number;
  residentTax: number;
  pensionApplied?: boolean;
  otherDeductionMonthly?: number;
  customDeductionsTotal?: number;
  monthlyAverageWorkHours: number;
  workDays: number;
  saturdayWorkDays: number;
  sundayWorkHours: number;
  overtimeHours: number;
  lateNightHours: number;
  holidayWorkDays: number;
  drivingDistanceKm: number;
  deliveryCases: number;
  absenceDays: number;
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
    pensionApplied = true,
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

  const overtimePay = roundJapanese(hourlyRate * 1.25 * overtimeHours);
  const lateNightPay = roundJapanese(hourlyRate * 0.25 * lateNightHours);
  const holidayPay = roundJapanese(hourlyRate * 1.35 * holidayWorkDays * 8);
  const commissionPay = roundJapanese(
    drivingDistanceKm * commissionRatePerKm + deliveryCases * commissionRatePerCase
  );

  let absenceDeduction: number;
  if (salaryType === "daily") {
    absenceDeduction = roundJapanese(dailyRateWeekday * absenceDays);
  } else {
    absenceDeduction = roundJapanese((baseSalary / 22) * absenceDays);
  }

  const customAllowancesTotal = customAllowances.reduce((sum, a) => sum + a.amount, 0);

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

  // 社会保険料：社員マスタの標準報酬月額（standardRemuneration）を固定の計算基礎とする
  const insBase = standardRemuneration ?? 0;
  const ins = calculateSocialInsurance(insBase, {
    healthRate: healthInsuranceRate,
    pensionRate: pensionInsuranceRate,
  });
  const socialInsurance = ins.healthInsurance + (pensionApplied ? ins.pension : 0);

  const employmentInsurance = roundJapanese(grossSalary * 0.0055);
  const nonTaxableAllowancesTotal = customAllowances.reduce((sum, a) => sum + (a.isTaxable === false ? a.amount : 0), 0);
  const afterInsuranceSalary = grossSalary - nonTaxableAllowancesTotal - socialInsurance - employmentInsurance;

  const dependentEquivCount = dependentCount + (hasSpouse ? 1 : 0);
  const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);

  const totalDeductions = roundJapanese(
    socialInsurance + employmentInsurance + incomeTax + residentTax + otherDeductionMonthly + customDeductionsTotal
  );

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

  const actualOvertime = Math.max(0, overtimeHours - fixedOvertimeHours);
  const overtimePay = actualOvertime * overtimeUnitPrice;
  const overtimeRate = salesAmount > 0 ? overtimePay / salesAmount : 0;
  const adjustedRate = commissionRate - overtimeRate;
  const salesSalary = Math.floor(salesAmount * adjustedRate);
  const minimumSalary = MIKAWA_DAILY_BASE * workDays + overtimePay;
  const finalSalary = Math.max(salesSalary, minimumSalary);
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

  const actualOvertimeHours = Math.max(0, overtimeHours - fixedOvertimeHours);
  const actualOvertimePay = Math.round(actualOvertimeHours * overtimeUnitPrice);
  const targetAmount = Math.floor(bluewingSalesAmount * commissionRate);
  const baseTotal = Math.floor(baseSalary + fixedOvertimeAmount + holidayPay);
  const rawPerformance = Math.max(0, targetAmount - baseTotal);
  const performanceAllowance = Math.round(rawPerformance / 1000) * 1000;
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
