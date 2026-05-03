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
// admin: 全員分
// driver: 自分の分のみ
router.get("/absences", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "ログインが必要です" });

  const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);

  const conditions = [eq(absenceRecordsTable.workDate, date)];
  if (req.session.role !== "admin") {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    conditions.push(eq(absenceRecordsTable.employeeId, Number(sessionEmployeeId)));
  }

  const records = await db
    .select()
    .from(absenceRecordsTable)
    .where(and(...conditions));
  return res.json(records);
});

// ── 月間欠勤一覧 ─────────────────────────────────────────
// admin: 全員分
// driver: 自分の分のみ
router.get("/absences/month", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "ログインが必要です" });

  const year  = parseInt(req.query.year  as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const to   = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;

  const conditions = [
    gte(absenceRecordsTable.workDate, from),
    lte(absenceRecordsTable.workDate, to),
  ];
  if (req.session.role !== "admin") {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    conditions.push(eq(absenceRecordsTable.employeeId, Number(sessionEmployeeId)));
  }

  const records = await db
    .select()
    .from(absenceRecordsTable)
    .where(and(...conditions));
  return res.json(records);
});

// ── 欠勤登録 ─────────────────────────────────────────────
// admin: body の employeeId で誰の欠勤でも作れる
// driver: 自分の分のみ作成可（body の employeeId が他人なら 403）
router.post("/absences", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "ログインが必要です" });

  const { employeeId: bodyEmployeeId, absenceType, workDate, note } = req.body as {
    employeeId: number;
    absenceType: string;
    workDate: string;
    note?: string;
  };

  if (!absenceType || !workDate) {
    return res.status(400).json({ error: "absenceType, workDate は必須です" });
  }
  if (!(absenceType in ABSENCE_DAYS)) {
    return res.status(400).json({ error: `absenceType が不正です: ${absenceType}` });
  }

  let employeeId: number;
  if (req.session.role === "admin") {
    if (!bodyEmployeeId) {
      return res.status(400).json({ error: "employeeId は必須です" });
    }
    employeeId = Number(bodyEmployeeId);
  } else {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    if (bodyEmployeeId !== undefined && bodyEmployeeId !== null && Number(bodyEmployeeId) !== Number(sessionEmployeeId)) {
      return res.status(403).json({ error: "他の従業員の欠勤を登録することはできません" });
    }
    employeeId = Number(sessionEmployeeId);
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
// admin: 任意のレコードを削除可
// driver: 自分のレコードのみ削除可
router.delete("/absences/:id", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "ログインが必要です" });

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "id が不正です" });

  if (req.session.role !== "admin") {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    const [target] = await db
      .select()
      .from(absenceRecordsTable)
      .where(eq(absenceRecordsTable.id, id));
    if (!target) return res.status(404).json({ error: "レコードが見つかりません" });
    if (Number(target.employeeId) !== Number(sessionEmployeeId)) {
      return res.status(403).json({ error: "他の従業員の欠勤を削除することはできません" });
    }
  }

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
