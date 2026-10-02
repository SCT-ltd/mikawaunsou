/**
 * 保険料率マスター・標準報酬月額の履歴から、給与明細の年月に効く値を解決する。
 *
 * どちらも「適用開始（給与明細の年月）がその月以前で、いちばん新しい行」を使う。
 * - 料率: 表が空なら初回に初期行を作る（従来の内蔵値＋会社設定の雇用保険料率。計算結果は変わらない）。
 * - 標準報酬月額: 該当行が無ければ社員マスタの standard_remuneration（初期値）を使う。
 */
import {
  db,
  companyTable,
  employeesTable,
  insuranceRatePeriodsTable,
  standardRemunerationHistoryTable,
  type InsuranceRatePeriod,
  type StandardRemunerationHistory,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { EMP_INS_RATE_R8, PENSION_MAX_STD, type EmployeeInsuranceRates } from "./tax-tables-reiwa8";

/** 年月を大小比較できる整数にする（2026年9月 → 202609）*/
export const ym = (year: number, month: number) => year * 100 + month;

/** 折半した率の浮動小数の誤差を落とす（(0.0985 + 0.0162) / 2 = 0.057350000000000005 → 0.05735）*/
const half = (rate: number) => Math.round((rate / 2) * 1e10) / 1e10;

export interface EffectiveInsuranceRates extends EmployeeInsuranceRates {
  periodId: number | null;
  effectiveYear: number | null;
  effectiveMonth: number | null;
  /** 合計の率（保険料額表の表記どおり）*/
  healthInsuranceRate: number;
  careInsuranceRate: number;
  childcareSupportRate: number;
  pensionRate: number;
  /** 雇用保険料率（本人負担）*/
  employmentInsuranceRate: number;
  note: string | null;
}

/**
 * 表が空のときに作る初期行。従来のプログラム内の値をそのまま移す:
 *   - 健保 9.85% / 介護 1.62% / 厚年 18.3%・上限65万（令和8年度の内蔵定数）
 *   - 子ども・子育て支援金は 2026年4月の明細から 0.23%（旧 isChildcareSupportApplicable）
 *   - 雇用保険は会社設定の値（0 以下なら 0.5%）
 */
async function buildSeedRows() {
  const [company] = await db.select().from(companyTable).limit(1);
  const empRate = (company?.employmentInsuranceRate ?? 0) > 0 ? company!.employmentInsuranceRate : EMP_INS_RATE_R8;
  const common = {
    healthInsuranceRate: 0.0985,
    careInsuranceRate: 0.0162,
    pensionRate: 0.183,
    employmentInsuranceRate: empRate,
    pensionMaxStandard: PENSION_MAX_STD,
  };
  return [
    { ...common, effectiveYear: 2000, effectiveMonth: 1, childcareSupportRate: 0, note: "初期値（子ども・子育て支援金の開始前）" },
    { ...common, effectiveYear: 2026, effectiveMonth: 4, childcareSupportRate: 0.0023, note: "令和8年度（子ども・子育て支援金の開始）" },
  ];
}

/** 料率の履歴を適用開始の古い順に返す。空なら初期行を作ってから返す。*/
export async function listInsuranceRatePeriods(): Promise<InsuranceRatePeriod[]> {
  const order = [asc(insuranceRatePeriodsTable.effectiveYear), asc(insuranceRatePeriodsTable.effectiveMonth)];
  let rows = await db.select().from(insuranceRatePeriodsTable).orderBy(...order);
  if (rows.length === 0) {
    // 同時に2つのリクエストが来ても一意制約で重複しない
    await db.insert(insuranceRatePeriodsTable).values(await buildSeedRows()).onConflictDoNothing();
    rows = await db.select().from(insuranceRatePeriodsTable).orderBy(...order);
  }
  return rows;
}

export function toEffectiveRates(row: InsuranceRatePeriod): EffectiveInsuranceRates {
  return {
    periodId: row.id,
    effectiveYear: row.effectiveYear,
    effectiveMonth: row.effectiveMonth,
    healthInsuranceRate: row.healthInsuranceRate,
    careInsuranceRate: row.careInsuranceRate,
    childcareSupportRate: row.childcareSupportRate,
    pensionRate: row.pensionRate,
    employmentInsuranceRate: row.employmentInsuranceRate,
    pensionMaxStandard: row.pensionMaxStandard,
    note: row.note ?? null,
    healthEmployeeRate: half(row.healthInsuranceRate),
    healthWithCareEmployeeRate: half(row.healthInsuranceRate + row.careInsuranceRate),
    childcareEmployeeRate: half(row.childcareSupportRate),
    pensionEmployeeRate: half(row.pensionRate),
  };
}

/** 履歴（古い順・新しい順どちらでも可）から、その明細の年月に効く行を選ぶ */
export function pickEffective<T extends { effectiveYear: number; effectiveMonth: number }>(
  rows: T[], year: number, month: number,
): T | undefined {
  const target = ym(year, month);
  let best: T | undefined;
  for (const r of rows) {
    const k = ym(r.effectiveYear, r.effectiveMonth);
    if (k <= target && (!best || k > ym(best.effectiveYear, best.effectiveMonth))) best = r;
  }
  return best;
}

export async function getEffectiveInsuranceRates(year: number, month: number): Promise<EffectiveInsuranceRates> {
  const rows = await listInsuranceRatePeriods();
  // どの行よりも前の月は、いちばん古い行を使う（計算を止めないため）
  const row = pickEffective(rows, year, month) ?? rows[0];
  return toEffectiveRates(row);
}

export interface EffectiveStandardRemuneration {
  employeeId: number;
  /** その月に使う標準報酬月額（0 = 未設定。計算では総支給を使う）*/
  standardRemuneration: number;
  /** 履歴の行から来たときの情報。社員マスタの初期値のときは null */
  historyId: number | null;
  effectiveYear: number | null;
  effectiveMonth: number | null;
  reason: string | null;
}

export function resolveStandardRemuneration(
  emp: { id: number; standardRemuneration: number | null },
  history: StandardRemunerationHistory[],
  year: number,
  month: number,
): EffectiveStandardRemuneration {
  const row = pickEffective(history.filter((h) => h.employeeId === emp.id), year, month);
  if (row) {
    return {
      employeeId: emp.id,
      standardRemuneration: row.amount,
      historyId: row.id,
      effectiveYear: row.effectiveYear,
      effectiveMonth: row.effectiveMonth,
      reason: row.reason,
    };
  }
  return {
    employeeId: emp.id,
    standardRemuneration: emp.standardRemuneration ?? 0,
    historyId: null,
    effectiveYear: null,
    effectiveMonth: null,
    reason: null,
  };
}

export async function getEffectiveStandardRemuneration(
  emp: typeof employeesTable.$inferSelect,
  year: number,
  month: number,
): Promise<EffectiveStandardRemuneration> {
  const history = await db.select().from(standardRemunerationHistoryTable)
    .where(eq(standardRemunerationHistoryTable.employeeId, emp.id));
  return resolveStandardRemuneration(emp, history, year, month);
}
