import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import { logger } from "./lib/logger";

import { authMiddleware } from "./middlewares/auth";

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    // TODO: 本番環境では環境変数 SESSION_SECRET を必ず設定してください
    secret: process.env.SESSION_SECRET || "mikawa-unsou-secret-key",
    resave: false,
    saveUninitialized: false,
    // MEMO: デフォルトの MemoryStore を使用しています。
    // 本番環境でマルチインスタンス化やサーバー再起動時のセッション維持が必要な場合は、
    // connect-redis や connect-pg-simple 等の永続ストアへの移行を推奨します。
    cookie: {
      httpOnly: true, // XSS対策: JSからのアクセスを禁止
      secure: process.env.NODE_ENV === "production", // 本番(HTTPS)ではTrueに設定
      maxAge: 24 * 60 * 60 * 1000, // 24時間
      sameSite: "lax", // CSRF対策と利便性のバランス
    },
  }),
);

app.use(authMiddleware);
app.use("/api", router);

// ── グローバルエラーハンドラー ────────────────────────────────────────────
// Express v5 は async ルートの未捕捉エラーを自動的にここへ渡す
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const log = (req as unknown as { log?: { error: (obj: object, msg: string) => void } }).log ?? logger;

  const message = err instanceof Error ? err.message : String(err);
  const stack   = err instanceof Error ? err.stack   : undefined;

  log.error({ err: { message, stack } }, "Unhandled error");

  // DB 固有エラーのメッセージを日本語に変換
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
