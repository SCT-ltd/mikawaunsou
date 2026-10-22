import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * 操作の記録を1件足す。記録に失敗しても本来の操作は止めない（ログに残す）。
 * detail には暗証番号・パスワードの値を入れないこと。
 */
export async function audit(req: Request, action: string, target: string | null, detail?: unknown): Promise<void> {
  try {
    const s = req.session;
    const actor = s?.userId ? (s.displayName ? `${s.displayName}（${s.username}）` : String(s.username ?? s.userId)) : "QR打刻ページ";
    await db.insert(auditLogsTable).values({
      userId: s?.userId ?? null,
      actor,
      action,
      target,
      detail: detail === undefined ? null : JSON.stringify(detail),
      ip: req.header("cf-connecting-ip") || req.ip || null,
    });
  } catch (err) {
    logger.warn({ err, action, target }, "操作の記録に失敗しました");
  }
}

/** 変わった項目だけを { 項目: [前, 後] } にする（社員・会社設定などの更新の記録用） */
export function diffOf(before: Record<string, unknown>, after: Record<string, unknown>, hide: string[] = ["pin", "passwordHash", "qrKey"]): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    if (hide.includes(k) || k === "updatedAt" || k === "createdAt") continue;
    const a = before[k], b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}
