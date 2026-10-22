import webpush from "web-push";
import { db, pushSubscriptionsTable, alertPushesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * スマホ・PC へのプッシュ通知をまとめて送る。
 * 送れなかった購読（期限切れ＝410/404）は止める。失敗しても呼び出し元は止めない。
 */
export interface PushPayload { title: string; body: string; url: string }

let configured = false;
function ready(): boolean {
  if (configured) return true;
  const pub = process.env["VAPID_PUBLIC_KEY"], priv = process.env["VAPID_PRIVATE_KEY"];
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env["VAPID_EMAIL"] ?? "mailto:admin@example.com", pub, priv);
  configured = true;
  return true;
}

async function sendTo(subs: Array<typeof pushSubscriptionsTable.$inferSelect>, payload: PushPayload): Promise<number> {
  if (!ready()) return 0;
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db.update(pushSubscriptionsTable).set({ active: false }).where(eq(pushSubscriptionsTable.id, sub.id));
      }
    }
  }
  return sent;
}

/** その社員のスマホへ */
export async function pushToEmployee(employeeId: number, payload: PushPayload): Promise<number> {
  const subs = await db.select().from(pushSubscriptionsTable).where(and(
    eq(pushSubscriptionsTable.role, "employee"), eq(pushSubscriptionsTable.employeeId, employeeId), eq(pushSubscriptionsTable.active, true)));
  return sendTo(subs, payload);
}

/** 事務所の PC へ */
export async function pushToOffice(payload: PushPayload): Promise<number> {
  const subs = await db.select().from(pushSubscriptionsTable).where(and(
    eq(pushSubscriptionsTable.role, "office"), eq(pushSubscriptionsTable.active, true)));
  return sendTo(subs, payload);
}

/** 同じ出来事（key）では1回だけ送る（従業員のお知らせと同じ「送った印」の表を使う） */
export async function pushOnce(key: string, send: () => Promise<unknown>): Promise<boolean> {
  const inserted = await db.insert(alertPushesTable).values({ key }).onConflictDoNothing().returning({ key: alertPushesTable.key });
  if (inserted.length === 0) return false;
  try { await send(); } catch (err) { logger.warn({ err, key }, "プッシュ通知に失敗"); }
  return true;
}

/** 応答を返したあとで送る（送り終わるまで画面を待たせない） */
export function later(fn: () => Promise<unknown>): void {
  setImmediate(() => { fn().catch((err) => logger.warn({ err }, "あとで送る通知に失敗")); });
}
