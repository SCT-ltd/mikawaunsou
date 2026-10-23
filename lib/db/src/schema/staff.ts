import { pgTable, serial, text, integer, timestamp, date, index, unique, customType } from "drizzle-orm/pg-core";

/** 写真の中身（PostgreSQL の bytea） */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * スタッフの打刻ページから送る写真（レシート・アルコール検知器の表示）。
 * チャットの添付とは別に置く（チャットの添付は、つないでいないものを1日で消すため）。
 */
export const staffFilesTable = pgTable("staff_files", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  /** receipt＝経費・立替のレシート／alcohol＝アルコール検知器の表示 */
  kind: text("kind").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("staff_files_emp").on(t.employeeId)]);

/** 経費・立替の申請（ガソリン・高速代・駐車場など）。承認するとその月の給与の「立替金精算」に入る */
export const expenseClaimsTable = pgTable("expense_claims", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  useDate: date("use_date").notNull(),
  /** fuel＝ガソリン／toll＝高速代／parking＝駐車場／other＝その他 */
  category: text("category").notNull(),
  amount: integer("amount").notNull(),
  note: text("note"),
  fileId: integer("file_id"),
  /** pending＝確認待ち／approved＝承認／rejected＝見送り */
  status: text("status").notNull().default("pending"),
  /** 承認したとき、どの月の給与で払うか */
  settleYear: integer("settle_year"),
  settleMonth: integer("settle_month"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  clientId: text("client_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("expense_claims_emp").on(t.employeeId), unique("expense_claims_client").on(t.employeeId, t.clientId)]);

/** 休み・有給の申請。承認すると「欠勤・休暇登録」に入る */
export const leaveRequestsTable = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  workDate: date("work_date").notNull(),
  /** routes/absences.ts の ABSENCE_DAYS の種類（有給・午前休みなど） */
  absenceType: text("absence_type").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  /** 承認して作った「欠勤・休暇登録」 */
  absenceId: integer("absence_id"),
  clientId: text("client_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("leave_requests_emp").on(t.employeeId), unique("leave_requests_client").on(t.employeeId, t.clientId)]);
