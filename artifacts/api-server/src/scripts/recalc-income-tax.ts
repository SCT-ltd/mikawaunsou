import { db, payrollsTable, employeesTable, allowanceDefinitionsTable, employeeAllowancesTable } from "@workspace/db";
import { calculateIncomeTaxReiwa8 } from "../lib/tax-tables-reiwa8";
import { eq, and, or } from "drizzle-orm";

async function main() {
  // 2026/4 と 2026/5 で CSC>0 のレコードを対象とする
  const rows = await db.select().from(payrollsTable).where(and(
    eq(payrollsTable.year, 2026),
    or(eq(payrollsTable.month, 4), eq(payrollsTable.month, 5)),
  ));
  console.log(`Total candidates: ${rows.length}`);

  let updated = 0;
  for (const p of rows) {
    const csc = Number(p.childcareSupportContribution ?? 0);
    if (csc === 0) continue;

    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, p.employeeId));
    if (!emp) continue;
    if (emp.taxExempt) continue;

    const allowanceRows = await db.select({
      amount: employeeAllowancesTable.amount,
      isTaxable: allowanceDefinitionsTable.isTaxable,
    })
      .from(employeeAllowancesTable)
      .innerJoin(allowanceDefinitionsTable, eq(allowanceDefinitionsTable.id, employeeAllowancesTable.allowanceDefinitionId))
      .where(eq(employeeAllowancesTable.employeeId, emp.id));
    const customNonTaxable = allowanceRows.filter(a => !a.isTaxable).reduce((s, a) => s + Number(a.amount), 0);
    const nonTaxable = (emp.transportationAllowance ?? 0) + customNonTaxable;

    const gross = Number(p.grossSalary);
    const social = Number(p.socialInsurance ?? 0);  // = HI + CSC + pension
    const ei = Number(p.employmentInsurance ?? 0);
    const dep = (emp.dependentCount ?? 0) + ((emp.hasSpouse ?? false) ? 1 : 0);

    const newAfterIns = Math.max(0, gross - nonTaxable - social - ei);
    const newIncomeTax = calculateIncomeTaxReiwa8(newAfterIns, dep);
    const oldIncomeTax = Number(p.incomeTax ?? 0);
    const delta = newIncomeTax - oldIncomeTax;
    if (delta === 0) continue;

    const newTotalDed = Number(p.totalDeductions ?? 0) + delta;
    const newNet = Number(p.netSalary ?? 0) - delta;

    await db.update(payrollsTable).set({
      incomeTax: newIncomeTax,
      totalDeductions: newTotalDed,
      netSalary: newNet,
    }).where(eq(payrollsTable.id, p.id));

    console.log(`  [${p.id}] ${emp.name} ${p.year}/${p.month}: incomeTax ${oldIncomeTax}→${newIncomeTax} (Δ${delta}), net ${p.netSalary}→${newNet}`);
    updated++;
  }
  console.log(`\n→ updated ${updated}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
