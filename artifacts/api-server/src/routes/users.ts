import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

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
  return res.status(201).json(created);
});

router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { password, role, displayName } = req.body;
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
  return res.json(updated);
});

router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (!deleted) return res.status(404).json({ error: "User not found" });
  return res.json({ success: true });
});

export default router;
