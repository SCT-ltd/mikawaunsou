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
import { requireAdmin } from "../lib/auth-middleware";

const router: IRouter = Router();

// 認証不要なルート
router.use(healthRouter);
router.use(authRouter);

// ── 認証ミドルウェア ─────────────────────────────────────────────────────
// ユーザーが0件の場合はバイパス（初回セットアップ用）
router.use(async (req: Request, res: Response, next: NextFunction) => {
  // 認証済みならOK
  if (req.session?.userId) return next();

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
router.use("/employees", requireAdmin);          // /employees/:id/allowances, /employees/:id/deductions も含む
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
