import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import healthRouter from "./health";
import companyRouter from "./company";
import employeesRouter from "./employees";
import monthlyRecordsRouter from "./monthly_records";
import payrollRouter from "./payroll";
import journalEntriesRouter from "./journal_entries";
import dashboardRouter from "./dashboard";
import allowancesRouter from "./allowances";
import attendanceRouter from "./attendance";
import absencesRouter from "./absences";
import messagesRouter from "./messages";
import usersRouter from "./users";
import authRouter from "./auth";
import calendarRouter from "./calendar";
import { requireAdmin } from "../lib/auth-middleware";

const router: IRouter = Router();

// 認証不要なルート
router.use(healthRouter);
router.use(authRouter);
router.use(calendarRouter); // カレンダー設定は全ユーザー参照・変更可能

// ── 公開ルート判定 ─────────────────────────────────────────────────────
// QR読み取りで遷移する /driver/:id ページが叩く API は、ログインなしで通す。
// （元仕様：QR打刻ページは公開フローで動作する）
function isPublicDriverFlowRequest(req: Request): boolean {
  const p = req.path;
  const m = req.method;
  // 社員情報・PIN関連
  if (m === "GET"  && /^\/employees\/\d+$/.test(p)) return true;
  if (m === "GET"  && /^\/employees\/\d+\/pin\/status$/.test(p)) return true;
  if (m === "POST" && /^\/employees\/\d+\/pin\/verify$/.test(p)) return true;
  // 打刻フロー
  if (m === "POST" && p === "/attendance/record") return true;
  if (m === "POST" && p === "/attendance/location/live") return true;
  if (m === "GET"  && /^\/attendance\/employee\/\d+\/(today|month)$/.test(p)) return true;
  if (/^\/attendance\/checklist\/\d+$/.test(p) && (m === "GET" || m === "PATCH")) return true;
  if (/^\/attendance\/draft\/\d+$/.test(p)     && (m === "GET" || m === "PATCH")) return true;
  // SSE（リアルタイム勤怠/メッセージ受信）
  if (m === "GET"  && p === "/attendance/stream") return true;
  if (m === "GET"  && p === "/messages/stream")   return true;
  // Web Push（QRページからの通知購読）
  if (m === "GET"  && p === "/messages/vapid-public-key") return true;
  if (m === "POST" && p === "/push/subscribe")            return true;
  // メッセージ（QRページから事務所への送受信）
  if (m === "GET"  && /^\/messages\/\d+$/.test(p)) return true;
  if (m === "GET"  && /^\/messages\/\d+\/unread-count$/.test(p)) return true;
  if (m === "POST" && /^\/messages\/\d+\/read$/.test(p)) return true;
  if (m === "POST" && p === "/messages") return true;
  return false;
}

// ── 認証ミドルウェア ─────────────────────────────────────────────────────
// ユーザーが0件の場合はバイパス（初回セットアップ用）
router.use(async (req: Request, res: Response, next: NextFunction) => {
  // 認証済みならOK
  if (req.session?.userId) return next();

  // QR打刻ページなどの公開フローは無条件に通す
  if (isPublicDriverFlowRequest(req)) return next();

  // ユーザーが0件ならすべて通す（初回セットアップ）
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable);
    if (count === 0) return next();
  } catch {
    // DB接続失敗時もバイパス
    return next();
  }

  return res.status(401).json({ error: "ログインが必要です" });
});
// ──────────────────────────────────────────────────────────────────────────

// ── 認可：第1段階 ─────────────────────────────────────────────────────
// パスプレフィックスごとに requireAdmin を適用する。
// （Express の router.use("/path", mw) は URL が /path で始まる全リクエストで mw を実行）
//
// 注意: router.use(mw, subRouter) と書くと subRouter がパスなしマウントの場合
//        全リクエストで mw が走り、別のルーターの処理まで巻き込んでしまうため使わない。
router.use("/payroll", requireAdmin);

// /employees は基本 admin 専用だが、QR打刻ページ（/driver/:id 公開ルート）が叩く
// 以下の3つだけはログイン不要・admin 不要で通す（元々公開だった仕様の維持）：
//   - GET  /employees/:id              （社員情報の表示）
//   - GET  /employees/:id/pin/status   （PIN設定有無）
//   - POST /employees/:id/pin/verify   （PIN認証）
router.use("/employees", (req: Request, res: Response, next: NextFunction) => {
  const path = req.path; // ここでは /employees を除いた残り部分（例: "/4", "/4/pin/verify"）
  const isPublicEmployeeRoute =
    (req.method === "GET"  && /^\/\d+$/.test(path)) ||
    (req.method === "GET"  && /^\/\d+\/pin\/status$/.test(path)) ||
    (req.method === "POST" && /^\/\d+\/pin\/verify$/.test(path));
  if (isPublicEmployeeRoute) return next();
  return requireAdmin(req, res, next);
});

router.use("/users", requireAdmin);
router.use("/monthly-records", requireAdmin);
router.use("/dashboard", requireAdmin);
router.use("/journal-entries", requireAdmin);

// 全ルーターを通常マウント（個別エンドポイントの requireAdmin は各ファイル側で対応）
router.use(companyRouter);     // PUT /company のみ admin（ファイル側）
router.use(employeesRouter);
router.use(payrollRouter);
router.use(monthlyRecordsRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(journalEntriesRouter);
router.use(allowancesRouter);  // /*-definitions の POST/PUT/DELETE は admin（ファイル側）。/employees/:id/{allowances,deductions} は上の "/employees" プレフィックスで admin
router.use(attendanceRouter);  // monthly-summary, gps-locations, location/live GET は admin（ファイル側）
router.use(absencesRouter);    // 現状認証のみ（owner設計後に強化）
router.use(messagesRouter);    // conversations, broadcast は admin（ファイル側）

export { requireAdmin };
export default router;
