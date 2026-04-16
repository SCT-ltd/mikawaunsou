import { Router, type Response } from "express";
import { db, attendanceRecordsTable, employeesTable, absenceRecordsTable } from "@workspace/db";
import { asc, eq, and, gte, lte } from "drizzle-orm";
import { ABSENCE_DAYS } from "./absences";

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
    .where(eq(employeesTable.isActive, true))
    .orderBy(asc(employeesTable.employeeCode));

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
  const { employeeId, eventType, note, startOdometer, endOdometer, recordedAt: recordedAtStr, latitude, longitude } = req.body as {
    employeeId: number;
    eventType: "clock_in" | "clock_out" | "break_start" | "break_end";
    note?: string;
    startOdometer?: number | null;
    endOdometer?: number | null;
    recordedAt?: string;
    latitude?: number | null;
    longitude?: number | null;
  };

  if (!employeeId || !eventType) {
    return res.status(400).json({ error: "employeeId と eventType は必須です" });
  }

  // クライアントからrecordedAtが送られた場合はそのタイムスタンプを使用し、
  // workDateはそのJST日付から算出する。送られない場合は現在時刻を使用。
  const now = recordedAtStr ? new Date(recordedAtStr) : new Date();

  // 未来の打刻を拒否（1分の余裕を持たせる）
  if (now.getTime() > Date.now() + 60 * 1000) {
    return res.status(400).json({ error: "未来の時刻で打刻することはできません" });
  }
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstDateStr = jst.toISOString().slice(0, 10);
  const jstHour    = jst.getUTCHours(); // JST時間（0〜23）

  // ── 深夜クロスオーバー判定 ─────────────────────────────
  // 出勤以外の打刻で JST 0〜4時台の場合、前日にオープンシフト（出勤のみ・退勤なし）
  // があれば、その前日を workDate として割り当てる（25時制対応）
  let workDate = jstDateStr;
  if (eventType !== "clock_in" && jstHour < 5) {
    const prevDate = new Date(jst.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const prevDayRecords = await db
      .select({ eventType: attendanceRecordsTable.eventType })
      .from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.employeeId, employeeId),
        eq(attendanceRecordsTable.workDate, prevDate),
      ));
    const hasClockIn  = prevDayRecords.some(r => r.eventType === "clock_in");
    const hasClockOut = prevDayRecords.some(r => r.eventType === "clock_out");
    if (hasClockIn && !hasClockOut) {
      // 前日にオープンシフトがある → 前日の打刻として記録
      workDate = prevDate;
    }
  }

  // 同日・同種別の重複チェック
  const existing = await db
    .select({ id: attendanceRecordsTable.id })
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.employeeId, employeeId),
      eq(attendanceRecordsTable.workDate, workDate),
      eq(attendanceRecordsTable.eventType, eventType),
    ))
    .limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: `この日にすでに「${eventType}」の打刻が登録されています` });
  }

  const [record] = await db.insert(attendanceRecordsTable).values({
    employeeId,
    eventType,
    workDate,
    recordedAt: now,
    note: note ?? null,
    startOdometer: startOdometer ?? null,
    endOdometer: endOdometer ?? null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
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

// ── 社員の月間打刻履歴 ───────────────────────────────
router.get("/attendance/employee/:employeeId/month", async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const records = await db
    .select()
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.employeeId, employeeId),
      gte(attendanceRecordsTable.workDate, from),
      lte(attendanceRecordsTable.workDate, to),
    ))
    .orderBy(attendanceRecordsTable.workDate, attendanceRecordsTable.recordedAt);

  return res.json(records);
});

