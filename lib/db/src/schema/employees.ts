import { pgTable, serial, text, integer, doublePrecision, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeCode: text("employee_code").notNull().unique(),
  name: text("name").notNull(),
  nameKana: text("name_kana").notNull(),
  department: text("department").notNull(),
  position: text("position").notNull().default(""),
  baseSalary: doublePrecision("base_salary").notNull(),
  transportationAllowance: doublePrecision("transportation_allowance").notNull().default(0),
  safetyDrivingAllowance: doublePrecision("safety_driving_allowance").notNull().default(0),
  longDistanceAllowance: doublePrecision("long_distance_allowance").notNull().default(0),
  positionAllowance: doublePrecision("position_allowance").notNull().default(0),
  familyAllowance: doublePrecision("family_allowance").notNull().default(0),
  earlyOvertimeAllowance: doublePrecision("early_overtime_allowance").notNull().default(0),
  commissionRatePerKm: doublePrecision("commission_rate_per_km").notNull().default(0),
  commissionRatePerCase: doublePrecision("commission_rate_per_case").notNull().default(0),
  dependentCount: integer("dependent_count").notNull().default(0),
  hasSpouse: boolean("has_spouse").notNull().default(false),
  healthInsuranceMonthly: doublePrecision("health_insurance_monthly").notNull().default(0),
  pensionMonthly: doublePrecision("pension_monthly").notNull().default(0),
  employmentInsuranceApplied: boolean("employment_insurance_applied").notNull().default(true),
  residentTax: doublePrecision("resident_tax").notNull().default(0),
  hireDate: date("hire_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  pin: text("pin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
