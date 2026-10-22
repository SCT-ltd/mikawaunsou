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
  monthlyRecordsTable,
  companyTable,
} from "@workspace/db";
import { and, eq, gt, or } from "drizzle-orm";
import { lateNightRateFor } from "./payroll-calculator";

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

// ────────────────────────────────────────────────────────────────
// 勤怠から金額が決まる手当（有給・休日出勤・早出残業・深夜）と、日給制の基本給
//
// これらは「月次実績入力」の手当・控除の画面（ブラウザ）だけが計算していた。そのため、
// その画面を開かずに計算した社員（まとめて保存・給与明細の一括計算）は、前の月の金額の
// まま明細が作られていた。同じ式をここに置き、計算のたびに勤怠から入れ直す。
// 式は components/monthly-input/allowance-panel.tsx と同じにしておくこと。
// ────────────────────────────────────────────────────────────────

export interface AttendanceForAuto {
  workDays: number | null;
  saturdayWorkDays: number | null;
  sundayWorkHours: number | null;
  /** 祝日の出勤日数（土曜と同じ日当＝1.25倍） */
  holidayWorkDays?: number | null;
  paidLeaveDays: number | null;
  overtimeHours: number | null;
  lateNightHours: number | null;
}
export interface EmployeeForAuto {
  id: number;
  salaryType: string | null;
  baseSalary: number | null;
  dailyRateWeekday?: number | null;
  dailyRateSaturday?: number | null;
  overtimeHourlyRate?: number | null;
  lateNightHourlyRate?: number | null;
}
export interface CompanyForAuto {
  dailyWageWeekday?: number | null;
  dailyWageSaturday?: number | null;
  hourlyWageSunday?: number | null;
}
/** base＝日給制の基本給（日給制でなければ null）。a＝手当ID→金額。 */
export interface AutoValues {
  base: number | null;
  a: Record<string, number>;
}

export function deriveAutoValues(
  emp: EmployeeForAuto,
  rec: AttendanceForAuto,
  company: CompanyForAuto,
  /** 有効な手当の定義（並び順どおり） */
  activeDefs: Array<{ id: number; name: string }>,
): AutoValues {
  const rateWeekday = (emp.dailyRateWeekday ?? 0) > 0 ? emp.dailyRateWeekday! : (company.dailyWageWeekday ?? 9808);
  const rateSaturday = (emp.dailyRateSaturday ?? 0) > 0 ? emp.dailyRateSaturday! : (company.dailyWageSaturday ?? 12260);
  const rateSundayHour = company.hourlyWageSunday ?? 1655;
  const overtimeRate = emp.overtimeHourlyRate ?? 0;
  const personalNightRate = emp.lateNightHourlyRate ?? 0;
  const workDays = rec.workDays ?? 0;
  const saturdayDays = rec.saturdayWorkDays ?? 0;
  const sundayHours = rec.sundayWorkHours ?? 0;
  const holidayDays = rec.holidayWorkDays ?? 0;
  const paidLeaveDays = rec.paidLeaveDays ?? 0;
  const overtimeHours = rec.overtimeHours ?? 0;
  const lateNightHours = rec.lateNightHours ?? 0;

  const a: Record<string, number> = {};
  const put = (keyword: string, amount: number) => {
    const def = activeDefs.find((d) => d.name.includes(keyword));
    if (def) a[String(def.id)] = amount;
  };
  put("有給", Math.round(rateWeekday * paidLeaveDays));
  // 日曜だけ1.35倍（日曜時給）、土曜と祝日は1.25倍（土曜日当）
  put("休日出勤手当", Math.round((saturdayDays + holidayDays) * rateSaturday + sundayHours * rateSundayHour));
  // 残業時給が未設定の社員は入れ直さない（手で入れた金額を0円で消さないため）
  if (overtimeRate > 0) {
    const OT_THRESHOLD = 60;
    put("早出残業手当", overtimeHours <= OT_THRESHOLD
      ? Math.round(overtimeRate * overtimeHours)
      : Math.round(overtimeRate * OT_THRESHOLD) + Math.round(overtimeRate * 1.20 * (overtimeHours - OT_THRESHOLD)));
  }
  if (overtimeRate > 0 || personalNightRate > 0) {
    put("深夜手当", Math.round(lateNightRateFor(personalNightRate, overtimeRate) * lateNightHours));
  }
  return { base: emp.salaryType === "daily" ? Math.round(workDays * rateWeekday) : null, a };
}

/** 勤怠がまだ無いときに保存された月の印。勤怠が入ったら、作りたてと同じに全部入れ直す。 */
const AUTO_PENDING = JSON.stringify({ pending: true });

