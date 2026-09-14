import { Router } from "express";
import {
  db,
  employeesTable,
  insuranceRatePeriodsTable,
  standardRemunerationHistoryTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";
import { paramStr } from "../lib/params";
import {
  getEffectiveInsuranceRates,
  listInsuranceRatePeriods,
  resolveStandardRemuneration,
} from "../lib/insurance-settings";

/**
 * 保険料率マスター（年度ごとの料率の履歴）と、社員ごとの標準報酬月額の履歴。
 * 適用開始はどちらも「給与明細の年月」。
 */
const router = Router();

const REASONS = ["teiji", "zuiji", "shikaku", "other"] as const;

function parseYearMonth(year: unknown, month: unknown): { year: number; month: number } | null {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || y < 2000 || y > 2100 || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

const RATE_FIELDS = [
  "healthInsuranceRate",
  "careInsuranceRate",
  "childcareSupportRate",
  "pensionRate",
  "employmentInsuranceRate",
] as const;

/** 料率の入力チェック。0〜0.5（50%）の範囲外は入力ミスとして弾く */
function parseRatePeriodBody(body: Record<string, unknown>) {
  const ymv = parseYearMonth(body.effectiveYear, body.effectiveMonth);
  if (!ymv) return { error: "適用開始の年月が正しくありません。" };
  const rates: Record<string, number> = {};
  for (const key of RATE_FIELDS) {
    const v = Number(body[key]);
    if (!Number.isFinite(v) || v < 0 || v > 0.5) return { error: `料率（${key}）が正しくありません。0〜0.5 の小数で入力してください（例: 9.85% → 0.0985）。` };
    rates[key] = v;
  }
  const cap = body.pensionMaxStandard === undefined ? 650000 : Number(body.pensionMaxStandard);
  if (!Number.isInteger(cap) || cap <= 0) return { error: "厚生年金の上限額が正しくありません。" };
  const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim() : null;
  return {
    value: {
      effectiveYear: ymv.year,
      effectiveMonth: ymv.month,
      healthInsuranceRate: rates.healthInsuranceRate,
      careInsuranceRate: rates.careInsuranceRate,
      childcareSupportRate: rates.childcareSupportRate,
      pensionRate: rates.pensionRate,
      employmentInsuranceRate: rates.employmentInsuranceRate,
      pensionMaxStandard: cap,
      note,
    },
  };
}

const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505");

// ── 保険料率マスター ────────────────────────────────────────────────────────

router.get("/insurance-rate-periods", async (_req, res) => {
  return res.json(await listInsuranceRatePeriods());
});

router.post("/insurance-rate-periods", requireAdmin, async (req, res) => {
  const parsed = parseRatePeriodBody(req.body ?? {});
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  await listInsuranceRatePeriods(); // 初期行が未作成なら先に作る
  try {
    const [row] = await db.insert(insuranceRatePeriodsTable).values(parsed.value!).returning();
    return res.status(201).json(row);
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: "同じ適用開始の年月の行がすでにあります。その行を編集してください。" });
    throw e;
  }
});

router.put("/insurance-rate-periods/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const parsed = parseRatePeriodBody(req.body ?? {});
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  try {
    const [row] = await db.update(insuranceRatePeriodsTable)
      .set({ ...parsed.value!, updatedAt: new Date() })
      .where(eq(insuranceRatePeriodsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "料率の行が見つかりません。" });
    return res.json(row);
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: "同じ適用開始の年月の行がすでにあります。" });
    throw e;
  }
});

router.delete("/insurance-rate-periods/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const rows = await listInsuranceRatePeriods();
  if (!rows.some((r) => r.id === id)) return res.status(404).json({ error: "料率の行が見つかりません。" });
  if (rows.length <= 1) return res.status(400).json({ error: "最後の1行は削除できません（料率が無いと計算できないため）。" });
  await db.delete(insuranceRatePeriodsTable).where(eq(insuranceRatePeriodsTable.id, id));
  return res.status(204).end();
});

router.get("/insurance-rates/effective", async (req, res) => {
  const ymv = parseYearMonth(req.query.year, req.query.month);
  if (!ymv) return res.status(400).json({ error: "year と month のクエリパラメータが必要です（例: ?year=2026&month=9）" });
  return res.json(await getEffectiveInsuranceRates(ymv.year, ymv.month));
});

// ── 標準報酬月額の履歴 ─────────────────────────────────────────────────────
// /employees/:id/... は routes/index.ts の "/employees" プレフィックスで admin 必須。
// /standard-remuneration/... も同ファイルで admin 必須にしている。

