import { Router } from "express";
import {
  db,
  employeesTable,
  payrollsTable,
  monthlyRecordsTable,
  employeeMonthSetsTable,
  companyTable,
  insuranceRatePeriodsTable,
  standardRemunerationHistoryTable,
  allowanceDefinitionsTable,
  employeeBankAccountsTable,
  transferSettingsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { buildZengin, toZenginKana } from "../lib/zengin";
import { audit } from "../lib/audit";

/**
 * 事務所の締め作業を助ける入口（給与明細画面の「確定前チェック」「前月との差」、振込一覧など）。
 * すべて管理画面のログインが必要（routes/index.ts で /office-tools に requireAdmin を掛けている。
 * 閲覧のみの人は GET だけ通る）。
 */
const router = Router();

function ym(req: { query: Record<string, unknown> }) {
  const year = parseInt(String(req.query.year), 10);
  const month = parseInt(String(req.query.month), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);

// ── その月の社員ごとの状態（確定前チェック・前月との差・未入力の絞り込みに使う）────────────
//
// needsRecalc（再計算が要りそう）＝ 未確定の明細を計算したあとで、次のどれかが変わったもの。
//   月次実績／その月の手当・控除／社員マスター（単価・日給・扶養など）／会社設定（日給・単価）／
//   保険料率／標準報酬月額／手当マスター（課税区分など）
// 明細の計算では更新日時を残していないので「明細の更新日時より後に変わったか」で見ている。
// ※ 社員マスターは暗証番号を変えただけでも更新日時が変わるため、念のための再計算を勧めることがある。
router.get("/office-tools/month-status", async (req, res) => {
  const p = ym(req);
  if (!p) return res.status(400).json({ error: "year と month を指定してください（例: ?year=2026&month=9）" });
  const { year, month } = p;
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;

  const [emps, records, payrolls, prevPayrolls, sets, [company], [rateMax], [defMax]] = await Promise.all([
    db.select().from(employeesTable),
    db.select().from(monthlyRecordsTable).where(and(eq(monthlyRecordsTable.year, year), eq(monthlyRecordsTable.month, month))),
    db.select().from(payrollsTable).where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month))),
    db.select().from(payrollsTable).where(and(eq(payrollsTable.year, prevY), eq(payrollsTable.month, prevM))),
    db.select().from(employeeMonthSetsTable).where(and(eq(employeeMonthSetsTable.year, year), eq(employeeMonthSetsTable.month, month))),
    db.select({ updatedAt: companyTable.updatedAt }).from(companyTable).limit(1),
    db.select({ t: sql<Date | null>`max(${insuranceRatePeriodsTable.updatedAt})` }).from(insuranceRatePeriodsTable),
    db.select({ t: sql<Date | null>`max(${allowanceDefinitionsTable.updatedAt})` }).from(allowanceDefinitionsTable),
  ]);

  const stdByEmp = new Map<number, number>();
  const stdRows = await db.select({ employeeId: standardRemunerationHistoryTable.employeeId, t: sql<Date>`max(${standardRemunerationHistoryTable.updatedAt})` })
    .from(standardRemunerationHistoryTable).groupBy(standardRemunerationHistoryTable.employeeId);
  for (const r of stdRows) stdByEmp.set(r.employeeId, ms(r.t));

  const ids = new Set<number>([...emps.filter((e) => e.isActive).map((e) => e.id), ...payrolls.map((p) => p.employeeId)]);
  const rows = [...ids].map((id) => {
    const e = emps.find((x) => x.id === id);
    const rec = records.find((r) => r.employeeId === id);
    const pr = payrolls.find((x) => x.employeeId === id);
    const prev = prevPayrolls.find((x) => x.employeeId === id);
    const set = sets.find((s) => s.employeeId === id);
    const reasons: string[] = [];
    if (pr && pr.status !== "confirmed") {
      const at = ms(pr.updatedAt);
      if (rec && ms(rec.updatedAt) > at) reasons.push("月次実績");
      if (set && ms(set.updatedAt) > at) reasons.push("手当・控除");
      if (e && ms(e.updatedAt) > at) reasons.push("社員マスター");
      if (company && ms(company.updatedAt) > at) reasons.push("会社設定");
      if (ms(rateMax?.t) > at) reasons.push("保険料率");
      if ((stdByEmp.get(id) ?? 0) > at) reasons.push("標準報酬月額");
      if (ms(defMax?.t) > at) reasons.push("手当マスター");
    }
    return {
      employeeId: id,
      employeeCode: e?.employeeCode ?? "",
      name: e?.name ?? "",
      isActive: e?.isActive ?? false,
      salaryType: e?.salaryType ?? null,
      overtimeHourlyRate: e?.overtimeHourlyRate ?? 0,
      hasRecord: !!rec,
      recordUpdatedAt: rec?.updatedAt ?? null,
      overtimeHours: rec?.overtimeHours ?? 0,
      lateNightHours: rec?.lateNightHours ?? 0,
      employmentInsuranceOverride: set?.employmentInsuranceOverride ?? null,
      payroll: pr ? {
        id: pr.id, status: pr.status, grossSalary: pr.grossSalary, netSalary: pr.netSalary,
        totalDeductions: pr.totalDeductions, calculationMode: pr.calculationMode, updatedAt: pr.updatedAt,
      } : null,
      prev: prev ? { grossSalary: prev.grossSalary, netSalary: prev.netSalary, status: prev.status } : null,
      needsRecalc: reasons.length > 0,
      recalcReasons: reasons,
    };
  }).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  return res.json({ year, month, prevYear: prevY, prevMonth: prevM, rows });
});

