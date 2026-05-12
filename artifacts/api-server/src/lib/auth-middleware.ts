import type { Request, Response, NextFunction } from "express";
import { db, attendanceRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "管理者権限が必要です" });
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
) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 未ログインは公開フロー（QR打刻など）として通過させる。
    // 既存の打刻フローは元々ログイン不要だったため、後方互換のためここで通す。
    // 「ログイン中のドライバーが他人になりすますのを防ぐ」owner チェックの本来の役割は
    // ログイン状態のときに引き続き機能する。
    if (!req.session?.userId) {
      return next();
    }

    if (req.session.role === "admin") {
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
  // 未ログインは公開フロー（QR打刻からの編集など）として通過。
  // ログイン中のドライバーには引き続き owner チェックが効く。
  if (!req.session?.userId) {
    return next();
  }

  const id = parseInt(req.params["id"] ?? "", 10);
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

  if (req.session.role === "admin") {
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