router.get("/employees/:id/standard-remuneration-history", async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);
  const rows = await db.select().from(standardRemunerationHistoryTable)
    .where(eq(standardRemunerationHistoryTable.employeeId, employeeId))
    .orderBy(desc(standardRemunerationHistoryTable.effectiveYear), desc(standardRemunerationHistoryTable.effectiveMonth));
  return res.json(rows);
});

interface HistoryEntryInput { employeeId: number; amount: number }

function parseHistoryMeta(body: Record<string, unknown>) {
  const ymv = parseYearMonth(body.effectiveYear, body.effectiveMonth);
  if (!ymv) return { error: "適用開始の年月が正しくありません。" };
  const reason = typeof body.reason === "string" && (REASONS as readonly string[]).includes(body.reason) ? body.reason : "teiji";
  const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim() : null;
  return { value: { effectiveYear: ymv.year, effectiveMonth: ymv.month, reason, note } };
}

const validAmount = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? n : null;
};

/** 同じ社員・同じ適用開始の行があれば上書きする（入力し直しを許す）*/
async function saveHistory(meta: { effectiveYear: number; effectiveMonth: number; reason: string; note: string | null }, entries: HistoryEntryInput[]) {
  if (entries.length === 0) return [];
  return db.insert(standardRemunerationHistoryTable)
    .values(entries.map((e) => ({ ...meta, employeeId: e.employeeId, amount: e.amount })))
    .onConflictDoUpdate({
      target: [
        standardRemunerationHistoryTable.employeeId,
        standardRemunerationHistoryTable.effectiveYear,
        standardRemunerationHistoryTable.effectiveMonth,
      ],
      set: {
        amount: sql`excluded.amount`,
        reason: sql`excluded.reason`,
        note: sql`excluded.note`,
        updatedAt: new Date(),
      },
    })
    .returning();
}

router.post("/employees/:id/standard-remuneration-history", async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  const meta = parseHistoryMeta(req.body ?? {});
  if ("error" in meta) return res.status(400).json({ error: meta.error });
  const amount = validAmount(req.body?.amount);
  if (amount === null) return res.status(400).json({ error: "標準報酬月額が正しくありません。" });
  const [row] = await saveHistory(meta.value!, [{ employeeId, amount }]);
  return res.status(201).json(row);
});

router.delete("/employees/:id/standard-remuneration-history/:historyId", async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);
  const historyId = parseInt(paramStr(req.params.historyId), 10);
  const deleted = await db.delete(standardRemunerationHistoryTable)
    .where(and(eq(standardRemunerationHistoryTable.id, historyId), eq(standardRemunerationHistoryTable.employeeId, employeeId)))
    .returning();
  if (deleted.length === 0) return res.status(404).json({ error: "履歴が見つかりません。" });
  return res.status(204).end();
});

/** 全社員の、その明細の年月に使う標準報酬月額 */
router.get("/standard-remuneration/effective", async (req, res) => {
  const ymv = parseYearMonth(req.query.year, req.query.month);
  if (!ymv) return res.status(400).json({ error: "year と month のクエリパラメータが必要です（例: ?year=2026&month=9）" });
  const employees = await db.select({ id: employeesTable.id, standardRemuneration: employeesTable.standardRemuneration })
    .from(employeesTable).orderBy(asc(employeesTable.employeeCode));
  const history = await db.select().from(standardRemunerationHistoryTable);
  return res.json(employees.map((e) => resolveStandardRemuneration(e, history, ymv.year, ymv.month)));
});

/** 定時決定などの一括登録。entries の社員ぶん、同じ適用開始・理由で履歴を追加（同じ年月は上書き）*/
router.post("/standard-remuneration/bulk", async (req, res) => {
  const meta = parseHistoryMeta(req.body ?? {});
  if ("error" in meta) return res.status(400).json({ error: meta.error });
  const rawEntries: unknown[] = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const entries: HistoryEntryInput[] = [];
  for (const raw of rawEntries) {
    const r = raw as { employeeId?: unknown; amount?: unknown };
    const employeeId = Number(r.employeeId);
    const amount = validAmount(r.amount);
    if (!Number.isInteger(employeeId) || amount === null) {
      return res.status(400).json({ error: "社員または金額が正しくない行があります。" });
    }
    entries.push({ employeeId, amount });
  }
  if (entries.length === 0) return res.status(400).json({ error: "登録する社員がありません。" });
  const ids = [...new Set(entries.map((e) => e.employeeId))];
  if (ids.length !== entries.length) return res.status(400).json({ error: "同じ社員が2回入っています。" });
  const found = await db.select({ id: employeesTable.id }).from(employeesTable).where(inArray(employeesTable.id, ids));
  if (found.length !== ids.length) return res.status(400).json({ error: "存在しない社員が含まれています。" });
  const rows = await saveHistory(meta.value!, entries);
  return res.status(201).json(rows);
});

export default router;