function parseAuto(raw: string | null | undefined): AutoValues | "pending" | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { pending?: boolean; base?: unknown; a?: unknown };
    if (v.pending) return "pending";
    if (v.a && typeof v.a === "object") return { base: typeof v.base === "number" ? v.base : null, a: v.a as Record<string, number> };
  } catch { /* 壊れた値は「控えなし」として扱う */ }
  return null;
}

async function activeAllowanceDefs(ex: Executor) {
  const defs = await ex.select().from(allowanceDefinitionsTable)
    .orderBy(allowanceDefinitionsTable.sortOrder, allowanceDefinitionsTable.id);
  return defs.filter((d) => d.isActive);
}

/**
 * 給与計算（手入力固定）の直前に呼ぶ。その月の手当・控除を返す。
 *
 *   - その月の控えが無い：直近の月の内容を元に作る。勤怠で決まる手当と日給の基本給は、
 *     この月の勤怠から計算した金額にする（前の月の金額を持ち越さない）。
 *   - 控えがある：勤怠が変わっていたら、手で直していない行だけを入れ直す。
 *     「手で直していない」＝今の金額が、前回勤怠から出した金額（auto_values）と同じ。
 *     手で直した金額は変えない。
 *   - 控えはあるが auto_values が無い（この仕組みの前に作られた月）：金額には触らず、
 *     今の勤怠から出した金額を控えるだけにする。
 */
export async function syncMonthItemsWithAttendance(
  emp: EmployeeForAuto,
  rec: AttendanceForAuto,
  company: CompanyForAuto,
  year: number,
  month: number,
): Promise<MonthItems> {
  return db.transaction(async (tx) => {
    const defs = await activeAllowanceDefs(tx);
    const auto = deriveAutoValues(emp, rec, company, defs);
    const autoJson = JSON.stringify(auto);
    const [set] = await tx.select().from(employeeMonthSetsTable)
      .where(sameMonth(employeeMonthSetsTable, emp.id, year, month));
    const current = await getMonthItems(emp.id, year, month, tx);
    const prev = set ? parseAuto(set.autoValues) : "pending";

    if (set && prev === null) {
      await tx.update(employeeMonthSetsTable).set({ autoValues: autoJson }).where(eq(employeeMonthSetsTable.id, set.id));
      return current;
    }

    const applyAll = prev === "pending";
    const allowances = current.allowances.map((x) => ({ ...x }));
    let changed = !set;
    for (const [key, amount] of Object.entries(auto.a)) {
      const defId = Number(key);
      const idx = allowances.findIndex((x) => x.allowanceDefinitionId === defId);
      const cur = idx >= 0 ? allowances[idx].amount : 0;
      if (!applyAll) {
        const before = (prev as AutoValues).a[key];
        if (before === undefined || cur !== before) continue; // 手で直した行・前回の控えが無い行は変えない
      }
      if (cur === amount) continue;
      changed = true;
      if (idx >= 0) {
        if (amount > 0) allowances[idx].amount = amount;
        else allowances.splice(idx, 1);
      } else if (amount > 0) {
        const def = defs.find((d) => d.id === defId)!;
        allowances.push({
          allowanceDefinitionId: def.id,
          allowanceName: def.name,
          isTaxable: def.isTaxable,
          excludeFromEmploymentInsurance: def.excludeFromEmploymentInsurance ?? false,
          amount,
          sortOrder: allowances.length,
        });
      }
    }

    let base: number | null | undefined = undefined; // undefined＝変えない
    if (!set) {
      base = auto.base;
    } else if (auto.base !== null) {
      const untouched = applyAll || (prev as AutoValues).base === current.baseSalary;
      if (untouched && current.baseSalary !== auto.base) { base = auto.base; changed = true; }
    }

    if (changed) await writeMonthRows(tx, emp.id, year, month, base, allowances, current.deductions);
    await tx.update(employeeMonthSetsTable).set({ autoValues: autoJson })
      .where(sameMonth(employeeMonthSetsTable, emp.id, year, month));
    return getMonthItems(emp.id, year, month, tx);
  });
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

    const [emp] = await tx.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
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

    // いまの勤怠から出した金額を控える（次の計算で「手で直した行かどうか」を見分けるため）。
    // 勤怠がまだ無い月は、勤怠が入ったときに全部入れ直す印を付ける。
    const [rec] = await tx.select().from(monthlyRecordsTable)
      .where(and(eq(monthlyRecordsTable.employeeId, employeeId), eq(monthlyRecordsTable.year, year), eq(monthlyRecordsTable.month, month)));
    let autoValues = AUTO_PENDING;
    if (rec && emp) {
      const [company] = await tx.select().from(companyTable).limit(1);
      autoValues = JSON.stringify(deriveAutoValues(emp, rec, company ?? {}, await activeAllowanceDefs(tx)));
    }
    await tx.update(employeeMonthSetsTable).set({ autoValues })
      .where(sameMonth(employeeMonthSetsTable, employeeId, year, month));

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
