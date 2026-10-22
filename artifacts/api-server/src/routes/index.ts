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
import attendanceScheduleRouter from "./attendance-schedule";
import absencesRouter from "./absences";
import messagesRouter from "./messages";
import usersRouter from "./users";
import authRouter from "./auth";
import calendarRouter from "./calendar";
import insuranceRouter from "./insurance";
import alertsRouter from "./alerts";
import auditRouter from "./audit";
import officeToolsRouter from "./office_tools";
import payrollLawRouter from "./payroll-law";
import { requireAdmin } from "../lib/auth-middleware";
import { audit, takeSnap, changesOf, redact, employeeName } from "../lib/audit";
import { findSpec } from "../lib/audit-catalog";

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
  if (m === "POST" && /^\/employees\/\d+\/pin\/setup$/.test(p)) return true;
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
// ── 操作の記録：書き込みはすべて、だれが・何を・どう変えたか（前→後）まで残す ───────────────
// どの窓口が何の操作かは lib/audit-catalog.ts の辞書。辞書に無い書き込みも「POST /パス」で必ず残る。
// QR の打刻ページ（ログインなし）からの操作は社員の名前で残す。断られた操作（403・409 など）も残す。
// 個人の情報やお金が入ったファイルの書き出し（CSV）も、だれがいつ持ち出したかを残す。
const lastAt = new Map<string, number>();
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.method === "HEAD" || req.method === "OPTIONS") return next();
  const hit = findSpec(req.method, req.path);
  if (req.method === "GET" && !hit) return next();
  if (hit && (hit.spec.skip || hit.spec.manual)) return next();
  const loggedIn = !!req.session?.userId;
  if (!loggedIn && !hit?.spec.driver) return next();
  const spec = hit?.spec, m = hit?.m;
  let before: unknown = null;
  if (spec?.snap && m) { try { before = await takeSnap(spec.snap, m, req); } catch { before = null; } }
  let resBody: unknown;
  const json = res.json.bind(res);
  res.json = (b: unknown) => { resBody = b; return json(b); };
  res.on("finish", () => { void (async () => {
    const st = res.statusCode;
    if (st === 401 || st === 404 || st === 304 || (req.method === "GET" && st >= 400)) return;
    // 200 でも { ok: false } は失敗（暗証番号の間違いなど）。断られた操作として 400 で残す
    const rbOk = !(resBody && typeof resBody === "object" && (resBody as Record<string, unknown>)["ok"] === false);
    const ok = st < 400 && rbOk;
    const stRec = ok ? st : st < 400 ? 400 : st;
    const action = `${req.method} ${req.path.replace(/\/\d+/g, "/:id")}`;
    let after: unknown = null;
    if (ok && spec?.snap && m && req.method !== "DELETE" && req.method !== "GET") { try { after = await takeSnap(spec.snap, m, req); } catch { after = null; } }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const rb = (resBody && typeof resBody === "object" ? resBody : {}) as Record<string, unknown>;
    const row = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && !(v as Record<string, unknown>)["__group"] ? (v as Record<string, unknown>) : null);
    let employeeId = (spec?.emp && m ? spec.emp(m, req) : null)
      ?? (Number(row(after)?.["employee_id"] ?? row(before)?.["employee_id"]) || null)
      ?? (Number(b["employeeId"]) || null) ?? (Number(rb["employeeId"]) || null);
    if (!employeeId && /^\/employees\/(\d+)/.test(req.path)) employeeId = Number(/^\/employees\/(\d+)/.exec(req.path)![1]);
    if (!employeeId && req.method === "POST" && req.path === "/employees" && ok) employeeId = Number(rb["id"]) || null;
    // 続けて何度も来る操作（点検の保存・本人確認）は一定の間は1件にまとめる。断られたものはまとめない
    const actorKey = req.session?.userId ? `u${req.session.userId}` : `e${employeeId}`;
    if (ok && spec?.throttleSec) {
      const key = `${actorKey}|${action}|${req.path}`;
      const t = lastAt.get(key) ?? 0;
      if (Date.now() - t < spec.throttleSec * 1000) return;
      lastAt.set(key, Date.now());
      if (lastAt.size > 5000) lastAt.clear();
    }
    const detail: Record<string, unknown> = {};
    if (!spec?.quiet) {
      if (spec?.snap) {
        if (req.method === "DELETE") { if (before) detail["before"] = before; }
        else if (req.method === "GET") { /* 書き出し：中身は残さない */ }
        else if (ok) {
          const ch = changesOf(before, after);
          if (Object.keys(ch).length) detail["changes"] = ch;
          else if (!before && after) detail["created"] = after;
          else detail["changes"] = {};
        }
      }
      if (!spec?.snap || !ok) {
        if (req.method !== "GET") {
          const body = JSON.stringify(redact(b));
          detail["body"] = body.length > 4000 ? body.slice(0, 4000) + "…" : JSON.parse(body);
        }
      }
      if (req.method === "POST" && ok && !spec?.snap && rb["id"] !== undefined) detail["id"] = rb["id"];
      if (req.query && Object.keys(req.query).length) detail["query"] = redact({ ...req.query });
    }
    if (!ok && typeof rb["error"] === "string") detail["error"] = rb["error"];
    const name = await employeeName(employeeId);
    const label = spec ? (typeof spec.label === "function" ? spec.label(req, m!) : spec.label) : action;
    const who = loggedIn ? undefined : name ? `社員：${name}（QR打刻ページ）` : "QR打刻ページ";
    const summary = label + (name ? `（${name}）` : "") + (ok ? "" : stRec === 403 ? "【権限がなく断られました】" : "【できませんでした】");
    await audit(req, action, req.path, Object.keys(detail).length ? detail : undefined, {
      summary, category: spec?.category ?? "その他", employeeId, status: stRec, actor: who,
    });
  })(); });
  return next();
});

