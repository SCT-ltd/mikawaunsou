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
