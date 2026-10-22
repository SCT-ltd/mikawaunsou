/**
 * payroll-core.ts の試験（pnpm run test）。
 * いちばん大事なのは「スイッチが既定（OFF）のとき、2026-10 までの式と1円も変わらない」こと。
 * そのため、以前の式をここに写しておき（legacy*）、たくさんの入力で突き合わせる。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAY_RULES,
  deriveAutoValues,
  calcStatutoryDeductions,
  bluewingCalc,
  pensionAppliedFor,
  healthAppliedFor,
  careAgeFor,
  insuranceBaseFor,
  commuteNonTaxableLimit,
  commuteTaxableExcess,
  paidLeaveGrants,
  paidLeaveLedger,
  calcBonus,
  residentTaxCollectMonth,
  absenceDeductionFor,
  buildPayrollJournal,
  payrollDates,
  dependentEquivalentCount,
  monthlyWithholdingTax,
  OtsuTableMissingError,
  teijiCandidate,
  zuijiCandidate,
  type PayRules,
} from "../src/payroll-core";
import { round50sen, calculateIncomeTaxReiwa8MonthlyKou } from "../src/index";

// ── 以前の式（2026-10-23 時点の lib/month-items.ts deriveAutoValues）──
function legacyLateNight(rate: number) { return Math.round(Math.round(rate / 1.25) * 0.25); }
function legacyAuto(emp: { salaryType: string; dailyRateWeekday?: number; dailyRateSaturday?: number; overtimeHourlyRate?: number; lateNightHourlyRate?: number },
  rec: { workDays: number; saturdayWorkDays: number; sundayWorkHours: number; holidayWorkDays: number; paidLeaveDays: number; overtimeHours: number; lateNightHours: number },
  company: { dailyWageWeekday: number; dailyWageSaturday: number; hourlyWageSunday: number }, defs: Array<{ id: number; name: string }>) {
  const rateWeekday = (emp.dailyRateWeekday ?? 0) > 0 ? emp.dailyRateWeekday! : company.dailyWageWeekday;
  const rateSaturday = (emp.dailyRateSaturday ?? 0) > 0 ? emp.dailyRateSaturday! : company.dailyWageSaturday;
  const a: Record<string, number> = {};
  const put = (k: string, v: number) => { const d = defs.find((x) => x.name.includes(k)); if (d) a[String(d.id)] = v; };
  const ot = emp.overtimeHourlyRate ?? 0, night = emp.lateNightHourlyRate ?? 0;
  put("有給", Math.round(rateWeekday * rec.paidLeaveDays));
  put("休日出勤手当", Math.round((rec.saturdayWorkDays + rec.holidayWorkDays) * rateSaturday + rec.sundayWorkHours * company.hourlyWageSunday));
  if (ot > 0) put("早出残業手当", rec.overtimeHours <= 60 ? Math.round(ot * rec.overtimeHours) : Math.round(ot * 60) + Math.round(ot * 1.20 * (rec.overtimeHours - 60)));
  if (ot > 0 || night > 0) put("深夜手当", Math.round((night > 0 ? night : legacyLateNight(ot)) * rec.lateNightHours));
  return { base: emp.salaryType === "daily" ? Math.round(rec.workDays * rateWeekday) : null, a };
}

// ── 以前の式（calculateInsuranceAndTax の保険料・源泉税）──
function legacyIns(i: { std: number; gross: number; nonTax: number; excluded: number; care: boolean; pension: boolean; ei: boolean; override: number | null; eiRate: number; dep: number }) {
  const rates = { h: 0.04925, hc: 0.05735, c: 0.00115, p: 0.0915, max: 650_000 };
  const health = round50sen(i.std * (i.care ? rates.hc : rates.h));
  const child = round50sen(i.std * rates.c);
  const pension = i.pension ? round50sen(Math.min(i.std, rates.max) * rates.p) : 0;
  const ei = i.override != null ? Math.round(i.override) : i.ei ? round50sen((i.gross - i.excluded) * i.eiRate) : 0;
  const tax = calculateIncomeTaxReiwa8MonthlyKou(i.gross - i.nonTax - health - child - pension - ei, i.dep);
  return { health, child, pension, ei, tax };
}
const R8 = { healthEmployeeRate: 0.04925, healthWithCareEmployeeRate: 0.05735, childcareEmployeeRate: 0.00115, pensionEmployeeRate: 0.0915, pensionMaxStandard: 650_000 };

const DEFS = [
  { id: 7, name: "休日出勤手当" }, { id: 8, name: "深夜手当" }, { id: 9, name: "有給" }, { id: 13, name: "早出残業手当" }, { id: 5, name: "職務手当" },
];
const COMPANY = { dailyWageWeekday: 9808, dailyWageSaturday: 12260, hourlyWageSunday: 1655 };

function* grid() {
  const types = ["daily", "fixed", "hourly"];
  const ots = [0, 1818, 1961, 2094, 2313];
  const nights = [0, 393];
  const otHours = [0, 12.5, 39.5, 59.75, 60, 60.25, 75.5, 101];
  const sat = [0, 1, 2, 4];
  const sun = [0, 5.5, 8];
  const hol = [0, 1];
  const leave = [0, 0.5, 1, 3];
  let k = 0;
  for (const t of types) for (const ot of ots) for (const n of nights) for (const h of otHours) for (const s of sat) for (const su of sun) for (const ho of hol) for (const l of leave) {
    k++;
    if (k % 7 !== 0) continue; // 間引く（それでも数千件）
    yield { emp: { salaryType: t, overtimeHourlyRate: ot, lateNightHourlyRate: n, dailyRateWeekday: k % 3 === 0 ? 10240 : 0 },
      rec: { workDays: 18 + (k % 5), saturdayWorkDays: s, sundayWorkHours: su, holidayWorkDays: ho, paidLeaveDays: l, overtimeHours: h, lateNightHours: (k % 4) * 1.5 } };
  }
}

test("スイッチ OFF：勤怠から決まる手当・日給の基本給は以前の式と1円も変わらない", () => {
  let n = 0;
  for (const { emp, rec } of grid()) {
    const now = deriveAutoValues({ ...emp, baseSalary: 1500 }, rec, COMPANY, DEFS);
    const old = legacyAuto(emp, rec, COMPANY, DEFS);
    assert.deepEqual(now, old, JSON.stringify({ emp, rec }));
    n++;
  }
  assert.ok(n > 1000, `試した件数 ${n}`);
});

test("スイッチ OFF：社会保険・雇用保険・源泉税は以前の式と1円も変わらない（標準報酬 88,000円以上）", () => {
  const stds = [88_000, 98_000, 280_000, 300_000, 320_000, 360_000, 380_000, 410_000, 440_000, 470_000, 650_000, 710_000];
  let n = 0;
  for (const std of stds) for (let gross = 120_000; gross <= 760_000; gross += 7_919) for (const care of [false, true]) for (const pension of [true, false]) for (const dep of [0, 1, 3]) {
    const override = n % 11 === 0 ? 1234 : null;
    const nonTax = n % 5 === 0 ? 10_000 : 0;
    const excluded = n % 7 === 0 ? 2_000 : 0;
    const old = legacyIns({ std, gross, nonTax, excluded, care, pension, ei: true, override, eiRate: 0.005, dep });
    const now = calcStatutoryDeductions({
      standardRemuneration: std, grossSalary: gross, nonTaxableAllowances: nonTax, employmentInsuranceExcluded: excluded,
      careInsuranceApplied: care, pensionApplied: pension, employmentInsuranceApplied: true, employmentInsuranceOverride: override,
      employmentInsuranceRate: 0.005, rates: R8, withholding: { dependentCount: dep, hasSpouse: false },
    });
    assert.equal(now.healthInsurance, old.health);
    assert.equal(now.childcareSupportContribution, old.child);
    assert.equal(now.pension, old.pension);
    assert.equal(now.employmentInsurance, old.ei);
    assert.equal(now.incomeTax, old.tax);
    n++;
  }
  assert.ok(n > 500);
});

test("スイッチ OFF：ブルーウィングの業績手当は以前の式と同じ", () => {
  const legacy = (i: { sales: number; rate: number; fh: number; oh: number; up: number; base: number; fixed: number; hol: number; fa: number; night: number }) => {
    const aoh = Math.max(0, i.oh - i.fh); const aop = Math.round(aoh * i.up);
    const r = i.sales > 0 ? Math.round((aop / i.sales) * 1000) / 1000 : 0;
    const A = Math.floor(i.sales * Math.max(0, i.rate - r)); const B = Math.floor(i.base + i.fixed + i.hol + i.night);
    const perf = Math.max(0, A - B); return { aop, perf, gross: Math.floor(i.fa + aop + B + perf) };
  };
  for (const sales of [0, 600_000, 1_234_567]) for (const oh of [0, 20, 25, 40, 61, 80]) for (const rate of [0, 0.32, 0.45]) {
    const i = { sales, rate, fh: 25, oh, up: 2111, base: 176_544 + 24_520, fixed: 50_000, hol: 9_103, fa: 50_000, night: 1_899 };
    const o = legacy(i);
    const r = bluewingCalc({ bluewingSalesAmount: sales, commissionRate: rate, fixedOvertimeHours: 25, overtimeHours: oh, overtimeUnitPrice: 2111, baseSalary: i.base, fixedAllowancesTotal: 50_000, holidayPay: 9_103, fixedOvertimeAmount: 50_000, lateNightPay: 1_899 });
    assert.equal(r.actualOvertimePay, o.aop);
    assert.equal(r.performanceAllowance, o.perf);
    assert.equal(r.grossSalary, o.gross);
  }
});

test("④新しい式：残業代を差し引かない／⑤60時間超の5割増", () => {
  const base = { bluewingSalesAmount: 1_000_000, commissionRate: 0.4, fixedOvertimeHours: 25, overtimeHours: 70, overtimeUnitPrice: 2000, baseSalary: 200_000, fixedAllowancesTotal: 50_000, holidayPay: 0, fixedOvertimeAmount: 50_000, lateNightPay: 0 };
  const v1 = bluewingCalc(base);
  const v2 = bluewingCalc(base, { v2: true });
  assert.equal(v2.solutionA, 400_000);
  assert.ok(v2.performanceAllowance > v1.performanceAllowance);
  const o = bluewingCalc(base, { over60: true });
  assert.equal(o.over60Premium, Math.round(10 * 2000 * 0.2));
});

test("70歳：誕生日の前日の月から厚生年金を引かない（1日生まれは前の月から）", () => {
  // 1956-10-12 生まれ → 2026-10-11 に70歳到達 → 10月分から引かない
  assert.equal(pensionAppliedFor(null, "1956-10-12", 2026, 9), true);
  assert.equal(pensionAppliedFor(null, "1956-10-12", 2026, 10), false);
  // 1956-10-01 生まれ → 2026-09-30 到達 → 9月分から
  assert.equal(pensionAppliedFor(null, "1956-10-01", 2026, 8), true);
  assert.equal(pensionAppliedFor(null, "1956-10-01", 2026, 9), false);
  assert.equal(pensionAppliedFor(true, "1956-10-01", 2026, 12), true);
});

test("75歳：誕生日「当日」の月から健康保険を引かない（1日生まれもその月から）", () => {
  assert.equal(healthAppliedFor("auto", "1951-10-12", 2026, 9), true);
  assert.equal(healthAppliedFor("auto", "1951-10-12", 2026, 10), false);
  // 1日生まれ：誕生日の前日の月（9月）ではなく、誕生日の月（10月）から
  assert.equal(healthAppliedFor("auto", "1951-10-01", 2026, 9), true);
  assert.equal(healthAppliedFor("auto", "1951-10-01", 2026, 10), false);
  assert.equal(healthAppliedFor("applied", "1951-10-01", 2026, 12), true);
  assert.equal(healthAppliedFor("not_applied", "1990-01-01", 2026, 1), false);
  // 75歳で健康保険が止まると、介護・子育て支援金も止まる
  const r = calcStatutoryDeductions({ standardRemuneration: 320_000, grossSalary: 300_000, nonTaxableAllowances: 0, careInsuranceApplied: false, pensionApplied: false, healthApplied: false, employmentInsuranceApplied: true, employmentInsuranceRate: 0.005, rates: R8, withholding: {} });
  assert.equal(r.healthInsurance + r.childcareSupportContribution + r.pension, 0);
  assert.equal(r.employmentInsurance, 1500); // 雇用保険は続く
});

test("40歳・65歳：介護保険の年齢（到達日の月から）", () => {
  assert.equal(careAgeFor("1986-10-12", 2026, 9), false);
  assert.equal(careAgeFor("1986-10-12", 2026, 10), true);
  assert.equal(careAgeFor("1961-10-12", 2026, 9), true);
  assert.equal(careAgeFor("1961-10-12", 2026, 10), false);
});

test("60時間の境目と祝日（土曜と同じ日当）", () => {
  const e = { salaryType: "daily", baseSalary: 0, overtimeHourlyRate: 2000 };
  const r = (h: number) => deriveAutoValues(e, { workDays: 20, saturdayWorkDays: 0, sundayWorkHours: 0, holidayWorkDays: 1, paidLeaveDays: 0, overtimeHours: h, lateNightHours: 0 }, COMPANY, DEFS).a;
  assert.equal(r(60)["13"], 120_000);
  assert.equal(r(60.5)["13"], 120_000 + Math.round(2000 * 1.2 * 0.5));
  assert.equal(r(60)["7"], 12_260);
  // ③：土曜・祝日の時間（1日×8h）を60時間の判定に入れる
  const rules: PayRules = { ...DEFAULT_PAY_RULES, over60IncludesRestDays: true };
  const a = deriveAutoValues(e, { workDays: 20, saturdayWorkDays: 0, sundayWorkHours: 0, holidayWorkDays: 1, paidLeaveDays: 0, overtimeHours: 55, lateNightHours: 0 }, COMPANY, DEFS, { rules }).a;
  assert.equal(a["13"], 110_000 + Math.round(2000 * 0.2 * 3));
  // ②：土曜・祝日の8時間超を残業に足す
  const b = deriveAutoValues(e, { workDays: 20, saturdayWorkDays: 1, sundayWorkHours: 0, holidayWorkDays: 0, paidLeaveDays: 0, overtimeHours: 10, lateNightHours: 0, restDayOvertimeHours: 2 }, COMPANY, DEFS, { rules: { ...DEFAULT_PAY_RULES, restDayOvertime: true } }).a;
  assert.equal(b["13"], 24_000);
});

test("⑦有給の日の賃金・⑧時給の人の休日出勤・①割増の基礎", () => {
  const rules = { ...DEFAULT_PAY_RULES, paidLeaveBySalaryType: true, hourlyHolidayNoDouble: true };
  const rec = { workDays: 20, saturdayWorkDays: 1, sundayWorkHours: 4, holidayWorkDays: 0, paidLeaveDays: 2, overtimeHours: 0, lateNightHours: 0 };
  assert.equal(deriveAutoValues({ salaryType: "fixed", baseSalary: 300_000 }, rec, COMPANY, DEFS, { rules }).a["9"], 0);
  const h = deriveAutoValues({ salaryType: "hourly", baseSalary: 1500 }, rec, COMPANY, DEFS, { rules }).a;
  assert.equal(h["9"], 1500 * 8 * 2);
  assert.equal(h["7"], Math.round(8 * 1500 * 0.25 + 4 * 1500 * 0.35));
  // ① 日給 9,808円 ＋ 算入する手当 32,000円（÷160h＝200円）→ 基礎 1,426円/h
  const p = deriveAutoValues({ salaryType: "daily", baseSalary: 0, overtimeHourlyRate: 1500 }, { ...rec, overtimeHours: 10 }, COMPANY, DEFS, { rules: { ...DEFAULT_PAY_RULES, premiumBaseIncludesAllowances: true }, premiumBaseAllowances: 32_000 }).a;
  assert.equal(p["13"], Math.round(1426 * 1.25) * 10);
});

test("標準報酬が未設定なら等級表に当てはめる・厚生年金は 88,000円が下限", () => {
  assert.equal(insuranceBaseFor(0, 163_652), 160_000);
  assert.equal(insuranceBaseFor(0, 60_000), 58_000);
  assert.equal(insuranceBaseFor(320_000, 1), 320_000);
  const r = calcStatutoryDeductions({ standardRemuneration: 0, grossSalary: 70_000, nonTaxableAllowances: 0, careInsuranceApplied: false, pensionApplied: true, employmentInsuranceApplied: true, employmentInsuranceRate: 0.005, rates: R8, withholding: {} });
  assert.equal(r.insuranceBase, 68_000);
  assert.equal(r.pension, round50sen(88_000 * 0.0915));
});

test("止める印は別々に効く", () => {
  const base = { standardRemuneration: 300_000, grossSalary: 300_000, nonTaxableAllowances: 0, careInsuranceApplied: false, pensionApplied: true, employmentInsuranceApplied: true, employmentInsuranceRate: 0.005, rates: R8, withholding: {} };
  const s = calcStatutoryDeductions({ ...base, socialInsuranceExempt: true });
  assert.equal(s.healthInsurance + s.pension, 0); assert.equal(s.employmentInsurance, 1500); assert.ok(s.incomeTax > 0);
  const e = calcStatutoryDeductions({ ...base, employmentInsuranceExempt: true, employmentInsuranceOverride: 999 });
  assert.equal(e.employmentInsurance, 0);
  const t = calcStatutoryDeductions({ ...base, incomeTaxExempt: true });
  assert.equal(t.incomeTax, 0); assert.ok(t.healthInsurance > 0);
});

test("源泉税：本人の障害者・寡婦などは扶養人数に足す／乙欄は表が無ければ止める", () => {
  assert.equal(dependentEquivalentCount({ dependentCount: 1, hasSpouse: true, disability: "general", widow: true, dependentDisabilityCount: 2 }), 6);
  assert.equal(monthlyWithholdingTax(80_000, { taxColumn: "otsu" }), Math.floor(80_000 * 0.03063));
  assert.throws(() => monthlyWithholdingTax(200_000, { taxColumn: "otsu" }), OtsuTableMissingError);
});

test("通勤手当の非課税の上限（マイカー）", () => {
  assert.equal(commuteNonTaxableLimit("car", 1.9), 0);
  assert.equal(commuteNonTaxableLimit("car", 2), 4_200);
  assert.equal(commuteNonTaxableLimit("car", 12), 7_300);
  assert.equal(commuteNonTaxableLimit("car", 60), 38_700);
  assert.equal(commuteNonTaxableLimit(null, 60), null);
  assert.equal(commuteTaxableExcess(10_000, "car", 12), 2_700);
  assert.equal(commuteTaxableExcess(10_000, null, 12), 0);
});

test("有給：付与日数・比例付与・古い付与から使う・年5日", () => {
  const g = paidLeaveGrants("2024-04-01", "2026-10-22");
  assert.deepEqual(g.map((x) => [x.date, x.days]), [["2024-10-01", 10], ["2025-10-01", 11], ["2026-10-01", 12]]);
  const p = paidLeaveGrants("2024-04-01", "2025-10-01", 3, 24);
  assert.deepEqual(p.map((x) => x.days), [5, 6]);
  const l = paidLeaveLedger(g, [{ date: "2025-01-10", days: 3 }, { date: "2025-11-01", days: 8 }], [], "2026-10-22");
  // 2024-10-01 の10日は 3＋7 で使い切り、残り1日は 2025-10-01 から
  assert.equal(l.grants[0]!.used, 10);
  assert.equal(l.grants[1]!.used, 1);
  assert.equal(l.remaining, 10 + 12); // 2024の分は使い切り、2025の残り10・2026の12
  assert.equal(l.obligations[0]!.shortage, 2);
  assert.equal(paidLeaveGrants("2024-08-31", "2025-03-31")[0]!.date, "2025-02-28");
});

test("賞与：標準賞与額は千円未満切り捨て・上限・月額表で計算する場合", () => {
  const base = { careInsuranceApplied: false, pensionApplied: true, healthApplied: true, employmentInsuranceApplied: true, rates: R8, employmentInsuranceRate: 0.005, withholding: {}, periodMonths: 6, rateTable: null };
  const r = calcBonus({ ...base, amount: 1_600_999, fiscalYearStandardBonusBefore: 5_000_000, prevMonthAfterInsurance: 250_000 });
  assert.equal(r.standardBonus, 1_600_000);
  assert.equal(r.pensionStandard, 1_500_000);
  assert.equal(r.healthStandard, 730_000);
  assert.equal(r.incomeTax, null); // 算出率の表が無い
  const m = calcBonus({ ...base, amount: 1_200_000, fiscalYearStandardBonusBefore: 0, prevMonthAfterInsurance: 0 });
  assert.equal(m.incomeTaxMethod, "monthly");
  assert.ok((m.incomeTax ?? 0) > 0);
  const t = calcBonus({ ...base, amount: 500_000, fiscalYearStandardBonusBefore: 0, prevMonthAfterInsurance: 250_000, rateTable: [{ from: 0, rates: [0.02042, 0, 0, 0, 0, 0, 0, 0] }] });
  assert.equal(t.incomeTax, Math.floor(t.afterInsurance * 0.02042));
});

test("住民税：6月分は5月分の明細から", () => {
  assert.deepEqual(residentTaxCollectMonth(2026, 5), { year: 2026, month: 6 });
  assert.deepEqual(residentTaxCollectMonth(2026, 12), { year: 2027, month: 1 });
});

test("欠勤控除（スイッチ OFF なら 0）", () => {
  assert.equal(absenceDeductionFor(300_000, 2, DEFAULT_PAY_RULES), 0);
  assert.equal(absenceDeductionFor(300_000, 2, { ...DEFAULT_PAY_RULES, absenceDeduction: true }), Math.round(300_000 / 22 * 2));
  assert.equal(absenceDeductionFor(300_000, 2, { ...DEFAULT_PAY_RULES, absenceDeduction: true, absenceDeductionMethod: "scheduledDays" }, 21), Math.round(300_000 / 21 * 2));
});

test("仕訳：給料手当の借方の合計＝総支給・日付はずれない", () => {
  const rows = [
    { grossSalary: 300_000, healthInsurance: 14_775, childcareSupportContribution: 345, pension: 27_450, employmentInsurance: 1_500, incomeTax: 6_000, residentTax: 10_000, otherDeductions: 3_000, netSalary: 0,
      standardRemuneration: 300_000, healthRateTotal: 0.0985, careRateTotal: 0, childcareRateTotal: 0.0023, pensionRateTotal: 0.183, pensionMaxStandard: 650_000, employmentInsuranceBase: 300_000 },
  ];
  const d = payrollDates(2026, 9, 31, 25);
  assert.deepEqual(d, { closing: "2026-09-30", payment: "2026-10-25" });
  assert.deepEqual(payrollDates(2026, 12, 31, 25), { closing: "2026-12-31", payment: "2027-01-25" });
  const lines = buildPayrollJournal(rows, { label: "x", entryDate: d.closing, paymentDate: d.payment, employerEmploymentRate: 0.0085, childContributionRate: 0.0036 });
  const salaryDebit = lines.filter((l) => l.debitAccount === "給料手当").reduce((s, l) => s + l.amount, 0);
  assert.equal(salaryDebit, 300_000);
  const net = lines.find((l) => l.creditAccount === "未払金（未払給与）")!.amount;
  assert.equal(net, 300_000 - 14_775 - 345 - 27_450 - 1_500 - 6_000 - 10_000 - 3_000);
  assert.equal(lines.find((l) => l.description.includes("厚生年金保険料（会社負担）"))!.amount, Math.floor(300_000 * 0.183) - 27_450);
  assert.equal(lines.find((l) => l.description.includes("拠出金"))!.amount, Math.floor(300_000 * 0.0036));
  assert.equal(lines.find((l) => l.creditAccount === "普通預金")!.date, "2026-10-25");
});

test("算定基礎・月額変更の候補", () => {
  const t = teijiCandidate([{ payYear: 2026, payMonth: 4, amount: 300_000, baseDays: 20 }, { payYear: 2026, payMonth: 5, amount: 310_000, baseDays: 16 }, { payYear: 2026, payMonth: 6, amount: 320_000, baseDays: 21 }]);
  assert.deepEqual(t, { average: 310_000, standard: 320_000, usedMonths: 2 });
  assert.ok(zuijiCandidate([{ payYear: 2026, payMonth: 5, amount: 360_000, baseDays: 20 }, { payYear: 2026, payMonth: 6, amount: 360_000, baseDays: 20 }, { payYear: 2026, payMonth: 7, amount: 360_000, baseDays: 20 }], 300_000, true));
  assert.equal(zuijiCandidate([{ payYear: 2026, payMonth: 5, amount: 310_000, baseDays: 20 }, { payYear: 2026, payMonth: 6, amount: 310_000, baseDays: 20 }, { payYear: 2026, payMonth: 7, amount: 310_000, baseDays: 20 }], 300_000, true), null);
});