router.use("/payroll", requireAdmin);
router.use("/payrolls", requireAdmin);
router.use("/payroll-law", requireAdmin);

// /employees は基本 admin 専用だが、QR打刻ページ（/driver/:id 公開ルート）が叩く
// 以下の3つだけはログイン不要・admin 不要で通す（元々公開だった仕様の維持）：
//   - GET  /employees/:id              （社員情報の表示）
//   - GET  /employees/:id/pin/status   （PIN設定有無）
//   - POST /employees/:id/pin/verify   （PIN認証）
//   - POST /employees/:id/pin/setup    （暗証番号がまだ無い人が自分で決める）
router.use("/employees", (req: Request, res: Response, next: NextFunction) => {
  const path = req.path; // ここでは /employees を除いた残り部分（例: "/4", "/4/pin/verify"）
  const isPublicEmployeeRoute =
    (req.method === "GET"  && /^\/\d+$/.test(path)) ||
    (req.method === "GET"  && /^\/\d+\/pin\/status$/.test(path)) ||
    (req.method === "POST" && /^\/\d+\/pin\/verify$/.test(path)) ||
    (req.method === "POST" && /^\/\d+\/pin\/setup$/.test(path));
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
// 確定前チェック・振込一覧など事務所の締め作業の入口（閲覧のみの人は見るだけ）
router.use("/office-tools", requireAdmin);

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
router.use(attendanceScheduleRouter); // 出勤の予定（シフト）・予定の型・月の勤怠表
router.use(absencesRouter);    // 現状認証のみ（owner設計後に強化）
router.use(messagesRouter);    // conversations, broadcast は admin（ファイル側）
router.use(insuranceRouter);
router.use(alertsRouter);      // 従業員のお知らせ（すべて admin・ファイル側）
router.use(calendarRouter);    // カレンダー（見るのはログインした人、変えるのは管理者）
router.use(officeToolsRouter); // 確定前チェック・振込口座・全銀の書き出し
router.use(payrollLawRouter);  // 給与計算と法令の画面（"/payroll-law" プレフィックスで admin）
router.use(auditRouter);       // 操作の記録（管理者だけ）   // 保険料率マスターの GET はログインのみ、POST/PUT/DELETE は admin（ファイル側）

export { requireAdmin };
export default router;
