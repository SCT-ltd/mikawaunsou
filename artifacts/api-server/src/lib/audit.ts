import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: number | null;
  detail?: unknown;
}

/**
 * 監査ログを1件書く。
 * 記録に失敗しても本来の操作は止めない（ログ出力のみ）。ただし失敗は必ずエラーログに残す。
 */
export async function writeAudit(req: Request, entry: AuditEntry): Promise<void> {
  const s = req.session;
  const actorLabel = s?.userId
    ? `${s.displayName ?? s.username ?? "user"}（${s.username ?? s.userId}）`
    : "未ログイン（QR打刻）";
  try {
    await db.insert(auditLogsTable).values({
      userId: s?.userId ?? null,
      actorLabel,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      detail: (entry.detail ?? null) as never,
      ip: req.ip ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action, targetType: entry.targetType, targetId: entry.targetId }, "監査ログの書き込みに失敗しました");
  }
}

/**
 * 2つの行の差分（変わった列だけ）を { 列名: { before, after } } で返す。
 * omit に入れた列（PIN・パスワードのハッシュなど）は記録しない。
 */
export function diffRow(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  omit: string[] = ["updatedAt", "createdAt"],
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (omit.includes(key)) continue;
    const a = before[key];
    const b = after[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);
    if (!same) out[key] = { before: a, after: b };
  }
  return out;
}
