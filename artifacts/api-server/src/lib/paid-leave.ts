/**
 * 有給休暇の管理簿（労基法39条・労基則24条の7）。式は payroll-core.ts の paidLeaveGrants / paidLeaveLedger。
 *
 * 取得日数の出どころ：
 *   - 月次実績の「有給」日数（給与の有給手当と同じ数）を月ごとの合計として使う。
 *   - 欠勤の記録（absence_records）に有給の日付があれば、その日付で数える（半日の有給は 0.5）。
 *     月の合計のうち日付の分からない残りは、その月の末日に取ったものとして数える。
 */
import { db, employeesTable, monthlyRecordsTable, absenceRecordsTable, paidLeaveAdjustmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { paidLeaveGrants, paidLeaveLedger, ymd, type LeaveEvent, type LeaveLedger } from "@workspace/tax-tables-reiwa8/core";

type Emp = typeof employeesTable.$inferSelect;

/** 欠勤の種類のうち有給として数えるもの（日数）。半日の有給はドライバー側の改修で 0.5 日として入る。 */
export function paidLeaveDaysOfAbsence(type: string): number {
  if (type === "paid_leave") return 1;
  if (/paid/.test(type) && /half/.test(type)) return 0.5;
  return 0;
}

export function jstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export interface EmployeeLeave {
  employeeId: number;
  employeeName: string;
  hireDate: string;
  ledger: LeaveLedger;
  taken: LeaveEvent[];
}

export async function paidLeaveFor(emps: Emp[], today = jstTodayIso()): Promise<EmployeeLeave[]> {
  const ids = emps.map((e) => e.id);
  if (ids.length === 0) return [];
  const [recs, abs, adj] = await Promise.all([
    db.select({ employeeId: monthlyRecordsTable.employeeId, year: monthlyRecordsTable.year, month: monthlyRecordsTable.month, days: monthlyRecordsTable.paidLeaveDays })
      .from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, ids)),
    db.select().from(absenceRecordsTable).where(inArray(absenceRecordsTable.employeeId, ids)),
    db.select().from(paidLeaveAdjustmentsTable).where(inArray(paidLeaveAdjustmentsTable.employeeId, ids)),
  ]);
  return emps.map((e) => {
    const taken: LeaveEvent[] = [];
    for (const r of recs.filter((x) => x.employeeId === e.id && (x.days ?? 0) > 0)) {
      const prefix = `${r.year}-${String(r.month).padStart(2, "0")}`;
      const dated = abs.filter((a) => a.employeeId === e.id && String(a.workDate).startsWith(prefix))
        .map((a) => ({ date: String(a.workDate).slice(0, 10), days: paidLeaveDaysOfAbsence(a.absenceType) }))
        .filter((a) => a.days > 0);
      const datedSum = dated.reduce((s, a) => s + a.days, 0);
      const use = datedSum <= (r.days ?? 0) ? dated : [];
      taken.push(...use);
      const rest = (r.days ?? 0) - (use.length ? datedSum : 0);
      if (rest > 0) taken.push({ date: ymd(r.year, r.month, 31), days: rest });
    }
    const grants = paidLeaveGrants(String(e.hireDate), today, e.weeklyScheduledDays, e.weeklyScheduledHours);
    const adjustments = adj.filter((a) => a.employeeId === e.id).map((a) => ({ date: String(a.date).slice(0, 10), days: a.days }));
    return {
      employeeId: e.id,
      employeeName: e.name,
      hireDate: String(e.hireDate),
      ledger: paidLeaveLedger(grants, taken, adjustments, today),
      taken: taken.sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
}

export async function activeEmployees(): Promise<Emp[]> {
  return db.select().from(employeesTable).where(eq(employeesTable.isActive, true));
}
