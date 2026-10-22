import type { Request, Response } from "express";
import { driverAccess, PIN_REQUIRED_BODY, PIN_NOT_SET_BODY } from "./driver-token";
import { isAdminReq } from "./roles";

/**
 * 打刻まわりの API で「だれとして扱うか」を決める。
 *   ログインしていない（QR の打刻ページ） … 暗証番号を確かめた端末の本人（暗証番号が無い人は requirePin でなければ通す）
 *   管理画面（管理者・スタッフ）           … 本文の employeeId の社員を、事務所として扱う
 *   ドライバーのアカウント                 … 自分だけ
 * だめなときは応答を返して null を返す。
 */
export interface Actor { employeeId: number; admin: boolean; actor: string }

export function actorName(req: Request): string {
  const s = req.session;
  if (s?.userId) return s.displayName ? `${s.displayName}（${s.username}）` : String(s.username ?? s.userId);
  return "本人（打刻ページ）";
}

export async function resolveActor(req: Request, res: Response, bodyEmployeeId: unknown, opts: { requirePin?: boolean } = {}): Promise<Actor | null> {
  const requested = Number(bodyEmployeeId);
  if (!req.session?.userId) {
    if (!Number.isInteger(requested) || requested <= 0) { res.status(400).json({ error: "employeeId は必須です" }); return null; }
    const access = await driverAccess(req, requested);
    if (access === "not-found") { res.status(404).json({ error: "社員が見つかりません。" }); return null; }
    if (access === "denied") { res.status(401).json(PIN_REQUIRED_BODY); return null; }
    if (access === "no-pin" && opts.requirePin) { res.status(403).json(PIN_NOT_SET_BODY); return null; }
    return { employeeId: requested, admin: false, actor: actorName(req) };
  }
  if (isAdminReq(req)) {
    if (!Number.isInteger(requested) || requested <= 0) { res.status(400).json({ error: "employeeId は必須です" }); return null; }
    return { employeeId: requested, admin: true, actor: actorName(req) };
  }
  const own = req.session.employeeId;
  if (own === null || own === undefined) { res.status(403).json({ error: "権限がありません" }); return null; }
  if (bodyEmployeeId !== undefined && bodyEmployeeId !== null && bodyEmployeeId !== "" && requested !== Number(own)) {
    res.status(403).json({ error: "他の従業員の記録は扱えません" });
    return null;
  }
  return { employeeId: Number(own), admin: false, actor: actorName(req) };
}

/** Postgres の一意の制約にかかったか */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (!constraint || name === constraint);
}
