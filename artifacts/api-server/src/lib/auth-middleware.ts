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
