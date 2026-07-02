import { Employee, Company } from "@workspace/api-client-react";
import {
  calculateIncomeTaxReiwa8,
  calculateInsuranceByGrade,
  round50sen,
  HEALTH_EMPLOYEE_RATE_R8,
  HEALTH_WITH_CARE_EMPLOYEE_RATE_R8,
  PENSION_EMPLOYEE_RATE_R8,
  CHILDCARE_SUPPORT_EMPLOYEE_RATE_R8,
  EMP_INS_EMPLOYEE_RATE_R8,
  OVERTIME_RATE_R8,
  LATE_NIGHT_ADDITIONAL_RATE_R8,
  HOLIDAY_RATE_R8,
} from "@/lib/tax-tables-reiwa8";

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
};

export type RowData = Record<string, number | string>;

// ── 給与計算ユーティリティ ────────────────────────────────────────────────
export function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  return fraction <= 0.5 ? Math.floor(amount) : Math.ceil(amount);
}

/**
 * 厚生年金適用判定（サーバー側 resolvePensionApplied と同ロジック）
 * - pensionApplied が true/false → その値をそのまま使用
 * - null/undefined → 生年月日から年齢を算出し 70歳以上なら false
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
  const birthDate = new Date(dob);
  const checkYear = year ?? new Date().getFullYear();
  const checkMonth = month ?? new Date().getMonth() + 1;
  const calcDate = new Date(checkYear, checkMonth - 1, 1);
  let age = calcDate.getFullYear() - birthDate.getFullYear();
  const md = calcDate.getMonth() - birthDate.getMonth();
  if (md < 0 || (md === 0 && calcDate.getDate() < birthDate.getDate())) age--;
  return age < 70;
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
  company: CompanySettings | undefined
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
      overtimePay = overtimeMinutes > 0 ? Math.ceil(overtimeMinutes / unitMinutes) * unitRate : 0;
    } else {
      const unitsNormal = Math.ceil((OT_THRESHOLD * 60) / unitMinutes);
      const overMins = overtimeMinutes - OT_THRESHOLD * 60;
      const unitsOver = overMins > 0 ? Math.ceil(overMins / unitMinutes) : 0;
      overtimePay = unitsNormal * unitRate + Math.round(unitsOver * unitRate * 1.20);
    }
    const lateNightMinutes = lateNightHours * 60;
    lateNightPay = lateNightMinutes > 0 ? Math.ceil(lateNightMinutes / unitMinutes) * unitRate : 0;
    holidayPay = roundJapanese(companyDailyRate * 1.35 * holidayWorkDays);
  } else if (empOtRate > 0) {
    // 個人残業時給が設定されている場合はそれを直接使用（割増込み単価）
    // 60h超部分は ×1.20（= 1.50/1.25）追加
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = roundJapanese(empOtRate * overtimeHours);
    } else {
      overtimePay =
        roundJapanese(empOtRate * OT_THRESHOLD) +
        roundJapanese(empOtRate * 1.20 * (overtimeHours - OT_THRESHOLD));
    }
    const hourlyRate = isHourly
      ? (emp.baseSalary ?? 0)
      : isDaily
      ? effectiveWeekdayRate / 8
      : monthlyHours > 0 ? baseSalary / monthlyHours : 0;
    lateNightPay = roundJapanese(hourlyRate * LATE_NIGHT_ADDITIONAL_RATE_R8 * lateNightHours);
    holidayPay = roundJapanese(hourlyRate * HOLIDAY_RATE_R8 * holidayWorkDays * 8);
  } else {
    // 標準計算: 日給÷8 or 月給÷月平均 × 割増率（令和8年 内蔵定数）
    const hourlyRate = isHourly
      ? (emp.baseSalary ?? 0)
      : isDaily
      ? effectiveWeekdayRate / 8
      : monthlyHours > 0 ? baseSalary / monthlyHours : 0;
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = roundJapanese(hourlyRate * OVERTIME_RATE_R8 * overtimeHours);
    } else {
      overtimePay =
        roundJapanese(hourlyRate * OVERTIME_RATE_R8 * OT_THRESHOLD) +
        roundJapanese(hourlyRate * 1.50 * (overtimeHours - OT_THRESHOLD));
    }
    lateNightPay = roundJapanese(hourlyRate * LATE_NIGHT_ADDITIONAL_RATE_R8 * lateNightHours);
    holidayPay = roundJapanese(hourlyRate * HOLIDAY_RATE_R8 * holidayWorkDays * 8);
  }

  // 土曜出勤分（基本給は平日のみ／土曜は別出し、個人単価がある場合もそれを使用）
  const saturdayPayPreview = isDaily && company
    ? Math.round((Number(editData.saturdayWorkDays) || 0) * effectiveSaturdayRate)
    : 0;

  const grossEstimate = baseSalary + saturdayPayPreview + overtimePay + lateNightPay + holidayPay;

  // 全額非課税社員は控除なし（手取り=総支給）
  const isExempt = emp.taxExempt === true;
  let net: number;
  if (isExempt) {
    net = grossEstimate;
  } else {
    // 令和8年の内蔵定数＋標準報酬月額等級表で、バックエンドと同じ基準で概算する
    // （company の可変料率は参照しない＝「プレビュー≠確定」を解消）。
    const stdRem = (emp.standardRemuneration ?? 0) > 0 ? (emp.standardRemuneration ?? 0) : grossEstimate;
    const healthRate = emp.careInsuranceApplied ? HEALTH_WITH_CARE_EMPLOYEE_RATE_R8 : HEALTH_EMPLOYEE_RATE_R8;
    const isPensionApplied = resolvePensionApplied(emp);
    const { healthInsurance, pension } = calculateInsuranceByGrade(stdRem, healthRate, PENSION_EMPLOYEE_RATE_R8);
    const childcareSupport = round50sen(stdRem * CHILDCARE_SUPPORT_EMPLOYEE_RATE_R8);
    const employmentInsurance = emp.employmentInsuranceApplied !== false
      ? round50sen(grossEstimate * EMP_INS_EMPLOYEE_RATE_R8)
      : 0;
    const totalInsurance =
      healthInsurance +
      (isPensionApplied ? pension : 0) +
      childcareSupport +
      employmentInsurance;
    const afterInsurance = Math.max(0, grossEstimate - totalInsurance);
    const incomeTax = calculateIncomeTaxFromOfficialTable(
      afterInsurance,
      emp.dependentCount ?? 0,
      emp.hasSpouse ?? false,
    );
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

  // 超過残業代
  const actualOTHours = Math.max(0, overtimeHours - fixedOTHours);
  const actualOTPay   = Math.round(actualOTHours * otUnitPrice);

  // BW深夜手当: 時給 = round(残業単価 / 1.25) → 例 round(2111/1.25)=1689
  // 深夜割増 per h = floor(1689×0.25)=422、4.5h×422=1899
  const bwBaseHourlyRate         = Math.round(otUnitPrice / 1.25);
  const lateNightPremiumPerHour  = Math.floor(bwBaseHourlyRate * 0.25);
  const lateNightPay             = Math.floor(lateNightPremiumPerHour * lateNightHours);

  // 休日出勤: 「日曜/祝日」列 = sundayWorkDays を使用
  const holidayDays2 = Number(rowData.sundayWorkDays) || 0;
  const holidayPay   = Math.floor(dailySaturday * holidayDays2);

  // 公式A: 調整済み歩合率 × 売上
  const otRatio      = sales > 0 ? Math.round((actualOTPay / sales) * 1000) / 1000 : 0;
  const adjustedRate = Math.max(0, commissionRate - otRatio);
  const solutionA    = Math.floor(sales * adjustedRate);

  // 公式B: 基本給（平日+土曜）+ マスター手当 + カスタム手当合計 + 休日 + 深夜
  // ※ サーバー側の fixedAllowancesTotal = masterFixed + customAllowancesTotal と一致させる
  const masterAllowances =
    (emp.transportationAllowance        ?? 0) +
    (emp.safetyDrivingAllowance         ?? 0) +
    (emp.longDistanceAllowance          ?? 0) +
    (emp.positionAllowance              ?? 0) +
    (emp.familyAllowance                ?? 0) +
    (emp.earlyOvertimeAllowance         ?? 0);
  const basePay   = Math.floor(workDays * dailyWage + saturdayDays * dailySaturday);
  const solutionB = Math.floor(basePay + masterAllowances + customAllowancesTotal + holidayPay + lateNightPay);

  // 解答C → 業績手当
  const solutionC      = solutionA - solutionB;
  const perfAllowance  = Math.max(0, solutionC);

  return { solutionA, solutionB, solutionC, perfAllowance, actualOTPay, otRatio, adjustedRate };
}

// ── 入力データ有無の判定（リストの「入力済」状態表示用）──────────────────
export function hasAnyRecordData(ed: RowData | undefined): boolean {
  if (!ed) return false;
  const numericFields = [
    "workDays", "saturdayWorkDays", "sundayWorkDays", "absenceDays",
    "overtimeHours", "lateNightHours", "holidayWorkDays",
    "drivingDistanceKm", "deliveryCases", "actualWorkHours",
    "bluewingSalesAmount",
  ];
  if (numericFields.some((f) => (Number(ed[f]) || 0) > 0)) return true;
  return String(ed.notes || "").trim().length > 0;
}

// ── 表示ユーティリティ ──────────────────────────────────────────────────
export function formatYen(v: number): string {
  return `¥${v.toLocaleString("ja-JP")}`;
}
