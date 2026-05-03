import type { Request, Response, NextFunction } from "express";

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
    if (!req.session?.userId) {
      return res.status(401).json({ error: "ログインが必要です" });
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
