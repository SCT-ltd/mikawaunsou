import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable } from "@workspace/db";
import { getMonthItems } from "../lib/month-items";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return res.status(400).json({ error: "year と month のクエリパラメータが必要です（例: ?year=2026&month=3）" });
  }

  const [empCount] = await db.select({ count: sql<number>`count(*)::int` }).from(employeesTable).where(eq(employeesTable.isActive, true));
  const totalEmployees = empCount?.count ?? 0;

  const payrolls = await db.select().from(payrollsTable)
    .where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)));

  const confirmedCount = payrolls.filter(p => p.status === "confirmed").length;
  const pendingCount = totalEmployees - payrolls.filter(p => p.status === "confirmed").length;

  const totals = payrolls.reduce((acc, p) => {
    acc.totalGrossSalary += p.grossSalary;
    acc.totalNetSalary += p.netSalary;
    acc.totalIncomeTax += p.incomeTax;
    acc.totalSocialInsurance += p.socialInsurance;
    acc.totalResidentTax += p.residentTax;
    return acc;
  }, { totalGrossSalary: 0, totalNetSalary: 0, totalIncomeTax: 0, totalSocialInsurance: 0, totalResidentTax: 0 });

  const averageNetSalary = payrolls.length > 0 ? totals.totalNetSalary / payrolls.length : 0;

  return res.json({
    year,
    month,
    totalEmployees,
    confirmedCount,
    pendingCount,
    ...totals,
    averageNetSalary,
  });
});

router.get("/dashboard/monthly-trend", async (req, res) => {
  const today = new Date();
  const results = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;

    const payrolls = await db.select().from(payrollsTable)
      .where(and(eq(payrollsTable.year, y), eq(payrollsTable.month, m)));

    const totalGrossSalary = payrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalNetSalary = payrolls.reduce((s, p) => s + p.netSalary, 0);

    const [empCount] = await db.select({ count: sql<number>`count(*)::int` }).from(employeesTable).where(eq(employeesTable.isActive, true));

    results.push({
      year: y,
      month: m,
      label: `${y}年${m}月`,
      totalGrossSalary,
      totalNetSalary,
      employeeCount: payrolls.length > 0 ? payrolls.length : (empCount?.count ?? 0),
    });
  }

  return res.json(results);
});

router.get("/dashboard/pending-employees", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return res.status(400).json({ error: "year と month のクエリパラメータが必要です（例: ?year=2026&month=3）" });
  }

  const employees = await db.select().from(employeesTable).where(eq(employeesTable.isActive, true));
  const records = await db.select().from(monthlyRecordsTable)
    .where(and(eq(monthlyRecordsTable.year, year), eq(monthlyRecordsTable.month, month)));
  const payrolls = await db.select().from(payrollsTable)
    .where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)));

  const result = employees.map(emp => {
    const record = records.find(r => r.employeeId === emp.id);
    const payroll = payrolls.find(p => p.employeeId === emp.id);
    return {
      id: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: emp.department,
      hasMonthlyRecord: !!record,
      hasPayroll: !!payroll,
      payrollStatus: payroll?.status ?? null,
    };
  });

  return res.json(result);
});

/**
 * 振替伝票の形の集計（ダッシュボード）。その月の給与明細を、勘定科目ごとの合計にまとめる。
 *   借方＝払うもの（給料手当・雑給・交通費・携帯代）／貸方＝差し引いたものと手取り（法定福利費・預り金・貸付金・未払費用）
 *   どちらの合計も総支給額になる（差引支給額＋控除合計＝総支給額）。
 * 科目の振り分けは事務所の手書きの伝票に合わせた（時給の人＝雑給、交通費＝旅費交通費、携帯代＝通信費、
 * 社会保険と雇用保険の本人負担＝法定福利費、貸付金の返済＝短期貸付金）。振込手数料・立替金など明細に無いものは入らない。
 */
