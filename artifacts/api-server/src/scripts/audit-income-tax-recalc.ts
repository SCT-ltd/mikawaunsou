import { db, payrollsTable, employeesTable, allowanceDefinitionsTable, employeeAllowancesTable } from "@workspace/db";
import { calculateIncomeTaxReiwa8 } from "../lib/tax-tables-reiwa8";
import { eq, and, or, inArray } from "drizzle-orm";

const TARGET_IDS = [8, 6, 23, 26, 27, 29, 25, 35];
const PRIOR_TAX: Record<number, number> = { 8: 36030, 6: 8180, 23: 16630, 26: 1300, 27: 8500, 29: 1400, 25: 1300, 35: 14430 };

async function main() {
  const rows = await db.select().from(payrollsTable).where(inArray(payrollsTable.id, TARGET_IDS));
  console.log("ID  | Emp | Y/M  | gross   | nonTax | social | EI    | dep | OLD-formula→tax | stored_old | match? | NEW-formula→tax | currentDB | action");
  console.log("----|-----|------|---------|--------|--------|-------|-----|-----------------|------------|--------|-----------------|-----------|-------");

  const rollbacks: { id: number; tax: number; td: number; net: number }[] = [];
  const keeps: number[] = [];

  for (const p of rows) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, p.employeeId));
    if (!emp) continue;
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
    const social = Number(p.socialInsurance ?? 0);
    const csc = Number(p.childcareSupportContribution ?? 0);
    const ei = Number(p.employmentInsurance ?? 0);
    const dep = (emp.dependentCount ?? 0) + ((emp.hasSpouse ?? false) ? 1 : 0);

    const oldFormulaAfterIns = Math.max(0, gross - nonTaxable - (social - csc) - ei);
    const oldFormulaTax = calculateIncomeTaxReiwa8(oldFormulaAfterIns, dep);
    const storedOld = PRIOR_TAX[p.id];
    const match = oldFormulaTax === storedOld ? "YES" : "NO ";

    const newFormulaAfterIns = Math.max(0, gross - nonTaxable - social - ei);
    const newFormulaTax = calculateIncomeTaxReiwa8(newFormulaAfterIns, dep);
    const currentDb = Number(p.incomeTax);

    const action = match === "YES" ? "KEEP " : "ROLLBACK";
    if (action === "ROLLBACK") {
      const delta = currentDb - storedOld;
      rollbacks.push({
        id: p.id,
        tax: storedOld,
        td: Number(p.totalDeductions) - delta,
        net: Number(p.netSalary) + delta,
      });
    } else {
      keeps.push(p.id);
    }

    console.log(`${String(p.id).padStart(3)} | ${String(emp.id).padStart(3)} | ${p.year}/${String(p.month).padStart(2)} | ${String(gross).padStart(7)} | ${String(nonTaxable).padStart(6)} | ${String(social).padStart(6)} | ${String(ei).padStart(5)} | ${dep}   | ${String(oldFormulaTax).padStart(15)} | ${String(storedOld).padStart(10)} | ${match}    | ${String(newFormulaTax).padStart(15)} | ${String(currentDb).padStart(9)} | ${action}`);
  }

  console.log(`\nKeeps: ${keeps.length} (${keeps.join(",")})`);
  console.log(`Rollbacks: ${rollbacks.length}`);

  for (const r of rollbacks) {
    await db.update(payrollsTable).set({
      incomeTax: r.tax,
      totalDeductions: r.td,
      netSalary: r.net,
    }).where(eq(payrollsTable.id, r.id));
    console.log(`  rolled back id=${r.id} → tax=${r.tax}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
