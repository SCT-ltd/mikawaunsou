import { Router } from "express";
import { db, attendanceRecordsTable, employeesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// 今日の日付文字列 (JST)
function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 社員の今日の打刻一覧
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

// 全社員の今日の状況（ダッシュボード用）
router.get("/attendance/today", async (req, res) => {
  const today = todayJST();

  const employees = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.isActive, true));

  const allRecords = await db
    .select()
    .from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.workDate, today))
    .orderBy(attendanceRecordsTable.recordedAt);

  const result = employees.map(emp => {
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

  return res.json(result);
});

// 打刻記録
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

  return res.status(201).json(record);
});

// 社員の過去の打刻履歴（日付指定）
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
