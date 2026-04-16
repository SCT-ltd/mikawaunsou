import { Router } from "express";
import { db, absenceRecordsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";

const router = Router();

// 欠勤種別の日数換算（0.5=半休、1.0=全休）
export const ABSENCE_DAYS: Record<string, number> = {
  sick:            1.0,
  paid_leave:      1.0,
  bereavement:     1.0,
  morning_half:    0.5,
  afternoon_half:  0.5,
  other:           1.0,
};

export const ABSENCE_LABELS: Record<string, string> = {
  sick:           "病欠",
  paid_leave:     "有給休暇",
  bereavement:    "忌引き",
  morning_half:   "午前休み",
  afternoon_half: "午後休み",
  other:          "その他",
};

// ── 指定日の欠勤一覧 ─────────────────────────────────────
router.get("/absences", async (req, res) => {
  const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
  const records = await db
    .select()
    .from(absenceRecordsTable)
    .where(eq(absenceRecordsTable.workDate, date));
  return res.json(records);
});

// ── 月間欠勤一覧 ─────────────────────────────────────────
router.get("/absences/month", async (req, res) => {
  const year  = parseInt(req.query.year  as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const to   = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
  const records = await db
    .select()
    .from(absenceRecordsTable)
    .where(and(
      gte(absenceRecordsTable.workDate, from),
      lte(absenceRecordsTable.workDate, to),
    ));
  return res.json(records);
});

// ── 欠勤登録 ─────────────────────────────────────────────
router.post("/absences", async (req, res) => {
  const { employeeId, absenceType, workDate, note } = req.body as {
    employeeId: number;
    absenceType: string;
    workDate: string;
    note?: string;
  };

  if (!employeeId || !absenceType || !workDate) {
    return res.status(400).json({ error: "employeeId, absenceType, workDate は必須です" });
  }
  if (!(absenceType in ABSENCE_DAYS)) {
    return res.status(400).json({ error: `absenceType が不正です: ${absenceType}` });
  }

  const [record] = await db.insert(absenceRecordsTable).values({
    employeeId,
    absenceType,
    workDate,
    note: note ?? null,
  }).returning();

  return res.status(201).json(record);
});

// ── 欠勤削除 ─────────────────────────────────────────────
router.delete("/absences/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [deleted] = await db
    .delete(absenceRecordsTable)
    .where(eq(absenceRecordsTable.id, id))
    .returning();

  if (!deleted) {
    return res.status(404).json({ error: "レコードが見つかりません" });
  }
  return res.status(204).send();
});

export default router;
