import { Router } from "express";
import { db, journalEntriesTable, payrollsTable, employeesTable, companyTable, employeeMonthAllowancesTable } from "@workspace/db";
import { buildPayrollJournal, payrollDates, type JournalPayrollRow } from "@workspace/tax-tables-reiwa8/core";
import { getEffectiveInsuranceRates } from "../lib/insurance-settings";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/journal-entries", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return res.status(400).json({ error: "year と month のクエリパラメータが必要です（例: ?year=2026&month=3）" });
  }

  const rows = await db.select().from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.year, year), eq(journalEntriesTable.month, month)));
  return res.json(rows);
});

router.post("/journal-entries/generate", async (req, res) => {
  const year = Number(req.body?.year);
  const month = Number(req.body?.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "年と月を指定してください。" });
  }

  // その月の確定済みの明細だけで作る
  const payrolls = await db.select({ payroll: payrollsTable, employee: employeesTable })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month), eq(payrollsTable.status, "confirmed")));
  if (payrolls.length === 0) return res.json([]);

  const [company] = await db.select().from(companyTable).limit(1);
  const fallbackRates = await getEffectiveInsuranceRates(year, month);
  // 雇用保険の計算基礎から外す手当（携帯代など）。会社負担の雇用保険料に使う
  const excluded = await db.select().from(employeeMonthAllowancesTable)
    .where(and(eq(employeeMonthAllowancesTable.year, year), eq(employeeMonthAllowancesTable.month, month), eq(employeeMonthAllowancesTable.excludeFromEmploymentInsurance, true)));

  const rows: JournalPayrollRow[] = payrolls.map(({ payroll: p, employee: e }) => {
    const childcare = p.childcareSupportContribution ?? 0;
    // 健康保険と厚生年金を分けて残していない古い明細は、標準報酬 × 料率で分ける（印刷と同じ考え方）
    const std = p.appliedStandardRemuneration ?? e.standardRemuneration ?? 0;
    const healthRate = p.appliedHealthInsuranceRate ?? fallbackRates.healthInsuranceRate;
    const careRate = p.appliedCareInsuranceRate ?? (e.careInsuranceApplied ? fallbackRates.careInsuranceRate : 0);
    const pensionRate = p.appliedPensionRate ?? fallbackRates.pensionRate;
    const pension = p.pensionAmount ?? Math.max(0, (p.socialInsurance ?? 0) - childcare - (p.healthInsuranceAmount ?? Math.round(std * (healthRate + careRate) / 2)));
    const health = p.healthInsuranceAmount ?? Math.max(0, (p.socialInsurance ?? 0) - childcare - pension);
    const ex = excluded.filter((x) => x.employeeId === e.id).reduce((s2, x) => s2 + (x.amount ?? 0), 0);
    return {
      grossSalary: p.grossSalary,
      healthInsurance: health,
      childcareSupportContribution: childcare,
      pension,
      employmentInsurance: p.employmentInsurance,
      incomeTax: p.incomeTax,
      residentTax: p.residentTax,
      otherDeductions: Math.max(0, (p.totalDeductions ?? 0) - (p.socialInsurance ?? 0) - p.employmentInsurance - p.incomeTax - p.residentTax),
      netSalary: p.netSalary,
      standardRemuneration: std,
      healthRateTotal: healthRate,
      careRateTotal: careRate,
      childcareRateTotal: p.appliedChildcareSupportRate ?? fallbackRates.childcareSupportRate,
      pensionRateTotal: pensionRate,
      pensionMaxStandard: fallbackRates.pensionMaxStandard,
      employmentInsuranceBase: p.grossSalary - ex,
    };
  });

  // 計上日：締め日か支払日（会社設定）。以前は new Date(year, month, 0).toISOString() で、
  // 日本時間の0時が UTC では前日になり「1日前」の日付になっていた。日付は文字列で組み立てる。
  const dates = payrollDates(year, month, company?.closingDay ?? 31, company?.paymentDay ?? 25);
  const entryDate = company?.journalDateBasis === "payment" ? dates.payment : dates.closing;
  const lines = buildPayrollJournal(rows, {
    label: `${year}年${month}月分給与`,
    entryDate,
    paymentDate: dates.payment,
    employerEmploymentRate: company?.employmentInsuranceEmployerRate ?? 0.0085,
    childContributionRate: company?.childContributionRate ?? 0.0036,
  });

  const inserted = await db.transaction(async (tx) => {
    await tx.delete(journalEntriesTable).where(and(eq(journalEntriesTable.year, year), eq(journalEntriesTable.month, month)));
    return tx.insert(journalEntriesTable).values(lines.map((l) => ({
      year, month, entryDate: l.date, debitAccount: l.debitAccount, creditAccount: l.creditAccount, amount: l.amount, description: l.description,
    }))).returning();
  });
  return res.json(inserted);
});

