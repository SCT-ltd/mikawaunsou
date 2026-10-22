import type { Request, Response, NextFunction } from "express";
import { db, attendanceRecordsTable } from "@workspace/db";
import { paramStr } from "./params";
import { eq } from "drizzle-orm";
import { isAdminReq } from "./roles";
import { driverAccess, PIN_REQUIRED_BODY, PIN_NOT_SET_BODY } from "./driver-token";

/**
 * 管理者専用ガード。
 * - 未ログイン → 401
 * - role !== "admin" → 403
 * - role === "admin" → 通過
 *
 * 注：requireAuth（routes/index.ts のグローバル認証ミドルウェア）が
 * 既に「ユーザー0件なら全通し（初回セットアップ用バイパス）」を行うため、
 * その状態では req.session.userId が undefined になり 401 を返す。
 * これは仕様通り（初回セットアップ中に管理操作はできない）。
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }
  // 管理者／スタッフ／閲覧のみ の決まりは lib/roles.ts
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: req.session.role === "viewer" ? "閲覧のみのユーザーは変更できません" : "この操作の権限がありません" });
  }
  return next();
}

/**
 * 本人または管理者のみ通過させるガード（owner チェック）。
 *
 * - 未ログイン → 401
 * - role === "admin" → 常に通過
 * - role === "driver" → セッションの employeeId と
 *   getEmployeeIdFromReq(req) で得た対象 employeeId が一致すれば通過、不一致なら 403
 *
 * driver アカウントが employees テーブルと紐付いていない場合（session.employeeId == null）
 * は常に 403。
 *
 * 使用例:
 *   router.get(
 *     "/messages/:employeeId",
 *     requireOwnerOrAdmin(req => parseInt(req.params.employeeId, 10)),
 *     handler,
 *   );
 *
 * body から取り出したい場合:
 *   requireOwnerOrAdmin(req => Number(req.body.employeeId))
 */
export function requireOwnerOrAdmin(
  getEmployeeIdFromReq: (req: Request) => number | null | undefined,
  /** requirePin: 暗証番号が未設定の社員には応えない（履歴・メッセージの読み取り用） */
  opts: { requirePin?: boolean } = {},
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 未ログイン＝QR 打刻ページからの公開フロー。
    // 以前は無条件で通していたため、社員番号（連番）を差し替えるだけで他人の打刻・位置・
    // メッセージを読み書きできた。暗証番号を確かめた端末（driver-token の印）だけを通す。
    // 暗証番号が未設定の社員は確かめようがないので、打刻に要る操作だけ従来どおり通し、
    // 履歴やメッセージの読み取り（requirePin）は断る。
    if (!req.session?.userId) {
      const access = await driverAccess(req, Number(getEmployeeIdFromReq(req)));
      if (access === "verified") return next();
      if (access === "no-pin") return opts.requirePin ? res.status(403).json(PIN_NOT_SET_BODY) : next();
      if (access === "not-found") return res.status(404).json({ error: "社員が見つかりません。" });
      return res.status(401).json(PIN_REQUIRED_BODY);
    }

    if (isAdminReq(req)) {
      return next();
    }

    const targetEmployeeId = getEmployeeIdFromReq(req);
    const sessionEmployeeId = req.session.employeeId;

    if (
      targetEmployeeId === null ||
      targetEmployeeId === undefined ||
      Number.isNaN(Number(targetEmployeeId)) ||
      sessionEmployeeId === null ||
      sessionEmployeeId === undefined
    ) {
      return res.status(403).json({ error: "権限がありません" });
    }

    if (Number(sessionEmployeeId) !== Number(targetEmployeeId)) {
      return res
        .status(403)
        .json({ error: "他の従業員のデータにはアクセスできません" });
    }

    return next();
  };
}

/**
 * 打刻レコード（attendance_records）の所有者チェック専用ガード。
 *
 * URL に employeeId が含まれず recordId だけしか取れない PATCH/DELETE 用。
 * - 未ログイン → 401
 * - レコード未存在 → 404
 * - admin → 通過
 * - driver で session.employeeId === record.employeeId → 通過
 * - driver で不一致 → 403
 *
 * ヒットしたレコードを `(req as any).attendanceRecord` に格納するので、
 * ハンドラ側で再フェッチせずに参照できる。
 */
export async function requireAttendanceRecordOwnerOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // 未ログインは断る。以前は「公開フロー」として素通ししていたが、この経路（打刻の修正・削除）を
  // 公開している画面は無く、いつか公開側に足すと所有者の確認が黙って無効になる地雷だった。
  if (!req.session?.userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const id = parseInt(paramStr(req.params["id"]), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "id が不正です" });
  }

  const [record] = await db
    .select()
    .from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.id, id))
    .limit(1);

  if (!record) {
    return res.status(404).json({ error: "レコードが見つかりません" });
  }

  if (isAdminReq(req)) {
    (req as Request & { attendanceRecord?: typeof record }).attendanceRecord = record;
    return next();
  }

  const sessionEmployeeId = req.session.employeeId;
  if (
    sessionEmployeeId === null ||
    sessionEmployeeId === undefined ||
    Number(sessionEmployeeId) !== Number(record.employeeId)
  ) {
    return res
      .status(403)
      .json({ error: "他の従業員のレコードにはアクセスできません" });
  }

  (req as Request & { attendanceRecord?: typeof record }).attendanceRecord = record;
  return next();
}
