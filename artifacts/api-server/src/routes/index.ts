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
import attendanceExtraRouter from "./attendance-extra";
import absencesRouter from "./absences";
import messagesRouter from "./messages";
import usersRouter from "./users";
import authRouter from "./auth";
import calendarRouter from "./calendar";
import insuranceRouter from "./insurance";
import alertsRouter from "./alerts";
import auditRouter from "./audit";
import { requireAdmin } from "../lib/auth-middleware";
import { audit } from "../lib/audit";

const router: IRouter = Router();

// 認証不要なルート
router.use(healthRouter);
router.use(authRouter);
// カレンダー（休日の設定）はログインの確認の後ろに置く（下）。以前はここにあり、
// ログインしていない人でも読み書き・全消去ができた。休日の設定は給与の金額に効く。

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
  // 押して1分以内の取り消し・打刻の場所の付け足し（本人の打刻だけ。中で確かめる）
  if (m === "POST"  && /^\/attendance\/records\/\d+\/cancel$/.test(p)) return true;
  if (m === "PATCH" && /^\/attendance\/records\/\d+\/location$/.test(p)) return true;
  // 勤怠の設定（点検・アルコールチェックを必須にするか・車両の一覧）
  if (m === "GET"  && p === "/attendance/settings/public") return true;
  // 打刻の修正申請・アルコールチェック（本人の分だけ。中で確かめる）
  if (m === "POST" && p === "/attendance/corrections") return true;
  if (m === "GET"  && /^\/attendance\/corrections\/mine\/\d+$/.test(p)) return true;
  if (m === "POST" && p === "/attendance/alcohol") return true;
  if (m === "GET"  && /^\/attendance\/alcohol\/\d+\/today$/.test(p)) return true;
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

  // 初めて使うとき（ユーザーが0人）だけは通す。ただし環境変数 ALLOW_INITIAL_SETUP=1 のときに限る。
  // 以前は「0人なら全部通す」「数えられなかったら全部通す」だったため、最後の管理者を消すか
  // DB が一時的に応えないだけで、給与を含むすべての API がログインなしで開いていた。
  if (process.env.ALLOW_INITIAL_SETUP === "1") {
    try {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable);
      if (count === 0) return next();
    } catch {
      return res.status(503).json({ error: "データベースに接続できません。しばらくしてからもう一度お試しください。" });
    }
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
// ── 操作の記録：管理画面からの書き込みを、成功したものだけすべて残す ───────────────
// （確定・確定解除・ユーザー・暗証番号などは各ルートで中身つきで残しているので、ここでは除く）
const AUDIT_SKIP = /^\/(auth\/|payroll\/\d+\/(confirm|unconfirm)$|users(\/|$)|employees\/\d+\/(pin|qr-key)|alerts\/read|push\/subscribe|messages(\/|$)|attendance\/location\/live$)/;
const SECRET_KEYS = /pin|password|secret|token|key|auth|p256dh|endpoint/i;
function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "（伏せ字）" : redact(x, depth + 1)]));
}
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || !req.session?.userId || AUDIT_SKIP.test(req.path)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const body = JSON.stringify(redact(req.body ?? {}));
    void audit(req, `${req.method} ${req.path.replace(/\/\d+/g, "/:id")}`, req.path, { query: req.query, body: body.length > 4000 ? body.slice(0, 4000) + "…" : JSON.parse(body) });
  });
  return next();
});

router.use("/payroll", requireAdmin);
router.use("/payrolls", requireAdmin);

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
router.use("/audit-logs", requireAdmin);
router.use("/calendar", (req: Request, res: Response, next: NextFunction) =>
  req.method === "GET" ? next() : requireAdmin(req, res, next));
router.use("/monthly-records", requireAdmin);
router.use("/dashboard", requireAdmin);
router.use("/journal-entries", requireAdmin);
// 標準報酬月額（全社員分）は admin 専用。/employees/:id/standard-remuneration-history は上の "/employees" で admin。
router.use("/standard-remuneration", requireAdmin);

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
router.use(attendanceExtraRouter); // 修正申請・アルコールチェック・日報・点検の判断・改善基準・勤怠の設定
router.use(absencesRouter);    // 現状認証のみ（owner設計後に強化）
router.use(messagesRouter);    // conversations, broadcast は admin（ファイル側）
router.use(insuranceRouter);
router.use(alertsRouter);      // 従業員のお知らせ（すべて admin・ファイル側）
router.use(calendarRouter);    // カレンダー（見るのはログインした人、変えるのは管理者）
router.use(auditRouter);       // 操作の記録（管理者だけ）   // 保険料率マスターの GET はログインのみ、POST/PUT/DELETE は admin（ファイル側）

export { requireAdmin };
export default router;
