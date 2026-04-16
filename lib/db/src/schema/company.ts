import { pgTable, serial, text, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companyTable = pgTable("company", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  closingDay: integer("closing_day").notNull().default(31),
  paymentDay: integer("payment_day").notNull().default(25),
  monthlyAverageWorkHours: doublePrecision("monthly_average_work_hours").notNull().default(160),
  socialInsuranceRate: doublePrecision("social_insurance_rate").notNull().default(0.1495),
  employmentInsuranceRate: doublePrecision("employment_insurance_rate").notNull().default(0.006),
  healthInsuranceEmployeeRate: doublePrecision("health_insurance_employee_rate").notNull().default(0.04925),
  healthInsuranceEmployerRate: doublePrecision("health_insurance_employer_rate").notNull().default(0.04925),
  careInsuranceRate: doublePrecision("care_insurance_rate").notNull().default(0.0091),
  pensionEmployeeRate: doublePrecision("pension_employee_rate").notNull().default(0.0915),
  pensionEmployerRate: doublePrecision("pension_employer_rate").notNull().default(0.0915),
  employmentInsuranceEmployerRate: doublePrecision("employment_insurance_employer_rate").notNull().default(0.0085),
  overtimeRate: doublePrecision("overtime_rate").notNull().default(1.25),
  lateNightAdditionalRate: doublePrecision("late_night_additional_rate").notNull().default(0.25),
  holidayRate: doublePrecision("holiday_rate").notNull().default(1.35),
  dailyWageWeekday: doublePrecision("daily_wage_weekday").notNull().default(9808),
  dailyWageSaturday: doublePrecision("daily_wage_saturday").notNull().default(12260),
  hourlyWageSunday: doublePrecision("hourly_wage_sunday").notNull().default(1655),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companyTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companyTable.$inferSelect;