// 画面は /journal-entries/export/csv を呼んでいた（サーバーは export-csv だけで、404 になっていた）。両方で受ける。
// 値は引用符で囲み、= + - @ で始まる文字には ' を付ける（表計算ソフトが式として動かさないように）。
const FORMAT_NAMES: Record<string, string> = {
  yayoi: "弥生会計", yayoi_import: "弥生会計インポート", freee: "freee", moneyforward: "マネーフォワード", generic: "汎用",
};
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const ymdSlash = (d: string) => d.replace(/-/g, "/");

router.get(["/journal-entries/export-csv", "/journal-entries/export/csv"], async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);
  const format = FORMAT_NAMES[String(req.query.format)] ? String(req.query.format) : "generic";
  if (!Number.isInteger(year) || !Number.isInteger(month)) return res.status(400).json({ error: "年と月を指定してください。" });

  const rows = await db.select().from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.year, year), eq(journalEntriesTable.month, month)))
    .orderBy(journalEntriesTable.id);

  let table: unknown[][];
  if (format === "yayoi_import") {
    // 弥生会計の「仕訳日記帳」インポートの25項目（見出し行なし・識別フラグ2000＝1行の仕訳）。
    // 取り込む前に、弥生会計側の勘定科目名（預り金の補助科目など）と合っているか確かめること。
    table = rows.map((r) => ["2000", "", "", ymdSlash(r.entryDate), r.debitAccount, "", "", "対象外", r.amount, 0,
      r.creditAccount, "", "", "対象外", r.amount, 0, r.description, "", "", "0", "", "", "0", "0", "no"]);
  } else if (format === "yayoi") {
    table = [["伝票日付", "借方科目", "借方金額", "貸方科目", "貸方金額", "摘要"],
      ...rows.map((r) => [ymdSlash(r.entryDate), r.debitAccount, r.amount, r.creditAccount, r.amount, r.description])];
  } else if (format === "freee") {
    table = [["発生日", "借方勘定科目", "借方金額", "貸方勘定科目", "貸方金額", "摘要"],
      ...rows.map((r) => [r.entryDate, r.debitAccount, r.amount, r.creditAccount, r.amount, r.description])];
  } else if (format === "moneyforward") {
    table = [["日付", "借方科目", "借方補助科目", "借方部門", "借方税区分", "借方金額", "貸方科目", "貸方補助科目", "貸方部門", "貸方税区分", "貸方金額", "摘要"],
      ...rows.map((r) => [r.entryDate, r.debitAccount, "", "", "対象外", r.amount, r.creditAccount, "", "", "対象外", r.amount, r.description])];
  } else {
    table = [["日付", "借方科目", "貸方科目", "金額", "摘要"], ...rows.map((r) => [r.entryDate, r.debitAccount, r.creditAccount, r.amount, r.description])];
  }
  const csvContent = table.map((line) => line.map(csvCell).join(",")).join("\r\n");
  const name = `仕訳_${year}年${month}月_${FORMAT_NAMES[format]}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="journal_${year}${String(month).padStart(2, "0")}_${format}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`);
  return res.send("﻿" + csvContent);
});

export default router;
