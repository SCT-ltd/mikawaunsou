import {
  db,
  employeesTable,
  payrollsTable,
  allowanceDefinitionsTable,
  employeeAllowancesTable,
  deductionDefinitionsTable,
  employeeDeductionsTable,
  employeeMonthSetsTable,
  employeeMonthAllowancesTable,
  employeeMonthDeductionsTable,
} from "@workspace/db";
import { and, eq, gt, or } from "drizzle-orm";

/**
 * 月ごとの手当・控除（schema/month_items.ts）を読み書きする。
 *
 * 読み方の決まり：
 *   その月の控え（employee_month_sets の行）があれば、その月の行を使う。
 *   無ければ、社員ごとの手当・控除（＝直近の月の内容）を初期値として返す。
 */

export interface MonthAllowance {
  allowanceDefinitionId: number;
  allowanceName: string;
  isTaxable: boolean;
  excludeFromEmploymentInsurance: boolean;
  amount: number;
  sortOrder: number;
}
export interface MonthDeduction {
  deductionDefinitionId: number;
  deductionName: string;
  amount: number;
  sortOrder: number;
}
export interface MonthItems {
  /** その月の控えがあるか（false のときは社員ごとの手当を初期値として返している） */
  exists: boolean;
  /** 日給制の人の、その月の基本給（控えが無い・日給制でない場合は null） */
  baseSalary: number | null;
  allowances: MonthAllowance[];
  deductions: MonthDeduction[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const sameMonth = <T extends { employeeId: unknown; year: unknown; month: unknown }>(t: T, employeeId: number, year: number, month: number) =>
  and(eq(t.employeeId as never, employeeId), eq(t.year as never, year), eq(t.month as never, month));

/** 社員ごとの手当・控除（月を持たない従来の置き場）を、月の行と同じ形にして返す。 */
async function readMaster(ex: Executor, employeeId: number): Promise<Pick<MonthItems, "allowances" | "deductions">> {
  const [aRows, aDefs, dRows, dDefs] = await Promise.all([
    ex.select().from(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, employeeId)).orderBy(employeeAllowancesTable.sortOrder),
    ex.select().from(allowanceDefinitionsTable),
    ex.select().from(employeeDeductionsTable).where(eq(employeeDeductionsTable.employeeId, employeeId)).orderBy(employeeDeductionsTable.sortOrder),
    ex.select().from(deductionDefinitionsTable),
  ]);
  const allowances: MonthAllowance[] = [];
  for (const r of aRows) {
    // 停止した手当は従来の計算でも除外していたので、ここでも入れない
    const def = aDefs.find((d) => d.id === r.allowanceDefinitionId && d.isActive);
    if (!def) continue;
    if (allowances.some((a) => a.allowanceDefinitionId === def.id)) continue;
    allowances.push({
      allowanceDefinitionId: def.id,
      allowanceName: def.name,
      isTaxable: def.isTaxable,
      excludeFromEmploymentInsurance: def.excludeFromEmploymentInsurance ?? false,
      amount: r.amount ?? 0,
      sortOrder: r.sortOrder,
    });
  }
  const deductions: MonthDeduction[] = dRows.map((r) => ({
    deductionDefinitionId: r.deductionDefinitionId,
    // 控除は、停止した定義の分も従来どおり引く（名前だけは出せるよう停止中の定義からも引く）
    deductionName: dDefs.find((d) => d.id === r.deductionDefinitionId)?.name ?? "",
    amount: r.amount ?? 0,
    sortOrder: r.sortOrder,
  }));
  return { allowances, deductions };
}

export async function getMonthItems(employeeId: number, year: number, month: number, ex: Executor = db): Promise<MonthItems> {
  const [set] = await ex.select().from(employeeMonthSetsTable)
    .where(sameMonth(employeeMonthSetsTable, employeeId, year, month));
  if (!set) {
    return { exists: false, baseSalary: null, ...(await readMaster(ex, employeeId)) };
  }
  const [aRows, dRows] = await Promise.all([
    ex.select().from(employeeMonthAllowancesTable)
      .where(sameMonth(employeeMonthAllowancesTable, employeeId, year, month))
      .orderBy(employeeMonthAllowancesTable.sortOrder),
    ex.select().from(employeeMonthDeductionsTable)
      .where(sameMonth(employeeMonthDeductionsTable, employeeId, year, month))
      .orderBy(employeeMonthDeductionsTable.sortOrder),
  ]);
  return {
    exists: true,
    baseSalary: set.baseSalary ?? null,
    allowances: aRows.map((r) => ({
      allowanceDefinitionId: r.allowanceDefinitionId,
      allowanceName: r.allowanceName,
      isTaxable: r.isTaxable,
      excludeFromEmploymentInsurance: r.excludeFromEmploymentInsurance,
      amount: r.amount ?? 0,
      sortOrder: r.sortOrder,
    })),
    deductions: dRows.map((r) => ({
      deductionDefinitionId: r.deductionDefinitionId,
      deductionName: r.deductionName,
      amount: r.amount ?? 0,
      sortOrder: r.sortOrder,
    })),
  };
}

/** その月の給与明細が確定済みか。確定済みの月の手当・控除は変えさせない。 */
export async function isMonthLocked(employeeId: number, year: number, month: number, ex: Executor = db): Promise<boolean> {
  const [p] = await ex.select({ status: payrollsTable.status }).from(payrollsTable)
    .where(and(eq(payrollsTable.employeeId, employeeId), eq(payrollsTable.year, year), eq(payrollsTable.month, month)));
  return p?.status === "confirmed";
}

/** この月より後に、控えのある月があるか。 */
async function hasLaterSet(ex: Executor, employeeId: number, year: number, month: number): Promise<boolean> {
  const rows = await ex.select({ id: employeeMonthSetsTable.id }).from(employeeMonthSetsTable)
    .where(and(
      eq(employeeMonthSetsTable.employeeId, employeeId),
      or(
        gt(employeeMonthSetsTable.year, year),
        and(eq(employeeMonthSetsTable.year, year), gt(employeeMonthSetsTable.month, month)),
      ),
    ))
    .limit(1);
  return rows.length > 0;
}

async function writeMonthRows(
  ex: Executor,
  employeeId: number,
  year: number,
  month: number,
  baseSalary: number | null | undefined,
  allowances: MonthAllowance[],
  deductions: MonthDeduction[],
): Promise<void> {
  const now = new Date();
  const [set] = await ex.select().from(employeeMonthSetsTable)
    .where(sameMonth(employeeMonthSetsTable, employeeId, year, month));
  if (set) {
    await ex.update(employeeMonthSetsTable)
      .set({ ...(baseSalary !== undefined && { baseSalary }), updatedAt: now })
      .where(eq(employeeMonthSetsTable.id, set.id));
  } else {
    await ex.insert(employeeMonthSetsTable).values({ employeeId, year, month, baseSalary: baseSalary ?? null });
  }
  await ex.delete(employeeMonthAllowancesTable).where(sameMonth(employeeMonthAllowancesTable, employeeId, year, month));
  await ex.delete(employeeMonthDeductionsTable).where(sameMonth(employeeMonthDeductionsTable, employeeId, year, month));
  if (allowances.length > 0) {
    await ex.insert(employeeMonthAllowancesTable).values(allowances.map((a, i) => ({
      employeeId, year, month,
      allowanceDefinitionId: a.allowanceDefinitionId,
      allowanceName: a.allowanceName,
      isTaxable: a.isTaxable,
      excludeFromEmploymentInsurance: a.excludeFromEmploymentInsurance,
      amount: a.amount,
      sortOrder: i,
    })));
  }
  if (deductions.length > 0) {
    await ex.insert(employeeMonthDeductionsTable).values(deductions.map((d, i) => ({
      employeeId, year, month,
      deductionDefinitionId: d.deductionDefinitionId,
      deductionName: d.deductionName,
      amount: d.amount,
      sortOrder: i,
    })));
  }
}

export class MonthLockedError extends Error {
  constructor() { super("month locked"); }
}

/**
 * 画面からの保存。その月の手当・控除を丸ごと置き換える（1回のトランザクション）。
 *
 * いちばん新しい月を保存したときは、社員ごとの手当・控除にも同じ内容を写す。
 * まだ控えの無い次の月を開いたとき、そこが初期値になる（毎月変わらない手当を打ち直さずに済む）。
 * 過去の月を直したときは写さない（今月用の内容を過去の月の値で上書きしない）。
 */
export async function saveMonthItems(
  employeeId: number,
  year: number,
  month: number,
  input: {
    allowances: Array<{ allowanceDefinitionId: number; amount: number }>;
    deductions: Array<{ deductionDefinitionId: number; amount: number }>;
    /** 日給制の人の、その月の基本給。undefined は「変えない」。 */
    baseSalary?: number;
  },
): Promise<MonthItems> {
  return db.transaction(async (tx) => {
    if (await isMonthLocked(employeeId, year, month, tx)) throw new MonthLockedError();

    const [emp] = await tx.select({ salaryType: employeesTable.salaryType }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    const [aDefs, dDefs] = await Promise.all([
      tx.select().from(allowanceDefinitionsTable),
      tx.select().from(deductionDefinitionsTable),
    ]);
    const allowances: MonthAllowance[] = [];
    for (const item of input.allowances) {
      const def = aDefs.find((d) => d.id === item.allowanceDefinitionId);
      if (!def) continue;
      allowances.push({
        allowanceDefinitionId: def.id,
        allowanceName: def.name,
        isTaxable: def.isTaxable,
        excludeFromEmploymentInsurance: def.excludeFromEmploymentInsurance ?? false,
        amount: item.amount,
        sortOrder: allowances.length,
      });
    }
    const deductions: MonthDeduction[] = [];
    for (const item of input.deductions) {
      const def = dDefs.find((d) => d.id === item.deductionDefinitionId);
      if (!def) continue;
      deductions.push({ deductionDefinitionId: def.id, deductionName: def.name, amount: item.amount, sortOrder: deductions.length });
    }

    // その月の基本給を持つのは日給制だけ（勤怠から月ごとに決まるため）。
    // 月給はマスターの基本給、時給は 時給×実働時間 を計算のたびに使う。
    const isDaily = emp?.salaryType === "daily";
    const monthBase = isDaily && input.baseSalary !== undefined ? input.baseSalary : undefined;
    await writeMonthRows(tx, employeeId, year, month, monthBase, allowances, deductions);

    if (!(await hasLaterSet(tx, employeeId, year, month))) {
      await tx.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, employeeId));
      if (allowances.length > 0) {
        await tx.insert(employeeAllowancesTable).values(allowances.map((a, i) => ({
          employeeId, allowanceDefinitionId: a.allowanceDefinitionId, amount: a.amount, sortOrder: i,
        })));
      }
      await tx.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.employeeId, employeeId));
      if (deductions.length > 0) {
        await tx.insert(employeeDeductionsTable).values(deductions.map((d, i) => ({
          employeeId, deductionDefinitionId: d.deductionDefinitionId, amount: d.amount, sortOrder: i,
        })));
      }
      // 月給の人の基本給は従来どおりマスターに書く（昇給をこの画面で入れる運用のため）。
      // 日給の人も、次の月の初期表示のために写しておく。時給の人は時給そのものなので触らない。
      if (input.baseSalary !== undefined && emp && emp.salaryType !== "hourly") {
        await tx.update(employeesTable).set({ baseSalary: input.baseSalary, updatedAt: new Date() }).where(eq(employeesTable.id, employeeId));
      }
    }
    return getMonthItems(employeeId, year, month, tx);
  });
}

/**
 * 給与計算のときに使う。その月の控えが無ければ、今の社員ごとの手当・控除から作ってから返す。
 * いちど計算した月は、以後ほかの月の作業で手当が変わっても影響を受けない。
 */
export async function ensureMonthItems(
  emp: { id: number; salaryType: string | null; baseSalary: number | null },
  year: number,
  month: number,
): Promise<MonthItems> {
  const current = await getMonthItems(emp.id, year, month);
  if (current.exists) return current;
  return db.transaction(async (tx) => {
    const again = await getMonthItems(emp.id, year, month, tx);
    if (again.exists) return again;
    const base = emp.salaryType === "daily" ? (emp.baseSalary ?? 0) : null;
    await writeMonthRows(tx, emp.id, year, month, base, again.allowances, again.deductions);
    return getMonthItems(emp.id, year, month, tx);
  });
}
