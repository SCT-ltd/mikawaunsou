import { type Request, type Response, type NextFunction } from "express";

/**
 * 管理画面認証ミドルウェア
 * 
 * 【保護対象】
 * - すべての管理画面系API (/api/employees, /api/payroll, /api/dashboard等)
 * 
 * 【除外対象 (パブリック / ドライバー用)】
 * - ヘルスチェック (/api/health)
 * - 認証関連 (/api/auth/*)
 * - ドライバー打刻・点検 (/api/attendance/record, /api/attendance/checklist/*等)
 * - 車両位置ライブ送信 (/api/attendance/location/live)
 * - ドライバー用メッセージ取得/送信
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // パブリックエンドポイントの除外
  const publicPaths = [
    "/api/health",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/employees/pin/status", // 正確には /api/employees/:id/pin/status
    "/api/employees/pin/verify",
  ];

  // 完全一致チェック
  if (publicPaths.includes(req.path)) {
    return next();
  }

  // 前方一致チェック（ドライバー用API）
  const driverPathPrefixes = [
    "/api/attendance/record",
    "/api/attendance/checklist/",
    "/api/attendance/draft/",
    "/api/attendance/location/live",
    "/api/attendance/employee/", // 今日の記録取得など: /api/attendance/employee/:id/today
    "/api/messages/stream", // SSE用
    "/api/messages/vapid-public-key",
  ];

  if (driverPathPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next();
  }

  // 特殊なパス（メッセージ送信・取得）
  if (req.path === "/api/messages" && (req.method === "POST" || req.query.employeeId)) {
    return next();
  }

  // 個別社員情報取得 (GET /api/employees/:id)
  const employeeIdMatch = req.path.match(/^\/api\/employees\/(\d+)(\/pin\/status|\/pin\/verify)?$/);
  if (employeeIdMatch) {
    return next();
  }

  // 管理画面系APIの認証チェック
  if (!req.session.userId) {
    return res.status(401).json({ error: "認証されていません。ログインしてください。" });
  }

  next();
}
