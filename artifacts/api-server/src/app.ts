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

// 本番では秘密の鍵が無い・短いまま動かさない（既定の文字列だとログインの印を偽造できる）
if (process.env.NODE_ENV === "production") {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length < 32 || s === "mikawa-dev-secret-change-in-prod") {
    throw new Error("SESSION_SECRET が未設定か短すぎます（32文字以上の乱数にしてください）");
  }
}

app.use(
  pinoHttp({
    logger,
    // 位置の送信・下書き・未読の数・稼働確認など、数秒〜数十秒ごとに来る要求は1行ずつ残さない
    // （ログが1日数万行になり、NAS の容量を圧迫していた）。失敗したものは残す。
    autoLogging: {
      ignore: (req) => /\/(attendance\/location\/live|attendance\/draft\/|attendance\/checklist\/|messages\/(\d+\/)?unread-count|healthz|attendance\/today|alerts$)/.test(req.url ?? ""),
    },
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

// 本番（Cloudflare Tunnel → nginx → api）ではプロキシ1段を信頼する。
// これが無いと Express は req.protocol を "http" と判断し、secure Cookie を発行できない。
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) app.set("trust proxy", 1);

// 画面と API は同じサイト（nginx が /api を中継）なので、本番ではほかのサイトからの呼び出しを許さない。
// 以前はどのサイトからでも Cookie 付きで呼べる設定だった。
app.use(cors({ origin: isProduction ? false : true, credentials: true }));
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
    secret: process.env.SESSION_SECRET || "mikawa-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // 本番は HTTPS 固定（Cloudflare）なので Secure 属性を付ける。
      // 開発は http://localhost のため false のまま（true にすると Cookie が発行されずログインできない）。
      secure: isProduction,
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
  // 中身（SQL の断片など）は本番では返さない。サーバーのログには残っている。
  res.status(500).json(isProduction ? { error: userMessage } : { error: userMessage, detail: message });
});

export default app;
