/**
 * 画面の手当パネル・概算で使う、サーバーと同じ給与の式（共有の lib/tax-tables-reiwa8/src/payroll-core.ts）。
 * パネルからは、ここの関数を呼ぶだけにする（式をパネルに書かない）。
 */
import {
  calcStatutoryDeductions,
  deriveAutoRows,
  autoContextFromAllowances,
  payRulesFromCompany,
  pensionAppliedFor,
  healthAppliedFor,
  exemptFlagsOf,
  commuteTaxableExcess,
  isCommuteAllowanceName,
  absenceDeductionFor,
  OtsuTableMissingError,
  type AutoRow,
  type StatutoryDeductions,
  type WithholdingProfile,
} from "@workspace/tax-tables-reiwa8/core";
import type { EmployeeInsuranceRates } from "@/lib/insurance-rates";

/** API が返す社員の行（生成された型に無い 2026-10-24 の項目も含めて読む） */
export interface EmployeeLike {
  id: number;
  salaryType?: string | null;
  baseSalary?: number | null;
  dateOfBirth?: string | null;
  pensionApplied?: boolean | null;
  careInsuranceApplied?: boolean | null;
  employmentInsuranceApplied?: boolean | null;
  taxExempt?: boolean | null;
  socialInsuranceExempt?: boolean | null;
  employmentInsuranceExempt?: boolean | null;
  incomeTaxExempt?: boolean | null;
  healthInsuranceMode?: string | null;
  dependentCount?: number | null;
  hasSpouse?: boolean | null;
  taxColumn?: string | null;
  disability?: string | null;
  widow?: boolean | null;
  singleParent?: boolean | null;
  workingStudent?: boolean | null;
  dependentDisabilityCount?: number | null;
  commuteMethod?: string | null;
  commuteDistanceKm?: number | null;
  transportationAllowance?: number | null;
  dailyRateWeekday?: number | null;
  dailyRateSaturday?: number | null;
  overtimeHourlyRate?: number | null;
  lateNightHourlyRate?: number | null;
}

const asEmp = (e: unknown) => e as EmployeeLike;

export function withholdingOfEmployee(e: unknown): WithholdingProfile {
  const x = asEmp(e);
  return {
    dependentCount: x.dependentCount ?? 0,
    hasSpouse: x.hasSpouse ?? false,
    taxColumn: x.taxColumn ?? "kou",
    disability: x.disability ?? "none",
    widow: x.widow ?? false,
    singleParent: x.singleParent ?? false,
    workingStudent: x.workingStudent ?? false,
    dependentDisabilityCount: x.dependentDisabilityCount ?? 0,
  };
}

export interface PanelDeductionsInput {
  employee: unknown;
  company: unknown;
  rates: EmployeeInsuranceRates;
  year: number;
  month: number;
  /** その月の標準報酬月額（0＝未設定） */
  standardRemuneration: number;
  grossSalary: number;
  nonTaxableAllowances: number;
  employmentInsuranceExcluded: number;
  employmentInsuranceOverride: number | null;
}

