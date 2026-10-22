import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc, lt, and, like, type SQL } from "drizzle-orm";

/** 操作の記録（新しい順・最大200件ずつ）。?before=<id> で続き、?q= で操作名・対象・中身を絞り込み */
const router = Router();

router.get("/audit-logs", async (req, res) => {
  const before = Number(req.query["before"]);
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const conds: SQL[] = [];
  if (Number.isInteger(before) && before > 0) conds.push(lt(auditLogsTable.id, before));
  if (q) conds.push(like(auditLogsTable.detail, `%${q.replace(/[%_]/g, "")}%`));
  const rows = await db.select().from(auditLogsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogsTable.id)).limit(200);
  return res.json(rows);
});

export default router;
