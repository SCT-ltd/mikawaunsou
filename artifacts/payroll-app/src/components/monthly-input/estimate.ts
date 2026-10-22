import { Employee, Company } from "@workspace/api-client-react";
import {
  calculateIncomeTaxReiwa8,
  calculateInsuranceByGrade,
  round50sen,
  OVERTIME_RATE_R8,
  LATE_NIGHT_ADDITIONAL_RATE_R8,
  HOLIDAY_RATE_R8,
} from "@/lib/tax-tables-reiwa8";
import { DEFAULT_INSURANCE_RATES_R8, type MonthInsurance } from "@/lib/insurance-rates";
import { panelDeductions } from "@/lib/payroll-shared";
import { bluewingCalc, payRulesFromCompany } from "@workspace/tax-tables-reiwa8/core";

/**
 * 月次実績入力の概算計算ロジック。
 * 旧 pages/monthly-input.tsx から移動したもので、計算式は一切変更していない
 * （給与計算は1円単位の正確性が要件のため）。型注釈のみ整理。
 */

// ── 型: 生成型に無いランタイムフィールドを補う拡張型 ────────────────────
// openapi.yaml 由来の Employee.salaryType は "fixed" | "daily" だが、
// ランタイムには "hourly"（時給制事務員）が存在するため文字列に広げる。
export type EmployeeExt = Omit<Employee, "salaryType"> & {
  salaryType: "fixed" | "daily" | "hourly" | (string & {});
  dateOfBirth?: string;
  useBluewingLogic?: boolean;
  bluewingCommissionRate?: number;
  bluewingFixedOvertimeHours?: number;
};

// Company 型に無いが API が返す会社設定フィールド
export type CompanySettings = Company & {
  dailyWageWeekday?: number;
  dailyWageSaturday?: number;
  monthlyWorkingHours?: number;
  /** 日曜・祝日の時給（既定 1,655円/h）*/
  hourlyWageSunday?: number;
};

export type RowData = Record<string, number | string>;

// ── 給与計算ユーティリティ ────────────────────────────────────────────────
export function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  return fraction <= 0.5 ? Math.floor(amount) : Math.ceil(amount);
}

/**
 * 深夜割増の1時間単価を「割増込みの残業時給」から復元する。
 * サーバ側 payroll-calculator.ts の lateNightPremiumPerHour と同一式。
 *   例) 2,111円/h → 422円/h、1,750円/h → 350円/h、1,909円/h → 382円/h
 */
export function lateNightPremiumPerHour(overtimeHourlyRate: number): number {
  return Math.round(Math.round(overtimeHourlyRate / 1.25) * 0.25);
}

/** 深夜の単価。個人の深夜単価があればそれ、無ければ残業単価から求める（サーバ側 lateNightRateFor と同じ）。 */
export function lateNightRateFor(personalLateNightRate: number | null | undefined, overtimeHourlyRate: number): number {
  return (personalLateNightRate ?? 0) > 0 ? personalLateNightRate! : lateNightPremiumPerHour(overtimeHourlyRate);
}

/**
 * 厚生年金適用判定（サーバー側 resolvePensionApplied と同ロジック）
 * - pensionApplied が true/false → その値をそのまま使用
 * - null/undefined → 70歳に達した日（誕生日の前日）の月から false
 *   （例：10月12日生まれ→10月11日に到達→10月分から引かない。1日生まれは前の月から）。
 *   以前は「その月の1日時点の年齢」で見ていたため、到達した月の分も引いていた。
 */
export function resolvePensionApplied(
  employee: EmployeeExt,
  year?: number,
  month?: number
): boolean {
  const pa = employee.pensionApplied;
  if (pa !== null && pa !== undefined) return pa;
  const dob = employee.dateOfBirth;
  if (!dob) return true;
  const checkY = year ?? new Date().getFullYear();
  const checkM = month ?? new Date().getMonth() + 1;
  const p = String(dob).split(/[-/]/).map(Number);
  if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return true;
  const reach = new Date(Date.UTC(p[0]! + 70, p[1]! - 1, p[2]!));
  reach.setUTCDate(reach.getUTCDate() - 1);
  return checkY * 12 + (checkM - 1) < reach.getUTCFullYear() * 12 + reach.getUTCMonth();
}

/**
 * 公式月額表（甲欄）による源泉所得税。
 * 公式表は「扶養親族等の数」(配偶者を含む) を引数に取るため、
 * 本関数内で hasSpouse を加算した上で公式表を引く。
 */
