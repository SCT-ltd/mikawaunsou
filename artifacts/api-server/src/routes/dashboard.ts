import { Router } from "express";
import { db, payrollsTable, employeesTable, monthlyRecordsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

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

export default router;
