import { Router, type Response } from "express";
import webpush from "web-push";
import { paramStr } from "../lib/params";
import { db, messagesTable, pushSubscriptionsTable, employeesTable } from "@workspace/db";
import { eq, and, desc, asc, isNull, sql } from "drizzle-orm";
import { requireAdmin, requireOwnerOrAdmin } from "../lib/auth-middleware";

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
// admin: ?employeeId=0（事務所用）または任意の employeeId を購読可
// driver: 自分の session.employeeId のみ購読可（query は無視 or 一致時のみ可）
router.get("/messages/stream", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const requestedEmployeeId = parseInt((req.query["employeeId"] as string) ?? "0", 10);
  let employeeId: number;

  if (req.session.role === "admin") {
    employeeId = Number.isNaN(requestedEmployeeId) ? 0 : requestedEmployeeId;
  } else {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    if (!Number.isNaN(requestedEmployeeId) && requestedEmployeeId !== 0 && requestedEmployeeId !== Number(sessionEmployeeId)) {
      return res.status(403).json({ error: "他の従業員のストリームにはアクセスできません" });
    }
    employeeId = Number(sessionEmployeeId);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  addSse(employeeId, res);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 30000);
  req.on("close", () => {
    clearInterval(heartbeat);
    removeSse(employeeId, res);
  });
  return;
});

// ── 未読件数（ロール別スコープ） ─────────────────────
// ※ /messages/:employeeId より前に定義（パスマッチ優先のため）
//
// admin  : 事務所が見るべき全社員→事務所宛の未読件数（従来通り）
// driver : 自分宛（事務所→自分の employeeId）の未読件数のみ
//          driver で session.employeeId が無ければ 403
router.get("/messages/unread-count", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  if (req.session.role === "admin") {
    const rows = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.sender, "employee"),
        isNull(messagesTable.readAt),
      ));
    const unreadCount = rows.length;
    console.log("[MESSAGES_UNREAD_COUNT_AUTH_CHECK]", {
      role: req.session.role,
      sessionEmployeeId: req.session.employeeId,
      targetScope: "office_all",
      unreadCount,
    });
    return res.json({ totalUnreadCount: unreadCount });
  }

  // driver
  const sessionEmployeeId = req.session.employeeId;
  if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
    console.log("[MESSAGES_UNREAD_COUNT_AUTH_CHECK]", {
      role: req.session.role,
      sessionEmployeeId,
      targetScope: "employee_self",
      unreadCount: null,
    });
    return res.status(403).json({ error: "権限がありません" });
  }
  const rows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.employeeId, Number(sessionEmployeeId)),
      eq(messagesTable.sender, "office"),
      isNull(messagesTable.readAt),
    ));
  const unreadCount = rows.length;
  console.log("[MESSAGES_UNREAD_COUNT_AUTH_CHECK]", {
    role: req.session.role,
    sessionEmployeeId,
    targetScope: "employee_self",
    unreadCount,
  });
  return res.json({ unreadCount });
});

// ── 会話一覧（事務所用） ──────────────────────────────
router.get("/messages/conversations", requireAdmin, async (_req, res) => {
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

    const unreadRows = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.employeeId, emp.id),
        eq(messagesTable.sender, "employee"),
        isNull(messagesTable.readAt),
      ));

    return {
      employee: {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: emp.name,
        department: emp.department,
      },
      latestMessage: latest ?? null,
      unreadCount: unreadRows.length,
    };
  }));

  return res.json(result);
});

// ── ドライバーの未読件数（事務所→ドライバー） ─────────
router.get("/messages/:employeeId/unread-count", requireOwnerOrAdmin(req => parseInt(paramStr(req.params["employeeId"]), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params["employeeId"]), 10);
  if (isNaN(employeeId)) return res.status(400).json({ error: "Invalid employeeId" });
  const rows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.employeeId, employeeId),
      eq(messagesTable.sender, "office"),
      isNull(messagesTable.readAt),
    ));
  return res.json({ unreadCount: rows.length });
});

// ── メッセージ取得 ─────────────────────────────────────
router.get("/messages/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params["employeeId"]), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params["employeeId"]), 10);
  if (isNaN(employeeId)) return res.status(400).json({ error: "Invalid employeeId" });
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.employeeId, employeeId))
    .orderBy(asc(messagesTable.createdAt));
  return res.json(messages);
});

// ── 既読処理 ───────────────────────────────────────────
// reader='office' → employeeからのメッセージを既読
// reader='employee' → officeからのメッセージを既読
router.post("/messages/:employeeId/read", requireOwnerOrAdmin(req => parseInt(paramStr(req.params["employeeId"]), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params["employeeId"]), 10);
  if (isNaN(employeeId)) return res.status(400).json({ error: "Invalid employeeId" });
  const { reader } = req.body as { reader: "office" | "employee" };

  if (!reader || (reader !== "office" && reader !== "employee")) {
    return res.status(400).json({ error: "reader は 'office' または 'employee' を指定してください" });
  }

  const senderToMark = reader === "office" ? "employee" : "office";

  const updated = await db
    .update(messagesTable)
    .set({ readAt: sql`NOW()` })
    .where(and(
      eq(messagesTable.employeeId, employeeId),
      eq(messagesTable.sender, senderToMark),
      isNull(messagesTable.readAt),
    ))
    .returning({ id: messagesTable.id });

  console.log("[MESSAGES_MARK_READ]", {
    employeeId,
    reader,
    senderToMark,
    markedReadCount: updated.length,
  });

  return res.json({ markedReadCount: updated.length });
});