router.get("/dashboard/transfer-slip", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);
  if (Number.isNaN(year) || Number.isNaN(month)) return res.status(400).json({ error: "year と month が必要です" });

  const rows = await db.select({ p: payrollsTable, salaryType: employeesTable.salaryType })
    .from(payrollsTable).innerJoin(employeesTable, eq(payrollsTable.employeeId, employeesTable.id))
    .where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)));
  // 手当・控除の内訳。その月の控えが無い古い月は社員ごとの手当（今の内容）になるので、
  // 合計がその明細と合うときだけ使う（合わない人の分は「給料手当」「その他の控除」にまとめる）
  const allow: { employeeId: number; allowanceName: string; amount: number }[] = [];
  const deduct: { employeeId: number; deductionName: string; amount: number }[] = [];
  for (const r of rows) {
    const it = await getMonthItems(r.p.employeeId, year, month);
    const aSum = it.allowances.reduce((t, x) => t + x.amount, 0);
    const dSum = it.deductions.reduce((t, x) => t + x.amount, 0);
    if (Math.abs(aSum - (r.p.customAllowancesTotal ?? 0)) < 1) for (const x of it.allowances) allow.push({ employeeId: r.p.employeeId, allowanceName: x.allowanceName, amount: x.amount });
    if (Math.abs(dSum - (r.p.customDeductionsTotal ?? 0)) < 1) for (const x of it.deductions) deduct.push({ employeeId: r.p.employeeId, deductionName: x.deductionName, amount: x.amount });
  }

  const yen = (n: number) => Math.round(n);
  type Line = { account: string; summary: string; amount: number; people?: number; detail?: { label: string; amount: number }[] };

  // ── 借方（払うもの）
  const allowAccount = (name: string) => /交通/.test(name) ? "旅費交通費" : /携帯|通信|電話/.test(name) ? "通信費" : null;
  const special = new Map<string, { amount: number; people: Set<number>; names: Map<string, number> }>();
  const specialOf = new Map<number, number>(); // 社員ごとの「給料以外の科目」の合計
  for (const a of allow) {
    const acc = allowAccount(a.allowanceName);
    if (!acc || !a.amount) continue;
    const g = special.get(acc) ?? { amount: 0, people: new Set(), names: new Map() };
    g.amount += a.amount; g.people.add(a.employeeId); g.names.set(a.allowanceName, (g.names.get(a.allowanceName) ?? 0) + a.amount);
    special.set(acc, g);
    specialOf.set(a.employeeId, (specialOf.get(a.employeeId) ?? 0) + a.amount);
  }
  let salary = 0, salaryPeople = 0, misc = 0, miscPeople = 0;
  for (const r of rows) {
    const base = r.p.grossSalary - (specialOf.get(r.p.employeeId) ?? 0);
    if (r.salaryType === "hourly") { misc += base; miscPeople++; } else { salary += base; salaryPeople++; }
  }
  const debit: Line[] = [];
  if (salaryPeople) debit.push({ account: "給料手当", summary: "給料", amount: yen(salary), people: salaryPeople });
  if (miscPeople) debit.push({ account: "雑給", summary: "アルバイト（時給の人）", amount: yen(misc), people: miscPeople });
  for (const acc of ["旅費交通費", "通信費"]) {
    const g = special.get(acc); if (!g) continue;
    debit.push({ account: acc, summary: [...g.names.keys()].join("・"), amount: yen(g.amount), people: g.people.size });
  }

  // ── 貸方（差し引いたもの・手取り）
  const sum = (f: (p: typeof rows[number]["p"]) => number) => rows.reduce((t, r) => t + (f(r.p) || 0), 0);
  const childcare = sum((p) => p.childcareSupportContribution);
  const pension = sum((p) => p.pensionAmount ?? 0);
  const social = sum((p) => p.socialInsurance);
  const health = social - childcare - pension; // 健康保険（介護を含む）
  const empIns = sum((p) => p.employmentInsurance);
  const credit: Line[] = [];
  credit.push({ account: "未払費用", summary: "差引支給額（手取り）", amount: yen(sum((p) => p.netSalary)), people: rows.length });
  // 健康保険と厚生年金を分けて残していない古い明細がある月は、まとめて出す
  const split = rows.every((r) => r.p.pensionAmount != null);
  const welfare = [
    ...(split ? [{ label: "健康保険（介護を含む）", amount: yen(health) }, { label: "厚生年金", amount: yen(pension) }]
      : [{ label: "健康保険・厚生年金", amount: yen(social - childcare) }]),
    { label: "子ども・子育て支援金", amount: yen(childcare) },
    { label: "雇用保険", amount: yen(empIns) },
  ].filter((d) => d.amount);
  credit.push({ account: "法定福利費", summary: "社会保険・雇用保険（本人負担）", amount: welfare.reduce((t, d) => t + d.amount, 0), detail: welfare });
  credit.push({ account: "預り金", summary: "所得税", amount: yen(sum((p) => p.incomeTax)) });
  credit.push({ account: "預り金", summary: "住民税", amount: yen(sum((p) => p.residentTax)) });
  const other = new Map<string, { account: string; amount: number; people: Set<number> }>();
  for (const d of deduct) {
    if (!d.amount) continue;
    // 差引マスターで入れた保険料（「雇用保険料」など）は、自動計算の分と混ぜずに別の行で出す
    const account = /保険/.test(d.deductionName) ? "法定福利費" : /貸付/.test(d.deductionName) ? "短期貸付金" : /立替/.test(d.deductionName) ? "立替金" : "預り金";
    const g = other.get(d.deductionName) ?? { account, amount: 0, people: new Set() };
    g.amount += d.amount; g.people.add(d.employeeId); other.set(d.deductionName, g);
  }
  for (const [name, g] of other) credit.push({ account: g.account, summary: g.account === "法定福利費" ? `${name}（差引マスター）` : name, amount: yen(g.amount), people: g.people.size });
  // 明細の控除合計と、ここで数えた控除が合わない分（手で入れた控除など）
  const counted = credit.slice(1).reduce((t, l) => t + l.amount, 0);
  const gap = yen(sum((p) => p.totalDeductions)) - counted;
  if (gap) credit.push({ account: "預り金", summary: "その他の控除", amount: gap });

  const debitTotal = debit.reduce((t, l) => t + l.amount, 0);
  const creditTotal = credit.reduce((t, l) => t + l.amount, 0);
  return res.json({
    year, month, people: rows.length,
    confirmed: rows.filter((r) => r.p.status === "confirmed").length,
    debit: debit.filter((l) => l.amount), credit: credit.filter((l) => l.amount),
    debitTotal, creditTotal,
  });
});

export default router;
