import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router = Router();

// 認証チェックミドルウェア (簡易版)
const isAdmin = (req: any, res: any, next: any) => {
  if (req.session.userId && req.session.userRole === 'admin') {
    return next();
  }
  res.status(403).json({ error: "管理者権限が必要です。" });
};

// ユーザー一覧取得
router.get("/users", isAdmin, async (req, res) => {
  try {
    const users = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      role: usersTable.role,
      createdAt: usersTable.createdAt
    }).from(usersTable);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "ユーザー一覧の取得に失敗しました。" });
  }
});

// ユーザー作成
router.post("/users", isAdmin, async (req, res) => {
  const { username, displayName, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "ユーザー名とパスワードを入力してください。" });
  }

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existing) {
      return res.status(400).json({ error: "このユーザー名は既に存在します。" });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const [newUser] = await db.insert(usersTable).values({
      username,
      displayName,
      passwordHash,
      role: role || 'admin'
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      role: usersTable.role
    });

    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: "ユーザーの作成に失敗しました。" });
  }
});

// パスワード変更 / ユーザー更新
router.patch("/users/:id", isAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { password, role } = req.body;

  try {
    const updateData: any = {};
    if (role) updateData.role = role;
    if (password) {
      const salt = bcrypt.genSaltSync(10);
      updateData.passwordHash = bcrypt.hashSync(password, salt);
    }
    updateData.updatedAt = new Date();

    const [updated] = await db.update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        role: usersTable.role
      });

    if (!updated) {
      return res.status(404).json({ error: "ユーザーが見つかりません。" });
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "ユーザーの更新に失敗しました。" });
  }
});

// ユーザー削除
router.delete("/users/:id", isAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  
  // 自分自身は削除不可
  if (id === req.session.userId) {
    return res.status(400).json({ error: "自分自身を削除することはできません。" });
  }

  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.json({ message: "ユーザーを削除しました。" });
  } catch (error) {
    res.status(500).json({ error: "ユーザーの削除に失敗しました。" });
  }
});

export default router;
