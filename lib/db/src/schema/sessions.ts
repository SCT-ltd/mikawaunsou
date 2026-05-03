import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * connect-pg-simple が要求するセッションテーブル定義。
 *
 * カラム名・型は connect-pg-simple のデフォルト node_modules/connect-pg-simple/table.sql
 * と完全一致させること（変更すると Store 側で SELECT/INSERT がエラーになる）。
 */
export const sessionsTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_session_expire").on(t.expire),
  }),
);
