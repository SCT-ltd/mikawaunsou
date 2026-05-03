import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

// connect-pg-simple は session() を一度ラップして factory を返す
const PgSessionStore = connectPgSimple(session);

// セッションデータの型拡張
declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
    displayName?: string;
    role?: string;
    /**
     * driver ロールでログインしている場合の本人 employees.id。
     * admin ロールの場合は null。
     */
    employeeId?: number | null;
  }
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// セッションミドルウェア
// 保存先を PostgreSQL の `session` テーブルに変更（旧: メモリ）。
// API サーバー再起動後もログイン状態が維持される。
// Cookie 設定（httpOnly / secure / maxAge 8h / sameSite）と
// req.session.* の API は従来通り変更なし。
app.use(
  session({
    store: new PgSessionStore({
      pool,
      tableName: "session",
      // テーブルは drizzle migration で事前作成しているのでランタイム自動作成は無効化
      createTableIfMissing: false,
      // 期限切れセッションを 1 時間ごとに削除
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET ?? "mikawa-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 8 * 60 * 60 * 1000, // 8時間
      sameSite: "lax",
    },
  }),
);

app.use("/api", router);

// ── グローバルエラーハンドラー ────────────────────────────────────────────
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const log = (req as unknown as { log?: { error: (obj: object, msg: string) => void } }).log ?? logger;

  const message = err instanceof Error ? err.message : String(err);
  const stack   = err instanceof Error ? err.stack   : undefined;

  log.error({ err: { message, stack } }, "Unhandled error");

  let userMessage = "サーバーエラーが発生しました。しばらく経ってからもう一度お試しください。";
  if (message.includes("unique") || message.includes("duplicate")) {
    userMessage = "すでに同じデータが登録されています。";
  } else if (message.includes("foreign key") || message.includes("violates")) {
    userMessage = "関連するデータが存在するため、この操作はできません。";
  } else if (message.includes("connect") || message.includes("ECONNREFUSED")) {
    userMessage = "データベースに接続できません。管理者に連絡してください。";
  } else if (message.includes("not null") || message.includes("null value")) {
    userMessage = "必須項目が入力されていません。";
  }

  if (res.headersSent) return;
  res.status(500).json({ error: userMessage, detail: message });
});

export default app;
