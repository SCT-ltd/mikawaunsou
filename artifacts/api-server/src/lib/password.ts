import crypto from "crypto";

/**
 * パスワード・暗証番号の保存形式。
 *
 * 以前はパスワードを sha256(パスワード＋全員共通の文字列) で保存していた。DB や控えの dump が
 * 漏れると短時間で解かれ、同じパスワードの人は同じ値になる。暗証番号は平文のまま保存していた。
 * scrypt（人ごとの塩・計算に時間がかかる）で保存し直す。
 *
 *   形式: scrypt$<N>$<塩(base64)>$<値(base64)>
 *
 * 古い形式（パスワード＝sha256の16進64桁、暗証番号＝4桁の数字）は、合っていたときに
 * その場で新しい形式へ書き換える（呼ぶ側で verify の upgrade を見て保存する）。
 */
const N = 16384;
const KEYLEN = 32;

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, KEYLEN, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyScrypt(plain: string, stored: string): boolean {
  const [, n, saltB64, hashB64] = stored.split("$");
  if (!n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(plain, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: 8, p: 1 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const isHashed = (stored: string | null | undefined) => !!stored && stored.startsWith("scrypt$");

/** 管理画面のパスワード。upgrade=true なら古い形式で合ったので、新しい形式に保存し直す。 */
export function verifyPassword(plain: string, stored: string): { ok: boolean; upgrade: boolean } {
  if (isHashed(stored)) return { ok: verifyScrypt(plain, stored), upgrade: false };
  const legacy = crypto.createHash("sha256").update(plain + "mikawa_salt").digest("hex");
  const ok = safeEqual(legacy, stored);
  return { ok, upgrade: ok };
}

/** 暗証番号。upgrade=true なら平文で保存されていたので、新しい形式に保存し直す。 */
export function verifyPin(plain: string, stored: string): { ok: boolean; upgrade: boolean } {
  if (isHashed(stored)) return { ok: verifyScrypt(plain, stored), upgrade: false };
  const ok = safeEqual(String(plain), stored);
  return { ok, upgrade: ok };
}
