import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * 操作の記録（追記だけ。消さない・書き換えない）。
 * だれが・いつ・何を・どう変えたかを残す。給与の確定・確定解除・社員情報や暗証番号の変更・
 * ユーザーと権限・会社設定・保険料率・カレンダー・打刻の修正など、お金と勤怠に関わる操作を記録する。
 */
export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  at: timestamp("at").notNull().defaultNow(),
  /** 操作した管理画面のユーザー（QR の打刻ページからの操作は null で、actor に社員を書く） */
  userId: integer("user_id"),
  /** 表示用の名前（ユーザー名、または「社員:◯◯」） */
  actor: text("actor").notNull(),
  /** 何をしたか（例: payroll.confirm / employee.update / pin.set） */
  action: text("action").notNull(),
  /** 対象（例: payroll:123 / employee:5） */
  target: text("target"),
  /** 変更の中身（JSON。変更前後の値など。暗証番号・パスワードの値は入れない） */
  detail: text("detail"),
  /** 接続元 */
  ip: text("ip"),
}, (t) => [
  index("audit_logs_at").on(t.at),
  index("audit_logs_target").on(t.target),
]);
