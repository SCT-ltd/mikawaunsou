import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashSecret } from "../lib/password";
import { audit } from "../lib/audit";

const router = Router();
const hashPassword = (password: string) => hashSecret(password);
const ROLES = ["admin", "staff", "viewer"];

/** 管理者が何人いるか（最後の1人を消す・降格するのを止めるため） */
async function adminCount(): Promise<number> {
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
  return rows.length;
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
  if (String(password).length < 8) return res.status(400).json({ error: "パスワードは8文字以上にしてください" });
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: "役割が正しくありません" });
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
  await audit(req, "user.create", `user:${created!.id}`, { username, role: role ?? "admin" });
  return res.status(201).json(created);
});

router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { password, role, displayName } = req.body;
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: "役割が正しくありません" });
  if (password && String(password).trim() !== "" && String(password).length < 8) {
    return res.status(400).json({ error: "パスワードは8文字以上にしてください" });
  }
  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!current) return res.status(404).json({ error: "User not found" });
  // 最後の管理者を管理者以外にすると、だれもユーザーを管理できなくなる
  if (role && role !== "admin" && current.role === "admin" && (await adminCount()) <= 1) {
    return res.status(409).json({ error: "管理者が1人だけのため、役割を変えられません。先に別の人を管理者にしてください。" });
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
  await audit(req, "user.update", `user:${id}`, {
    ...(role && role !== current.role ? { role: [current.role, role] } : {}),
    ...(displayName && displayName !== current.displayName ? { displayName: [current.displayName, displayName] } : {}),
    ...(password && String(password).trim() !== "" ? { password: "変更" } : {}),
  });
  return res.json(updated);
});

router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  if (req.session.userId === id) return res.status(409).json({ error: "自分自身は削除できません" });
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "admin" && (await adminCount()) <= 1) {
    return res.status(409).json({ error: "最後の管理者は削除できません" });
  }
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (!deleted) return res.status(404).json({ error: "User not found" });
  await audit(req, "user.delete", `user:${id}`, { username: target.username, role: target.role });
  return res.json({ success: true });
});

export default router;
