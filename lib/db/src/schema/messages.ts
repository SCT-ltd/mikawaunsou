import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
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
