/**
 * 給与計算と法令まわりの画面のための API（2026-10-24 追加・すべて管理者だけ。routes/index.ts で requireAdmin）。
 *
 *   /payroll-law/employees            社員の法令まわりの情報（健康保険の適用・止める印・源泉税の区分・通勤・名簿・退職）
 *   /payroll-law/resident-tax         住民税の12か月分
 *   /payroll-law/paid-leave           有給の管理簿
 *   /payroll-law/remuneration-review  算定基礎・月額変更の候補
 *   /payroll-law/yearend              年末調整の準備（年間の集計・申告書の中身）
 *   /payroll-law/bonuses              賞与の明細
 *   /payroll-law/wage-ledger          賃金台帳（労基法108条）
 *   /payroll-law/worker-roster        労働者名簿（労基法107条）
 *   /payroll-law/ei-shortfall         雇用保険料の不足（4〜8月を 0.0005 で計算していた分）
 *   /payroll-law/minimum-wage         最低賃金との比較
 *   /payroll-law/overtime             残業の月ごと・年の累計
 *   /payroll-law/retirement/:id       退職の判断材料
 *
 * ここで作る CSV は個人情報を含む。ログに中身を書かない。
 */
import { Router, type Response } from "express";
import {
  db,
  employeesTable,
  companyTable,
  payrollsTable,
  monthlyRecordsTable,
  allowanceDefinitionsTable,
  deductionDefinitionsTable,
  employeeMonthAllowancesTable,
  employeeMonthDeductionsTable,
  employeeAllowancesTable,
  employeeDeductionsTable,
  residentTaxSchedulesTable,
  paidLeaveAdjustmentsTable,
  bonusPaymentsTable,
  yearendDeclarationsTable,
  employmentInsuranceSettlementsTable,
  standardRemunerationHistoryTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  calcBonus,
  commuteNonTaxableLimit,
  hourlyForMinimumWage,
  payRulesFromCompany,
  pensionAppliedFor,
  healthAppliedFor,
  exemptFlagsOf,
  residentTaxFiscalYear,
  payrollDates,
  type BonusRateRow,
} from "@workspace/tax-tables-reiwa8/core";
import { round50sen } from "@workspace/tax-tables-reiwa8";
import { audit, diffOf } from "../lib/audit";
import { getEffectiveInsuranceRates, getEffectiveStandardRemuneration } from "../lib/insurance-settings";
import { paidLeaveFor, activeEmployees, jstTodayIso } from "../lib/paid-leave";
import { reviewCandidates } from "../lib/remuneration-review";
import { withholdingOf, commuteExcessOf, scheduledWeekdays } from "../lib/payroll-context";
import { getMonthItems, saveMonthItems, MonthLockedError } from "../lib/month-items";

const router = Router();

// ── 共通 ───────────────────────────────────────────────────────────