// ── 全社員の月間勤怠集計（月次実績入力への取り込み用） ──
router.get("/attendance/monthly-summary", async (req, res) => {
  const year  = parseInt(req.query.year  as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to   = `${year}-${pad(month)}-${pad(lastDay)}`;

  // 対象月の全打刻を取得
  const allRecords = await db
    .select()
    .from(attendanceRecordsTable)
    .where(and(
      gte(attendanceRecordsTable.workDate, from),
      lte(attendanceRecordsTable.workDate, to),
    ))
    .orderBy(attendanceRecordsTable.employeeId, attendanceRecordsTable.workDate, attendanceRecordsTable.recordedAt);

  // 社員×日付でグループ化
  const byEmpDate = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    const key = `${r.employeeId}:${r.workDate}`;
    if (!byEmpDate.has(key)) byEmpDate.set(key, []);
    byEmpDate.get(key)!.push(r);
  }

  // 日ごとの実働分数を計算（break時間を差し引く）
  function calcWorkMinutes(recs: typeof allRecords): number {
    let clockInTime: Date | null = null;
    let breakStart: Date | null = null;
    let breakTotal = 0;
    let totalMs = 0;
    for (const r of recs) {
      const t = new Date(r.recordedAt);
      if (r.eventType === "clock_in")    clockInTime = t;
      else if (r.eventType === "break_start") breakStart = t;
      else if (r.eventType === "break_end" && breakStart) {
        breakTotal += t.getTime() - breakStart.getTime();
        breakStart = null;
      } else if (r.eventType === "clock_out" && clockInTime) {
        totalMs = t.getTime() - clockInTime.getTime() - breakTotal;
      }
    }
    return Math.round(Math.max(0, totalMs) / 60000);
  }

  // 社員ごとに集計
  const summaryMap = new Map<number, {
    workDays: number;
    saturdayWorkDays: number;
    sundayWorkHours: number;
    overtimeHours: number;
  }>();

  for (const [key, recs] of byEmpDate.entries()) {
    const [empIdStr, dateStr] = key.split(":");
    const empId = parseInt(empIdStr, 10);
    // clock_in がなければカウントしない
    if (!recs.some(r => r.eventType === "clock_in")) continue;

    if (!summaryMap.has(empId)) {
      summaryMap.set(empId, { workDays: 0, saturdayWorkDays: 0, sundayWorkHours: 0, overtimeHours: 0 });
    }
    const s = summaryMap.get(empId)!;
    const dow = new Date(dateStr).getDay(); // 0=日, 6=土
    const workMins = calcWorkMinutes(recs);

    if (dow === 0) {
      // 日曜：時間単位で加算（小数1位）
      s.sundayWorkHours = Math.round((s.sundayWorkHours + workMins / 60) * 10) / 10;
    } else if (dow === 6) {
      s.saturdayWorkDays += 1;
    } else {
      // 平日：出勤日カウント + 8h超過分を残業
      s.workDays += 1;
      const overtimeMins = Math.max(0, workMins - 480);
      s.overtimeHours = Math.round((s.overtimeHours + overtimeMins / 60) * 10) / 10;
    }
  }

  // 欠勤データを取得して集計に加算
  const absenceRecs = await db
    .select()
    .from(absenceRecordsTable)
    .where(and(
      gte(absenceRecordsTable.workDate, from),
      lte(absenceRecordsTable.workDate, to),
    ));

  // 欠勤ごとに absenceDays を加算
  const absenceSummary = new Map<number, number>();
  for (const a of absenceRecs) {
    const days = ABSENCE_DAYS[a.absenceType] ?? 1.0;
    absenceSummary.set(a.employeeId, (absenceSummary.get(a.employeeId) ?? 0) + days);
  }

  // 欠勤のみの社員も結果に含める
  for (const [empId, days] of absenceSummary.entries()) {
    if (!summaryMap.has(empId)) {
      summaryMap.set(empId, { workDays: 0, saturdayWorkDays: 0, sundayWorkHours: 0, overtimeHours: 0 });
    }
  }

  const result = Array.from(summaryMap.entries()).map(([employeeId, s]) => ({
    employeeId,
    ...s,
    absenceDays: Math.round((absenceSummary.get(employeeId) ?? 0) * 10) / 10,
  }));

  return res.json(result);
});

// ── 全社員の最新GPS位置情報（リアルタイムマップ用） ────────
router.get("/attendance/gps-locations", async (req, res) => {
  const today = todayJST();

  const employees = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.isActive, true))
    .orderBy(asc(employeesTable.employeeCode));

  const todayRecords = await db
    .select()
    .from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.workDate, today))
    .orderBy(attendanceRecordsTable.recordedAt);

  const result = employees.map(emp => {
    const empRecords = todayRecords.filter(r => r.employeeId === emp.id);
    const lastEvent = empRecords.length > 0 ? empRecords[empRecords.length - 1] : null;

    let status: string;
    if (!lastEvent) status = "未出勤";
    else if (lastEvent.eventType === "clock_in") status = "出勤中";
    else if (lastEvent.eventType === "break_start") status = "休憩中";
    else if (lastEvent.eventType === "break_end") status = "出勤中";
    else status = "退勤済";

    // GPS付きの最新レコードを検索（最新順）
    const latestGps = [...empRecords].reverse().find(r => r.latitude != null && r.longitude != null);

    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: emp.department,
      status,
      latitude: latestGps?.latitude ?? null,
      longitude: latestGps?.longitude ?? null,
      lastEventType: latestGps?.eventType ?? null,
      lastGpsTime: latestGps?.recordedAt ?? null,
    };
  });

  return res.json(result);
});

export default router;
