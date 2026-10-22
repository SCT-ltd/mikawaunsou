import type { Request } from "express";

/**
 * 管理画面のユーザーの役割と、できること。
 *
 *   admin  （管理者）  … すべて
 *   staff  （スタッフ）… ユーザー管理・会社設定・保険料率の変更・操作の記録の閲覧 以外すべて
 *   viewer （閲覧のみ）… 見るだけ（GET）。書き込みは一切できない
 *
 * 以前は画面で3つを選べたのに、サーバーは「admin か、それ以外（全部断る）」の2つしか無かった。
 * 管理者の権限が要る判定はすべてここ（isAdminReq）を通す。
 */
const STAFF_DENY: Array<{ method?: string; re: RegExp }> = [
  { re: /^\/api\/users(\/|$)/ },
  { re: /^\/api\/audit-logs(\/|$)/ },
  { method: "PUT", re: /^\/api\/company(\/|$)/ },
  { method: "POST", re: /^\/api\/insurance-rate-periods(\/|$)/ },
  { method: "PUT", re: /^\/api\/insurance-rate-periods(\/|$)/ },
  { method: "DELETE", re: /^\/api\/insurance-rate-periods(\/|$)/ },
];

const READ = new Set(["GET", "HEAD", "OPTIONS"]);

/** この要求を管理者の権限で通してよいか（ログインしていなければ false） */
export function isAdminReq(req: Request): boolean {
  const role = req.session?.role;
  if (!req.session?.userId || !role) return false;
  if (role === "admin") return true;
  const path = (req.originalUrl || req.url).split("?")[0]!;
  if (role === "staff") return !STAFF_DENY.some((d) => (!d.method || d.method === req.method) && d.re.test(path));
  if (role === "viewer") return READ.has(req.method) && !/^\/api\/(users|audit-logs)(\/|$)/.test(path);
  return false;
}

export const ROLE_LABEL: Record<string, string> = { admin: "管理者", staff: "スタッフ", viewer: "閲覧のみ" };
