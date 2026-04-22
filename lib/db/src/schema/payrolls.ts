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
  employmentInsurance: doublePrecision("employment_insurance").notNull().default(0),
  incomeTax: doublePrecision("income_tax").notNull().default(0),
  residentTax: doublePrecision("resident_tax").notNull().default(0),
  totalDeductions: doublePrecision("total_deductions").notNull().default(0),
  netSalary: doublePrecision("net_salary").notNull().default(0),
  customAllowancesTotal: doublePrecision("custom_allowances_total").notNull().default(0),
  overtimeHours: doublePrecision("overtime_hours").notNull().default(0),
  lateNightHours: doublePrecision("late_night_hours").notNull().default(0),
  holidayWorkDays: doublePrecision("holiday_work_days").notNull().default(0),
  workDays: doublePrecision("work_days").notNull().default(0),
  notes: text("notes"),
  useMikawaLogic: boolean("use_mikawa_logic").notNull().default(false),
  salesAmount: doublePrecision("sales_amount").notNull().default(0),
  commissionRate: doublePrecision("commission_rate").notNull().default(0),
  performanceAllowance: doublePrecision("performance_allowance").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("payrolls_employee_year_month_unique").on(t.employeeId, t.year, t.month),
]);

export const insertPayrollSchema = createInsertSchema(payrollsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrollsTable.$inferSelect;