// ── 未確定の明細（単価・保険料率などを変えたあとの「一括再計算」用）─────────────────────
router.get("/office-tools/draft-payrolls", async (_req, res) => {
  const rows = await db.select({
    id: payrollsTable.id, employeeId: payrollsTable.employeeId, year: payrollsTable.year, month: payrollsTable.month,
  }).from(payrollsTable).where(eq(payrollsTable.status, "draft"));
  return res.json(rows.sort((a, b) => a.year - b.year || a.month - b.month || a.employeeId - b.employeeId));
});

// ── 社員の振込口座 ─────────────────────────────────────────────────────
const digits = (v: unknown, max: number) => String(v ?? "").replace(/\D/g, "").slice(0, max);

function cleanAccount(b: Record<string, unknown>) {
  const accountType = [1, 2, 4, 9].includes(Number(b.accountType)) ? Number(b.accountType) : 1;
  return {
    bankCode: digits(b.bankCode, 4),
    bankName: String(b.bankName ?? "").trim().slice(0, 40),
    branchCode: digits(b.branchCode, 3),
    branchName: String(b.branchName ?? "").trim().slice(0, 40),
    accountType,
    accountNumber: digits(b.accountNumber, 7),
    holderKana: String(b.holderKana ?? "").trim().slice(0, 60),
  };
}

/** 入力の誤りを日本語で返す（空なら問題なし）。全部空欄は「口座なし」として通す */
function accountErrors(a: ReturnType<typeof cleanAccount>, label = ""): string[] {
  const empty = !a.bankCode && !a.branchCode && !a.accountNumber && !a.holderKana;
  if (empty) return [];
  const errs: string[] = [];
  if (a.bankCode.length !== 4) errs.push(`${label}銀行コードは4桁の数字で入れてください`);
  if (a.branchCode.length !== 3) errs.push(`${label}支店コードは3桁の数字で入れてください`);
  if (!a.accountNumber) errs.push(`${label}口座番号を入れてください（7桁まで）`);
  if (!a.holderKana) errs.push(`${label}口座名義（カナ）を入れてください`);
  else if (toZenginKana(a.holderKana) === null) errs.push(`${label}口座名義はカナ（と英大文字・数字）で入れてください`);
  return errs;
}

router.get("/office-tools/bank-accounts/:employeeId", async (req, res) => {
  const id = parseInt(req.params.employeeId, 10);
  const [row] = await db.select().from(employeeBankAccountsTable).where(eq(employeeBankAccountsTable.employeeId, id));
  return res.json(row ?? null);
});

