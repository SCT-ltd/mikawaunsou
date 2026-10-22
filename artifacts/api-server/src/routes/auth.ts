import { Router, type Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyPassword, hashSecret } from "../lib/password";
import { audit } from "../lib/audit";

const router = Router();

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

  const checked = user ? verifyPassword(String(password), user.passwordHash) : { ok: false, upgrade: false };
  if (!user || !checked.ok) {
    // 失敗を記録。窓を過ぎていればカウントをリセットして数え直す。
    const a = existing && now - existing.firstFailureAt <= WINDOW_MS
      ? existing
      : { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    a.failures += 1;
    if (a.failures >= MAX_FAILURES) a.lockedUntil = now + LOCK_MS;
    attempts.set(key, a);

    const remaining = MAX_FAILURES - a.failures;
    // 失敗も残す（パスワードは残さない。打たれたユーザー名だけ）
    const uname = String(username).slice(0, 64);
    await audit(req, "auth.login.fail", user ? `user:${user.id}` : null, { username: uname, reason: user ? "パスワードが違う" : "そのユーザー名は無い", locked: a.lockedUntil > now },
      { actor: "ログイン画面", status: a.lockedUntil > now ? 429 : 401, summary: `ログインに失敗（ユーザー名「${uname}」${a.lockedUntil > now ? "・回数の上限でロック" : ""}）` });
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

  // 古い形式（sha256＋共通の文字列）で保存されていたら、この機会に新しい形式で保存し直す
  if (checked.upgrade) {
    await db.update(usersTable).set({ passwordHash: hashSecret(String(password)), updatedAt: new Date() }).where(eq(usersTable.id, user.id));
  }

  // ログインの前後でセッションの番号を作り直す（前もって仕込まれた番号を乗っ取られないように）
  await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.displayName;
  req.session.role = user.role;
  req.session.employeeId = user.employeeId ?? null;

  await audit(req, "auth.login", `user:${user.id}`);
  return res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    employeeId: user.employeeId ?? null,
  });
});

router.post("/auth/logout", async (req, res) => {
  if (req.session?.userId) await audit(req, "auth.logout", `user:${req.session.userId}`);
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
