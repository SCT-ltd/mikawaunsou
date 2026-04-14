import { pgTable, serial, text, integer, date, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  eventType: text("event_type").notNull(), // 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
  workDate: date("work_date").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type InsertAttendanceRecord = typeof attendanceRecordsTable.$inferInsert;
