import { Router, type Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "mikawa_salt").digest("hex");
}

// ── ログイン試行のレート制限（総当たり対策）─────────────────────────────
// 管理画面（admin.mikawa-unso.jp）は Cloudflare Access を外したため、ログイン画面が
// インターネットに直接晒されている。パスワードは sha256 + 固定ソルトで総当たりに弱く、
// ユーザー名も少数のため、回数制限が無いとボットに突破されうる。
//
// 単一の api コンテナで動くのでプロセス内 Map で十分（複数レプリカにするなら要 Redis 等）。
const MAX_FAILURES = 5;                    // この回数失敗したらロック
const WINDOW_MS    = 15 * 60 * 1000;       // 失敗回数を数える窓
const LOCK_MS      = 15 * 60 * 1000;       // ロックする時間

type Attempt = { failures: number; firstFailureAt: number; lockedUntil: number };
const attempts = new Map<string, Attempt>();

/** Cloudflare が付ける実クライアントIPを使う（無ければ Express の req.ip）。 */
function clientKey(req: Request): string {
  return req.header("cf-connecting-ip") || req.ip || "unknown";
}

/** 期限切れのエントリを掃除する（Map が無限に太らないように）。 */
function pruneAttempts(now: number): void {
  for (const [key, a] of attempts) {
    if (a.lockedUntil < now && now - a.firstFailureAt > WINDOW_MS) attempts.delete(key);
  }
}

router.post("/auth/login", async (req, res) => {
  const now = Date.now();
  const key = clientKey(req);
  pruneAttempts(now);

  const existing = attempts.get(key);
  if (existing && existing.lockedUntil > now) {
    const mins = Math.ceil((existing.lockedUntil - now) / 60000);
    res.setHeader("Retry-After", String(Math.ceil((existing.lockedUntil - now) / 1000)));
    return res.status(429).json({
      error: `ログインの試行回数が上限に達しました。${mins}分後にもう一度お試しください。`,
    });
  }

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
    // 失敗を記録。窓を過ぎていればカウントをリセットして数え直す。
    const a = existing && now - existing.firstFailureAt <= WINDOW_MS
      ? existing
      : { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    a.failures += 1;
    if (a.failures >= MAX_FAILURES) a.lockedUntil = now + LOCK_MS;
    attempts.set(key, a);

    const remaining = MAX_FAILURES - a.failures;
    if (a.lockedUntil > now) {
      res.setHeader("Retry-After", String(Math.ceil(LOCK_MS / 1000)));
      return res.status(429).json({
        error: `ログインの試行回数が上限に達しました。${Math.ceil(LOCK_MS / 60000)}分後にもう一度お試しください。`,
      });
    }
    return res.status(401).json({
      error: `ユーザー名またはパスワードが違います（あと${remaining}回でロックされます）`,
    });
  }

  // 成功したらカウントをクリア
  attempts.delete(key);

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