/** 健保・子育て支援金・厚年・雇用保険・源泉税（サーバーの calculateInsuranceAndTax と同じ式） */
export function panelDeductions(i: PanelDeductionsInput): StatutoryDeductions & { error: string | null } {
  const e = asEmp(i.employee);
  const rules = payRulesFromCompany(i.company as Record<string, unknown> | undefined);
  const base = {
    standardRemuneration: i.standardRemuneration,
    grossSalary: i.grossSalary,
    nonTaxableAllowances: i.nonTaxableAllowances,
    employmentInsuranceExcluded: i.employmentInsuranceExcluded,
    careInsuranceApplied: e.careInsuranceApplied === true,
    pensionApplied: pensionAppliedFor(e.pensionApplied, e.dateOfBirth, i.year, i.month),
    healthApplied: healthAppliedFor(e.healthInsuranceMode, e.dateOfBirth, i.year, i.month),
    employmentInsuranceApplied: e.employmentInsuranceApplied !== false,
    employmentInsuranceOverride: i.employmentInsuranceOverride,
    employmentInsuranceRate: i.rates.employmentInsuranceRate,
    rates: i.rates,
    ...exemptFlagsOf(e),
    withholding: withholdingOfEmployee(e),
    rounding: rules.healthChildcareRounding,
  };
  try {
    return { ...calcStatutoryDeductions(base), error: null };
  } catch (err) {
    if (err instanceof OtsuTableMissingError) {
      // 乙欄の表が無いときは源泉税を 0 として表示し、注意を出す（サーバーは計算を止める）
      const r = calcStatutoryDeductions({ ...base, incomeTaxExempt: true });
      return { ...r, error: "乙欄（扶養控除等申告書なし）の税額表が入っていないため、源泉所得税を計算できません。" };
    }
    throw err;
  }
}

/** 通勤手当のうち非課税の上限を超えて課税になる額（社員の通勤の手段が未設定なら 0） */
export function panelCommuteExcess(employee: unknown, rows: Array<{ name: string | undefined; isTaxable: boolean | undefined; amount: number }>): number {
  const e = asEmp(employee);
  const commute = (e.transportationAllowance ?? 0) + rows.filter((r) => r.isTaxable === false && r.name && isCommuteAllowanceName(r.name)).reduce((s, r) => s + (r.amount || 0), 0);
  return commuteTaxableExcess(commute, e.commuteMethod, e.commuteDistanceKm);
}

/** ⑨ 月給の人の欠勤控除（会社設定のスイッチが OFF なら 0） */
export function panelAbsenceDeduction(employee: unknown, company: unknown, base: number, absenceDays: number, scheduledDaysInMonth?: number): number {
  if (asEmp(employee).salaryType !== "fixed") return 0;
  return absenceDeductionFor(base, absenceDays, payRulesFromCompany(company as Record<string, unknown> | undefined), scheduledDaysInMonth);
}

/** 勤怠から金額が決まる手当（サーバーの lib/month-items.ts と同じ式・説明つき） */
export function panelAutoRows(
  employee: unknown,
  attendance: Record<string, unknown> | undefined,
  company: unknown,
  defs: Array<{ id: number; name: string; includeInPremiumBase?: boolean }>,
  rows: Array<{ defId: number | null; amount: number }>,
): AutoRow[] {
  const e = asEmp(employee);
  const rules = payRulesFromCompany(company as Record<string, unknown> | undefined);
  const premiumIds = new Set(defs.filter((d) => d.includeInPremiumBase).map((d) => d.id));
  const ctx = autoContextFromAllowances(rows.map((r) => ({ allowanceDefinitionId: r.defId, amount: r.amount, name: defs.find((d) => d.id === r.defId)?.name })), premiumIds, rules);
  const n = (k: string) => Number(attendance?.[k] ?? 0) || 0;
  return deriveAutoRows(
    { salaryType: e.salaryType ?? null, baseSalary: e.baseSalary ?? 0, dailyRateWeekday: e.dailyRateWeekday, dailyRateSaturday: e.dailyRateSaturday, overtimeHourlyRate: e.overtimeHourlyRate, lateNightHourlyRate: e.lateNightHourlyRate },
    {
      workDays: n("workDays"), saturdayWorkDays: n("saturdayWorkDays"), sundayWorkHours: n("sundayWorkHours"), holidayWorkDays: n("holidayWorkDays"),
      paidLeaveDays: n("paidLeaveDays"), overtimeHours: n("overtimeHours"), lateNightHours: n("lateNightHours"),
      restDayOvertimeHours: n("restDayOvertimeHours"), actualWorkHours: n("actualWorkHours"),
    },
    (company ?? {}) as { dailyWageWeekday?: number; dailyWageSaturday?: number; hourlyWageSunday?: number },
    defs,
    ctx,
  ).rows;
}
