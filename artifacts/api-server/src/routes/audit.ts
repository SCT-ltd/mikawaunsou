import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";

const router = Router();

// 監査ログの閲覧（admin 専用。routes/index.ts の "/audit-logs" プレフィックスで requireAdmin）
// 追記専用なので、更新・削除のエンドポイントは作らない。
//   ?targetType=payroll&targetId=12   … 特定の明細の履歴
//   ?action=payroll.unconfirm         … 確定解除だけ
//   ?from=2026-09-01&to=2026-10-01    … 期間（to は含まない）
//   ?limit=200                        … 既定100・最大1000
router.get("/audit-logs", async (req, res) => {
  const conditions = [];
  if (typeof req.query.targetType === "string") conditions.push(eq(auditLogsTable.targetType, req.query.targetType));
  if (typeof req.query.targetId === "string") {
    const n = parseInt(req.query.targetId, 10);
    if (Number.isNaN(n)) return res.status(400).json({ error: "targetId が正しくありません。" });
    conditions.push(eq(auditLogsTable.targetId, n));
  }
  if (typeof req.query.action === "string") conditions.push(eq(auditLogsTable.action, req.query.action));
  for (const [key, op] of [["from", gte], ["to", lt]] as const) {
    const v = req.query[key];
    if (typeof v !== "string") continue;
    const d = new Date(`${v}T00:00:00+09:00`);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `${key} は YYYY-MM-DD で指定してください。` });
    conditions.push(op(auditLogsTable.at, d));
  }
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 1000);
  const rows = await db.select().from(auditLogsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.at), desc(auditLogsTable.id))
    .limit(limit);
  return res.json(rows);
});

export default router;
