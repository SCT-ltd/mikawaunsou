import { pgTable, serial, text, integer, timestamp, boolean, index, customType } from "drizzle-orm/pg-core";

/** 添付の中身（PostgreSQL の bytea） */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
import { employeesTable } from "./employees";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  sender: text("sender").notNull(), // 'office' | 'employee'
  content: text("content").notNull(),
  readAt: timestamp("read_at"),
  /** 端末が送るごとに作る番号（電波が悪くて送り直したときに二重に届かないように） */
  clientId: text("client_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employeesTable.id),
  role: text("role").notNull(), // 'office' | 'employee'
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptionsTable.$inferInsert;

/**
 * メッセージの添付（写真・PDF）。中身は DB に入れる（バックアップ＝pg_dump に一緒に入る）。
 *   送る前に上げて番号をもらい（message_id は空）、メッセージを送るときに番号を付けてつなぐ。
 *   つながないまま1日たったものは消す。見られるのは、その会話の本人（暗証番号を確かめた端末）と管理者だけ。
 */
export const messageAttachmentsTable = pgTable("message_attachments", {
  id: serial("id").primaryKey(),
  /** どの会話か（社員）。メッセージにつなぐときも同じ社員の会話かを確かめる */
  employeeId: integer("employee_id").notNull(),
  messageId: integer("message_id"),
  /** 上げた側（office｜employee） */
  uploadedBy: text("uploaded_by").notNull(),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("message_attachments_message").on(t.messageId), index("message_attachments_emp").on(t.employeeId)]);
