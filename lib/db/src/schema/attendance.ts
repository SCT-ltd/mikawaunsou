import { pgTable, serial, text, integer, date, timestamp, doublePrecision, unique, boolean, index } from "drizzle-orm/pg-core";
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
  checklistNgItems: text("checklist_ng_items"),
  /** 端末が打刻ごとに作る番号。電波が悪くて送り直したときに、同じ打刻を2回入れないために使う */
  clientId: text("client_id"),
  /** 取り消した日時（取り消した打刻は消さずに残し、集計からは外す） */
  voidedAt: timestamp("voided_at"),
  voidReason: text("void_reason"),
  /** 取り消した人（本人／事務所のユーザー名） */
  voidedBy: text("voided_by"),
  /** どこから入った打刻か：qr（その場で）／offline（電波が戻ってから）／admin（管理画面）／correction（修正申請の承認）／auto（自動で足したもの） */
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type InsertAttendanceRecord = typeof attendanceRecordsTable.$inferInsert;

// 欠勤・休暇記録
// absenceType: 'sick'=病欠, 'paid_leave'=有給, 'paid_leave_am'=午前の半日有給, 'paid_leave_pm'=午後の半日有給,
//              'bereavement'=忌引き, 'morning_half'=午前休み, 'afternoon_half'=午後休み, 'other'=その他
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

// 入力中ドラフト（出発・到着地・走行距離 — 打刻前の入力内容をリアルタイム保存）
export const attendanceDraftsTable = pgTable("attendance_drafts", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  workDate: date("work_date").notNull(),
  departure: text("departure"),
  arrival: text("arrival"),
  startOdometer: doublePrecision("start_odometer"),
  endOdometer: doublePrecision("end_odometer"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("attendance_drafts_emp_date_unique").on(t.employeeId, t.workDate)]);

export type AttendanceDraft = typeof attendanceDraftsTable.$inferSelect;
export type InsertAttendanceDraft = typeof attendanceDraftsTable.$inferInsert;

/**
 * 打刻の変更の記録（取り消し・修正・修正申請の承認・自動で足した休憩終了など）。
 * 打刻は消さずに残し、だれが・いつ・なにを・なぜ変えたかをここに残す。
 * before / after は打刻の行を JSON にしたもの。
 */
export const attendanceRecordLogsTable = pgTable("attendance_record_logs", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id"),
  employeeId: integer("employee_id").notNull(),
  workDate: date("work_date"),
  action: text("action").notNull(), // 'cancel' | 'edit' | 'add' | 'correction' | 'auto_break_end' | 'delete'
  before: text("before"),
  after: text("after"),
  actor: text("actor").notNull(),
  reason: text("reason"),
  at: timestamp("at").notNull().defaultNow(),
});

/**
 * 打刻の修正申請。ドライバーが理由をつけて出し、事務所が承認すると打刻に反映する。
 * kind: 'add'（打ち忘れを足す）| 'change'（時刻を直す）| 'cancel'（取り消す）
 */
