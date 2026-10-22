import { Router } from "express";
import { db, alertReadsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";
import { computeAlerts } from "../lib/alerts";

/**
 * 従業員のお知らせ（右上のベル・ダッシュボード）。
 *   GET  /alerts          … お知らせの一覧（read＝このユーザーが読んだか）と未読の数
 *   POST /alerts/read     … { keys: string[] } を読んだことにする
 *   POST /alerts/read-all … いま出ているお知らせをすべて読んだことにする
 */
const router = Router();

router.get("/alerts", requireAdmin, async (req, res) => {
  const userId = req.session.userId!;
  const alerts = await computeAlerts();
  const keys = alerts.map((a) => a.key);
  const reads = keys.length === 0 ? [] : await db.select({ key: alertReadsTable.key }).from(alertReadsTable)
    .where(and(eq(alertReadsTable.userId, userId), inArray(alertReadsTable.key, keys)));
  const readSet = new Set(reads.map((r) => r.key));
  const items = alerts.map((a) => ({ ...a, read: readSet.has(a.key) }));
  return res.json({ items, unread: items.filter((a) => !a.read).length });
});

async function markRead(userId: number, keys: string[]) {
  const clean = [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0 && k.length <= 200))].slice(0, 500);
  if (clean.length === 0) return;
  await db.insert(alertReadsTable).values(clean.map((key) => ({ userId, key }))).onConflictDoNothing();
}

router.post("/alerts/read", requireAdmin, async (req, res) => {
  const keys = (req.body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) return res.status(400).json({ error: "keys を配列で指定してください" });
  await markRead(req.session.userId!, keys as string[]);
  return res.json({ ok: true });
});

router.post("/alerts/read-all", requireAdmin, async (req, res) => {
  const alerts = await computeAlerts();
  await markRead(req.session.userId!, alerts.map((a) => a.key));
  return res.json({ ok: true });
});

export default router;
