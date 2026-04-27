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

router.use(companyRouter);
router.use(employeesRouter);
router.use(monthlyRecordsRouter);
router.use(payrollRouter);
router.use(journalEntriesRouter);
router.use(dashboardRouter);
router.use(allowancesRouter);
router.use(attendanceRouter);
router.use(absencesRouter);
router.use(messagesRouter);
router.use(usersRouter);

export default router;
