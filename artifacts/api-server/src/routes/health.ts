import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// DB に1回問い合わせてから ok を返す（以前は DB が止まっていても ok を返していた）
router.get("/healthz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return res.status(503).json({ status: "db-unavailable" });
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  return res.json(data);
});

export default router;
