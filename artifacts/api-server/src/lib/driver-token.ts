import crypto from "crypto";
import type { Request, Response } from "express";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * QR 打刻ページ（ログインなし）で「暗証番号を確かめた端末」を見分けるための印。
 *
 * これまで暗証番号は画面側で確かめるだけで、サーバーは結果を覚えていなかった。
 * そのため社員番号（連番）を知っていれば、暗証番号なしで他人の打刻・位置・メッセージを
 * 読み書きできた。暗証番号が合ったときにこの印（署名つき Cookie）を渡し、公開 API は
 * 印のある端末だけに応える。
 *
 * - 印は社員ごと（1台の端末を複数人で使える）。
 * - 署名に暗証番号そのものを混ぜるので、暗証番号を変える・消すと古い印は使えなくなる。
 * - 有効期間は30日。切れたら暗証番号を入れ直す。
 */

const TOKEN_DAYS = 30;
const cookieName = (employeeId: number) => `mkdrv_${employeeId}`;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET が設定されていません");
    return "mikawa-dev-secret-change-in-prod";
  }
  return s;
}

/** QR の合言葉（URL の ?k= を画面がヘッダー X-QR-Key で送る。EventSource はヘッダーを付けられないので ?k= も見る） */
export function qrKeyFromReq(req: Request): string | null {
  const h = req.header("x-qr-key");
  if (h) return h;
  const q = (req.query as Record<string, unknown> | undefined)?.["k"];
  return typeof q === "string" && q ? q : null;
}

export function qrKeyOk(req: Request, stored: string | null | undefined): boolean {
  const given = qrKeyFromReq(req);
  if (!stored || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** QR の合言葉を作る（推測できない長さの英数字） */
export function newQrKey(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function sign(employeeId: number, exp: number, pin: string): string {
  return crypto.createHmac("sha256", secret()).update(`${employeeId}.${exp}.${pin}`).digest("base64url");
}

/** Cookie ヘッダーから1つ取り出す（cookie-parser は使っていないため自前で読む）。 */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** 暗証番号が合った端末に印を渡す。 */
export function issueDriverToken(res: Response, employeeId: number, pin: string): void {
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(cookieName(employeeId), `${exp}.${sign(employeeId, exp, pin)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: TOKEN_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function tokenValid(req: Request, employeeId: number, pin: string): boolean {
  const raw = readCookie(req, cookieName(employeeId));
  if (!raw) return false;
  const dot = raw.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(raw.slice(0, dot));
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(employeeId, exp, pin);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type DriverAccess =
  /** 暗証番号を確かめた端末 */
  | "verified"
  /** 暗証番号が未設定の社員（確かめようがない） */
  | "no-pin"
  /** 暗証番号が設定されているのに、確かめていない端末 */
  | "denied"
  /** 社員が存在しない */
  | "not-found";

/** ログインしていない要求が、その社員として扱ってよいかを調べる。 */
export async function driverAccess(req: Request, employeeId: number): Promise<DriverAccess> {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return "not-found";
  const [emp] = await db
    .select({ pin: employeesTable.pin, qrKey: employeesTable.qrKey })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
  if (!emp) return "not-found";
  // 暗証番号を確かめた端末は、QR の合言葉が無くても本人
  if (emp.pin && tokenValid(req, employeeId, emp.pin)) return "verified";
  // それ以外は通さない。以前は暗証番号の無い人を QR の合言葉だけで通していたため、
  // QR の写真が他人に渡ると、その人として打刻・位置の送信ができた。
  // 暗証番号の無い人は、打刻ページで最初に決めてもらう（POST /employees/:id/pin/setup）。
  return "denied";
}

/** 暗証番号として弱すぎるもの（同じ数字の繰り返し・並び）。設定のときに断る。 */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  return "0123456789012".includes(pin) || "9876543210987".includes(pin);
}

export const QR_KEY_REQUIRED_BODY = { error: "QRコードが新しくなりました。事務所で新しいQRコードを受け取って、読み取り直してください。", code: "qr-key-required" };
export const PIN_REQUIRED_BODY = { error: "暗証番号の確認が必要です。画面を読み込み直して、暗証番号を入力してください。", code: "pin-required" };
export const PIN_NOT_SET_BODY = { error: "暗証番号が未設定のため表示できません。事務所で暗証番号を設定してください。", code: "pin-not-set" };
