import { pgTable, serial, integer, doublePrecision, text, date, timestamp, unique, index } from "drizzle-orm/pg-core";

/**
 * 給与計算と法令まわりの表（2026-10-24 追加）。
 */

/**
 * 住民税（特別徴収）の月ごとの額。年度＝6月〜翌5月の12回分。
 * collect_year / collect_month は「徴収する月」＝給与を支払う月（6月分＝6月に払う給与＝5月分の明細）。
 * 行が無い月は、これまでどおり社員マスターの residentTax（月額）を使う。
 */
export const residentTaxSchedulesTable = pgTable("resident_tax_schedules", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  collectYear: integer("collect_year").notNull(),
  collectMonth: integer("collect_month").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("resident_tax_schedules_emp_month_unique").on(t.employeeId, t.collectYear, t.collectMonth),
]);

/**
 * 有給の調整（システムを使い始める前の残日数・手で直した分）。
 * days が＋なら付与として足す（2年で消える）、−なら取得済みとして引く。
 */
export const paidLeaveAdjustmentsTable = pgTable("paid_leave_adjustments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  date: date("date").notNull(),
  days: doublePrecision("days").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("paid_leave_adjustments_emp").on(t.employeeId)]);

/** 賞与の明細。確定した行は計算し直さない。 */
export const bonusPaymentsTable = pgTable("bonus_payments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  payDate: date("pay_date").notNull(),
  amount: doublePrecision("amount").notNull(),
  /** 賞与の計算の対象になった期間の月数（6か月を超えると月額表の計算で12で割る） */
  periodMonths: integer("period_months").notNull().default(6),
  standardBonus: doublePrecision("standard_bonus").notNull().default(0),
  healthStandard: doublePrecision("health_standard").notNull().default(0),
  pensionStandard: doublePrecision("pension_standard").notNull().default(0),
  healthInsurance: doublePrecision("health_insurance").notNull().default(0),
  childcareSupportContribution: doublePrecision("childcare_support_contribution").notNull().default(0),
  pension: doublePrecision("pension").notNull().default(0),
  employmentInsurance: doublePrecision("employment_insurance").notNull().default(0),
  incomeTax: doublePrecision("income_tax"),
  netAmount: doublePrecision("net_amount"),
  /** rate＝算出率の表／monthly＝月額表で計算 */
  incomeTaxMethod: text("income_tax_method"),
  status: text("status").notNull().default("draft"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("bonus_payments_emp").on(t.employeeId)]);

/** 年末調整の申告書の中身（扶養控除等・保険料控除・基礎控除など）。年×社員で1行・中身は JSON。 */
export const yearendDeclarationsTable = pgTable("yearend_declarations", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  year: integer("year").notNull(),
  data: text("data").notNull().default("{}"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("yearend_declarations_emp_year_unique").on(t.employeeId, t.year)]);

/**
 * 雇用保険料の不足分（4〜8月分を 0.0005 で計算していた件）を、何月の控除で取り戻したかの記録。
 * 取り戻すと決めた月の「その他の控除」に行を足し、ここに残す（二重に足さないため）。
 */
export const employmentInsuranceSettlementsTable = pgTable("employment_insurance_settlements", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  /** 不足していた明細の年月 */
  fromYear: integer("from_year").notNull(),
  fromMonth: integer("from_month").notNull(),
  amount: doublePrecision("amount").notNull(),
  /** 控除に足した明細の年月 */
  applyYear: integer("apply_year").notNull(),
  applyMonth: integer("apply_month").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique("employment_insurance_settlements_unique").on(t.employeeId, t.fromYear, t.fromMonth)]);
