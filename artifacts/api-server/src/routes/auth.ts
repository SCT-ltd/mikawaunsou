import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "mikawa_salt").digest("hex");
}

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "ユーザー名とパスワードは必須です" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, String(username)))
    .limit(1);

  if (!user || user.passwordHash !== hashPassword(String(password))) {
    return res.status(401).json({ error: "ユーザー名またはパスワードが違います" });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.displayName;
  req.session.role = user.role;
  req.session.employeeId = user.employeeId ?? null;

  return res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    employeeId: user.employeeId ?? null,
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "ログアウトに失敗しました" });
    }
    res.clearCookie("connect.sid");
    return res.json({ success: true });
  });
});

router.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "未ログイン" });
  }
  return res.json({
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
    employeeId: req.session.employeeId ?? null,
  });
});

export default router;
