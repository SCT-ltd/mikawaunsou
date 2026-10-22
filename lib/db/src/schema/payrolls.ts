import { pgTable, serial, integer, doublePrecision, text, timestamp, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const payrollsTable = pgTable("payrolls", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  status: text("status").notNull().default("draft"),
  baseSalary: doublePrecision("base_salary").notNull().default(0),
  overtimePay: doublePrecision("overtime_pay").notNull().default(0),
  lateNightPay: doublePrecision("late_night_pay").notNull().default(0),
  holidayPay: doublePrecision("holiday_pay").notNull().default(0),
  saturdayPay: doublePrecision("saturday_pay").notNull().default(0),
  commissionPay: doublePrecision("commission_pay").notNull().default(0),
  transportationAllowance: doublePrecision("transportation_allowance").notNull().default(0),
  safetyDrivingAllowance: doublePrecision("safety_driving_allowance").notNull().default(0),
  longDistanceAllowance: doublePrecision("long_distance_allowance").notNull().default(0),
  positionAllowance: doublePrecision("position_allowance").notNull().default(0),
  familyAllowance: doublePrecision("family_allowance").notNull().default(0),
  earlyOvertimeAllowance: doublePrecision("early_overtime_allowance").notNull().default(0),
  absenceDeduction: doublePrecision("absence_deduction").notNull().default(0),
  grossSalary: doublePrecision("gross_salary").notNull().default(0),
  socialInsurance: doublePrecision("social_insurance").notNull().default(0),
  childcareSupportContribution: doublePrecision("childcare_support_contribution").notNull().default(0),
  employmentInsurance: doublePrecision("employment_insurance").notNull().default(0),
  incomeTax: doublePrecision("income_tax").notNull().default(0),
  residentTax: doublePrecision("resident_tax").notNull().default(0),
  totalDeductions: doublePrecision("total_deductions").notNull().default(0),
  netSalary: doublePrecision("net_salary").notNull().default(0),
  customAllowancesTotal: doublePrecision("custom_allowances_total").notNull().default(0),
  overtimeHours: doublePrecision("overtime_hours").notNull().default(0),
  lateNightHours: doublePrecision("late_night_hours").notNull().default(0),
  holidayWorkDays: doublePrecision("holiday_work_days").notNull().default(0),
  /** 明細表示用: 日曜・祝日の出勤時間（monthly_records.sundayWorkHours のスナップショット）*/
  holidayWorkHours: doublePrecision("holiday_work_hours").notNull().default(0),
  /** 明細表示用: 祝日の出勤日数（monthly_records.holidayWorkDays のスナップショット）。土曜と同じ1.25倍の日当で計算 */
  publicHolidayWorkDays: doublePrecision("public_holiday_work_days").notNull().default(0),
  /** 明細表示用: 有給休暇の日数（monthly_records.paidLeaveDays のスナップショット）*/
  paidLeaveDays: doublePrecision("paid_leave_days").notNull().default(0),
  saturdayWorkDays: doublePrecision("saturday_work_days").notNull().default(0),
  workDays: doublePrecision("work_days").notNull().default(0),
  notes: text("notes"),
  useMikawaLogic: boolean("use_mikawa_logic").notNull().default(false),
  useBluewingLogic: boolean("use_bluewing_logic").notNull().default(false),
  bluewingSalesAmount: doublePrecision("bluewing_sales_amount").notNull().default(0),
  bluewingPerformanceAllowance: doublePrecision("bluewing_performance_allowance").notNull().default(0),
  salesAmount: doublePrecision("sales_amount").notNull().default(0),
  commissionRate: doublePrecision("commission_rate").notNull().default(0),
  performanceAllowance: doublePrecision("performance_allowance").notNull().default(0),
  calculationMode: text("calculation_mode").notNull().default("auto"),
  customDeductionsTotal: doublePrecision("custom_deductions_total").notNull().default(0),
  // ── 計算に使った保険の基準（スナップショット）。料率・標準報酬月額は履歴で月ごとに変わるため、
  //    「この明細はどの値で計算したか」を後から確認できるように残す。この列が入る前の明細は null。
  /** 保険料の計算に使った標準報酬月額（未設定の社員は総支給で計算した値）*/
  appliedStandardRemuneration: doublePrecision("applied_standard_remuneration"),
  /** 健康保険料率（合計）*/
  appliedHealthInsuranceRate: doublePrecision("applied_health_insurance_rate"),
  /** 介護保険料率（合計）。介護保険の対象外の社員は 0 */
  appliedCareInsuranceRate: doublePrecision("applied_care_insurance_rate"),
  /** 子ども・子育て支援金率（合計）*/
  appliedChildcareSupportRate: doublePrecision("applied_childcare_support_rate"),
  /** 厚生年金保険料率（合計）*/
  appliedPensionRate: doublePrecision("applied_pension_rate"),
  /** 雇用保険料率（本人負担）*/
  appliedEmploymentInsuranceRate: doublePrecision("applied_employment_insurance_rate"),
  /** 健康保険料（介護込み）と厚生年金保険料。印刷はこの値をそのまま出す（この列が入る前の明細は null） */
  healthInsuranceAmount: doublePrecision("health_insurance_amount"),
  pensionAmount: doublePrecision("pension_amount"),
  /** 計算のときに見つかった注意（最低賃金を下回る など）。JSON の文字列の配列 */
  calcWarnings: text("calc_warnings"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("payrolls_employee_year_month_unique").on(t.employeeId, t.year, t.month),
]);

export const insertPayrollSchema = createInsertSchema(payrollsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrollsTable.$inferSelect;
