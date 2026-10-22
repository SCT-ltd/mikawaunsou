import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc, lt, and, or, eq, gte, ilike, isNull, sql, type SQL } from "drizzle-orm";

/**
 * 操作の記録（新しい順・最大200件ずつ）。?before=<id> で続き。
 * 絞り込み：?q=（一文・だれが・中身）／?category=／?employeeId=／?userId=（0＝QR打刻ページ）／
 *           ?from=YYYY-MM-DD&to=YYYY-MM-DD（日本時間）／?failed=1（断られた操作だけ）
 */
const router = Router();

router.get("/audit-logs", async (req, res) => {
  const qs = req.query as Record<string, unknown>;
  const str = (k: string) => (typeof qs[k] === "string" ? (qs[k] as string).trim() : "");
  const before = Number(qs["before"]);
  const conds: SQL[] = [];
  if (Number.isInteger(before) && before > 0) conds.push(lt(auditLogsTable.id, before));
  const q = str("q").replace(/[%_\\]/g, "");
  if (q) conds.push(or(ilike(auditLogsTable.summary, `%${q}%`), ilike(auditLogsTable.actor, `%${q}%`), ilike(auditLogsTable.detail, `%${q}%`), ilike(auditLogsTable.action, `%${q}%`))!);
  const cat = str("category");
  if (cat) conds.push(eq(auditLogsTable.category, cat));
  const emp = Number(str("employeeId"));
  if (Number.isInteger(emp) && emp > 0) conds.push(eq(auditLogsTable.employeeId, emp));
  const uid = str("userId");
  if (uid === "0") conds.push(isNull(auditLogsTable.userId));
  else if (/^\d+$/.test(uid)) conds.push(eq(auditLogsTable.userId, Number(uid)));
  const from = str("from"), to = str("to");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) conds.push(gte(auditLogsTable.at, sql`(${from}::date)::timestamp - interval '9 hours'`));
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) conds.push(lt(auditLogsTable.at, sql`(${to}::date + 1)::timestamp - interval '9 hours'`));
  if (str("failed") === "1") conds.push(gte(auditLogsTable.status, 400));
  const rows = await db.select().from(auditLogsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogsTable.id)).limit(200);
  return res.json(rows);
});

export default router;
