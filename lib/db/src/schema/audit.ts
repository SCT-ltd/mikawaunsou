import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * 操作の記録（監査ログ）。
 * 給与明細の確定・確定解除・修正、打刻の修正・削除、保険料率・標準報酬月額・社員・ユーザーの変更を
 * 「誰が・いつ・何を」残す。削除した行は detail.before にまるごと保存し、後から復元・説明できるようにする。
 * 追記専用（更新・削除のAPIは作らない）。
 */
export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  // 操作した人。公開QRフローなど未ログインの操作は null（actorLabel に "QR:社員ID" などを入れる）
  userId: integer("user_id"),
  actorLabel: text("actor_label").notNull(),
  // 例: "payroll.confirm" / "payroll.unconfirm" / "attendance.delete"
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  // 変更前後の値など
  detail: jsonb("detail"),
  ip: text("ip"),
}, (t) => [
  index("audit_logs_target_idx").on(t.targetType, t.targetId),
  index("audit_logs_at_idx").on(t.at),
]);

export type AuditLog = typeof auditLogsTable.$inferSelect;
