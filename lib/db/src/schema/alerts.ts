import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * 従業員のお知らせ（右上のベル・ダッシュボード・PCのプッシュ通知）。
 *
 * お知らせそのものは保存しない。社員マスター・月次実績・明細から毎回作り直す
 * （lib/alerts.ts）。ここに持つのは「だれが読んだか」と「プッシュ通知を送ったか」だけ。
 * お知らせの key は出来事ごとに決まった文字列（例: age70:21:2026-10-11）。
 */
export const alertReadsTable = pgTable("alert_reads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  key: text("key").notNull(),
  readAt: timestamp("read_at").notNull().defaultNow(),
}, (t) => [
  unique("alert_reads_user_key_unique").on(t.userId, t.key),
]);

export const alertPushesTable = pgTable("alert_pushes", {
  key: text("key").primaryKey(),
  pushedAt: timestamp("pushed_at").notNull().defaultNow(),
});
