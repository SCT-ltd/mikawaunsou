import { pgTable, serial, integer, doublePrecision, text, boolean, timestamp, unique, index } from "drizzle-orm/pg-core";

/**
 * 月ごとの手当・控除（社員 × 年月）。
 *
 * これまで手当・控除は「社員ごとに1つ」（employee_allowances / employee_deductions）で、
 * 年月を持たなかった。そのため
 *   - 未確定の先月分を開いただけで、その月の勤怠から計算した金額で今月用の手当が書き換わる
 *   - 確定済みの明細を刷り直すと、内訳だけが「今の手当」になり合計と合わない
 * という問題があった。ここに月ごとの控えを持ち、計算・画面・印刷はその月の行を使う。
 *
 * employee_month_sets の行がある＝その月の手当・控除は確定した内容を持っている（0行でも「無し」と確定）。
 * 行が無い月は、従来どおり社員ごとの手当（＝直近の月の内容）を初期値として使う。
 *
 * 手当名・課税区分は当時の値を写して持つ（手当マスターを後で変えても、過去の明細の内訳は変わらない）。
 */
export const employeeMonthSetsTable = pgTable("employee_month_sets", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  /** 日給制の人の、その月の基本給（勤怠から計算した額、または手で直した額）。月給・時給は null。 */
  baseSalary: doublePrecision("base_salary"),
  /**
   * 最後に勤怠から出した金額の控え（JSON）。勤怠が変わったとき、手で直していない行だけを
   * 入れ直すために使う（今の金額がこの控えと同じ＝手で直していない）。lib/month-items.ts を参照。
   */
  autoValues: text("auto_values"),
  /** その月の雇用保険料を手で決めた額。null＝自動計算（総支給 × 料率）。 */
  employmentInsuranceOverride: doublePrecision("employment_insurance_override"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("employee_month_sets_employee_year_month_unique").on(t.employeeId, t.year, t.month),
]);

export const employeeMonthAllowancesTable = pgTable("employee_month_allowances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  allowanceDefinitionId: integer("allowance_definition_id").notNull(),
  allowanceName: text("allowance_name").notNull(),
  isTaxable: boolean("is_taxable").notNull().default(true),
  excludeFromEmploymentInsurance: boolean("exclude_from_employment_insurance").notNull().default(false),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  index("employee_month_allowances_lookup").on(t.employeeId, t.year, t.month),
]);

export const employeeMonthDeductionsTable = pgTable("employee_month_deductions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  deductionDefinitionId: integer("deduction_definition_id").notNull(),
  deductionName: text("deduction_name").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  index("employee_month_deductions_lookup").on(t.employeeId, t.year, t.month),
]);