export function calculateIncomeTaxFromOfficialTable(
  afterInsuranceSalary: number,
  dependentCount: number,
  hasSpouse: boolean,
): number {
  const dependentEquivCount = (dependentCount ?? 0) + (hasSpouse ? 1 : 0);
  return calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);
}

// ── 概算計算（社員行用）────────────────────────────────────────────────
export function computeQuickEstimate(
  emp: EmployeeExt,
  editData: RowData,
  company: CompanySettings | undefined,
  /** その明細の年月の料率・標準報酬月額（マスターの履歴）。省略時は令和8年度の内蔵値＋社員マスタの値 */
  insurance?: MonthInsurance,
) {
  const isDaily = emp.salaryType === "daily";
  const isHourly = emp.salaryType === "hourly";
  const actualWorkHours = Number(editData.actualWorkHours) || 0;

  // 個人日当単価（dailyRateWeekday/dailyRateSaturday優先、0なら会社標準）
  const empWeekdayRate   = isDaily ? (emp.dailyRateWeekday ?? 0) : 0;
  const empSaturdayRate  = isDaily ? (emp.dailyRateSaturday ?? 0) : 0;
  // 会社標準日当
  const companyDailyRate    = company?.dailyWageWeekday ?? 9808;
  const companySaturdayRate = company?.dailyWageSaturday ?? 12260;
  // 実効単価（個人設定>0なら優先）
  const effectiveWeekdayRate   = empWeekdayRate   > 0 ? empWeekdayRate   : companyDailyRate;
  const effectiveSaturdayRate  = empSaturdayRate  > 0 ? empSaturdayRate  : companySaturdayRate;

  const baseSalary = isDaily && company
    ? Math.round((Number(editData.workDays) || 0) * effectiveWeekdayRate)
    : isHourly
    ? Math.round((emp.baseSalary ?? 0) * actualWorkHours)
    : emp.baseSalary ?? 0;

  const monthlyHours = company?.monthlyWorkingHours ?? 160;
  const overtimeHours = Number(editData.overtimeHours) || 0;
  const lateNightHours = Number(editData.lateNightHours) || 0;
  const holidayWorkDays = Number(editData.holidayWorkDays) || 0;
  // 日曜・祝日は「時間 × 日曜時給」（会社設定 hourlyWageSunday、既定 1,655円/h）
  const sundayWorkHours = Number(editData.sundayWorkHours) || 0;
  const sundayPay = Math.round((company?.hourlyWageSunday ?? 1655) * sundayWorkHours);

  // 個人残業単位設定がある場合はその計算式を使用（切り上げ×単位単価）
  const unitMinutes = emp.overtimeUnitMinutes ?? 0;
  const unitRate = emp.overtimeUnitRate ?? 0;
  let overtimePay: number;
  let lateNightPay: number;
  let holidayPay: number;
  // 個人残業時給（残業時給単価マスタ）
  const empOtRate = emp.overtimeHourlyRate ?? 0;
  const OT_THRESHOLD = 60;

  if (isDaily && unitMinutes > 0 && unitRate > 0) {
    const overtimeMinutes = overtimeHours * 60;
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = overtimeMinutes > 0 ? Math.round(Math.ceil(overtimeMinutes / unitMinutes) * unitRate) : 0;
    } else {
      const unitsNormal = Math.ceil((OT_THRESHOLD * 60) / unitMinutes);
      const overMins = overtimeMinutes - OT_THRESHOLD * 60;
      const unitsOver = overMins > 0 ? Math.ceil(overMins / unitMinutes) : 0;
      overtimePay = unitsNormal * unitRate + Math.round(unitsOver * unitRate * 1.20);
    }
    // 深夜手当は残業の単位単価ではなく素の時給の25%（サーバ側 calculatePayroll と同じ）。
    // 以前は残業と同じ単位単価を掛けていたため、概算と確定値が大きくズレていた。
    lateNightPay = roundJapanese((effectiveWeekdayRate / 8) * LATE_NIGHT_ADDITIONAL_RATE_R8 * lateNightHours);
    holidayPay = roundJapanese(companyDailyRate * 1.25 * holidayWorkDays);
  } else if (empOtRate > 0) {
    // 個人残業時給が設定されている場合はそれを直接使用（割増込み単価）
    // 60h超部分は ×1.20（= 1.50/1.25）追加
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = Math.round(empOtRate * overtimeHours);
    } else {
      overtimePay =
        Math.round(empOtRate * OT_THRESHOLD) +
        Math.round(empOtRate * 1.20 * (overtimeHours - OT_THRESHOLD));
    }
    const hourlyRate = isHourly
      ? (emp.baseSalary ?? 0)
      : isDaily
      ? effectiveWeekdayRate / 8
      : monthlyHours > 0 ? baseSalary / monthlyHours : 0;
    // 深夜手当は残業単価から素の時給を復元して25%（サーバ側 calculatePayroll と同じ）
    lateNightPay = Math.floor(lateNightRateFor((emp as { lateNightHourlyRate?: number }).lateNightHourlyRate, empOtRate) * lateNightHours);
    holidayPay = roundJapanese(hourlyRate * 1.25 * holidayWorkDays * 8); // 祝日は1.25倍
  } else {
    // 標準計算: 日給÷8 or 月給÷月平均 × 割増率（令和8年 内蔵定数）
    const hourlyRate = isHourly
      ? (emp.baseSalary ?? 0)
      : isDaily
      ? effectiveWeekdayRate / 8
      : monthlyHours > 0 ? baseSalary / monthlyHours : 0;
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = Math.round(hourlyRate * OVERTIME_RATE_R8 * overtimeHours);
    } else {
      overtimePay =
        Math.round(hourlyRate * OVERTIME_RATE_R8 * OT_THRESHOLD) +
        Math.round(hourlyRate * 1.50 * (overtimeHours - OT_THRESHOLD));
    }
    lateNightPay = roundJapanese(hourlyRate * LATE_NIGHT_ADDITIONAL_RATE_R8 * lateNightHours);
    holidayPay = roundJapanese(hourlyRate * 1.25 * holidayWorkDays * 8); // 祝日は1.25倍
  }

  // 土曜出勤分（基本給は平日のみ／土曜は別出し、個人単価がある場合もそれを使用）
  const saturdayPayPreview = isDaily && company
    ? Math.round((Number(editData.saturdayWorkDays) || 0) * effectiveSaturdayRate)
    : 0;

  const grossEstimate = baseSalary + saturdayPayPreview + overtimePay + lateNightPay + holidayPay + sundayPay;

  // 全額非課税社員は控除なし（手取り=総支給）
  const isExempt = emp.taxExempt === true;
  let net: number;
  if (isExempt) {
    net = grossEstimate;
  } else {
    // 保険料率マスター・標準報酬月額の履歴（その明細の年月の値）＋標準報酬月額等級表で、
    // バックエンドと同じ基準で概算する（company の旧料率は参照しない＝「プレビュー≠確定」を解消）。
    const rates = insurance?.rates ?? DEFAULT_INSURANCE_RATES_R8;
    const empStd = insurance
      ? insurance.standardRemunerationOf(emp.id, emp.standardRemuneration)
      : (emp.standardRemuneration ?? 0);
    // 雇用保険料の概算。ここでの grossEstimate は勤怠のみ（基本給＋残業等）で、
    // カスタム手当（携帯代・職務手当など）を含まない。したがって「雇用保険の対象外」
    // 手当（携帯代）も元から基礎に入っておらず、確定計算のような除外処理は不要。
    // これは月次入力の速報概算であり、手当込みの正確な雇用保険料は明細（手当・控除パネル）で算出する。
    // 保険料・源泉税の式はサーバーと同じ共有の関数（lib/payroll-shared.ts）。
    // 以前は年月を渡さず「今日」で70歳を判定し、標準報酬が65万円を超える人の厚生年金を0円にしていた。
    const ded = panelDeductions({
      employee: emp, company, rates,
      year: insurance?.year ?? new Date().getFullYear(),
      month: insurance?.month ?? new Date().getMonth() + 1,
      standardRemuneration: empStd,
      grossSalary: grossEstimate,
      nonTaxableAllowances: 0,
      employmentInsuranceExcluded: 0,
      employmentInsuranceOverride: null,
    });
    const totalInsurance = ded.healthInsurance + ded.pension + ded.childcareSupportContribution + ded.employmentInsurance;
    const incomeTax = ded.incomeTax;
    const residentTax = emp.residentTax ?? 0;
    net = roundJapanese(grossEstimate - totalInsurance - incomeTax - residentTax);
  }

  return { gross: grossEstimate, net };
}

