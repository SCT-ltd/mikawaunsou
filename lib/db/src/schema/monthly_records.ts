import { pgTable, serial, integer, doublePrecision, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const monthlyRecordsTable = pgTable("monthly_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  workDays: doublePrecision("work_days").notNull().default(0),
  overtimeHours: doublePrecision("overtime_hours").notNull().default(0),
  lateNightHours: doublePrecision("late_night_hours").notNull().default(0),
  holidayWorkDays: doublePrecision("holiday_work_days").notNull().default(0),
  drivingDistanceKm: doublePrecision("driving_distance_km").notNull().default(0),
  deliveryCases: integer("delivery_cases").notNull().default(0),
  absenceDays: doublePrecision("absence_days").notNull().default(0),
  saturdayWorkDays: doublePrecision("saturday_work_days").notNull().default(0),
  sundayWorkHours: doublePrecision("sunday_work_hours").notNull().default(0),
  notes: text("notes"),
  salesAmount: doublePrecision("sales_amount").notNull().default(0),
  commissionRate: doublePrecision("commission_rate").notNull().default(0),
  fixedOvertimeHours: doublePrecision("fixed_overtime_hours").notNull().default(0),
  overtimeUnitPrice: doublePrecision("overtime_unit_price").notNull().default(2111),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("monthly_records_employee_year_month_unique").on(t.employeeId, t.year, t.month),
]);

export const insertMonthlyRecordSchema = createInsertSchema(monthlyRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMonthlyRecord = z.infer<typeof insertMonthlyRecordSchema>;
export type MonthlyRecord = typeof monthlyRecordsTable.$inferSelect;
