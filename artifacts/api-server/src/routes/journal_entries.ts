import { Router } from "express";
import { db, journalEntriesTable, payrollsTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/journal-entries", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);
  const rows = await db.select().from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.year, year), eq(journalEntriesTable.month, month)));
  return res.json(rows);
});

router.post("/journal-entries/generate", async (req, res) => {
  const { year, month } = req.body;

  // Get all confirmed payrolls for the month
  const payrolls = await db.select({
    payroll: payrollsTable,
    employee: employeesTable,
  })
    .from(payrollsTable)
    .innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(and(
      eq(payrollsTable.year, year),
      eq(payrollsTable.month, month),
      eq(payrollsTable.status, "confirmed")
    ));

  if (payrolls.length === 0) {
    return res.json([]);
  }

  // Delete existing entries for this month
  await db.delete(journalEntriesTable)
    .where(and(eq(journalEntriesTable.year, year), eq(journalEntriesTable.month, month)));

  const lastDayOfMonth = new Date(year, month, 0);
  const entryDate = lastDayOfMonth.toISOString().split("T")[0];

  // Aggregate totals
  const totals = payrolls.reduce((acc, r) => {
    const p = r.payroll;
    acc.grossSalary += p.grossSalary;
    acc.socialInsurance += p.socialInsurance;
    acc.employmentInsurance += p.employmentInsurance;
    acc.incomeTax += p.incomeTax;
    acc.residentTax += p.residentTax;
    acc.netSalary += p.netSalary;
    return acc;
  }, { grossSalary: 0, socialInsurance: 0, employmentInsurance: 0, incomeTax: 0, residentTax: 0, netSalary: 0 });

  const round = (n: number) => Math.round(n);
  const label = `${year}年${month}月分給与`;

  const entries: Array<{ year: number; month: number; entryDate: string; debitAccount: string; creditAccount: string; amount: number; description: string }> = [];

  // 給与支払総額の計上
  entries.push({
    year, month, entryDate,
    debitAccount: "給料手当",
    creditAccount: "未払給与",
    amount: round(totals.grossSalary),
    description: `${label} 給与支給総額`,
  });

  // 社会保険料（会社負担分）
  entries.push({
    year, month, entryDate,
    debitAccount: "法定福利費",
    creditAccount: "預り金（社会保険料）",
    amount: round(totals.socialInsurance),
    description: `${label} 社会保険料（従業員負担）`,
  });

  // 雇用保険料
  entries.push({
    year, month, entryDate,
    debitAccount: "法定福利費",
    creditAccount: "預り金（雇用保険料）",
    amount: round(totals.employmentInsurance),
    description: `${label} 雇用保険料（従業員負担）`,
  });

  // 源泉所得税
  entries.push({
    year, month, entryDate,
    debitAccount: "給料手当",
    creditAccount: "預り金（源泉所得税）",
    amount: round(totals.incomeTax),
    description: `${label} 源泉所得税`,
  });

  // 住民税
  entries.push({
    year, month, entryDate,
    debitAccount: "給料手当",
    creditAccount: "預り金（住民税）",
    amount: round(totals.residentTax),
    description: `${label} 住民税`,
  });

  // 差引支給額（口座振込）
  entries.push({
    year, month, entryDate,
    debitAccount: "未払給与",
    creditAccount: "普通預金",
    amount: round(totals.netSalary),
    description: `${label} 銀行振込`,
  });

  const inserted = await db.insert(journalEntriesTable).values(entries).returning();
  return res.json(inserted);
});

router.get("/journal-entries/export-csv", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);
  const format = (req.query.format as string) ?? "generic";

  const rows = await db.select().from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.year, year), eq(journalEntriesTable.month, month)));

  let csvContent = "";

  if (format === "yayoi") {
    const header = "伝票日付,借方科目,借方金額,貸方科目,貸方金額,摘要";
    const lines = rows.map(r =>
      [r.entryDate, r.debitAccount, r.amount, r.creditAccount, r.amount, r.description].join(",")
    );
    csvContent = [header, ...lines].join("\n");
  } else if (format === "freee") {
    const header = "発生日,借方勘定科目,借方金額,貸方勘定科目,貸方金額,摘要";
    const lines = rows.map(r =>
      [r.entryDate, r.debitAccount, r.amount, r.creditAccount, r.amount, r.description].join(",")
    );
    csvContent = [header, ...lines].join("\n");
  } else if (format === "moneyforward") {
    const header = "日付,借方科目,借方補助科目,借方部門,借方税区分,借方金額,貸方科目,貸方補助科目,貸方部門,貸方税区分,貸方金額,摘要";
    const lines = rows.map(r =>
      [r.entryDate, r.debitAccount, "", "", "対象外", r.amount, r.creditAccount, "", "", "対象外", r.amount, r.description].join(",")
    );
    csvContent = [header, ...lines].join("\n");
  } else {
    const header = "日付,借方科目,貸方科目,金額,摘要";
    const lines = rows.map(r =>
      [r.entryDate, r.debitAccount, r.creditAccount, r.amount, r.description].join(",")
    );
    csvContent = [header, ...lines].join("\n");
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="journal_${year}${String(month).padStart(2, "0")}_${format}.csv"`);
  return res.send("\uFEFF" + csvContent);
});

export default router;
