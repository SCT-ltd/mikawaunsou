import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "ユーザー名とパスワードを入力してください。" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "ユーザー名またはパスワードが正しくありません。" });
  }

  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.username = user.username;

  return res.json({
    id: user.id,
    username: user.username,
    role: user.role,
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "ログアウトに失敗しました。" });
    }
    res.clearCookie("connect.sid");
    return res.json({ message: "ログアウトしました。" });
  });
});

router.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "認証されていません。" });
  }

  return res.json({
    id: req.session.userId,
    username: req.session.username,
    role: req.session.userRole,
  });
});

export default router;
