import { Router, type Response } from "express";
import { db, attendanceRecordsTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// ── SSEクライアント管理 ────────────────────────────────
const sseClients = new Set<Response>();

function flush(res: Response) {
  if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
    (res as unknown as { flush: () => void }).flush();
  }
}

function broadcast(data: unknown) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
    flush(client);
  }
}

// ── ユーティリティ ────────────────────────────────────
function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

async function buildSnapshot(date?: string) {
  const targetDate = date ?? todayJST();

  const employees = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.isActive, true));

  const allRecords = await db
    .select()
    .from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.workDate, targetDate))
    .orderBy(attendanceRecordsTable.recordedAt);

  return employees.map(emp => {
    const empRecords = allRecords.filter(r => r.employeeId === emp.id);
    const lastEvent = empRecords.length > 0 ? empRecords[empRecords.length - 1] : null;

    let status: string;
    if (!lastEvent) status = "未出勤";
    else if (lastEvent.eventType === "clock_in") status = "出勤中";
    else if (lastEvent.eventType === "break_start") status = "休憩中";
    else if (lastEvent.eventType === "break_end") status = "出勤中";
    else status = "退勤済";

    const clockIn = empRecords.find(r => r.eventType === "clock_in");

    return {
      employee: {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: emp.name,
        department: emp.department,
      },
      status,
      clockInTime: clockIn?.recordedAt ?? null,
      records: empRecords,
    };
  });
}

// ── SSEストリーム ─────────────────────────────────────
router.get("/attendance/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // 接続直後に現在の状態を送信
  try {
    const snapshot = await buildSnapshot();
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    flush(res);
  } catch {
    // 初回送信失敗は無視
  }

  sseClients.add(res);

  // 接続維持用ハートビート（15秒ごと）
  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
    flush(res);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ── 全社員の勤怠状況（日付指定可、デフォルト今日） ──
router.get("/attendance/today", async (req, res) => {
  const date = req.query.date as string | undefined;
  const snapshot = await buildSnapshot(date);
  return res.json(snapshot);
});

// ── 社員の今日の打刻一覧 ─────────────────────────────
router.get("/attendance/employee/:employeeId/today", async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const today = todayJST();

  const records = await db
    .select()
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.employeeId, employeeId),
      eq(attendanceRecordsTable.workDate, today),
    ))
    .orderBy(attendanceRecordsTable.recordedAt);

  return res.json(records);
});

// ── 打刻記録（POST → SSEブロードキャスト） ──────────
router.post("/attendance/record", async (req, res) => {
  const { employeeId, eventType, note } = req.body as {
    employeeId: number;
    eventType: "clock_in" | "clock_out" | "break_start" | "break_end";
    note?: string;
  };

  if (!employeeId || !eventType) {
    return res.status(400).json({ error: "employeeId と eventType は必須です" });
  }

  const today = todayJST();
  const now = new Date();

  const [record] = await db.insert(attendanceRecordsTable).values({
    employeeId,
    eventType,
    workDate: today,
    recordedAt: now,
    note: note ?? null,
  }).returning();

  // 打刻後に全SSEクライアントへ最新スナップショットをブロードキャスト
  buildSnapshot().then(snapshot => broadcast(snapshot)).catch(() => {});

  return res.status(201).json(record);
});

// ── 打刻レコード修正 ─────────────────────────────────
router.patch("/attendance/records/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { eventType, recordedAt } = req.body as {
    eventType?: "clock_in" | "clock_out" | "break_start" | "break_end";
    recordedAt?: string;
  };

  if (!eventType && !recordedAt) {
    return res.status(400).json({ error: "eventType または recordedAt が必要です" });
  }

  const updateValues: Record<string, unknown> = {};
  if (eventType) updateValues.eventType = eventType;
  if (recordedAt) updateValues.recordedAt = new Date(recordedAt);

  const [updated] = await db
    .update(attendanceRecordsTable)
    .set(updateValues)
    .where(eq(attendanceRecordsTable.id, id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "レコードが見つかりません" });
  }

  buildSnapshot().then(snapshot => broadcast(snapshot)).catch(() => {});
  return res.json(updated);
});

// ── 打刻レコード削除 ─────────────────────────────────
router.delete("/attendance/records/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const [deleted] = await db
    .delete(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.id, id))
    .returning();

  if (!deleted) {
    return res.status(404).json({ error: "レコードが見つかりません" });
  }

  buildSnapshot().then(snapshot => broadcast(snapshot)).catch(() => {});
  return res.status(204).send();
});

// ── 社員の打刻履歴（日付指定） ───────────────────────
router.get("/attendance/employee/:employeeId", async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const { date } = req.query;
  const targetDate = (date as string) ?? todayJST();

  const records = await db
    .select()
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.employeeId, employeeId),
      eq(attendanceRecordsTable.workDate, targetDate),
    ))
    .orderBy(attendanceRecordsTable.recordedAt);

  return res.json(records);
});

export default router;
