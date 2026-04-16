import { pgTable, serial, text, integer, date, timestamp, doublePrecision, unique } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  eventType: text("event_type").notNull(), // 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
  workDate: date("work_date").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  note: text("note"),
  startOdometer: doublePrecision("start_odometer"),
  endOdometer: doublePrecision("end_odometer"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type InsertAttendanceRecord = typeof attendanceRecordsTable.$inferInsert;

// 欠勤・休暇記録
// absenceType: 'sick'=病欠, 'paid_leave'=有給, 'bereavement'=忌引き,
//              'morning_half'=午前休み, 'afternoon_half'=午後休み, 'other'=その他
export const absenceRecordsTable = pgTable("absence_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  absenceType: text("absence_type").notNull(),
  workDate: date("work_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AbsenceRecord = typeof absenceRecordsTable.$inferSelect;
export type InsertAbsenceRecord = typeof absenceRecordsTable.$inferInsert;

// リアルタイム位置情報（社員ごとの最新GPS座標）
export const liveLocationsTable = pgTable("live_locations", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracy: doublePrecision("accuracy"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("live_locations_employee_unique").on(t.employeeId)]);

export type LiveLocation = typeof liveLocationsTable.$inferSelect;
export type InsertLiveLocation = typeof liveLocationsTable.$inferInsert;