router.put("/office-tools/bank-accounts/:employeeId", async (req, res) => {
  const id = parseInt(req.params.employeeId, 10);
  const [emp] = await db.select({ id: employeesTable.id, name: employeesTable.name }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  const a = cleanAccount(req.body ?? {});
  const errs = accountErrors(a);
  if (errs.length) return res.status(400).json({ error: errs.join("。") });
  const [row] = await db.insert(employeeBankAccountsTable).values({ employeeId: id, ...a, updatedAt: new Date() })
    .onConflictDoUpdate({ target: employeeBankAccountsTable.employeeId, set: { ...a, updatedAt: new Date() } })
    .returning();
  // 口座番号そのものは記録に残さない（下4桁だけ）
  await audit(req, "bank.update", `employee:${id}`, { employee: emp.name, bankCode: a.bankCode, branchCode: a.branchCode, account: a.accountNumber ? `****${a.accountNumber.slice(-3)}` : "" });
  return res.json(row);
});

// ── 振込元（会社の口座・委託者）──────────────────────────────────────────
const EMPTY_SETTINGS = {
  id: 1, consignorCode: "", consignorName: "", bankCode: "", bankName: "", branchCode: "", branchName: "",
  accountType: 1, accountNumber: "", kindCode: "11", designation: "", newline: true,
};

router.get("/office-tools/transfer-settings", async (_req, res) => {
  const [row] = await db.select().from(transferSettingsTable).where(eq(transferSettingsTable.id, 1));
  return res.json(row ?? EMPTY_SETTINGS);
});

router.put("/office-tools/transfer-settings", async (req, res) => {
  const b = req.body ?? {};
  const acc = cleanAccount(b);
  const v = {
    consignorCode: digits(b.consignorCode, 10),
    consignorName: String(b.consignorName ?? "").trim().slice(0, 60),
    bankCode: acc.bankCode, bankName: acc.bankName, branchCode: acc.branchCode, branchName: acc.branchName,
    accountType: acc.accountType, accountNumber: acc.accountNumber,
    kindCode: ["11", "12", "21"].includes(String(b.kindCode)) ? String(b.kindCode) : "11",
    designation: String(b.designation ?? "").replace(/[^0-9A-Z ]/g, "").slice(0, 1),
    newline: b.newline !== false,
  };
  const errs: string[] = [];
  if (v.consignorCode && v.consignorCode.length !== 10) errs.push("委託者コードは10桁の数字で入れてください（銀行から渡される番号）");
  if (v.consignorName && toZenginKana(v.consignorName) === null) errs.push("委託者名はカナ（と英大文字・数字）で入れてください");
  if (v.bankCode && v.bankCode.length !== 4) errs.push("振込元の銀行コードは4桁の数字で入れてください");
  if (v.branchCode && v.branchCode.length !== 3) errs.push("振込元の支店コードは3桁の数字で入れてください");
  if (errs.length) return res.status(400).json({ error: errs.join("。") });
  const [row] = await db.insert(transferSettingsTable).values({ id: 1, ...v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: transferSettingsTable.id, set: { ...v, updatedAt: new Date() } })
    .returning();
  await audit(req, "transfer-settings.update", "transfer-settings", { consignorCode: v.consignorCode ? "（設定あり）" : "", bankCode: v.bankCode, branchCode: v.branchCode, kindCode: v.kindCode });
  return res.json(row);
});

// ── その月の振込一覧（差引支給額と口座）─────────────────────────────────────
async function transferList(year: number, month: number) {
  const rows = await db.select({ payroll: payrollsTable, emp: employeesTable, bank: employeeBankAccountsTable })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .leftJoin(employeeBankAccountsTable, eq(employeeBankAccountsTable.employeeId, payrollsTable.employeeId))
    .where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)));
  return rows
    .map((r) => {
      const problems: string[] = [];
      if (!r.bank) problems.push("口座が未登録です");
      else problems.push(...accountErrors(cleanAccount(r.bank as unknown as Record<string, unknown>)));
      if (r.bank && !r.bank.accountNumber) problems.push("口座番号がありません");
      if (r.payroll.netSalary <= 0) problems.push("差引支給額が0円以下です");
      return {
        payrollId: r.payroll.id,
        employeeId: r.emp.id,
        employeeCode: r.emp.employeeCode,
        name: r.emp.name,
        status: r.payroll.status,
        netSalary: Math.round(r.payroll.netSalary),
        bank: r.bank ? {
          bankCode: r.bank.bankCode, bankName: r.bank.bankName, branchCode: r.bank.branchCode, branchName: r.bank.branchName,
          accountType: r.bank.accountType, accountNumber: r.bank.accountNumber, holderKana: r.bank.holderKana,
        } : null,
        problems: [...new Set(problems)],
      };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}

router.get("/office-tools/transfer", async (req, res) => {
  const p = ym(req);
  if (!p) return res.status(400).json({ error: "year と month を指定してください" });
  const list = await transferList(p.year, p.month);
  const [settings] = await db.select().from(transferSettingsTable).where(eq(transferSettingsTable.id, 1));
  return res.json({
    year: p.year, month: p.month, rows: list,
    total: list.reduce((s, r) => s + r.netSalary, 0),
    settingsReady: !!settings && settings.consignorCode.length === 10 && !!settings.consignorName && settings.bankCode.length === 4 && settings.branchCode.length === 3 && !!settings.accountNumber,
  });
});

// 全銀協フォーマットのファイル。確定済みの明細だけを書き出す（未確定の金額で振り込まないため）。
// ?date=MMDD（取組日＝振込日）・?ids=1,2,3（書き出す社員を選ぶとき）
router.get("/office-tools/transfer/zengin", async (req, res) => {
  const p = ym(req);
  if (!p) return res.status(400).json({ error: "year と month を指定してください" });
  const date = String(req.query.date ?? "").replace(/\D/g, "");
  if (date.length !== 4) return res.status(400).json({ error: "振込日（月日4桁。例: 1110）を指定してください" });
  const [settings] = await db.select().from(transferSettingsTable).where(eq(transferSettingsTable.id, 1));
  if (!settings || settings.consignorCode.length !== 10 || !settings.consignorName || settings.bankCode.length !== 4 || settings.branchCode.length !== 3 || !settings.accountNumber) {
    return res.status(400).json({ error: "振込元（委託者コード・委託者名・会社の口座）が未設定です。会社設定の「振込元」で入れてください。" });
  }
  const pick = String(req.query.ids ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));
  const list = (await transferList(p.year, p.month))
    .filter((r) => (pick.length ? pick.includes(r.employeeId) : true))
    .filter((r) => r.status === "confirmed");
  if (list.length === 0) return res.status(400).json({ error: "書き出せる明細がありません（確定済みの明細だけを書き出します）。" });
  const bad = list.filter((r) => r.problems.length > 0);
  if (bad.length) {
    return res.status(400).json({ error: `口座の入力に足りないところがある人がいます：${bad.map((r) => `${r.name}（${r.problems.join("・")}）`).join("、")}` });
  }
  let buf: Buffer;
  try {
    buf = buildZengin(settings, date, list.map((r) => ({
      ...r.bank!,
      amount: r.netSalary,
      customerCode: r.employeeCode.replace(/\D/g, "") || undefined,
    })));
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "書き出せませんでした" });
  }
  await audit(req, "transfer.export", `transfer:${p.year}-${p.month}`, { count: list.length, total: list.reduce((s, r) => s + r.netSalary, 0), date });
  const name = `振込データ_${p.year}${String(p.month).padStart(2, "0")}.txt`;
  res.setHeader("Content-Type", "text/plain; charset=Shift_JIS");
  res.setHeader("Content-Disposition", `attachment; filename="zengin.txt"; filename*=UTF-8''${encodeURIComponent(name)}`);
  return res.send(buf);
});

export default router;
