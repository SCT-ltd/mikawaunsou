/**
 * 1人・1か月の給与計算に要る「法令まわりの前提」を集める（DB を読むのはここだけ。式は payroll-core.ts）。
 *   - 会社設定のスイッチ（PayRules）
 *   - 健康保険（75歳）・厚生年金（70歳）を引くか、保険・税を止める印
 *   - 源泉税の甲欄・乙欄と扶養親族等の数に足す分
 *   - その月の住民税（月ごとの額があればそれ、無ければ社員マスターの月額）
 *   - その月の所定労働日数（欠勤控除の日割り用）
 */
import { db, residentTaxSchedulesTable, employeesTable, companyTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  payRulesFromCompany,
  pensionAppliedFor,
  healthAppliedFor,
  exemptFlagsOf,
  residentTaxCollectMonth,
  commuteTaxableExcess,
  isCommuteAllowanceName,
  hourlyForMinimumWage,
  type PayRules,
  type WithholdingProfile,
} from "@workspace/tax-tables-reiwa8/core";
import { japaneseHolidays } from "./jp-holidays";

type Emp = typeof employeesTable.$inferSelect;
type Company = Partial<typeof companyTable.$inferSelect>;

export interface PayrollContext {
  rules: PayRules;
  healthApplied: boolean;
  pensionApplied: boolean;
  socialInsuranceExempt: boolean;
  employmentInsuranceExempt: boolean;
  incomeTaxExempt: boolean;
  withholding: WithholdingProfile;
  residentTax: number;
  /** 住民税を月ごとの表から取ったか（false＝社員マスターの月額） */
  residentTaxFromSchedule: boolean;
  scheduledDaysInMonth: number;
}

/** その月の平日（土日・祝日を除く）の日数 */
export function scheduledWeekdays(year: number, month: number): number {
  const hol = japaneseHolidays(year);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    const w = dt.getUTCDay();
    const key = dt.toISOString().slice(0, 10);
    if (w !== 0 && w !== 6 && !hol.has(key)) n++;
  }
  return n;
}

export async function residentTaxFor(emp: Pick<Emp, "id" | "residentTax">, year: number, month: number): Promise<{ amount: number; fromSchedule: boolean }> {
  const c = residentTaxCollectMonth(year, month);
  const [row] = await db.select().from(residentTaxSchedulesTable).where(and(
    eq(residentTaxSchedulesTable.employeeId, emp.id),
    eq(residentTaxSchedulesTable.collectYear, c.year),
    eq(residentTaxSchedulesTable.collectMonth, c.month),
  ));
  return row ? { amount: row.amount ?? 0, fromSchedule: true } : { amount: emp.residentTax ?? 0, fromSchedule: false };
}

export function withholdingOf(emp: Emp): WithholdingProfile {
  return {
    dependentCount: emp.dependentCount ?? 0,
    hasSpouse: emp.hasSpouse ?? false,
    taxColumn: emp.taxColumn ?? "kou",
    disability: emp.disability ?? "none",
    widow: emp.widow ?? false,
    singleParent: emp.singleParent ?? false,
    workingStudent: emp.workingStudent ?? false,
    dependentDisabilityCount: emp.dependentDisabilityCount ?? 0,
  };
}

export async function loadPayrollContext(emp: Emp, company: Company, year: number, month: number): Promise<PayrollContext> {
  const rules = payRulesFromCompany(company as Record<string, unknown>);
  const rt = await residentTaxFor(emp, year, month);
  return {
    rules,
    healthApplied: healthAppliedFor(emp.healthInsuranceMode, emp.dateOfBirth, year, month),
    pensionApplied: pensionAppliedFor(emp.pensionApplied, emp.dateOfBirth, year, month),
    ...exemptFlagsOf(emp),
    withholding: withholdingOf(emp),
    residentTax: rt.amount,
    residentTaxFromSchedule: rt.fromSchedule,
    scheduledDaysInMonth: scheduledWeekdays(year, month),
  };
}

/** 通勤手当のうち非課税の上限を超えた分（課税に回す額）。手当の行とマスターの通勤手当から出す。 */
export function commuteExcessOf(emp: Emp, allowances: Array<{ allowanceName: string; isTaxable: boolean; amount: number }>): number {
  const commute = (emp.transportationAllowance ?? 0)
    + allowances.filter((a) => !a.isTaxable && isCommuteAllowanceName(a.allowanceName)).reduce((s, a) => s + a.amount, 0);
  return commuteTaxableExcess(commute, emp.commuteMethod, emp.commuteDistanceKm);
}

/**
 * 計算のときの注意（明細に残して画面に出す）。最低賃金・退職の月・ブルーウィングの手入力固定。
 */
export function payrollWarnings(
  emp: Emp,
  company: Company,
  year: number,
  month: number,
  opts: { includedAllowances: number; calculationMode: string; monthlyBase?: number },
): string[] {
  const out: string[] = [];
  const rules = payRulesFromCompany(company as Record<string, unknown>);
  const minWage = company.minimumWageHourly ?? 0;
  if (minWage > 0) {
    const weekday = (emp.dailyRateWeekday ?? 0) > 0 ? emp.dailyRateWeekday : (company.dailyWageWeekday ?? 9808);
    const hourly = hourlyForMinimumWage(emp.salaryType, {
      weekdayDaily: weekday ?? 0,
      monthlyBase: opts.monthlyBase ?? emp.baseSalary ?? 0,
      hourlyWage: emp.baseSalary ?? 0,
    }, opts.includedAllowances, rules);
    const effective = company.minimumWageEffectiveDate ? String(company.minimumWageEffectiveDate) : null;
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-31`;
    if ((!effective || effective <= monthEnd) && hourly + 1e-9 < minWage) {
      out.push(`最低賃金（${minWage.toLocaleString("ja-JP")}円）を下回っています：1時間あたり ${Math.floor(hourly).toLocaleString("ja-JP")}円（基本給＋算入する手当 ÷ 所定時間）`);
    }
  }
  if (emp.retirementDate) {
    const r = String(emp.retirementDate).slice(0, 10);
    const [ry, rm, rd] = r.split("-").map(Number);
    if (ry === year && rm === month) {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      out.push(rd === last
        ? `${month}月末で退職：資格を失うのは翌月1日なので、${month}月分の社会保険料はかかります。`
        : `${month}月${rd}日に退職（月末ではない）：資格を失うのは${rd + 1 > last ? "翌月1日" : `${month}月${rd + 1}日`}で、${month}月分の社会保険料はかからないことがあります。社労士に確認してください。`);
    }
  }
  if (emp.useBluewingLogic && opts.calculationMode === "manual") {
    out.push("ブルーウィングの計算対象ですが「手入力固定」で計算しています。業績手当・超過残業代・固定残業代は自動では入りません（手当に入れた金額だけが支給されます）。");
  }
  if (emp.taxColumn === "otsu") {
    out.push("扶養控除等申告書が出ていない（乙欄）ため、源泉所得税は乙欄で計算しています。");
  }
  return out;
}
