import express, { Router, type Response } from "express";
import webpush from "web-push";
import { paramStr } from "../lib/params";
import { db, messagesTable, pushSubscriptionsTable, employeesTable, messageAttachmentsTable } from "@workspace/db";
import { eq, and, desc, asc, isNull, sql, inArray, lt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin, requireOwnerOrAdmin } from "../lib/auth-middleware";
import { driverAccess, PIN_REQUIRED_BODY, PIN_NOT_SET_BODY } from "../lib/driver-token";
import { isAdminReq } from "../lib/roles";

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

// ── 添付（写真・PDF） ─────────────────────────────────────
// 送る前に POST /messages/:社員/attachments で上げて番号をもらい、POST /messages の attachmentIds でつなぐ。
// 写真は端末で長い辺1600pxに縮めてから送る（そのままだと1枚数MBになる）。
const ATTACH_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
};
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_MAX_PER_MESSAGE = 4;
export type AttachmentMeta = { id: number; fileName: string; mime: string; size: number };
const metaCols = { id: messageAttachmentsTable.id, messageId: messageAttachmentsTable.messageId, fileName: messageAttachmentsTable.fileName, mime: messageAttachmentsTable.mime, size: messageAttachmentsTable.size };

/** メッセージに付いている添付（中身は除く） */
async function attachmentsOf(messageIds: number[]): Promise<Map<number, AttachmentMeta[]>> {
  const out = new Map<number, AttachmentMeta[]>();
  if (messageIds.length === 0) return out;
  const rows = await db.select(metaCols).from(messageAttachmentsTable).where(inArray(messageAttachmentsTable.messageId, messageIds)).orderBy(asc(messageAttachmentsTable.id));
  for (const r of rows) {
    if (!out.has(r.messageId!)) out.set(r.messageId!, []);
    out.get(r.messageId!)!.push({ id: r.id, fileName: r.fileName, mime: r.mime, size: r.size });
  }
  return out;
}

/** 添付の中身を受け取る。大きすぎるときは 413 で理由を返す（そのままだと 500 になる） */
const rawParser = express.raw({ type: () => true, limit: ATTACH_MAX_BYTES + 1024 });
const rawBody = (req: express.Request, res: express.Response, next: express.NextFunction) =>
  rawParser(req, res, (err?: unknown) => {
    if (!err) return next();
    const st = (err as { status?: number }).status;
    return res.status(st === 413 ? 413 : 400).json({ error: st === 413 ? "1つのファイルは10MBまでです" : "ファイルを受け取れませんでした" });
  });