// ── BW公式A/B/C リアルタイム計算 ────────────────────────────────────────
export type BWCalcResult = {
  solutionA: number;
  solutionB: number;
  solutionC: number;
  perfAllowance: number;
  actualOTPay: number;
  otRatio: number;
  adjustedRate: number;
};

export function computeBWCalc(
  emp: EmployeeExt,
  rowData: RowData,
  company: CompanySettings | undefined,
  customAllowancesTotal: number
): BWCalcResult | null {
  const sales = Number(rowData.bluewingSalesAmount) || 0;
  if (sales <= 0) return null;

  const commissionRate  = emp.bluewingCommissionRate    ?? 0;
  const fixedOTHours    = emp.bluewingFixedOvertimeHours ?? 0;
  const overtimeHours   = Number(rowData.overtimeHours)   || 0;
  const lateNightHours  = Number(rowData.lateNightHours)  || 0;
  const workDays        = Number(rowData.workDays)         || 0;
  const saturdayDays    = Number(rowData.saturdayWorkDays) || 0;
  const otUnitPrice     = Number(rowData.overtimeUnitPrice) || 2111;

  const dailyWage     = company?.dailyWageWeekday  ?? 9808;
  const dailySaturday = company?.dailyWageSaturday ?? 12260;

  // BW深夜手当: 個人の深夜単価、無ければ残業単価から素の時給を復元して25%（サーバーと同じ lateNightRateFor）
  const lateNightPay = Math.floor(lateNightRateFor((emp as { lateNightHourlyRate?: number }).lateNightHourlyRate, otUnitPrice) * lateNightHours);

  // 休日出勤: 「日曜/祝日」列 = sundayWorkHours（時間）× 日曜時給（サーバーと同じく四捨五入）
  const sundayHours = Number(rowData.sundayWorkHours) || 0;
  const holidayPay  = Math.round((company?.hourlyWageSunday ?? 1655) * sundayHours);

  // 公式B: 基本給（平日+土曜）+ マスター手当 + カスタム手当合計 + 休日 + 深夜
  // ※ サーバー側の fixedAllowancesTotal = masterFixed + customAllowancesTotal と一致させる
  const masterAllowances =
    (emp.transportationAllowance        ?? 0) +
    (emp.safetyDrivingAllowance         ?? 0) +
    (emp.longDistanceAllowance          ?? 0) +
    (emp.positionAllowance              ?? 0) +
    (emp.familyAllowance                ?? 0) +
    (emp.earlyOvertimeAllowance         ?? 0);
  const basePay   = Math.floor(workDays * dailyWage) + Math.floor(saturdayDays * dailySaturday);

  // 式はサーバーと同じ共有の関数（会社設定④⑤のスイッチもここで効く）
  const rules = payRulesFromCompany(company as Record<string, unknown> | undefined);
  const r = bluewingCalc({
    bluewingSalesAmount: sales, commissionRate, fixedOvertimeHours: fixedOTHours, overtimeHours, overtimeUnitPrice: otUnitPrice,
    baseSalary: basePay, fixedAllowancesTotal: masterAllowances + customAllowancesTotal, holidayPay,
    fixedOvertimeAmount: (emp as { bluewingFixedOvertimeAmount?: number }).bluewingFixedOvertimeAmount ?? 0, lateNightPay,
  }, { v2: rules.bluewingPerformanceV2, over60: rules.bluewingOver60 });

  return { solutionA: r.solutionA, solutionB: r.solutionB, solutionC: r.solutionC, perfAllowance: r.performanceAllowance, actualOTPay: r.actualOvertimePay, otRatio: r.otRatio, adjustedRate: r.adjustedRate };
}

// ── 入力データ有無の判定（リストの「入力済」状態表示用）──────────────────
export function hasAnyRecordData(ed: RowData | undefined): boolean {
  if (!ed) return false;
  const numericFields = [
    "workDays", "saturdayWorkDays", "sundayWorkDays", "sundayWorkHours", "absenceDays", "paidLeaveDays",
    "overtimeHours", "lateNightHours", "holidayWorkDays",
    "drivingDistanceKm", "deliveryCases", "actualWorkHours",
    "bluewingSalesAmount", "restDayOvertimeHours",
  ];
  if (numericFields.some((f) => (Number(ed[f]) || 0) > 0)) return true;
  return String(ed.notes || "").trim().length > 0;
}

// ── 表示ユーティリティ ──────────────────────────────────────────────────
export function formatYen(v: number): string {
  return `¥${v.toLocaleString("ja-JP")}`;
}