export const attendanceCorrectionsTable = pgTable("attendance_corrections", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  workDate: date("work_date").notNull(),
  kind: text("kind").notNull(),
  eventType: text("event_type"),
  recordId: integer("record_id"),
  /** 直したい時刻（add / change のとき） */
  requestedAt: timestamp("requested_at"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  resultRecordId: integer("result_record_id"),
  clientId: text("client_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * 日常点検（1人1日1件）。出勤の前でも書ける。
 * items は {項目ID: "良"|"否"} の JSON。全項目に答えるまでは「未点検」。
 * 事務所は「否」があったときの処置と、運行してよいかの判断を残す。
 */
export const dailyInspectionsTable = pgTable("daily_inspections", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  workDate: date("work_date").notNull(),
  vehicle: text("vehicle"),
  items: text("items").notNull().default("{}"),
  total: integer("total").notNull().default(0),
  checked: integer("checked").notNull().default(0),
  /** 「否」だった項目の名前（JSON の配列） */
  ng: text("ng").notNull().default("[]"),
  officeAction: text("office_action"),
  /** 事務所の判断：'ok'（運行してよい）| 'ng'（運行しない） */
  officeDecision: text("office_decision"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("daily_inspections_emp_date_unique").on(t.employeeId, t.workDate)]);

/** 出勤したあとに点検を書き換えたときの履歴 */
export const inspectionHistoryTable = pgTable("inspection_history", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  workDate: date("work_date").notNull(),
  before: text("before"),
  after: text("after"),
  actor: text("actor").notNull(),
  at: timestamp("at").notNull().defaultNow(),
});

/**
 * アルコールチェックの記録（運送業の義務・1年間保存）。
 * 社員を消しても残すため、社員の表とはつながず、名前も控えておく。
 * phase: 'before'（乗る前）| 'after'（乗った後）
 * method: 'face'（対面）| 'phone'（電話）| 'video'（ビデオ通話）| 'other'
 */
export const alcoholChecksTable = pgTable("alcohol_checks", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  workDate: date("work_date").notNull(),
  phase: text("phase").notNull(),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  valueMg: doublePrecision("value_mg"),
  detected: boolean("detected").notNull().default(false),
  method: text("method").notNull(),
  checker: text("checker"),
  vehicle: text("vehicle"),
  note: text("note"),
  clientId: text("client_id"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 日報（退勤のときにまとめて残す。1人1日1件） */
export const dailyReportsTable = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  workDate: date("work_date").notNull(),
  vehicle: text("vehicle"),
  departure: text("departure"),
  arrival: text("arrival"),
  startOdometer: doublePrecision("start_odometer"),
  endOdometer: doublePrecision("end_odometer"),
  distanceKm: doublePrecision("distance_km"),
  shipper: text("shipper"),
  waitingMinutes: integer("waiting_minutes"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("daily_reports_emp_date_unique").on(t.employeeId, t.workDate)]);

/** 勤怠の設定（1行だけ。中身は JSON。lib/attendance-settings.ts が読み書きする） */
export const attendanceSettingsTable = pgTable("attendance_settings", {
  id: integer("id").primaryKey().default(1),
  data: text("data").notNull().default("{}"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 出勤の予定（シフト）。1人1日1件。無い日は「予定の型」（曜日ごと）を使う。
 * 時刻は日本時間の "HH:MM"。終わりが始まりより前なら翌日（夜勤）。isOff＝その日は休み。
 */
export const workSchedulesTable = pgTable("work_schedules", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  workDate: date("work_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  isOff: boolean("is_off").notNull().default(false),
  note: text("note"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("work_schedules_emp_date_unique").on(t.employeeId, t.workDate)]);

/**
 * 予定の型（曜日ごと）。data＝{"0":{"start":"08:00","end":"17:00"}|null, … "6":…, "holidayOff":true}
 * 0=日曜〜6=土曜。null の曜日は予定なし（休み）。holidayOff＝祝日は休みにする。
 */
export const schedulePatternsTable = pgTable("schedule_patterns", {
  employeeId: integer("employee_id").primaryKey(),
  data: text("data").notNull().default("{}"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 月の勤怠表の「確認済み」（社員ごと・月ごと）。ym＝"2026-10" */
export const attendanceMonthChecksTable = pgTable("attendance_month_checks", {
  employeeId: integer("employee_id").notNull(),
  ym: text("ym").notNull(),
  checkedBy: text("checked_by"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
}, (t) => [unique("attendance_month_checks_unique").on(t.employeeId, t.ym)]);

/**
 * 位置の記録（リアルタイムマップの「1日の道すじ」「走行距離の目安」「長く止まっている場所」用）。
 * 打刻ページが送る位置（15秒ごと）のうち、1分以上たったか30m以上動いたものだけを残す。
 * 勤務中だけ残し（設定）、残す日数を過ぎたら消す（設定・既定60日）。
 */
export const locationPointsTable = pgTable("location_points", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  workDate: date("work_date").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracy: doublePrecision("accuracy"),
  recordedAt: timestamp("recorded_at").notNull(),
}, (t) => [index("location_points_emp_date").on(t.employeeId, t.workDate), index("location_points_at").on(t.recordedAt)]);

/**
 * 取引先・よく行く場所（荷主・現場・営業所など）。マスター管理の「取引先」とリアルタイムマップの「場所」は同じもの。
 * 位置（緯度経度）があれば地図に円で出し、半径の中に入ると「到着」、出ると「出発」を残す。
 * 位置は住所から国土地理院の住所検索で出す（geo_source=gsi）か、地図で押して決める（manual）。出せなければ空。
 */
export const placesTable = pgTable("places", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** site＝現場／office＝営業所・車庫／shipper＝荷主／other＝そのほか */
  kind: text("kind").notNull().default("site"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  /** 位置の出どころ（gsi＝住所から自動／manual＝地図で決めた／null＝位置なし） */
  geoSource: text("geo_source"),
  /** 住所から探したときに見つかった地名（どこに当てたかの確認用） */
  geoLabel: text("geo_label"),
  phone: text("phone"),
  contact: text("contact"),
  radiusM: integer("radius_m").notNull().default(150),
  address: text("address"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 場所への到着・出発（位置から自動で付ける）。場所を消しても名前は残す */
export const placeVisitsTable = pgTable("place_visits", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  placeId: integer("place_id").notNull(),
  placeName: text("place_name").notNull(),
  workDate: date("work_date").notNull(),
  arrivedAt: timestamp("arrived_at").notNull(),
  leftAt: timestamp("left_at"),
}, (t) => [index("place_visits_emp_date").on(t.employeeId, t.workDate), index("place_visits_date").on(t.workDate)]);
