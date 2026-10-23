import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 時刻の列（タイムゾーンなし）は UTC で持つ（drizzle は UTC として読み書きする）。
  // 本番の DB は日本時間なので、DB の既定値 now() だけ日本時間で入り、画面で9時間ずれていた（チャットの時刻など）
  options: "-c TimeZone=UTC",
  // NAS の DB は再起動することがある。待ち時間の上限を決め、使っていない接続は長めに保つ
  max: 8,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
});
// 待機中の接続が切れたとき（DB の再起動など）に、処理されない例外でプロセスが落ちないようにする
pool.on("error", (err) => {
  console.error("[db] 待機中の接続でエラー:", err.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
