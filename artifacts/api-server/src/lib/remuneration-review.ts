/**
 * 標準報酬月額の見直しの候補（算定基礎＝定時決定・月額変更＝随時改定）。決めるのは人で、ここは候補を出すだけ。
 *
 * 前提（社労士に確認すること）：
 *   - 明細の年月＝勤務した月、支払いは翌月。報酬は「支払った月」で数える（4〜6月に払った分＝3〜5月分の明細）。
 *   - 標準報酬月額の履歴は「明細の年月」で入れる。定時決定は 9月分の明細から、随時改定は変動した支払月から4か月目の月分から。
 *   - 報酬＝明細の総支給額（通勤手当を含む・賞与は入れない）。
 *   - 支払基礎日数：日給・時給は出勤日数＋土曜・祝日の出勤日数＋有給の日数（日曜は時間を8で割って切り上げ）、
 *     月給は暦日数（欠勤控除がある月は 暦日数 − 欠勤日数）。17日未満の月は除く。
 */
import { db, payrollsTable, monthlyRecordsTable, employeeMonthAllowancesTable, standardRemunerationHistoryTable, employeesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { teijiCandidate, zuijiCandidate, type RemunerationMonth } from "@workspace/tax-tables-reiwa8/core";
import { resolveStandardRemuneration } from "./insurance-settings";

type Emp = typeof employeesTable.$inferSelect;

/** 固定的賃金に入れない手当（勤怠や成績で毎月変わるもの） */
const VARIABLE = /有給|休日出勤|早出残業|深夜|業績|歩合|還付|精励/;

export interface ReviewMonth extends RemunerationMonth {
  year: number;
  month: number;
  fixedWage: number;
}

export interface ReviewCandidate {
  employeeId: number;
  employeeName: string;
  kind: "teiji" | "zuiji";
  /** 標準報酬月額の履歴に入れる「明細の年月」 */
  effectiveYear: number;
  effectiveMonth: number;
  average: number;
  standard: number;
  current: number;
  gradeDiff?: number;
  months: ReviewMonth[];
  /** 同じ年月の履歴がもうある */
  alreadyRegistered: boolean;
}

const addMonths = (y: number, m: number, n: number) => {
  const k = y * 12 + (m - 1) + n;
  return { year: Math.floor(k / 12), month: (k % 12) + 1 };
};

export async function reviewMonths(emps: Emp[]): Promise<Map<number, ReviewMonth[]>> {
  const ids = emps.map((e) => e.id);
  const out = new Map<number, ReviewMonth[]>();
  if (ids.length === 0) return out;
  const [pays, recs, allows] = await Promise.all([
    db.select().from(payrollsTable).where(inArray(payrollsTable.employeeId, ids)),
    db.select().from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, ids)),
    db.select().from(employeeMonthAllowancesTable).where(inArray(employeeMonthAllowancesTable.employeeId, ids)),
  ]);
  for (const e of emps) {
    const list: ReviewMonth[] = [];
    for (const p of pays.filter((x) => x.employeeId === e.id)) {
      const r = recs.find((x) => x.employeeId === e.id && x.year === p.year && x.month === p.month);
      const pay = addMonths(p.year, p.month, 1);
      const calendarDays = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
      const baseDays = e.salaryType === "fixed"
        ? calendarDays - ((p.absenceDeduction ?? 0) > 0 ? (r?.absenceDays ?? 0) : 0)
        : (r ? (r.workDays ?? 0) + (r.saturdayWorkDays ?? 0) + (r.holidayWorkDays ?? 0) + (r.paidLeaveDays ?? 0)
          + ((r.sundayWorkDays ?? 0) > 0 ? r.sundayWorkDays : Math.ceil((r.sundayWorkHours ?? 0) / 8)) : 0);
      const fixedAllow = allows.filter((a) => a.employeeId === e.id && a.year === p.year && a.month === p.month && !VARIABLE.test(a.allowanceName))
        .reduce((s, a) => s + (a.amount ?? 0), 0);
      // 日給の人は「日当」が固定的賃金（基本給÷出勤日数で戻す）、月給は基本給、時給は時給
      const unit = e.salaryType === "daily"
        ? ((r?.workDays ?? 0) > 0 ? Math.round((p.baseSalary ?? 0) / r!.workDays) : 0)
        : e.salaryType === "hourly" ? (e.baseSalary ?? 0) : (p.baseSalary ?? 0);
      list.push({ year: p.year, month: p.month, payYear: pay.year, payMonth: pay.month, amount: p.grossSalary ?? 0, baseDays, fixedWage: unit + fixedAllow });
    }
    out.set(e.id, list.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)));
  }
  return out;
}

export async function reviewCandidates(emps: Emp[], year: number): Promise<ReviewCandidate[]> {
  const months = await reviewMonths(emps);
  const history = await db.select().from(standardRemunerationHistoryTable);
  const out: ReviewCandidate[] = [];
  for (const e of emps) {
    const list = months.get(e.id) ?? [];
    const has = (y: number, m: number) => history.some((h) => h.employeeId === e.id && h.effectiveYear === y && h.effectiveMonth === m);

    // 定時決定：その年の4〜6月に払った分
    const tm = list.filter((x) => x.payYear === year && x.payMonth >= 4 && x.payMonth <= 6);
    if (tm.length > 0) {
      const c = teijiCandidate(tm);
      if (c) {
        const cur = resolveStandardRemuneration(e, history, year, 9).standardRemuneration;
        out.push({ employeeId: e.id, employeeName: e.name, kind: "teiji", effectiveYear: year, effectiveMonth: 9,
          average: c.average, standard: c.standard, current: cur, months: tm, alreadyRegistered: has(year, 9) });
      }
    }

    // 随時改定：固定的賃金が前の月と変わった月から3か月
    for (let k = 1; k + 2 < list.length; k++) {
      const prev = list[k - 1]!, cur = list[k]!;
      if (prev.fixedWage === cur.fixedWage || prev.fixedWage <= 0) continue;
      const three = list.slice(k, k + 3);
      const contiguous = three.every((x, i) => i === 0 || (x.year * 12 + x.month) - (three[i - 1]!.year * 12 + three[i - 1]!.month) === 1);
      if (!contiguous) continue;
      const eff = addMonths(cur.year, cur.month, 4); // 変動した支払月（明細の翌月）から4か月目＝明細の年月では +4
      if (eff.year !== year && eff.year !== year + 1 && eff.year !== year - 1) continue;
      const currentStd = resolveStandardRemuneration(e, history, cur.year, cur.month).standardRemuneration;
      if (currentStd <= 0) continue;
      const z = zuijiCandidate(three, currentStd, cur.fixedWage > prev.fixedWage);
      if (z) {
        out.push({ employeeId: e.id, employeeName: e.name, kind: "zuiji", effectiveYear: eff.year, effectiveMonth: eff.month,
          average: z.average, standard: z.standard, current: currentStd, gradeDiff: z.gradeDiff, months: three, alreadyRegistered: has(eff.year, eff.month) });
      }
    }
  }
  return out;
}
