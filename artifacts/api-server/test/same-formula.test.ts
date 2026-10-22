/**
 * 画面（手当パネル・概算）の式とサーバーの式が同じ答えを出すか（pnpm run test）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateInsuranceAndTax } from "../src/lib/tax-tables-reiwa8";
import { calculateBluewingPayroll } from "../src/lib/payroll-calculator";
import { panelDeductions, panelAutoRows } from "../../payroll-app/src/lib/payroll-shared";
import { computeBWCalc } from "../../payroll-app/src/components/monthly-input/estimate";
import { deriveAutoValues } from "@workspace/tax-tables-reiwa8/core";

const RATES = { healthEmployeeRate: 0.04925, healthWithCareEmployeeRate: 0.05735, childcareEmployeeRate: 0.00115, pensionEmployeeRate: 0.0915, employmentInsuranceRate: 0.005, pensionMaxStandard: 650_000 };

test("保険料・源泉税：画面の panelDeductions とサーバーの calculateInsuranceAndTax が同じ", () => {
  let n = 0;
  for (const std of [0, 88_000, 280_000, 410_000, 710_000]) for (let gross = 90_000; gross < 800_000; gross += 13_331) for (const dob of ["1990-05-05", "1956-10-12", "1951-10-01"]) {
    const emp = { id: 1, careInsuranceApplied: n % 2 === 0, dateOfBirth: dob, pensionApplied: null, employmentInsuranceApplied: true, dependentCount: n % 3, hasSpouse: n % 4 === 0, healthInsuranceMode: "auto", socialInsuranceExempt: false, employmentInsuranceExempt: false, incomeTaxExempt: false, disability: n % 9 === 0 ? "general" : "none" };
    const year = 2026, month = 10;
    const front = panelDeductions({ employee: emp, company: {}, rates: RATES, year, month, standardRemuneration: std, grossSalary: gross, nonTaxableAllowances: 5_000, employmentInsuranceExcluded: 1_000, employmentInsuranceOverride: null });
    const back = calculateInsuranceAndTax({
      standardRemuneration: std, grossSalary: gross, nonTaxableAllowances: 5_000, employmentInsuranceExcludedAllowances: 1_000,
      dependentCount: emp.dependentCount, hasSpouse: emp.hasSpouse, careInsuranceApplied: emp.careInsuranceApplied,
      pensionApplied: dob === "1990-05-05", healthApplied: dob !== "1951-10-01",
      employmentInsuranceApplied: true, residentTax: 0, employmentInsuranceRate: 0.005, insuranceRates: RATES,
      withholding: { disability: emp.disability },
    });
    assert.equal(front.healthInsurance, back.healthInsurance);
    assert.equal(front.childcareSupportContribution, back.childcareSupportContribution);
    assert.equal(front.pension, back.pension);
    assert.equal(front.employmentInsurance, back.employmentInsurance);
    assert.equal(front.incomeTax, back.incomeTax);
    n++;
  }
  assert.ok(n > 100);
});

test("勤怠から決まる手当：画面の panelAutoRows とサーバー（month-items が使う deriveAutoValues）が同じ", () => {
  const defs = [{ id: 7, name: "休日出勤手当" }, { id: 8, name: "深夜手当" }, { id: 9, name: "有給" }, { id: 13, name: "早出残業手当" }];
  const company = { dailyWageWeekday: 9808, dailyWageSaturday: 12260, hourlyWageSunday: 1655 };
  for (const ot of [0, 1961, 2313]) for (const h of [0, 30, 60, 72.25]) for (const s of [0, 2]) {
    const emp = { id: 1, salaryType: "daily", baseSalary: 0, overtimeHourlyRate: ot, lateNightHourlyRate: 0, dailyRateWeekday: 10240 };
    const rec = { workDays: 19, saturdayWorkDays: s, sundayWorkHours: 5.5, holidayWorkDays: 1, paidLeaveDays: 1.5, overtimeHours: h, lateNightHours: 3, restDayOvertimeHours: 0, actualWorkHours: 0 };
    const front = Object.fromEntries(panelAutoRows(emp, rec, company, defs, []).map((r) => [String(r.defId), r.amount]));
    const back = deriveAutoValues(emp, rec, company, defs).a;
    assert.deepEqual(front, back);
  }
});

test("ブルーウィング：画面の computeBWCalc とサーバーの calculateBluewingPayroll が同じ", () => {
  const emp = { id: 1, bluewingCommissionRate: 0.42, bluewingFixedOvertimeHours: 25, bluewingFixedOvertimeAmount: 50_000, transportationAllowance: 0, safetyDrivingAllowance: 0, longDistanceAllowance: 0, positionAllowance: 0, familyAllowance: 0, earlyOvertimeAllowance: 0, lateNightHourlyRate: 393 };
  const company = { dailyWageWeekday: 9808, dailyWageSaturday: 12260, hourlyWageSunday: 1655 };
  for (const oh of [10, 25, 40, 65]) for (const sales of [500_000, 1_100_000]) {
    const row = { bluewingSalesAmount: sales, overtimeHours: oh, lateNightHours: 4.5, workDays: 18, saturdayWorkDays: 2, overtimeUnitPrice: 2111, sundayWorkHours: 5.5 };
    const f = computeBWCalc(emp as never, row, company as never, 60_000)!;
    const night = Math.floor(393 * 4.5);
    const b = calculateBluewingPayroll({ bluewingSalesAmount: sales, commissionRate: 0.42, fixedOvertimeHours: 25, overtimeHours: oh, overtimeUnitPrice: 2111,
      baseSalary: Math.floor(18 * 9808) + Math.floor(2 * 12260), fixedAllowancesTotal: 60_000, holidayPay: Math.round(1655 * 5.5), fixedOvertimeAmount: 50_000, lateNightPay: night });
    assert.equal(f.perfAllowance, b.performanceAllowance);
    assert.equal(f.actualOTPay, b.actualOvertimePay);
    assert.equal(f.solutionB, b.solutionB);
  }
});