const ownerOf = (req: { params: Record<string, unknown> }) => parseInt(paramStr(req.params["employeeId"] as string), 10);
router.post("/messages/:employeeId/attachments", requireOwnerOrAdmin(ownerOf, { requirePin: true }),
  rawBody, async (req, res) => {
  const employeeId = ownerOf(req);
  if (Number.isNaN(employeeId)) return res.status(400).json({ error: "Invalid employeeId" });
  const mime = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ATTACH_TYPES[mime]) return res.status(400).json({ error: "送れるのは写真（JPEG・PNG・WebP・GIF）とPDFだけです" });
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || data.length === 0) return res.status(400).json({ error: "ファイルが空です" });
  if (data.length > ATTACH_MAX_BYTES) return res.status(413).json({ error: "1つのファイルは10MBまでです" });
  // 中身が名乗った種類と違うもの（拡張子を変えただけの物など）は断る
  const head = data.subarray(0, 12);
  const looks = mime === "application/pdf" ? head.subarray(0, 4).toString("latin1") === "%PDF"
    : mime === "image/jpeg" ? head[0] === 0xff && head[1] === 0xd8
    : mime === "image/png" ? head.subarray(1, 4).toString("latin1") === "PNG"
    : mime === "image/gif" ? head.subarray(0, 3).toString("latin1") === "GIF"
    : head.subarray(8, 12).toString("latin1") === "WEBP";
  if (!looks) return res.status(400).json({ error: "ファイルの中身が写真・PDFではありません" });
  let fileName = "添付";
  try { fileName = decodeURIComponent(String(req.headers["x-file-name"] ?? "")).replace(/[\/\r\n\t"]/g, "_").trim().slice(0, 120) || fileName; } catch { /* 名前が読めなければ既定 */ }
  const [row] = await db.insert(messageAttachmentsTable).values({
    employeeId, messageId: null, uploadedBy: isAdminReq(req) ? "office" : "employee",
    fileName, mime, size: data.length, data, createdAt: new Date(),
  }).returning(metaCols);
  return res.status(201).json({ id: row!.id, fileName: row!.fileName, mime: row!.mime, size: row!.size });
});

router.get("/messages/:employeeId/attachments/:id", requireOwnerOrAdmin(ownerOf, { requirePin: true }), async (req, res) => {
  const employeeId = ownerOf(req);
  const id = parseInt(paramStr(req.params["id"]), 10);
  const [a] = await db.select().from(messageAttachmentsTable).where(and(eq(messageAttachmentsTable.id, id), eq(messageAttachmentsTable.employeeId, employeeId)));
  if (!a) return res.status(404).json({ error: "添付が見つかりません" });
  const dl = req.query["download"] === "1";
  res.setHeader("Content-Type", a.mime);
  res.setHeader("Content-Length", String(a.data.length));
  res.setHeader("Content-Disposition", `${dl ? "attachment" : "inline"}; filename="file.${ATTACH_TYPES[a.mime] ?? "bin"}"; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(a.data);
});

// つながないまま1日たった添付を消す（上げたあと送らずにやめた分）
setInterval(() => {
  void db.delete(messageAttachmentsTable)
    .where(and(isNull(messageAttachmentsTable.messageId), lt(messageAttachmentsTable.createdAt, new Date(Date.now() - 24 * 3600_000))))
    .catch((err) => logger.warn({ err }, "使われなかった添付を消せませんでした"));
}, 3600_000).unref();

// ── VAPID公開鍵 ──────────────────────────────────────
router.get("/messages/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapidPublicKey ?? "" });
});

// ── SSEストリーム ──────────────────────────────────────
// admin: ?employeeId=0（事務所用）または任意の employeeId を購読可
// driver: 自分の session.employeeId のみ購読可（query は無視 or 一致時のみ可）
router.get("/messages/stream", async (req, res) => {
  const requestedEmployeeId = parseInt((req.query["employeeId"] as string) ?? "0", 10);
  let employeeId: number;

  if (!req.session?.userId) {
    // QR の打刻ページ：暗証番号を確かめた端末の本人だけ（メッセージは暗証番号が要る決まり）。
    // 以前は 401 で断っていたため、事務所からのメッセージが開き直すまで画面に出なかった。
    if (Number.isNaN(requestedEmployeeId) || requestedEmployeeId <= 0) return res.status(401).json({ error: "ログインが必要です" });
    const access = await driverAccess(req, requestedEmployeeId);
    if (access === "not-found") return res.status(404).json({ error: "社員が見つかりません。" });
    if (access === "no-pin") return res.status(403).json(PIN_NOT_SET_BODY);
    if (access === "denied") return res.status(401).json(PIN_REQUIRED_BODY);
    employeeId = requestedEmployeeId;
  } else if (isAdminReq(req)) {
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

  // つながりの確認（画面は ping が来なくなったら、切れたとみなしてつなぎ直す）
  const heartbeat = setInterval(() => res.write("event: ping\ndata: 1\n\n"), 25000);
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

  if (isAdminReq(req)) {
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
router.get("/messages/:employeeId/unread-count", requireOwnerOrAdmin(req => parseInt(paramStr(req.params["employeeId"]), 10), { requirePin: true }), async (req, res) => {
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
router.get("/messages/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params["employeeId"]), 10), { requirePin: true }), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params["employeeId"]), 10);
  if (isNaN(employeeId)) return res.status(400).json({ error: "Invalid employeeId" });
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.employeeId, employeeId))
    .orderBy(asc(messagesTable.createdAt));
  const att = await attachmentsOf(messages.map((m) => m.id));
  return res.json(messages.map((m) => ({ ...m, attachments: att.get(m.id) ?? [] })));
});

// ── 既読処理 ───────────────────────────────────────────
// reader='office' → employeeからのメッセージを既読
// reader='employee' → officeからのメッセージを既読
router.post("/messages/:employeeId/read", requireOwnerOrAdmin(req => parseInt(paramStr(req.params["employeeId"]), 10), { requirePin: true }), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params["employeeId"]), 10);
  if (isNaN(employeeId)) return res.status(400).json({ error: "Invalid employeeId" });
  // 事務所側として既読にできるのは管理者だけ。QR ページ（未ログイン）やドライバーは
  // 本文で reader:"office" と名乗っても、事務所からのメッセージ（自分あて）しか既読にできない。
  const reader: "office" | "employee" = isAdminReq(req)
    ? (req.body as { reader: "office" | "employee" })?.reader
    : "employee";

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
  const { employeeId: bodyEmployeeId, content: rawContent, attachmentIds: rawIds } = req.body as {
    employeeId?: number;
    sender?: "office" | "employee";
    content?: string;
    attachmentIds?: unknown;
  };
  // 添付だけ（本文なし）でも送れる
  const attachmentIds = Array.isArray(rawIds) ? [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (attachmentIds.length > ATTACH_MAX_PER_MESSAGE) return res.status(400).json({ error: `添付は1回に${ATTACH_MAX_PER_MESSAGE}つまでです` });
  const content = typeof rawContent === "string" ? rawContent : "";
  if (!content.trim() && attachmentIds.length === 0) {
    return res.status(400).json({ error: "メッセージ内容が必要です" });
  }
  if (content.length > 2000) {
    return res.status(400).json({ error: "メッセージは2,000文字までです" });
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
    // 社員番号を差し替えるだけで他人の名前で事務所へ送れたため、暗証番号を確かめた端末に限る。
    const access = await driverAccess(req, employeeId);
    if (access === "not-found") return res.status(404).json({ error: "社員が見つかりません。" });
    if (access === "no-pin") return res.status(403).json(PIN_NOT_SET_BODY);
    if (access === "denied") return res.status(401).json(PIN_REQUIRED_BODY);
  } else if (isAdminReq(req)) {
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

  // 端末が送るごとに作る番号。電波が悪くて押し直したとき、同じメッセージが2回届かないようにする
  const rawClientId = (req.body as { clientId?: unknown })?.clientId;
  const clientId = typeof rawClientId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(rawClientId) ? rawClientId : null;
  if (clientId) {
    const [dup] = await db.select().from(messagesTable).where(and(eq(messagesTable.employeeId, employeeId), eq(messagesTable.clientId, clientId)));
    if (dup) return res.status(200).json({ ...dup, attachments: (await attachmentsOf([dup.id])).get(dup.id) ?? [] });
  }
  // 添付は「この会話に・同じ側が上げて・まだどこにもつながっていない」ものだけ
  if (attachmentIds.length) {
    const ok = await db.select({ id: messageAttachmentsTable.id }).from(messageAttachmentsTable).where(and(
      inArray(messageAttachmentsTable.id, attachmentIds), eq(messageAttachmentsTable.employeeId, employeeId),
      eq(messageAttachmentsTable.uploadedBy, sender), isNull(messageAttachmentsTable.messageId)));
    if (ok.length !== attachmentIds.length) return res.status(400).json({ error: "添付が見つかりません。もう一度ファイルを選んでください。" });
  }

  let message: typeof messagesTable.$inferSelect;
  try {
    [message] = await db.insert(messagesTable).values({
      employeeId,
      sender,
      content: content.trim(),
      clientId,
    }).returning() as [typeof messagesTable.$inferSelect];
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505" && clientId) {
      const [dup] = await db.select().from(messagesTable).where(and(eq(messagesTable.employeeId, employeeId), eq(messagesTable.clientId, clientId)));
      if (dup) return res.status(200).json(dup);
    }
    throw err;
  }

  if (attachmentIds.length) {
    await db.update(messageAttachmentsTable).set({ messageId: message.id }).where(inArray(messageAttachmentsTable.id, attachmentIds));
  }
  const full = { ...message, attachments: (await attachmentsOf([message.id])).get(message.id) ?? [] };

  // SSEでリアルタイム配信
  broadcastToEmployee(employeeId, { type: "message", message: full });

  // 先に「送れた」と返し、プッシュ通知はそのあとで送る。
  // 以前は事務所の端末すべてへ送り終わるまで返事をしなかったため、電波の悪い所では
  // 「送れなかった」と思って押し直し、同じメッセージが2回届いていた。
  res.status(201).json(full);
  const pushText = content.trim() || (full.attachments.some((a) => a.mime.startsWith("image/")) ? "📎 写真が届きました" : "📎 ファイルが届きました");
  setImmediate(() => { void sendMessagePush(employeeId, sender, pushText).catch(() => {}); });
  return;
});

async function sendMessagePush(employeeId: number, sender: "office" | "employee", content: string) {
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
          body: content.slice(0, 80),
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
}

// ── 一斉送信 ───────────────────────────────────────────
router.post("/messages/broadcast", requireAdmin, async (req, res) => {
  const { content, employeeIds } = req.body as { content: string; employeeIds?: number[] };
  if (typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "メッセージ内容が必要です" });
  }
  if (content.length > 2000) {
    return res.status(400).json({ error: "メッセージは2,000文字までです" });
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
  if (endpoint.length > 1000 || p256dh.length > 200 || auth.length > 100) {
    return res.status(400).json({ error: "購読情報が正しくありません" });
  }

  let employeeId: number | null;
  let role: "office" | "employee";

  if (!req.session?.userId) {
    // QR の打刻ページ：暗証番号を確かめた端末の本人として登録する（役割は必ず employee）。
    // 以前はログインを求めていたため、ドライバーのスマホにはプッシュ通知が届かなかった。
    const target = Number(bodyEmployeeId);
    if (!Number.isInteger(target) || target <= 0) return res.status(401).json({ error: "ログインが必要です" });
    const access = await driverAccess(req, target);
    if (access === "not-found") return res.status(404).json({ error: "社員が見つかりません。" });
    if (access === "no-pin") return res.status(403).json(PIN_NOT_SET_BODY);
    if (access === "denied") return res.status(401).json(PIN_REQUIRED_BODY);
    role = "employee";
    employeeId = target;
  } else if (isAdminReq(req)) {
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

  // 1つの端末（endpoint）は最後に登録した人だけに届ける。1台を何人かで使うときは、
  // 打刻ページを開いた（＝登録し直した）人に切り替わる。前の人には replacedEmployeeId で知らせる。
  const existing = await db.select({ id: pushSubscriptionsTable.id, employeeId: pushSubscriptionsTable.employeeId, role: pushSubscriptionsTable.role })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .limit(1);

  if (existing.length > 0) {
    const prev = existing[0]!;
    const replacedEmployeeId = prev.role === "employee" && prev.employeeId !== null && prev.employeeId !== employeeId ? prev.employeeId : null;
    await db.update(pushSubscriptionsTable)
      .set({ p256dh, auth, active: true, employeeId, role })
      .where(eq(pushSubscriptionsTable.id, prev.id));
    return res.status(201).json({ ok: true, replacedEmployeeId });
  }
  await db.insert(pushSubscriptionsTable).values({
    employeeId,
    role,
    endpoint,
    p256dh,
    auth,
  });

  return res.status(201).json({ ok: true, replacedEmployeeId: null });
});

export default router;
