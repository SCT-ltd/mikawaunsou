import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import crypto from "crypto";
import { writeAudit } from "../lib/audit";

const router = Router();

/**
 * 自分以外の管理者の人数。
 * 管理者が0人になると routes/index.ts の「ユーザー0件なら全通し（初回セットアップ）」に近い状態になったり、
 * 誰も管理画面を操作できなくなるため、最後の管理者は削除・降格させない。
 */
async function otherAdminCount(excludeUserId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), ne(usersTable.id, excludeUserId)));
  return count;
}

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "mikawa_salt").digest("hex");
}

router.get("/users", async (_req, res) => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.id);
  return res.json(users);
});

router.post("/users", async (req, res) => {
  const { username, displayName, password, role } = req.body;
  if (!username || !displayName || !password) {
    return res.status(400).json({ error: "username, displayName, password は必須です" });
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "そのユーザー名は既に使用されています" });
  }
  const [created] = await db.insert(usersTable).values({
    username,
    displayName,
    passwordHash: hashPassword(password),
    role: role ?? "admin",
  }).returning({
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  });
  await writeAudit(req, { action: "user.create", targetType: "user", targetId: created.id,
    detail: { username: created.username, displayName: created.displayName, role: created.role } });
  return res.status(201).json(created);
});

router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { password, role, displayName } = req.body;
  const [before] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!before) return res.status(404).json({ error: "User not found" });
  if (role && role !== "admin" && before.role === "admin" && (await otherAdminCount(id)) === 0) {
    return res.status(409).json({ error: "最後の管理者の権限は変更できません。先に別の管理者を作成してください。" });
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (displayName) updates.displayName = displayName;
  if (role) updates.role = role;
  if (password && password.trim() !== "") updates.passwordHash = hashPassword(password);
  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    });
  if (!updated) return res.status(404).json({ error: "User not found" });
  await writeAudit(req, { action: "user.update", targetType: "user", targetId: id, detail: {
    username: before.username,
    displayName: displayName && displayName !== before.displayName ? { before: before.displayName, after: displayName } : undefined,
    role: role && role !== before.role ? { before: before.role, after: role } : undefined,
    passwordChanged: Boolean(password && password.trim() !== ""),
  } });
  return res.json(updated);
});

router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  if (req.session?.userId === id) {
    return res.status(409).json({ error: "ログイン中の自分自身は削除できません。" });
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "admin" && (await otherAdminCount(id)) === 0) {
    return res.status(409).json({ error: "最後の管理者は削除できません。先に別の管理者を作成してください。" });
  }
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (!deleted) return res.status(404).json({ error: "User not found" });
  await writeAudit(req, { action: "user.delete", targetType: "user", targetId: id,
    detail: { username: target.username, displayName: target.displayName, role: target.role, employeeId: target.employeeId } });
  return res.json({ success: true });
});

export default router;
