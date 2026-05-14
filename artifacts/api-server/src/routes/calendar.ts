import { Router } from "express";
import { db, calendarOverridesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Response } from "express";

const router = Router();

// SSE クライアント一覧
const sseClients = new Set<Response>();

function broadcastOverrides(overrides: Record<string, boolean>) {
  const data = JSON.stringify(overrides);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// GET /calendar/overrides — 現在の全オーバーライドを取得
router.get("/calendar/overrides", async (_req, res) => {
  const rows = await db.select().from(calendarOverridesTable);
  const result: Record<string, boolean> = {};
  for (const row of rows) {
    result[row.dateStr] = row.isRed;
  }
  return res.json(result);
});

// POST /calendar/overrides/:date — 日付をトグル（isRed: true/false/null で削除）
router.post("/calendar/overrides/:date", async (req, res) => {
  const { date } = req.params as { date: string };
  const { isRed } = req.body as { isRed: boolean | null };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  if (isRed === null || isRed === undefined) {
    await db.delete(calendarOverridesTable)
      .where(eq(calendarOverridesTable.dateStr, date));
  } else {
    await db.insert(calendarOverridesTable)
      .values({ dateStr: date, isRed })
      .onConflictDoUpdate({
        target: calendarOverridesTable.dateStr,
        set: { isRed, updatedAt: new Date() },
      });
  }

  const rows = await db.select().from(calendarOverridesTable);
  const all: Record<string, boolean> = {};
  for (const row of rows) all[row.dateStr] = row.isRed;

  broadcastOverrides(all);
  return res.json(all);
});

// DELETE /calendar/overrides — 年度リセット（from〜to の範囲を削除）
router.delete("/calendar/overrides", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  if (from && to) {
    const rows = await db.select().from(calendarOverridesTable);
    const toDelete = rows.filter(r => r.dateStr >= from && r.dateStr <= to);
    for (const row of toDelete) {
      await db.delete(calendarOverridesTable)
        .where(eq(calendarOverridesTable.dateStr, row.dateStr));
    }
  } else {
    await db.delete(calendarOverridesTable);
  }

  const rows = await db.select().from(calendarOverridesTable);
  const all: Record<string, boolean> = {};
  for (const row of rows) all[row.dateStr] = row.isRed;

  broadcastOverrides(all);
  return res.json(all);
});

// GET /calendar/stream — SSE でリアルタイム配信
router.get("/calendar/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);

  // 接続直後に現在値を送信
  db.select().from(calendarOverridesTable).then(rows => {
    const all: Record<string, boolean> = {};
    for (const row of rows) all[row.dateStr] = row.isRed;
    try { res.write(`data: ${JSON.stringify(all)}\n\n`); } catch { /* ignore */ }
  });

  // keep-alive
  const timer = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(timer); }
  }, 25_000);

  req.on("close", () => {
    clearInterval(timer);
    sseClients.delete(res);
  });
});

export default router;
