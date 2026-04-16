import { Router, type Response } from "express";
import webpush from "web-push";
import { db, messagesTable, pushSubscriptionsTable, employeesTable } from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";

const router = Router();

// VAPID設定
const vapidPublicKey  = process.env["VAPID_PUBLIC_KEY"]!;
const vapidPrivateKey = process.env["VAPID_PRIVATE_KEY"]!;
const vapidEmail      = process.env["VAPID_EMAIL"] ?? "mailto:admin@example.com";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

// ── SSEクライアント（employeeId→Set<res>）──
// officeは employeeId = 0 として扱う
const sseClients = new Map<number, Set<Response>>();

function addSse(employeeId: number, res: Response) {
  if (!sseClients.has(employeeId)) sseClients.set(employeeId, new Set());
  sseClients.get(employeeId)!.add(res);
}
function removeSse(employeeId: number, res: Response) {
  sseClients.get(employeeId)?.delete(res);
}
function broadcastToEmployee(employeeId: number, data: unknown) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.get(employeeId)?.forEach(r => r.write(payload));
  // office (0) も通知
  sseClients.get(0)?.forEach(r => r.write(payload));
}

// ── VAPID公開鍵 ──────────────────────────────────────
router.get("/messages/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapidPublicKey ?? "" });
});

// ── SSEストリーム ──────────────────────────────────────
router.get("/messages/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const employeeId = parseInt((req.query["employeeId"] as string) ?? "0", 10);
  addSse(employeeId, res);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 30000);
  req.on("close", () => {
    clearInterval(heartbeat);
    removeSse(employeeId, res);
  });
});

// ── 会話一覧（事務所用） ──────────────────────────────
router.get("/messages/conversations", async (_req, res) => {
  const employees = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.isActive, true))
    .orderBy(asc(employeesTable.employeeCode));

  const result = await Promise.all(employees.map(async emp => {
    const [latest] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.employeeId, emp.id))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);

    const unread = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.employeeId, emp.id),
        eq(messagesTable.sender, "employee"),
      ))
      .then(rows => rows.filter(r => {
        // readAt is null = unread
        return true; // counted below
      }));

    const unreadCount = (await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.employeeId, emp.id),
        eq(messagesTable.sender, "employee"),
      ))
    ).length; // simplified: count all employee messages as potentially unread
    void unread;

    return {
      employee: {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: emp.name,
        department: emp.department,
      },
      latestMessage: latest ?? null,
      unreadCount,
    };
  }));

  return res.json(result);
});

// ── メッセージ取得 ─────────────────────────────────────
router.get("/messages/:employeeId", async (req, res) => {
  const employeeId = parseInt(req.params["employeeId"], 10);
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.employeeId, employeeId))
    .orderBy(asc(messagesTable.createdAt));
  return res.json(messages);
});

// ── メッセージ送信 ─────────────────────────────────────
router.post("/messages", async (req, res) => {
  const { employeeId, sender, content } = req.body as {
    employeeId: number;
    sender: "office" | "employee";
    content: string;
  };

  if (!employeeId || !sender || !content?.trim()) {
    return res.status(400).json({ error: "必須パラメータが不足しています" });
  }

  const [message] = await db.insert(messagesTable).values({
    employeeId,
    sender,
    content: content.trim(),
  }).returning();

  // SSEでリアルタイム配信
  broadcastToEmployee(employeeId, { type: "message", message });

  // プッシュ通知
  const targets =
    sender === "office"
      ? await db.select().from(pushSubscriptionsTable)
          .where(and(
            eq(pushSubscriptionsTable.role, "employee"),
            eq(pushSubscriptionsTable.employeeId, employeeId),
            eq(pushSubscriptionsTable.active, true),
          ))
      : await db.select().from(pushSubscriptionsTable)
          .where(and(
            eq(pushSubscriptionsTable.role, "office"),
            eq(pushSubscriptionsTable.active, true),
          ));

  const [emp] = await db.select({ name: employeesTable.name })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));

  for (const sub of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: sender === "office" ? `事務所からのメッセージ` : `${emp?.name ?? "従業員"}からのメッセージ`,
          body: content.trim().slice(0, 80),
          url: sender === "office" ? `/driver/${employeeId}` : `/messages`,
        })
      );
    } catch (err: unknown) {
      // 期限切れ購読を無効化
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db.update(pushSubscriptionsTable)
          .set({ active: false })
          .where(eq(pushSubscriptionsTable.id, sub.id));
      }
    }
  }

  return res.status(201).json(message);
});

// ── プッシュ購読登録 ───────────────────────────────────
router.post("/push/subscribe", async (req, res) => {
  const { employeeId, role, endpoint, p256dh, auth } = req.body as {
    employeeId?: number | null;
    role: "office" | "employee";
    endpoint: string;
    p256dh: string;
    auth: string;
  };

  if (!endpoint || !p256dh || !auth || !role) {
    return res.status(400).json({ error: "購読情報が不足しています" });
  }

  // 既存の同エンドポイントを更新 or 新規挿入
  const existing = await db.select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .limit(1);

  if (existing.length > 0) {
    await db.update(pushSubscriptionsTable)
      .set({ p256dh, auth, active: true, employeeId: employeeId ?? null })
      .where(eq(pushSubscriptionsTable.id, existing[0]!.id));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      employeeId: employeeId ?? null,
      role,
      endpoint,
      p256dh,
      auth,
    });
  }

  return res.status(201).json({ ok: true });
});

export default router;