const intQ = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
function sendCsv(res: Response, asciiName: string, jaName: string, table: unknown[][]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(jaName)}`);
  res.setHeader("Cache-Control", "no-store");
  return res.send("﻿" + table.map((r) => r.map(csvCell).join(",")).join("\r\n"));
}
const ymKey = (y: number, m: number) => y * 12 + (m - 1);
const nameOf = (n: string) => n.replace(/[\s　]+/g, " ").trim();

/** 最低賃金をもとにした単価の1円未満：50銭未満切り捨て・50銭以上切り上げ（昭和63年3月14日 基発150号） */
const roundRate = (x: number) => Math.round(x);

async function companyRow() {
  const [c] = await db.select().from(companyTable).limit(1);
  return c ?? null;
}

// ── 社員の法令まわりの情報 ───────────────────────────────────────────

const PROFILE_FIELDS = [
  "healthInsuranceMode", "socialInsuranceExempt", "employmentInsuranceExempt", "incomeTaxExempt",
  "taxColumn", "disability", "widow", "singleParent", "workingStudent", "dependentDisabilityCount",
  "commuteMethod", "commuteDistanceKm", "weeklyScheduledDays", "weeklyScheduledHours",
  "gender", "address", "jobType", "retirementDate", "retirementReason",
] as const;

router.get("/payroll-law/employees", async (_req, res) => {
  const rows = await db.select().from(employeesTable).orderBy(asc(employeesTable.employeeCode));
  return res.json(rows.map((e) => ({
    id: e.id, employeeCode: e.employeeCode, name: e.name, nameKana: e.nameKana, isActive: e.isActive,
    salaryType: e.salaryType, isOfficeStaff: e.isOfficeStaff, dateOfBirth: e.dateOfBirth, hireDate: e.hireDate,
    taxExempt: e.taxExempt, dependentCount: e.dependentCount, hasSpouse: e.hasSpouse, residentTax: e.residentTax,
    ...Object.fromEntries(PROFILE_FIELDS.map((k) => [k, e[k]])),
  })));
});

router.put("/payroll-law/employees/:id", async (req, res) => {
  const id = intQ(req.params.id, 1, 1e9);
  if (!id) return res.status(400).json({ error: "社員の指定が正しくありません。" });
  const [before] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!before) return res.status(404).json({ error: "社員が見つかりません。" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  const oneOf = (k: string, list: string[]) => { if (b[k] !== undefined) { if (!list.includes(String(b[k]))) throw new Error(k); set[k] = b[k]; } };
  const bool = (k: string) => { if (b[k] !== undefined) { if (typeof b[k] !== "boolean") throw new Error(k); set[k] = b[k]; } };
  const num = (k: string, lo: number, hi: number, nullable = true) => {
    if (b[k] === undefined) return;
    if ((b[k] === null || b[k] === "") && nullable) { set[k] = null; return; }
    const n = Number(b[k]); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(k); set[k] = n;
  };
  const str = (k: string, max: number) => { if (b[k] !== undefined) { const s = b[k] === null ? "" : String(b[k]).trim().slice(0, max); set[k] = s === "" ? null : s; } };
  try {
    oneOf("healthInsuranceMode", ["auto", "applied", "not_applied"]);
    oneOf("taxColumn", ["kou", "otsu"]);
    oneOf("disability", ["none", "general", "special"]);
    if (b.commuteMethod !== undefined) { if (b.commuteMethod === null || b.commuteMethod === "" || b.commuteMethod === "none") set.commuteMethod = null; else oneOf("commuteMethod", ["public", "car"]); }
    for (const k of ["socialInsuranceExempt", "employmentInsuranceExempt", "incomeTaxExempt", "widow", "singleParent", "workingStudent"]) bool(k);
    num("dependentDisabilityCount", 0, 20, false);
    num("commuteDistanceKm", 0, 500);
    num("weeklyScheduledDays", 0, 7);
    num("weeklyScheduledHours", 0, 80);
    oneOf("gender", ["male", "female", "other", ""]);
    if (set.gender === "") set.gender = null;
    str("address", 300); str("jobType", 100); str("retirementReason", 200);
    if (b.retirementDate !== undefined) {
      const d = String(b.retirementDate ?? "");
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("retirementDate");
      set.retirementDate = d || null;
    }
  } catch (e) {
    return res.status(400).json({ error: `入力が正しくありません（${(e as Error).message}）。` });
  }
  if (set.widow === true && (set.singleParent ?? before.singleParent) === true) return res.status(400).json({ error: "寡婦とひとり親は同時に選べません。" });
  // 止める印を3つとも入れた／外したら、旧い「全額非課税」の印もそろえる（旧い画面の表示のため）
  const flags = exemptFlagsOf({ ...before, ...set } as never);
  set.taxExempt = flags.socialInsuranceExempt && flags.employmentInsuranceExempt && flags.incomeTaxExempt;
  const [after] = await db.update(employeesTable).set({ ...set, updatedAt: new Date() }).where(eq(employeesTable.id, id)).returning();
  await audit(req, "employee.legal", `employee:${id}`, diffOf(before as never, after as never, ["pin", "qrKey", "address"]));
  return res.json({ ok: true });
});

// ── 住民税の12か月分 ─────────────────────────────────────────────────

const FY_MONTHS = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5];
const fyMonth = (fy: number, i: number) => ({ year: i < 7 ? fy : fy + 1, month: FY_MONTHS[i]! });

router.get("/payroll-law/resident-tax", async (req, res) => {
  const fy = intQ(req.query.fiscalYear, 2000, 2100) ?? residentTaxFiscalYear(new Date().getFullYear(), new Date().getMonth() + 1);
  const emps = await activeEmployees();
  const rows = await db.select().from(residentTaxSchedulesTable).where(inArray(residentTaxSchedulesTable.employeeId, emps.map((e) => e.id).concat([0])));
  return res.json({
    fiscalYear: fy,
    months: FY_MONTHS.map((_, i) => fyMonth(fy, i)),
    employees: emps.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)).map((e) => ({
      employeeId: e.id, name: e.name, masterMonthly: e.residentTax ?? 0,
      amounts: FY_MONTHS.map((_, i) => {
        const m = fyMonth(fy, i);
        const r = rows.find((x) => x.employeeId === e.id && x.collectYear === m.year && x.collectMonth === m.month);
        return r ? r.amount : null;
      }),
    })),
  });
});

/** 12か月分をまとめて保存。null の月は行を消す（社員マスターの月額に戻る）。確定済みの明細の月は変えない。 */
router.put("/payroll-law/resident-tax/:employeeId", async (req, res) => {
  const employeeId = intQ(req.params.employeeId, 1, 1e9);
  const fy = intQ(req.body?.fiscalYear, 2000, 2100);
  const amounts = req.body?.amounts as unknown[];
  if (!employeeId || !fy || !Array.isArray(amounts) || amounts.length !== 12) return res.status(400).json({ error: "年度と12か月分の金額を送ってください。" });
  const vals = amounts.map((v) => (v === null || v === "" ? null : Number(v)));
  if (vals.some((v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 10_000_000))) return res.status(400).json({ error: "金額は0以上の整数（円）で入れてください。" });
  const locked = await db.select({ year: payrollsTable.year, month: payrollsTable.month }).from(payrollsTable)
    .where(and(eq(payrollsTable.employeeId, employeeId), eq(payrollsTable.status, "confirmed")));
  const existing = await db.select().from(residentTaxSchedulesTable).where(eq(residentTaxSchedulesTable.employeeId, employeeId));
  const skipped: string[] = [];
  await db.transaction(async (tx) => {
    for (let i = 0; i < 12; i++) {
      const m = fyMonth(fy, i);
      // 徴収月 m は 前の月の明細から引く。その明細が確定済みなら変えない
      const ps = m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 };
      const cur = existing.find((x) => x.collectYear === m.year && x.collectMonth === m.month);
      const v = vals[i];
      if ((cur?.amount ?? null) === v) continue;
      if (locked.some((l) => l.year === ps.year && l.month === ps.month)) { skipped.push(`${m.month}月分`); continue; }
      if (v === null) {
        if (cur) await tx.delete(residentTaxSchedulesTable).where(eq(residentTaxSchedulesTable.id, cur.id));
      } else if (cur) {
        await tx.update(residentTaxSchedulesTable).set({ amount: v, updatedAt: new Date() }).where(eq(residentTaxSchedulesTable.id, cur.id));
      } else {
        await tx.insert(residentTaxSchedulesTable).values({ employeeId, collectYear: m.year, collectMonth: m.month, amount: v });
      }
    }
  });
  await audit(req, "resident_tax.save", `employee:${employeeId}`, { fiscalYear: fy, skipped });
  return res.json({ ok: true, skipped });
});

// ── 有給の管理簿 ─────────────────────────────────────────────────────

router.get("/payroll-law/paid-leave", async (_req, res) => {
  const emps = await activeEmployees();
  const list = await paidLeaveFor(emps);
  const adj = await db.select().from(paidLeaveAdjustmentsTable).orderBy(asc(paidLeaveAdjustmentsTable.date));
  return res.json({ today: jstTodayIso(), employees: list.map((x) => ({ ...x, adjustments: adj.filter((a) => a.employeeId === x.employeeId) })) });
});

router.post("/payroll-law/paid-leave/adjustments", async (req, res) => {
  const employeeId = intQ(req.body?.employeeId, 1, 1e9);
  const date = String(req.body?.date ?? "");
  const days = Number(req.body?.days);
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(days) || days === 0 || Math.abs(days) > 60 || Math.round(days * 2) !== days * 2) {
    return res.status(400).json({ error: "社員・日付・日数（0.5日単位、＋は付与・−は取得）を入れてください。" });
  }
  const [row] = await db.insert(paidLeaveAdjustmentsTable).values({ employeeId, date, days, note: String(req.body?.note ?? "").slice(0, 200) || null }).returning();
  await audit(req, "paid_leave.adjust", `employee:${employeeId}`, { date, days });
  return res.json(row);
});

router.delete("/payroll-law/paid-leave/adjustments/:id", async (req, res) => {
  const id = intQ(req.params.id, 1, 1e9);
  if (!id) return res.status(400).json({ error: "指定が正しくありません。" });
  const [row] = await db.delete(paidLeaveAdjustmentsTable).where(eq(paidLeaveAdjustmentsTable.id, id)).returning();
  if (row) await audit(req, "paid_leave.adjust.delete", `employee:${row.employeeId}`, { date: row.date, days: row.days });
  return res.json({ ok: true });
});

/** 有給休暇管理簿（労基則24条の7：基準日・日数・取得した日付） */
router.get("/payroll-law/paid-leave.csv", async (_req, res) => {
  const list = await paidLeaveFor(await activeEmployees());
  const table: unknown[][] = [["氏名", "入社日", "基準日（付与日）", "付与日数", "時効の日", "使った日数", "残日数", "取得日と日数（この付与の期間）", "年5日の期限", "期限までの取得", "不足"]];
  for (const x of list) {
    for (const g of x.ledger.grants) {
      const ob = x.ledger.obligations.find((o) => o.grantDate === g.date);
      const t = x.taken.filter((e) => e.date >= g.date && e.date < g.expires).map((e) => `${e.date}(${e.days})`).join(" ");
      table.push([nameOf(x.employeeName), x.hireDate, g.date, g.days, g.expires, g.used, g.remaining, t, ob?.deadline ?? "", ob?.taken ?? "", ob?.shortage ?? ""]);
    }
  }
  return sendCsv(res, "paid_leave_ledger.csv", `有給休暇管理簿_${jstTodayIso()}.csv`, table);
});

// ── 算定基礎・月額変更 ───────────────────────────────────────────────

router.get("/payroll-law/remuneration-review", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100) ?? new Date().getFullYear();
  return res.json(await reviewCandidates(await activeEmployees(), year));
});

/** 候補を標準報酬月額の履歴に入れる（同じ年月の行があれば 409。金額は人が確かめて送る） */
router.post("/payroll-law/remuneration-review/apply", async (req, res) => {
  const employeeId = intQ(req.body?.employeeId, 1, 1e9);
  const y = intQ(req.body?.effectiveYear, 2000, 2100);
  const m = intQ(req.body?.effectiveMonth, 1, 12);
  const amount = Number(req.body?.amount);
  const reason = ["teiji", "zuiji"].includes(String(req.body?.reason)) ? String(req.body.reason) : "other";
  if (!employeeId || !y || !m || !Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "社員・適用の年月・標準報酬月額を入れてください。" });
  try {
    const [row] = await db.insert(standardRemunerationHistoryTable).values({ employeeId, effectiveYear: y, effectiveMonth: m, amount, reason, note: "見直しの候補から登録" }).returning();
    await audit(req, "standard_remuneration.add", `employee:${employeeId}`, { y, m, amount, reason });
    return res.json(row);
  } catch {
    return res.status(409).json({ error: "同じ年月の標準報酬月額がもう入っています。標準報酬の画面で直してください。" });
  }
});

// ── 年末調整の準備（年間の集計）・退職者の源泉徴収票の数字 ───────────────

interface YearTotals {
  employeeId: number; name: string; retirementDate: string | null;
  months: Array<{ year: number; month: number; paymentDate: string; gross: number; nonTaxable: number; social: number; incomeTax: number; status: string }>;
  bonuses: Array<{ payDate: string; amount: number; social: number; incomeTax: number | null }>;
  paidAmount: number; socialInsurance: number; incomeTax: number; draftMonths: number;
}

/**
 * その年に「支払った」給与・賞与の集計（源泉徴収票・給与支払報告書の元の数字）。
 *   支払金額＝総支給額 − 非課税の通勤手当など（賞与を含む）
 *   社会保険料等の金額＝健保・介護・子育て支援金・厚年・雇用保険（＋雇用保険料の不足分を精算した控除）
 *   源泉徴収税額＝毎月の源泉税の合計（年末調整の前）
 */
async function yearTotals(year: number, onlyEmployee?: number): Promise<YearTotals[]> {
  const company = await companyRow();
  const emps = onlyEmployee
    ? await db.select().from(employeesTable).where(eq(employeesTable.id, onlyEmployee))
    : await db.select().from(employeesTable);
  const ids = emps.map((e) => e.id).concat([0]);
  const [pays, allows, deds, bonuses] = await Promise.all([
    db.select().from(payrollsTable).where(inArray(payrollsTable.employeeId, ids)),
    db.select().from(employeeMonthAllowancesTable).where(inArray(employeeMonthAllowancesTable.employeeId, ids)),
    db.select().from(employeeMonthDeductionsTable).where(inArray(employeeMonthDeductionsTable.employeeId, ids)),
    db.select().from(bonusPaymentsTable).where(inArray(bonusPaymentsTable.employeeId, ids)),
  ]);
  const out: YearTotals[] = [];
  for (const e of emps) {
    const months: YearTotals["months"] = [];
    for (const p of pays.filter((x) => x.employeeId === e.id)) {
      const dates = payrollDates(p.year, p.month, company?.closingDay ?? 31, company?.paymentDay ?? 25);
      if (Number(dates.payment.slice(0, 4)) !== year) continue;
      const a = allows.filter((x) => x.employeeId === e.id && x.year === p.year && x.month === p.month && x.amount > 0);
      const nonTax = (p.transportationAllowance ?? 0) + a.filter((x) => !x.isTaxable).reduce((s, x) => s + x.amount, 0)
        - commuteExcessOf(e, a.map((x) => ({ allowanceName: x.allowanceName, isTaxable: x.isTaxable, amount: x.amount })));
      const eiSettle = deds.filter((d) => d.employeeId === e.id && d.year === p.year && d.month === p.month && d.deductionName === EI_SETTLE_NAME).reduce((s, d) => s + d.amount, 0);
      months.push({ year: p.year, month: p.month, paymentDate: dates.payment, gross: p.grossSalary, nonTaxable: nonTax,
        social: (p.socialInsurance ?? 0) + (p.employmentInsurance ?? 0) + eiSettle, incomeTax: p.incomeTax ?? 0, status: p.status });
    }
    months.sort((x, y) => ymKey(x.year, x.month) - ymKey(y.year, y.month));
    const bs = bonuses.filter((b) => b.employeeId === e.id && String(b.payDate).startsWith(`${year}-`)).map((b) => ({
      payDate: String(b.payDate), amount: b.amount, social: b.healthInsurance + b.childcareSupportContribution + b.pension + b.employmentInsurance, incomeTax: b.incomeTax,
    }));
    if (months.length === 0 && bs.length === 0) continue;
    out.push({
      employeeId: e.id, name: e.name, retirementDate: e.retirementDate ? String(e.retirementDate) : null, months, bonuses: bs,
      paidAmount: months.reduce((s, m) => s + m.gross - m.nonTaxable, 0) + bs.reduce((s, b) => s + b.amount, 0),
      socialInsurance: months.reduce((s, m) => s + m.social, 0) + bs.reduce((s, b) => s + b.social, 0),
      incomeTax: months.reduce((s, m) => s + m.incomeTax, 0) + bs.reduce((s, b) => s + (b.incomeTax ?? 0), 0),
      draftMonths: months.filter((m) => m.status !== "confirmed").length,
    });
  }
  return out;
}

router.get("/payroll-law/yearend", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100) ?? new Date().getFullYear();
  const decl = await db.select().from(yearendDeclarationsTable).where(eq(yearendDeclarationsTable.year, year));
  const totals = await yearTotals(year);
  return res.json({ year, employees: totals.map((t) => ({ ...t, declaration: JSON.parse(decl.find((d) => d.employeeId === t.employeeId)?.data ?? "{}") })) });
});

router.get("/payroll-law/yearend.csv", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100) ?? new Date().getFullYear();
  const totals = await yearTotals(year);
  const table: unknown[][] = [["氏名", "退職日", "支払金額（給与＋賞与・非課税分を除く）", "社会保険料等の金額", "源泉徴収税額（年末調整前）", "未確定の月", "給与の月数", "賞与の回数"]];
  for (const t of totals) table.push([nameOf(t.name), t.retirementDate ?? "", t.paidAmount, t.socialInsurance, t.incomeTax, t.draftMonths, t.months.length, t.bonuses.length]);
  return sendCsv(res, `yearend_${year}.csv`, `年末調整の準備_${year}年.csv`, table);
});

/** 申告書の中身（扶養控除等・保険料控除・基礎控除・配偶者控除など）を年ごとに保存する。中身の形は画面が決める。 */
router.put("/payroll-law/yearend/declarations/:employeeId", async (req, res) => {
  const employeeId = intQ(req.params.employeeId, 1, 1e9);
  const year = intQ(req.body?.year, 2000, 2100);
  const data = req.body?.data;
  if (!employeeId || !year || typeof data !== "object" || data === null) return res.status(400).json({ error: "社員・年・中身を送ってください。" });
  const json = JSON.stringify(data);
  if (json.length > 20_000) return res.status(400).json({ error: "中身が大きすぎます。" });
  await db.insert(yearendDeclarationsTable).values({ employeeId, year, data: json })
    .onConflictDoUpdate({ target: [yearendDeclarationsTable.employeeId, yearendDeclarationsTable.year], set: { data: json, updatedAt: new Date() } });
  await audit(req, "yearend.declaration", `employee:${employeeId}`, { year });
  return res.json({ ok: true });
});

// ── 賞与 ─────────────────────────────────────────────────────────────

function rateTableOf(c: { bonusTaxRateTable?: string | null } | null): BonusRateRow[] | null {
  if (!c?.bonusTaxRateTable) return null;
  try { const t = JSON.parse(c.bonusTaxRateTable); return Array.isArray(t) ? t : null; } catch { return null; }
}

/** 賞与の計算（保存はしない）。保存・再計算の両方で使う。 */
async function computeBonus(employeeId: number, payDate: string, amount: number, periodMonths: number, excludeBonusId?: number) {
  const [e] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!e) throw Object.assign(new Error("社員が見つかりません。"), { status: 404 });
  const company = await companyRow();
  const py = Number(payDate.slice(0, 4)), pm = Number(payDate.slice(5, 7));
  // 保険料は「支払った月」の料率。明細の年月に直すと支払月の前の月（翌月払いのため）。料率表は明細の年月で引く
  const slip = pm === 1 ? { y: py - 1, m: 12 } : { y: py, m: pm - 1 };
  const rates = await getEffectiveInsuranceRates(py, pm);
  // 年度（4月〜翌3月）の標準賞与額の累計（健康保険の上限 573万円）
  const fyStart = pm >= 4 ? py : py - 1;
  const others = await db.select().from(bonusPaymentsTable).where(eq(bonusPaymentsTable.employeeId, employeeId));
  const before = others.filter((b) => b.id !== excludeBonusId && String(b.payDate) >= `${fyStart}-04-01` && String(b.payDate) < payDate)
    .reduce((s, b) => s + (b.standardBonus ?? 0), 0);
  // 前月の給与（＝賞与を払う月の前の月に払った給与＝その前の月の明細）の社会保険料等控除後の額
  const prevSlip = slip.m === 1 ? { y: slip.y - 1, m: 12 } : { y: slip.y, m: slip.m - 1 };
  const [prev] = await db.select().from(payrollsTable).where(and(eq(payrollsTable.employeeId, employeeId), eq(payrollsTable.year, prevSlip.y), eq(payrollsTable.month, prevSlip.m)));
  let prevAfter = 0;
  if (prev) {
    const items = await getMonthItems(employeeId, prevSlip.y, prevSlip.m);
    const nonTax = (prev.transportationAllowance ?? 0) + items.allowances.filter((a) => !a.isTaxable && a.amount > 0).reduce((s, a) => s + a.amount, 0);
    prevAfter = prev.grossSalary - nonTax - (prev.socialInsurance ?? 0) - (prev.employmentInsurance ?? 0);
  }
  const flags = exemptFlagsOf(e);
  const r = calcBonus({
    amount,
    fiscalYearStandardBonusBefore: before,
    careInsuranceApplied: e.careInsuranceApplied ?? false,
    pensionApplied: pensionAppliedFor(e.pensionApplied, e.dateOfBirth, py, pm),
    healthApplied: healthAppliedFor(e.healthInsuranceMode, e.dateOfBirth, py, pm),
    employmentInsuranceApplied: e.employmentInsuranceApplied ?? true,
    rates,
    employmentInsuranceRate: rates.employmentInsuranceRate,
    ...flags,
    withholding: withholdingOf(e),
    prevMonthAfterInsurance: prevAfter,
    periodMonths,
    rateTable: rateTableOf(company),
  });
  return { employee: e, result: r, prevMonthAfterInsurance: prevAfter, fiscalYearStandardBonusBefore: before };
}

function bonusInput(b: Record<string, unknown>) {
  const employeeId = intQ(b.employeeId, 1, 1e9);
  const payDate = String(b.payDate ?? "");
  const amount = Number(b.amount);
  const periodMonths = intQ(b.periodMonths ?? 6, 1, 12) ?? 6;
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(payDate) || !Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) return null;
  return { employeeId, payDate, amount, periodMonths, note: String(b.note ?? "").slice(0, 200) || null };
}

router.get("/payroll-law/bonuses", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100) ?? new Date().getFullYear();
  const rows = await db.select({ b: bonusPaymentsTable, name: employeesTable.name }).from(bonusPaymentsTable)
    .innerJoin(employeesTable, eq(bonusPaymentsTable.employeeId, employeesTable.id)).orderBy(asc(bonusPaymentsTable.payDate));
  const company = await companyRow();
  return res.json({ hasRateTable: !!rateTableOf(company), bonuses: rows.filter((r) => String(r.b.payDate).startsWith(`${year}-`)).map((r) => ({ ...r.b, employeeName: r.name })) });
});

router.post("/payroll-law/bonuses/preview", async (req, res) => {
  const i = bonusInput(req.body ?? {});
  if (!i) return res.status(400).json({ error: "社員・支給日・金額（円）を入れてください。" });
  try { return res.json(await computeBonus(i.employeeId, i.payDate, i.amount, i.periodMonths)); }
  catch (e) { return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message }); }
});

const bonusRow = (r: Awaited<ReturnType<typeof computeBonus>>["result"]) => ({
  standardBonus: r.standardBonus, healthStandard: r.healthStandard, pensionStandard: r.pensionStandard,
  healthInsurance: r.healthInsurance, childcareSupportContribution: r.childcareSupportContribution, pension: r.pension,
  employmentInsurance: r.employmentInsurance, incomeTax: r.incomeTax, netAmount: r.netAmount, incomeTaxMethod: r.incomeTaxMethod,
});

router.post("/payroll-law/bonuses", async (req, res) => {
  const i = bonusInput(req.body ?? {});
  if (!i) return res.status(400).json({ error: "社員・支給日・金額（円）を入れてください。" });
  const c = await computeBonus(i.employeeId, i.payDate, i.amount, i.periodMonths);
  const [row] = await db.insert(bonusPaymentsTable).values({ employeeId: i.employeeId, payDate: i.payDate, amount: i.amount, periodMonths: i.periodMonths, note: i.note, ...bonusRow(c.result) }).returning();
  await audit(req, "bonus.create", `bonus:${row!.id}`, { employee: c.employee.name, payDate: i.payDate, amount: i.amount });
  return res.json({ ...row, incomeTaxError: c.result.incomeTaxError });
});

router.put("/payroll-law/bonuses/:id", async (req, res) => {
  const id = intQ(req.params.id, 1, 1e9);
  const [cur] = id ? await db.select().from(bonusPaymentsTable).where(eq(bonusPaymentsTable.id, id)) : [];
  if (!cur) return res.status(404).json({ error: "賞与の明細が見つかりません。" });
  if (cur.status === "confirmed") return res.status(409).json({ error: "確定済みの賞与は計算し直せません。先に確定を解除してください。" });
  const i = bonusInput({ ...cur, ...(req.body ?? {}), employeeId: cur.employeeId });
  if (!i) return res.status(400).json({ error: "支給日・金額（円）を入れてください。" });
  const c = await computeBonus(i.employeeId, i.payDate, i.amount, i.periodMonths, id!);
  const [row] = await db.update(bonusPaymentsTable).set({ payDate: i.payDate, amount: i.amount, periodMonths: i.periodMonths, note: i.note, ...bonusRow(c.result), updatedAt: new Date() })
    .where(and(eq(bonusPaymentsTable.id, id!), eq(bonusPaymentsTable.status, "draft"))).returning();
  if (!row) return res.status(409).json({ error: "確定済みの賞与は計算し直せません。" });
  return res.json({ ...row, incomeTaxError: c.result.incomeTaxError });
});

async function setBonusStatus(req: import("express").Request, res: Response, confirm: boolean) {
  const id = intQ(req.params.id, 1, 1e9);
  const [cur] = id ? await db.select().from(bonusPaymentsTable).where(eq(bonusPaymentsTable.id, id)) : [];
  if (!cur) return res.status(404).json({ error: "賞与の明細が見つかりません。" });
  if (confirm && cur.incomeTax === null) return res.status(400).json({ error: "源泉所得税が計算できていないため確定できません（算出率の表を会社設定に入れてください）。" });
  const [row] = await db.update(bonusPaymentsTable).set({ status: confirm ? "confirmed" : "draft", updatedAt: new Date() }).where(eq(bonusPaymentsTable.id, id!)).returning();
  await audit(req, confirm ? "bonus.confirm" : "bonus.unconfirm", `bonus:${id}`, { amount: cur.amount, payDate: cur.payDate });
  return res.json(row);
}
router.post("/payroll-law/bonuses/:id/confirm", (req, res) => setBonusStatus(req, res, true));
router.post("/payroll-law/bonuses/:id/unconfirm", (req, res) => setBonusStatus(req, res, false));

router.delete("/payroll-law/bonuses/:id", async (req, res) => {
  const id = intQ(req.params.id, 1, 1e9);
  if (!id) return res.status(400).json({ error: "指定が正しくありません。" });
  const [row] = await db.delete(bonusPaymentsTable).where(and(eq(bonusPaymentsTable.id, id), eq(bonusPaymentsTable.status, "draft"))).returning();
  if (!row) return res.status(409).json({ error: "確定済みの賞与は消せません。" });
  await audit(req, "bonus.delete", `bonus:${id}`, { amount: row.amount, payDate: row.payDate });
  return res.json({ ok: true });
});

/** 賞与支払届の数字（支給日・賞与額・標準賞与額〔健保・厚年〕）。届書は年金機構の様式で出す（これは元の数字の一覧） */
router.get("/payroll-law/bonuses/report.csv", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100) ?? new Date().getFullYear();
  const rows = await db.select({ b: bonusPaymentsTable, e: employeesTable }).from(bonusPaymentsTable)
    .innerJoin(employeesTable, eq(bonusPaymentsTable.employeeId, employeesTable.id)).orderBy(asc(bonusPaymentsTable.payDate));
  const table: unknown[][] = [["社員番号", "氏名", "生年月日", "支給日", "賞与額（通貨）", "標準賞与額（健保・1,000円未満切り捨て・年度573万円まで）", "標準賞与額（厚年・1回150万円まで）", "健康保険料", "子ども・子育て支援金", "厚生年金保険料", "雇用保険料", "源泉所得税", "差引支給額", "状態"]];
  for (const { b, e } of rows.filter((r) => String(r.b.payDate).startsWith(`${year}-`))) {
    table.push([e.employeeCode, nameOf(e.name), e.dateOfBirth ?? "", b.payDate, b.amount, b.healthStandard, b.pensionStandard, b.healthInsurance, b.childcareSupportContribution, b.pension, b.employmentInsurance, b.incomeTax ?? "未計算", b.netAmount ?? "", b.status === "confirmed" ? "確定" : "未確定"]);
  }
  return sendCsv(res, `bonus_report_${year}.csv`, `賞与支払届の数字_${year}年.csv`, table);
});

// ── 賃金台帳（労基法108条・労基則54条）─────────────────────────────────

async function wageLedger(year: number, month: number | null) {
  const where = month ? and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)) : eq(payrollsTable.year, year);
  const rows = await db.select({ p: payrollsTable, e: employeesTable }).from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id)).where(where)
    .orderBy(asc(employeesTable.employeeCode), asc(payrollsTable.month));
  const ids = rows.map((r) => r.e.id).concat([0]);
  const [recs, allows, deds] = await Promise.all([
    db.select().from(monthlyRecordsTable).where(and(inArray(monthlyRecordsTable.employeeId, ids), eq(monthlyRecordsTable.year, year))),
    db.select().from(employeeMonthAllowancesTable).where(and(inArray(employeeMonthAllowancesTable.employeeId, ids), eq(employeeMonthAllowancesTable.year, year))),
    db.select().from(employeeMonthDeductionsTable).where(and(inArray(employeeMonthDeductionsTable.employeeId, ids), eq(employeeMonthDeductionsTable.year, year))),
  ]);
  const company = await companyRow();
  return rows.map(({ p, e }) => {
    const r = recs.find((x) => x.employeeId === e.id && x.month === p.month);
    const dates = payrollDates(p.year, p.month, company?.closingDay ?? 31, company?.paymentDay ?? 25);
    const health = p.healthInsuranceAmount ?? null;
    const pension = p.pensionAmount ?? null;
    return {
      employeeId: e.id, employeeCode: e.employeeCode, name: e.name, gender: e.gender,
      year: p.year, month: p.month, periodEnd: dates.closing, paymentDate: dates.payment, status: p.status,
      workDays: (r?.workDays ?? 0) + (r?.saturdayWorkDays ?? 0) + (r?.holidayWorkDays ?? 0) + (r && (r.sundayWorkHours ?? 0) > 0 ? Math.ceil((r.sundayWorkHours ?? 0) / 8) : 0),
      workHours: r?.actualWorkHours ?? 0,
      overtimeHours: (r?.overtimeHours ?? 0) + (r?.restDayOvertimeHours ?? 0),
      holidayWorkDays: (r?.saturdayWorkDays ?? 0) + (r?.holidayWorkDays ?? 0),
      sundayWorkHours: r?.sundayWorkHours ?? 0,
      lateNightHours: r?.lateNightHours ?? 0,
      paidLeaveDays: r?.paidLeaveDays ?? 0,
      baseSalary: p.baseSalary,
      pays: [
        ...(p.saturdayPay ? [["土曜出勤手当", p.saturdayPay]] : []),
        ...(p.overtimePay ? [["時間外手当", p.overtimePay]] : []),
        ...(p.lateNightPay ? [["深夜手当", p.lateNightPay]] : []),
        ...(p.holidayPay ? [["休日手当", p.holidayPay]] : []),
        ...(p.performanceAllowance && p.calculationMode !== "manual" ? [["業績手当", p.performanceAllowance]] : []),
        ...(p.transportationAllowance ? [["通勤手当", p.transportationAllowance]] : []),
        ...allows.filter((a) => a.employeeId === e.id && a.month === p.month && a.amount > 0).map((a) => [a.allowanceName, a.amount]),
      ] as Array<[string, number]>,
      absenceDeduction: p.absenceDeduction ?? 0,
      grossSalary: p.grossSalary,
      deductions: [
        ["健康保険料", health ?? Math.max(0, (p.socialInsurance ?? 0) - (p.childcareSupportContribution ?? 0) - (pension ?? 0))],
        ["子ども・子育て支援金", p.childcareSupportContribution ?? 0],
        ["厚生年金保険料", pension ?? 0],
        ["雇用保険料", p.employmentInsurance],
        ["源泉所得税", p.incomeTax],
        ["住民税", p.residentTax],
        ...deds.filter((d) => d.employeeId === e.id && d.month === p.month && d.amount > 0).map((d) => [d.deductionName, d.amount]),
      ] as Array<[string, number]>,
      healthPensionSplitKnown: health !== null,
      totalDeductions: p.totalDeductions,
      netSalary: p.netSalary,
    };
  });
}

router.get("/payroll-law/wage-ledger", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100);
  const month = req.query.month ? intQ(req.query.month, 1, 12) : null;
  if (!year) return res.status(400).json({ error: "年を指定してください。" });
  return res.json(await wageLedger(year, month));
});

router.get("/payroll-law/wage-ledger.csv", async (req, res) => {
  const year = intQ(req.query.year, 2000, 2100);
  const month = req.query.month ? intQ(req.query.month, 1, 12) : null;
  if (!year) return res.status(400).json({ error: "年を指定してください。" });
  const rows = await wageLedger(year, month);
  const payNames = [...new Set(rows.flatMap((r) => r.pays.map((x) => x[0])))];
  const dedNames = [...new Set(rows.flatMap((r) => r.deductions.map((x) => x[0])))];
  const head = ["社員番号", "氏名", "性別", "賃金計算期間（明細の年月）", "締め日", "支払日", "労働日数", "労働時間数", "時間外労働の時間数", "休日（土曜・祝日）の出勤日数", "日曜の労働時間数", "深夜労働の時間数", "有給の日数",
    "基本給", ...payNames, "欠勤控除", "総支給額", ...dedNames, "控除合計", "差引支給額", "状態"];
  const g = (v: string | null) => v === "male" ? "男" : v === "female" ? "女" : v === "other" ? "その他" : "";
  const table: unknown[][] = [head, ...rows.map((r) => [r.employeeCode, nameOf(r.name), g(r.gender), `${r.year}年${r.month}月`, r.periodEnd, r.paymentDate, r.workDays, r.workHours, r.overtimeHours, r.holidayWorkDays, r.sundayWorkHours, r.lateNightHours, r.paidLeaveDays,
    r.baseSalary, ...payNames.map((n) => r.pays.filter((x) => x[0] === n).reduce((s, x) => s + x[1], 0)), r.absenceDeduction, r.grossSalary,
    ...dedNames.map((n) => r.deductions.filter((x) => x[0] === n).reduce((s, x) => s + x[1], 0)), r.totalDeductions, r.netSalary, r.status === "confirmed" ? "確定" : "未確定"])];
  return sendCsv(res, `wage_ledger_${year}${month ? String(month).padStart(2, "0") : ""}.csv`, `賃金台帳_${year}年${month ? `${month}月` : ""}.csv`, table);
});

// ── 労働者名簿（労基法107条・労基則53条）───────────────────────────────

async function roster() {
  const rows = await db.select().from(employeesTable).orderBy(asc(employeesTable.employeeCode));
  return rows.map((e) => ({
    id: e.id, employeeCode: e.employeeCode, name: e.name, nameKana: e.nameKana, dateOfBirth: e.dateOfBirth, gender: e.gender,
    address: e.address, jobType: e.jobType ?? (e.isOfficeStaff ? "事務" : "貨物自動車の運転"), jobTypeEntered: !!e.jobType,
    hireDate: e.hireDate, retirementDate: e.retirementDate, retirementReason: e.retirementReason, isActive: e.isActive,
    missing: [!e.gender && "性別", !e.address && "住所", !e.jobType && "業務の種類", !e.dateOfBirth && "生年月日"].filter(Boolean),
  }));
}

router.get("/payroll-law/worker-roster", async (_req, res) => res.json(await roster()));

router.get("/payroll-law/worker-roster.csv", async (_req, res) => {
  const g = (v: string | null) => v === "male" ? "男" : v === "female" ? "女" : v === "other" ? "その他" : "";
  const table: unknown[][] = [["社員番号", "氏名", "ふりがな", "生年月日", "性別", "住所", "業務の種類", "雇入れの年月日", "退職の年月日", "退職の事由（解雇はその理由）"],
    ...(await roster()).map((r) => [r.employeeCode, nameOf(r.name), r.nameKana, r.dateOfBirth ?? "", g(r.gender), r.address ?? "", r.jobType, r.hireDate, r.retirementDate ?? "", r.retirementReason ?? ""])];
  return sendCsv(res, "worker_roster.csv", `労働者名簿_${jstTodayIso()}.csv`, table);
});

// ── 雇用保険料の不足（料率を 0.0005 で計算していた月）────────────────────

const EI_SETTLE_NAME = "雇用保険料（不足分の精算）";

router.get("/payroll-law/ei-shortfall", async (req, res) => {
  const rate = Number(req.query.rate ?? 0.005);
  const fromY = intQ(req.query.fromYear ?? 2026, 2000, 2100)!, fromM = intQ(req.query.fromMonth ?? 4, 1, 12)!;
  const toY = intQ(req.query.toYear ?? 2026, 2000, 2100)!, toM = intQ(req.query.toMonth ?? 8, 1, 12)!;
  if (!(rate > 0 && rate < 0.1)) return res.status(400).json({ error: "正しい料率を入れてください（例 0.005）。" });
  const rows = await db.select({ p: payrollsTable, e: employeesTable }).from(payrollsTable).innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id));
  const target = rows.filter(({ p }) => ymKey(p.year, p.month) >= ymKey(fromY, fromM) && ymKey(p.year, p.month) <= ymKey(toY, toM));
  const ids = target.map((t) => t.e.id).concat([0]);
  const [allows, settled] = await Promise.all([
    db.select().from(employeeMonthAllowancesTable).where(and(inArray(employeeMonthAllowancesTable.employeeId, ids), eq(employeeMonthAllowancesTable.excludeFromEmploymentInsurance, true))),
    db.select().from(employmentInsuranceSettlementsTable),
  ]);
  const out = target.map(({ p, e }) => {
    const flags = exemptFlagsOf(e);
    const excluded = allows.filter((a) => a.employeeId === e.id && a.year === p.year && a.month === p.month).reduce((s, a) => s + a.amount, 0);
    const base = p.grossSalary - excluded;
    const applies = !flags.employmentInsuranceExempt && (e.employmentInsuranceApplied ?? true);
    const correct = applies ? round50sen(base * rate) : 0;
    const s = settled.find((x) => x.employeeId === e.id && x.fromYear === p.year && x.fromMonth === p.month);
    return {
      employeeId: e.id, name: e.name, year: p.year, month: p.month, status: p.status, base,
      deducted: p.employmentInsurance, correct, shortfall: correct - p.employmentInsurance,
      settled: s ? { applyYear: s.applyYear, applyMonth: s.applyMonth, amount: s.amount } : null,
    };
  }).filter((x) => x.shortfall !== 0)
    .sort((a, b) => a.employeeId - b.employeeId || ymKey(a.year, a.month) - ymKey(b.year, b.month));
  return res.json({ rate, items: out });
});

/** 不足分を、選んだ月の「その他の控除」に1行で足す（その月の明細は確定前であること）。 */
router.post("/payroll-law/ei-shortfall/settle", async (req, res) => {
  const employeeId = intQ(req.body?.employeeId, 1, 1e9);
  const applyYear = intQ(req.body?.applyYear, 2000, 2100);
  const applyMonth = intQ(req.body?.applyMonth, 1, 12);
  const items = (Array.isArray(req.body?.items) ? req.body.items : []) as Array<{ fromYear: number; fromMonth: number; amount: number }>;
  if (!employeeId || !applyYear || !applyMonth || items.length === 0 || items.some((i) => !Number.isInteger(i.fromYear) || !Number.isInteger(i.fromMonth) || !Number.isInteger(i.amount) || i.amount <= 0)) {
    return res.status(400).json({ error: "社員・取り戻す月・不足の月と額を送ってください。" });
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  let [def] = await db.select().from(deductionDefinitionsTable).where(eq(deductionDefinitionsTable.name, EI_SETTLE_NAME));
  if (!def) [def] = await db.insert(deductionDefinitionsTable).values({ name: EI_SETTLE_NAME, description: "2026年4〜8月分の雇用保険料（料率の誤り）の不足分", calculationType: "fixed", sortOrder: 900 }).returning();
  try {
    const cur = await getMonthItems(employeeId, applyYear, applyMonth);
    const already = await db.select().from(employmentInsuranceSettlementsTable).where(eq(employmentInsuranceSettlementsTable.employeeId, employeeId));
    if (items.some((i) => already.some((a) => a.fromYear === i.fromYear && a.fromMonth === i.fromMonth))) return res.status(409).json({ error: "すでに取り戻すことにした月が含まれています。" });
    const deductions = cur.deductions.map((d) => ({ deductionDefinitionId: d.deductionDefinitionId, amount: d.amount }));
    const idx = deductions.findIndex((d) => d.deductionDefinitionId === def!.id);
    if (idx >= 0) deductions[idx]!.amount += total; else deductions.push({ deductionDefinitionId: def!.id, amount: total });
    await saveMonthItems(employeeId, applyYear, applyMonth, {
      allowances: cur.allowances.map((a) => ({ allowanceDefinitionId: a.allowanceDefinitionId, amount: a.amount })),
      deductions,
    });
    await db.insert(employmentInsuranceSettlementsTable).values(items.map((i) => ({ employeeId, fromYear: i.fromYear, fromMonth: i.fromMonth, amount: i.amount, applyYear, applyMonth })));
    // いちばん新しい月に足すと、社員ごとの控除（次の月の初期値）にも写る（saveMonthItems の決まり）。
    // 精算は1回だけなので、写った行は消す（翌月以降に同じ額が繰り返し引かれないように）。
    await db.delete(employeeDeductionsTable).where(and(eq(employeeDeductionsTable.employeeId, employeeId), eq(employeeDeductionsTable.deductionDefinitionId, def!.id)));
  } catch (e) {
    if (e instanceof MonthLockedError) return res.status(409).json({ error: "取り戻す月の明細は確定済みです。確定前の月を選んでください。" });
    throw e;
  }
  await audit(req, "ei_shortfall.settle", `employee:${employeeId}`, { applyYear, applyMonth, total, months: items.map((i) => `${i.fromYear}-${i.fromMonth}`) });
  return res.json({ ok: true, total, note: "その月の明細を「再計算」すると控除に入ります。" });
});

// ── 最低賃金 ─────────────────────────────────────────────────────────

router.get("/payroll-law/minimum-wage", async (_req, res) => {
  const company = await companyRow();
  const rules = payRulesFromCompany(company as never);
  const minWage = company?.minimumWageHourly ?? 0;
  const hpd = rules.scheduledHoursPerDay;
  const emps = await activeEmployees();
  const [defs, master] = await Promise.all([
    db.select().from(allowanceDefinitionsTable),
    db.select().from(employeeAllowancesTable),
  ]);
  const premiumIds = new Set(defs.filter((d) => d.includeInPremiumBase).map((d) => d.id));
  const companyChecks = [
    { label: "平日の日当", amount: company?.dailyWageWeekday ?? 0, need: roundRate(minWage * hpd) },
    { label: "土曜の日当（1.25倍）", amount: company?.dailyWageSaturday ?? 0, need: roundRate(minWage * hpd * 1.25) },
    { label: "日曜の時給（1.35倍）", amount: company?.hourlyWageSunday ?? 0, need: roundRate(minWage * 1.35) },
  ].map((c) => ({ ...c, ok: c.amount >= c.need }));
  const employees = emps.map((e) => {
    const included = master.filter((m) => m.employeeId === e.id && premiumIds.has(m.allowanceDefinitionId)).reduce((s, m) => s + (m.amount ?? 0), 0);
    const weekday = (e.dailyRateWeekday ?? 0) > 0 ? e.dailyRateWeekday : (company?.dailyWageWeekday ?? 9808);
    const hourly = hourlyForMinimumWage(e.salaryType, { weekdayDaily: weekday, monthlyBase: e.baseSalary ?? 0, hourlyWage: e.baseSalary ?? 0 }, included, rules);
    return { employeeId: e.id, name: e.name, salaryType: e.salaryType, hourly: Math.floor(hourly * 100) / 100, ok: hourly + 1e-9 >= minWage };
  });
  return res.json({ minimumWage: minWage, effectiveDate: company?.minimumWageEffectiveDate ?? null, scheduledHoursPerDay: hpd, companyChecks, employees });
});

// ── 残業の月ごと・年の累計 ─────────────────────────────────────────────

router.get("/payroll-law/overtime", async (req, res) => {
  const company = await companyRow();
  const start = company?.overtimeYearStartMonth ?? 4;
  const fy = intQ(req.query.fiscalYear, 2000, 2100) ?? (new Date().getMonth() + 1 >= start ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const months = Array.from({ length: 12 }, (_, i) => { const k = ymKey(fy, start) + i; return { year: Math.floor(k / 12), month: (k % 12) + 1 }; });
  const emps = await activeEmployees();
  const recs = await db.select().from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, emps.map((e) => e.id).concat([0])));
  return res.json({ fiscalYear: fy, startMonth: start, months, employees: emps.map((e) => {
    const hours = months.map((m) => { const r = recs.find((x) => x.employeeId === e.id && x.year === m.year && x.month === m.month); return r ? (r.overtimeHours ?? 0) + (r.restDayOvertimeHours ?? 0) : null; });
    const total = hours.reduce<number>((s, h) => s + (h ?? 0), 0);
    return { employeeId: e.id, name: e.name, isDriver: !e.isOfficeStaff, hours, total, annualLimit: e.isOfficeStaff ? 720 : 960 };
  }) });
});

// ── 退職の判断材料 ───────────────────────────────────────────────────

router.get("/payroll-law/retirement/:id", async (req, res) => {
  const id = intQ(req.params.id, 1, 1e9);
  const [e] = id ? await db.select().from(employeesTable).where(eq(employeesTable.id, id)) : [];
  if (!e) return res.status(404).json({ error: "社員が見つかりません。" });
  if (!e.retirementDate) return res.json({ employeeId: e.id, retirementDate: null });
  const r = String(e.retirementDate).slice(0, 10);
  const [ry, rm, rd] = r.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(ry, rm, 0)).getUTCDate();
  const loss = rd === last ? (rm === 12 ? `${ry + 1}-01-01` : `${ry}-${String(rm + 1).padStart(2, "0")}-01`) : `${ry}-${String(rm).padStart(2, "0")}-${String(rd + 1).padStart(2, "0")}`;
  // 保険料は資格を失った月の前の月の分まで
  const lossY = Number(loss.slice(0, 4)), lossM = Number(loss.slice(5, 7));
  const lastPremium = lossM === 1 ? { year: lossY - 1, month: 12 } : { year: lossY, month: lossM - 1 };
  // 最終月の日割り（月給）。どちらの式を使うかは就業規則で決まる。ここは両方の数字を出すだけ（明細には入れない）
  let proration = null as null | { calendar: number; scheduled: number; base: number; calendarDays: number; scheduledDays: number; workedCalendar: number; workedScheduled: number };
  if (e.salaryType === "fixed") {
    const all = scheduledWeekdays(ry, rm);
    let worked = 0;
    for (let d = 1; d <= rd; d++) { const w = new Date(Date.UTC(ry, rm - 1, d)).getUTCDay(); if (w !== 0 && w !== 6) worked++; }
    worked = Math.min(worked, all);
    proration = { base: e.baseSalary, calendarDays: last, workedCalendar: rd, scheduledDays: all, workedScheduled: worked,
      calendar: Math.round(e.baseSalary * rd / last), scheduled: Math.round(e.baseSalary * worked / (all || 1)) };
  }
  const totals = await yearTotals(ry, e.id);
  return res.json({
    employeeId: e.id, name: e.name, retirementDate: r, retirementReason: e.retirementReason,
    monthEnd: rd === last, lossDate: loss, lastPremiumMonth: lastPremium,
    note: rd === last
      ? `${rm}月末の退職なので、資格を失うのは${loss}。${rm}月分まで社会保険料がかかります。翌月25日払いの${rm}月分の明細で${rm}月分を引くと、引き残しはありません（当月分を翌月の給与から引く運用の場合は、${rm}月分と前月分の2か月分を最後の給与で引くことになります）。`
      : `月の途中の退職なので、資格を失うのは${loss}。社会保険料は${lastPremium.year}年${lastPremium.month}月分までです（${rm}月分はかかりません）。`,
    proration,
    withholdingSlip: totals[0] ?? null,
    commuteLimit: commuteNonTaxableLimit(e.commuteMethod, e.commuteDistanceKm),
  });
});

// 標準報酬が今いくつか（画面の補助）
router.get("/payroll-law/standard/:id", async (req, res) => {
  const id = intQ(req.params.id, 1, 1e9);
  const y = intQ(req.query.year, 2000, 2100), m = intQ(req.query.month, 1, 12);
  const [e] = id ? await db.select().from(employeesTable).where(eq(employeesTable.id, id)) : [];
  if (!e || !y || !m) return res.status(400).json({ error: "指定が正しくありません。" });
  return res.json(await getEffectiveStandardRemuneration(e, y, m));
});

export default router;
