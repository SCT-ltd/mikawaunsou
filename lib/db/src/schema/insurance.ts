import { pgTable, serial, integer, doublePrecision, text, timestamp, unique } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

/**
 * 社会保険・雇用保険の料率の履歴（年度改定をマスターで切り替えるための表）。
 *
 * - 料率は保険料額表に載っている「会社＋本人の合計」の率で持つ（例: 健康保険 0.0985）。
 *   本人負担はその半分として計算する。雇用保険だけは「本人負担」の率で持つ。
 * - 適用開始は**給与明細の年月**（payrolls.year / month）で数える。
 *   明細の年月に対して「適用開始がその月以前で、いちばん新しい行」を使う。
 */
export const insuranceRatePeriodsTable = pgTable("insurance_rate_periods", {
  id: serial("id").primaryKey(),
  effectiveYear: integer("effective_year").notNull(),
  effectiveMonth: integer("effective_month").notNull(),
  /** 健康保険料率（合計。本人は半分）*/
  healthInsuranceRate: doublePrecision("health_insurance_rate").notNull(),
  /** 介護保険料率（合計。40〜64歳のみ、本人は半分）*/
  careInsuranceRate: doublePrecision("care_insurance_rate").notNull(),
  /** 子ども・子育て支援金率（合計。本人は半分）*/
  childcareSupportRate: doublePrecision("childcare_support_rate").notNull(),
  /** 厚生年金保険料率（合計。本人は半分）*/
  pensionRate: doublePrecision("pension_rate").notNull(),
  /** 雇用保険料率（本人負担）*/
  employmentInsuranceRate: doublePrecision("employment_insurance_rate").notNull(),
  /** 厚生年金の標準報酬月額の上限 */
  pensionMaxStandard: integer("pension_max_standard").notNull().default(650000),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("insurance_rate_periods_effective_unique").on(t.effectiveYear, t.effectiveMonth),
]);

export type InsuranceRatePeriod = typeof insuranceRatePeriodsTable.$inferSelect;

/**
 * 社員ごとの標準報酬月額の履歴（定時決定・随時改定など）。
 * 適用開始は給与明細の年月。該当する行が無い月は employees.standard_remuneration（初期値）を使う。
 */
export const standardRemunerationHistoryTable = pgTable("standard_remuneration_history", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  effectiveYear: integer("effective_year").notNull(),
  effectiveMonth: integer("effective_month").notNull(),
  amount: doublePrecision("amount").notNull(),
  /** teiji（定時決定）/ zuiji（随時改定）/ shikaku（資格取得）/ other */
  reason: text("reason").notNull().default("teiji"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("standard_remuneration_history_emp_effective_unique").on(t.employeeId, t.effectiveYear, t.effectiveMonth),
]);

export type StandardRemunerationHistory = typeof standardRemunerationHistoryTable.$inferSelect;