// ── メッセージ送信 ─────────────────────────────────────
// admin → sender は強制的に "office"、employeeId は body 通り（任意のドライバーへ）
// driver → sender は強制的に "employee"、employeeId は session.employeeId を強制使用
//          （body の employeeId が他人IDならその時点で 403、sender も信用しない）
router.post("/messages", async (req, res) => {
  // 未ログイン（QR打刻ページからのドライバー → 事務所 メッセージ）は元仕様通り公開で受ける。
  // ログイン中は admin/driver それぞれの owner チェックを後続で実施。
  const { employeeId: bodyEmployeeId, content } = req.body as {
    employeeId?: number;
    sender?: "office" | "employee";
    content?: string;
  };

  if (!content?.trim()) {
    return res.status(400).json({ error: "メッセージ内容が必要です" });
  }

  let employeeId: number;
  let sender: "office" | "employee";

  if (!req.session?.userId) {
    // 未ログイン公開フロー（QRページ）：ドライバーから事務所へのメッセージ扱い
    if (!bodyEmployeeId || Number.isNaN(Number(bodyEmployeeId))) {
      return res.status(400).json({ error: "送信元の employeeId が必要です" });
    }
    employeeId = Number(bodyEmployeeId);
    sender = "employee";
  } else if (req.session.role === "admin") {
    if (!bodyEmployeeId || Number.isNaN(Number(bodyEmployeeId))) {
      return res.status(400).json({ error: "送信先の employeeId が必要です" });
    }
    employeeId = Number(bodyEmployeeId);
    sender = "office";
  } else {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    // driver は body の employeeId を信用しない。指定されていれば本人IDと一致するかチェック。
    if (bodyEmployeeId !== undefined && bodyEmployeeId !== null && Number(bodyEmployeeId) !== Number(sessionEmployeeId)) {
      return res.status(403).json({ error: "他の従業員として送信することはできません" });
    }
    employeeId = Number(sessionEmployeeId);
    sender = "employee";
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

// ── 一斉送信 ───────────────────────────────────────────
router.post("/messages/broadcast", requireAdmin, async (req, res) => {
  const { content, employeeIds } = req.body as { content: string; employeeIds?: number[] };
  if (!content?.trim()) {
    return res.status(400).json({ error: "メッセージ内容が必要です" });
  }

  const allActive = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.isActive, true));

  const employees = Array.isArray(employeeIds) && employeeIds.length > 0
    ? allActive.filter(e => employeeIds.includes(e.id))
    : allActive;

  const inserted = await Promise.all(
    employees.map(emp =>
      db.insert(messagesTable).values({
        employeeId: emp.id,
        sender: "office",
        content: content.trim(),
      }).returning().then(rows => rows[0]!)
    )
  );

  // SSE + プッシュ通知を各従業員へ
  for (const message of inserted) {
    broadcastToEmployee(message.employeeId, { type: "message", message });

    const targets = await db.select()
      .from(pushSubscriptionsTable)
      .where(and(
        eq(pushSubscriptionsTable.role, "employee"),
        eq(pushSubscriptionsTable.employeeId, message.employeeId),
        eq(pushSubscriptionsTable.active, true),
      ));

    for (const sub of targets) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: "事務所からのお知らせ（全員）",
            body: content.trim().slice(0, 80),
            url: `/driver/${message.employeeId}`,
          })
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await db.update(pushSubscriptionsTable)
            .set({ active: false })
            .where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    }
  }

  return res.status(201).json({ count: inserted.length });
});

// ── プッシュ購読登録 ───────────────────────────────────
// admin → role を任意指定可能、employeeId も自由
// driver → role は強制的に "employee"、employeeId は session.employeeId を強制使用
router.post("/push/subscribe", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const { employeeId: bodyEmployeeId, role: bodyRole, endpoint, p256dh, auth } = req.body as {
    employeeId?: number | null;
    role?: "office" | "employee";
    endpoint?: string;
    p256dh?: string;
    auth?: string;
  };

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "購読情報が不足しています" });
  }

  let employeeId: number | null;
  let role: "office" | "employee";

  if (req.session.role === "admin") {
    if (!bodyRole || (bodyRole !== "office" && bodyRole !== "employee")) {
      return res.status(400).json({ error: "role は 'office' または 'employee' を指定してください" });
    }
    role = bodyRole;
    employeeId = bodyEmployeeId ?? null;
  } else {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    if (bodyEmployeeId !== undefined && bodyEmployeeId !== null && Number(bodyEmployeeId) !== Number(sessionEmployeeId)) {
      return res.status(403).json({ error: "他の従業員として購読することはできません" });
    }
    role = "employee";
    employeeId = Number(sessionEmployeeId);
  }

  const existing = await db.select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .limit(1);

  if (existing.length > 0) {
    await db.update(pushSubscriptionsTable)
      .set({ p256dh, auth, active: true, employeeId, role })
      .where(eq(pushSubscriptionsTable.id, existing[0]!.id));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      employeeId,
      role,
      endpoint,
      p256dh,
      auth,
    });
  }

  return res.status(201).json({ ok: true });
});

export default router;
