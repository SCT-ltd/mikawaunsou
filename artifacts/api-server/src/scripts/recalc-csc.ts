import { db, payrollsTable, employeesTable, companyTable } from "@workspace/db";
import { calculateInsuranceAndTax, EMP_INS_RATE_R8 } from "../lib/tax-tables-reiwa8";
import { eq, and } from "drizzle-orm";

function resolvePensionApplied(emp: typeof employeesTable.$inferSelect, year: number, month: number): boolean {
  if (emp.pensionApplied !== null && emp.pensionApplied !== undefined) return emp.pensionApplied;
  if (!emp.dateOfBirth) return true;
  const dob = new Date(emp.dateOfBirth);
  const calcDate = new Date(year, month - 1, 1);
  let age = calcDate.getFullYear() - dob.getFullYear();
  const monthDiff = calcDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && calcDate.getDate() < dob.getDate())) age--;
  return age < 70;
}

async function main() {
  const [company] = await db.select().from(companyTable).limit(1);
  const empInsRate =
    (company?.employmentInsuranceRate ?? 0) > 0
      ? company!.employmentInsuranceRate!
      : EMP_INS_RATE_R8;

  async function applyDelta(year: number, month: number, computeCsc: (emp: typeof employeesTable.$inferSelect, gross: number) => number, label: string) {
    const rows = await db.select().from(payrollsTable).where(and(eq(payrollsTable.year, year), eq(payrollsTable.month, month)));
    console.log(`\n=== ${label}: ${rows.length} records ===`);
    let updated = 0;
    for (const p of rows) {
      const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, p.employeeId));
      if (!emp) continue;
      const newCsc = computeCsc(emp, Number(p.grossSalary));
      const oldCsc = Number(p.childcareSupportContribution ?? 0);
      const delta = newCsc - oldCsc;
      if (delta === 0) continue;
      const newSocial = Number(p.socialInsurance ?? 0) + delta;
      const newTotal = Number(p.totalDeductions ?? 0) + delta;
      const newNet = Number(p.netSalary ?? 0) - delta;
      await db.update(payrollsTable).set({
        childcareSupportContribution: newCsc,
        socialInsurance: newSocial,
        totalDeductions: newTotal,
        netSalary: newNet,
      }).where(eq(payrollsTable.id, p.id));
      console.log(`  [${p.id}] ${emp.name}: CSC ${oldCsc}→${newCsc} (Δ${delta>=0?"+":""}${delta}), net ${p.netSalary}→${newNet}`);
      updated++;
    }
    console.log(`  → updated ${updated}`);
  }

  // 4月給料 (= 3月分労働) に CSC を反映
  await applyDelta(2026, 4,
    (emp, gross) => {
      if (emp.taxExempt) return 0;
      const insBase = (emp.standardRemuneration ?? 0) > 0 ? emp.standardRemuneration! : gross;
      const ins = calculateInsuranceAndTax({
        standardRemuneration: insBase,
        grossSalary: gross,
        nonTaxableAllowances: 0,
        dependentCount: emp.dependentCount ?? 0,
        hasSpouse: emp.hasSpouse ?? false,
        careInsuranceApplied: emp.careInsuranceApplied ?? false,
        pensionApplied: resolvePensionApplied(emp, 2026, 4),
        employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
        residentTax: emp.residentTax ?? 0,
        customDeductionsTotal: 0,
        employmentInsuranceRate: empInsRate,
      });
      return ins.childcareSupportContribution;
    },
    "2026/4 (April payroll: add CSC)",
  );

  // 3月給料の異常レコード（CSC>0）をクリア
  await applyDelta(2026, 3, () => 0, "2026/3 (March payroll: clear CSC)");

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
