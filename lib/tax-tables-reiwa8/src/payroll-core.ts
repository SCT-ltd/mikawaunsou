/**
 * 給与計算の「式」をまとめた置き場（サーバー・画面の両方から使う。DB には触らない純粋な関数だけ）。
 *
 * 以前は同じ式が サーバー（routes/payroll.ts・lib/month-items.ts）と
 * 画面（components/monthly-input/estimate.ts・手当パネル2つ）に別々に書かれていて、
 * 片方だけ直すと「画面の金額」と「明細の金額」が食い違っていた。
 * ここを直せば両方に効く。
 *
 * ★会社設定のスイッチ（PayRules）は、社労士・税理士の確認が済むまで既定で OFF。
 *   OFF のときは、これまでと1円も変わらない式になっている（試験 payroll-core.test.ts で確かめている）。
 */

import {
  calculateIncomeTaxReiwa8MonthlyKou,
  round50sen,
  getInsuranceGrade,
  PENSION_MAX_STD,
} from "./index";

// ────────────────────────────────────────────────────────────────────────────
// 会社設定のスイッチ
// ────────────────────────────────────────────────────────────────────────────

export type AbsenceDeductionMethod = "fixed22" | "monthlyAverage" | "scheduledDays";

export interface PayRules {
  /** ① 割増賃金の基礎に手当（手当マスターで「割増の基礎に入れる」印の付いたもの）を入れる */
  premiumBaseIncludesAllowances: boolean;
  /** ② 土曜・祝日の8時間を超えた時間（rest_day_overtime_hours）を残業として払う */
  restDayOvertime: boolean;
  /** ③ 月60時間超の判定に、土曜・祝日に働いた時間を含める */
  over60IncludesRestDays: boolean;
  /** ④ ブルーウィングの業績手当を「残業代を差し引かない式」（新しい式の候補）で出す */
  bluewingPerformanceV2: boolean;
  /** ⑤ ブルーウィングの月60時間超の残業を5割増にする */
  bluewingOver60: boolean;
  /** ⑥ 歩合給（業績手当）の時間外の割増（労基則19条1項6号）を払う */
  commissionPremium: boolean;
  /** ⑦ 有給の日の賃金を給与の形ごとに出す（日給＝平日日当、時給＝時給×所定時間、月給＝足さない） */
  paidLeaveBySalaryType: boolean;
  /** ⑧ 時給の人の土曜・日曜の休日出勤手当を「割増の分だけ」にする（基本給に同じ時間が入っているため） */
  hourlyHolidayNoDouble: boolean;
  /** ⑨ 月給の人の欠勤を差し引く（手入力固定の計算でも） */
  absenceDeduction: boolean;
  /** ⑨ 欠勤控除の日割りの式 */
  absenceDeductionMethod: AbsenceDeductionMethod;
  /** 健康保険料と子ども・子育て支援金の端数処理（separate＝別々に50銭判定〔今まで〕／combined＝合わせて判定） */
  healthChildcareRounding: "separate" | "combined";
  /** 1日の所定労働時間（既定 8 時間） */
  scheduledHoursPerDay: number;
  /** 1か月の平均所定労働時間（会社設定 monthlyAverageWorkHours） */
  monthlyAverageWorkHours: number;
}

export const DEFAULT_PAY_RULES: PayRules = {
  premiumBaseIncludesAllowances: false,
  restDayOvertime: false,
  over60IncludesRestDays: false,
  bluewingPerformanceV2: false,
  bluewingOver60: false,
  commissionPremium: false,
  paidLeaveBySalaryType: false,
  hourlyHolidayNoDouble: false,
  absenceDeduction: false,
  absenceDeductionMethod: "fixed22",
  healthChildcareRounding: "separate",
  scheduledHoursPerDay: 8,
  monthlyAverageWorkHours: 160,
};

/** 会社設定の行（列名は schema/company.ts）からスイッチを作る。列が無い・空なら既定値。 */
export function payRulesFromCompany(c: Record<string, unknown> | null | undefined): PayRules {
  const b = (k: string) => c?.[k] === true;
  const n = (k: string, d: number) => {
    const v = Number(c?.[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const method = String(c?.["absenceDeductionMethod"] ?? "fixed22");
  return {
    premiumBaseIncludesAllowances: b("rulePremiumBaseIncludesAllowances"),
    restDayOvertime: b("ruleRestDayOvertime"),
    over60IncludesRestDays: b("ruleOver60IncludesRestDays"),
    bluewingPerformanceV2: b("ruleBluewingPerformanceV2"),
    bluewingOver60: b("ruleBluewingOver60"),
    commissionPremium: b("ruleCommissionPremium"),
    paidLeaveBySalaryType: b("rulePaidLeaveBySalaryType"),
    hourlyHolidayNoDouble: b("ruleHourlyHolidayNoDouble"),
    absenceDeduction: b("ruleAbsenceDeduction"),
    absenceDeductionMethod: (["fixed22", "monthlyAverage", "scheduledDays"].includes(method) ? method : "fixed22") as AbsenceDeductionMethod,
    healthChildcareRounding: c?.["healthChildcareRounding"] === "combined" ? "combined" : "separate",
    scheduledHoursPerDay: n("scheduledHoursPerDay", 8),
    monthlyAverageWorkHours: n("monthlyAverageWorkHours", 160),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 年齢の節目
//   年齢到達日＝その歳の誕生日の前日（年齢計算ニ関スル法律）。
//   40歳：到達日の月から介護保険料／65歳：到達日の月から介護保険料なし
//   70歳：到達日の月から厚生年金保険料なし（資格喪失日＝到達日）
//   75歳：誕生日「当日」に後期高齢者医療へ移る（健康保険の資格喪失日＝誕生日）。
//         保険料は喪失月の前月分まで＝誕生日の月から健康保険料（介護・子育て支援金を含む）なし。
// ────────────────────────────────────────────────────────────────────────────

function parseYmd(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const p = String(s).slice(0, 10).split(/[-/]/).map(Number);
  if (p.length < 3 || p.some((x) => !Number.isFinite(x))) return null;
  return { y: p[0]!, m: p[1]!, d: p[2]! };
}

/** その歳の誕生日の前日（年齢到達日）。UTC の 0 時で返す。 */
export function ageReachDate(dob: string | null | undefined, age: number): Date | null {
  const b = parseYmd(dob);
  if (!b) return null;
  const r = new Date(Date.UTC(b.y + age, b.m - 1, b.d));
  r.setUTCDate(r.getUTCDate() - 1);
  return r;
}

/** その歳の誕生日（当日）。2月29日生まれは平年は3月1日。 */
export function birthdayAt(dob: string | null | undefined, age: number): Date | null {
  const b = parseYmd(dob);
  if (!b) return null;
  return new Date(Date.UTC(b.y + age, b.m - 1, b.d));
}

const ymIndex = (y: number, m: number) => y * 12 + (m - 1);
const dateYmIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** 厚生年金を引くか（override が true/false ならそれ、null なら 70歳到達日の月から引かない） */
export function pensionAppliedFor(override: boolean | null | undefined, dob: string | null | undefined, year: number, month: number): boolean {
  if (override !== null && override !== undefined) return override;
  const r = ageReachDate(dob, 70);
  if (!r) return true;
  return ymIndex(year, month) < dateYmIndex(r);
}

export type HealthInsuranceMode = "auto" | "applied" | "not_applied";

/**
 * 健康保険（介護・子ども子育て支援金を含む）を引くか。
 *   auto        … 75歳の誕生日の月から引かない（後期高齢者医療へ）
 *   applied     … 常に引く／not_applied … 引かない
 */
export function healthAppliedFor(mode: string | null | undefined, dob: string | null | undefined, year: number, month: number): boolean {
  if (mode === "applied") return true;
  if (mode === "not_applied") return false;
  const r = birthdayAt(dob, 75);
  if (!r) return true;
  return ymIndex(year, month) < dateYmIndex(r);
}

/** 介護保険の対象の年齢か（40歳到達日の月〜65歳到達日の前月）。お知らせ用。 */
export function careAgeFor(dob: string | null | undefined, year: number, month: number): boolean | null {
  const a = ageReachDate(dob, 40), b = ageReachDate(dob, 65);
  if (!a || !b) return null;
  const k = ymIndex(year, month);
  return k >= dateYmIndex(a) && k < dateYmIndex(b);
}

// ────────────────────────────────────────────────────────────────────────────
// 社会保険・雇用保険・源泉所得税（1か月の給与）
// ────────────────────────────────────────────────────────────────────────────

/** 厚生年金の標準報酬月額の下限（第1級 88,000円）。厚生年金保険法20条 */
export const PENSION_MIN_STD = 88_000;

/**
 * 保険料の計算に使う標準報酬月額。
 * 決まっていない（0）人は、その月の総支給額を等級表に当てはめた額にする。
 * 以前は総支給額そのものを掛けていた（等級表に無い金額で保険料を出していた）。
 */
export function insuranceBaseFor(standardRemuneration: number | null | undefined, grossSalary: number): number {
  const s = standardRemuneration ?? 0;
  if (s > 0) return s;
  return getInsuranceGrade(Math.max(0, grossSalary)).stdMonthly;
}

/** 本人負担の保険料率（折半後）と厚生年金の上限 */
export interface EmployeeRates {
  healthEmployeeRate: number;
  healthWithCareEmployeeRate: number;
  childcareEmployeeRate: number;
  pensionEmployeeRate: number;
  pensionMaxStandard: number;
}

/** 扶養控除等申告書まわりの社員の情報（源泉税の甲欄・乙欄と扶養親族等の数） */
export interface WithholdingProfile {
  dependentCount?: number | null;
  hasSpouse?: boolean | null;
  /** 'kou'＝扶養控除等申告書を出している（甲欄）／'otsu'＝出していない（乙欄） */
  taxColumn?: string | null;
  /** 本人が障害者か（'none'|'general'|'special'）。甲欄では1人として数える */
  disability?: string | null;
  widow?: boolean | null;
  singleParent?: boolean | null;
  workingStudent?: boolean | null;
  /** 扶養親族（配偶者を含む）のうち障害者の数。同居特別障害者は2人として数えて入れる */
  dependentDisabilityCount?: number | null;
}

/**
 * 月額表甲欄の「扶養親族等の数」。
 * 控除対象配偶者・控除対象扶養親族の数に、本人が障害者・寡婦・ひとり親・勤労学生に当たるときは
 * それぞれ1を足し、扶養親族等に障害者がいるときはその数を足す（月額表の備考）。
 */
export function dependentEquivalentCount(p: WithholdingProfile): number {
  return (p.dependentCount ?? 0)
    + (p.hasSpouse ? 1 : 0)
    + (p.disability && p.disability !== "none" ? 1 : 0)
    + (p.widow ? 1 : 0)
    + (p.singleParent ? 1 : 0)
    + (p.workingStudent ? 1 : 0)
    + Math.max(0, p.dependentDisabilityCount ?? 0);
}

export class OtsuTableMissingError extends Error {
  constructor(public afterInsuranceSalary: number) {
    super("乙欄の税額表が入っていないため、源泉所得税を計算できません。");
  }
}

/**
 * 源泉所得税（月額表）。
 *   甲欄：令和8年分の月額表（index.ts の公式値）
 *   乙欄：社会保険料等控除後の給与等の金額が 88,000円未満なら その 3.063%（月額表 乙欄の備考）。
 *         88,000円以上の行の値はこのシステムに入っていない（推測で埋めない）→ OtsuTableMissingError
 */
export function monthlyWithholdingTax(afterInsuranceSalary: number, p: WithholdingProfile): number {
  if (p.taxColumn === "otsu") {
    const s = Math.max(0, Math.floor(afterInsuranceSalary));
    if (s < 88_000) return Math.floor(s * 0.03063);
    throw new OtsuTableMissingError(s);
  }
  return calculateIncomeTaxReiwa8MonthlyKou(afterInsuranceSalary, dependentEquivalentCount(p));
}

export interface StatutoryDeductionInput {
  /** その月に効く標準報酬月額（0＝未設定。総支給を等級表に当てはめる） */
  standardRemuneration: number;
  grossSalary: number;
  /** 非課税の手当（通勤手当など）。源泉税の計算基礎から除く */
  nonTaxableAllowances: number;
  /** 雇用保険の計算基礎から除く手当（携帯代など実費弁償） */
  employmentInsuranceExcluded?: number;
  careInsuranceApplied: boolean;
  pensionApplied: boolean;
  /** 健康保険を引くか（75歳・適用除外）。省略時 true */
  healthApplied?: boolean;
  employmentInsuranceApplied: boolean;
  /** 雇用保険料を手で決めた額（null＝自動） */
  employmentInsuranceOverride?: number | null;
  employmentInsuranceRate: number;
  rates: EmployeeRates;
  /** それぞれ止める印（旧「全額非課税」を3つに分けたもの） */
  socialInsuranceExempt?: boolean;
  employmentInsuranceExempt?: boolean;
  incomeTaxExempt?: boolean;
  withholding: WithholdingProfile;
  rounding?: PayRules["healthChildcareRounding"];
}

export interface StatutoryDeductions {
  /** 保険料の計算に使った標準報酬月額 */
  insuranceBase: number;
  healthInsurance: number;
  childcareSupportContribution: number;
  pension: number;
  employmentInsurance: number;
  /** 社会保険料等控除後の給与等の金額（源泉税の計算基礎） */
  afterInsuranceSalary: number;
  incomeTax: number;
}

export function calcStatutoryDeductions(i: StatutoryDeductionInput): StatutoryDeductions {
  const insuranceBase = insuranceBaseFor(i.standardRemuneration, i.grossSalary);
  const social = !i.socialInsuranceExempt;
  const healthOn = social && i.healthApplied !== false;

  const healthRate = i.careInsuranceApplied ? i.rates.healthWithCareEmployeeRate : i.rates.healthEmployeeRate;
  let healthInsurance = 0;
  let childcareSupportContribution = 0;
  if (healthOn) {
    childcareSupportContribution = round50sen(insuranceBase * i.rates.childcareEmployeeRate);
    if (i.rounding === "combined") {
      // 健康保険料と支援金を合わせた額で 50銭判定し、支援金を差し引いた残りを健康保険料にする
      healthInsurance = round50sen(insuranceBase * (healthRate + i.rates.childcareEmployeeRate)) - childcareSupportContribution;
    } else {
      healthInsurance = round50sen(insuranceBase * healthRate);
    }
  }

  // 厚生年金：標準報酬月額は 88,000円〜上限（650,000円）の範囲に収める
  const pensionBase = Math.min(Math.max(insuranceBase, PENSION_MIN_STD), i.rates.pensionMaxStandard);
  const pension = social && i.pensionApplied ? round50sen(pensionBase * i.rates.pensionEmployeeRate) : 0;

  const employmentInsurance = i.employmentInsuranceExempt
    ? 0
    : i.employmentInsuranceOverride != null
    ? Math.round(i.employmentInsuranceOverride)
    : i.employmentInsuranceApplied
    ? round50sen((i.grossSalary - (i.employmentInsuranceExcluded ?? 0)) * i.employmentInsuranceRate)
    : 0;

  const afterInsuranceSalary = i.grossSalary - i.nonTaxableAllowances - healthInsurance - childcareSupportContribution - pension - employmentInsurance;
  const incomeTax = i.incomeTaxExempt ? 0 : monthlyWithholdingTax(afterInsuranceSalary, i.withholding);

  return { insuranceBase, healthInsurance, childcareSupportContribution, pension, employmentInsurance, afterInsuranceSalary, incomeTax };
}

/** 社員マスターの印から、止める3つの印を作る（新しい印が無い古い行は taxExempt を3つに広げる） */
export function exemptFlagsOf(emp: {
  taxExempt?: boolean | null;
  socialInsuranceExempt?: boolean | null;
  employmentInsuranceExempt?: boolean | null;
  incomeTaxExempt?: boolean | null;
}): { socialInsuranceExempt: boolean; employmentInsuranceExempt: boolean; incomeTaxExempt: boolean } {
  const has = emp.socialInsuranceExempt != null || emp.employmentInsuranceExempt != null || emp.incomeTaxExempt != null;
  if (!has) {
    const t = emp.taxExempt === true;
    return { socialInsuranceExempt: t, employmentInsuranceExempt: t, incomeTaxExempt: t };
  }
  return {
    socialInsuranceExempt: emp.socialInsuranceExempt === true,
    employmentInsuranceExempt: emp.employmentInsuranceExempt === true,
    incomeTaxExempt: emp.incomeTaxExempt === true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 通勤手当の非課税の上限（所得税法9条1項5号・施行令20条の2）
//   マイカー等：片道の距離ごと（令和7年4月1日以後に支払うものの額。国税庁「通勤手当の非課税限度額の引上げ」）
//   交通機関：月15万円
// ────────────────────────────────────────────────────────────────────────────

export function commuteNonTaxableLimit(method: string | null | undefined, oneWayKm: number | null | undefined): number | null {
  if (method === "public") return 150_000;
  if (method !== "car") return null; // 未設定＝今までどおり（全額を非課税として扱う）
  const km = oneWayKm ?? 0;
  if (km < 2) return 0;
  if (km < 10) return 4_200;
  if (km < 15) return 7_300;
  if (km < 25) return 13_500;
  if (km < 35) return 19_700;
  if (km < 45) return 25_900;
  if (km < 55) return 32_300;
  return 38_700;
}

/** 通勤手当のうち、非課税の上限を超えて課税になる額 */
export function commuteTaxableExcess(commuteAllowance: number, method: string | null | undefined, oneWayKm: number | null | undefined): number {
  const limit = commuteNonTaxableLimit(method, oneWayKm);
  if (limit === null) return 0;
  return Math.max(0, commuteAllowance - limit);
}

/** 手当の名前が通勤手当か（手当マスターの「交通費」「通勤手当」） */
export const isCommuteAllowanceName = (name: string) => /交通費|通勤/.test(name);

// ────────────────────────────────────────────────────────────────────────────
// 勤怠から金額が決まる手当（有給・休日出勤・早出残業・深夜）と日給の基本給
// ────────────────────────────────────────────────────────────────────────────

/** 深夜割増の1時間単価を「割増込みの残業時給」から復元する（÷1.25×0.25・四捨五入） */
export function lateNightPremiumPerHour(overtimeHourlyRate: number): number {
  return Math.round(Math.round(overtimeHourlyRate / 1.25) * 0.25);
}
export function lateNightRateFor(personalLateNightRate: number | null | undefined, overtimeHourlyRate: number): number {
  return (personalLateNightRate ?? 0) > 0 ? personalLateNightRate! : lateNightPremiumPerHour(overtimeHourlyRate);
}

export interface AttendanceForAuto {
  workDays: number | null;
  saturdayWorkDays: number | null;
  sundayWorkHours: number | null;
  /** 祝日の出勤日数（土曜と同じ日当＝1.25倍） */
  holidayWorkDays?: number | null;
  paidLeaveDays: number | null;
  overtimeHours: number | null;
  lateNightHours: number | null;
  /** 土曜・祝日の8時間を超えた時間（②のスイッチで残業として払う） */
  restDayOvertimeHours?: number | null;
  /** 実働時間（時給制の基本給・⑥の総労働時間） */
  actualWorkHours?: number | null;
}
export interface EmployeeForAuto {
  id?: number;
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
export interface AutoRow {
  defId: number;
  amount: number;
  /** 画面に出す式の説明 */
  note: string;
}
export interface AutoContext {
  rules?: PayRules;
  /** ① 割増の基礎に入れる手当の合計（月額） */
  premiumBaseAllowances?: number;
  /** ⑥ 歩合給（業績手当）の額 */
  commissionAmount?: number;
}

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

/** 割増の基礎になる1時間あたりの賃金（①のスイッチ用）。 */
export function premiumBaseHourly(
  salaryType: string | null,
  baseOrRate: { weekdayDaily: number; monthlyBase: number; hourlyWage: number },
  includedAllowances: number,
  rules: PayRules,
): number {
  const hpd = rules.scheduledHoursPerDay > 0 ? rules.scheduledHoursPerDay : 8;
  const mah = rules.monthlyAverageWorkHours > 0 ? rules.monthlyAverageWorkHours : 160;
  const own = salaryType === "daily"
    ? baseOrRate.weekdayDaily / hpd
    : salaryType === "hourly"
    ? baseOrRate.hourlyWage
    : baseOrRate.monthlyBase / mah;
  return own + Math.max(0, includedAllowances) / mah;
}

/**
 * 勤怠から金額が決まる手当（行ごと・説明つき）。
 * スイッチがすべて OFF のときは、2026-10 までの式と同じ金額になる（試験で確かめている）。
 */
export function deriveAutoRows(
  emp: EmployeeForAuto,
  rec: AttendanceForAuto,
  company: CompanyForAuto,
  activeDefs: Array<{ id: number; name: string }>,
  ctx: AutoContext = {},
): { base: number | null; rows: AutoRow[] } {
  const rules = ctx.rules ?? DEFAULT_PAY_RULES;
  const hpd = rules.scheduledHoursPerDay > 0 ? rules.scheduledHoursPerDay : 8;
  const rateWeekday = (emp.dailyRateWeekday ?? 0) > 0 ? emp.dailyRateWeekday! : (company.dailyWageWeekday ?? 9808);
  let rateSaturday = (emp.dailyRateSaturday ?? 0) > 0 ? emp.dailyRateSaturday! : (company.dailyWageSaturday ?? 12260);
  let rateSundayHour = company.hourlyWageSunday ?? 1655;
  let overtimeRate = emp.overtimeHourlyRate ?? 0;
  let personalNightRate = emp.lateNightHourlyRate ?? 0;
  const workDays = rec.workDays ?? 0;
  const saturdayDays = rec.saturdayWorkDays ?? 0;
  const sundayHours = rec.sundayWorkHours ?? 0;
  const holidayDays = rec.holidayWorkDays ?? 0;
  const paidLeaveDays = rec.paidLeaveDays ?? 0;
  const overtimeHoursRaw = rec.overtimeHours ?? 0;
  const lateNightHours = rec.lateNightHours ?? 0;
  const restOt = rules.restDayOvertime ? Math.max(0, rec.restDayOvertimeHours ?? 0) : 0;
  const isHourly = emp.salaryType === "hourly";
  const hourlyWage = isHourly ? (emp.baseSalary ?? 0) : 0;

  // ① 割増の基礎を「基本給＋算入する手当」から出す。今の単価より低くはしない（多く払うのは問題ない）。
  let baseHourly: number | null = null;
  if (rules.premiumBaseIncludesAllowances) {
    baseHourly = premiumBaseHourly(emp.salaryType, { weekdayDaily: rateWeekday, monthlyBase: emp.baseSalary ?? 0, hourlyWage }, ctx.premiumBaseAllowances ?? 0, rules);
    rateSaturday = Math.max(rateSaturday, Math.round(baseHourly * 1.25 * hpd));
    rateSundayHour = Math.max(rateSundayHour, Math.round(baseHourly * 1.35));
    overtimeRate = Math.max(overtimeRate, Math.round(baseHourly * 1.25));
    personalNightRate = Math.max(lateNightRateFor(personalNightRate, overtimeRate), Math.round(baseHourly * 0.25));
  }

  const rows: AutoRow[] = [];
  const put = (keyword: string, amount: number, note: string) => {
    const def = activeDefs.find((d) => d.name.includes(keyword));
    if (def) rows.push({ defId: def.id, amount, note });
  };

  // 有給
  if (rules.paidLeaveBySalaryType) {
    // ⑦ 給与の形ごと（労基法39条9項の「通常の賃金」）
    if (emp.salaryType === "fixed") {
      put("有給", 0, `月給のため有給の日の賃金は基本給に含まれます（自動）`);
    } else if (isHourly) {
      put("有給", Math.round(hourlyWage * hpd * paidLeaveDays), `勤怠の有給 ${paidLeaveDays}日 × 時給${yen(hourlyWage)} × ${hpd}時間（自動）`);
    } else {
      put("有給", Math.round(rateWeekday * paidLeaveDays), `勤怠の有給 ${paidLeaveDays}日 × ${yen(rateWeekday)}（自動）`);
    }
  } else {
    put("有給", Math.round(rateWeekday * paidLeaveDays), `勤怠の有給 ${paidLeaveDays}日 × ${rateWeekday.toLocaleString("ja-JP")}円（自動）`);
  }

  // 休日出勤（日曜だけ1.35倍＝日曜時給、土曜と祝日は1.25倍＝土曜日当）
  if (isHourly && rules.hourlyHolidayNoDouble) {
    // ⑧ 時給の人は基本給（時給×実働時間）に土日の時間も入っているので、割増の分（0.25・0.35）だけ払う
    const h = baseHourly ?? hourlyWage;
    const amount = Math.round((saturdayDays + holidayDays) * hpd * h * 0.25 + sundayHours * h * 0.35);
    put("休日出勤手当", amount, `土曜・祝日 ${saturdayDays + holidayDays}日×${hpd}時間×${yen(h)}×0.25 ＋ 日曜 ${sundayHours}h×${yen(h)}×0.35（割増分のみ・自動）`);
  } else {
    put("休日出勤手当", Math.round((saturdayDays + holidayDays) * rateSaturday + sundayHours * rateSundayHour),
      `勤怠の土曜 ${saturdayDays}日` + (holidayDays > 0 ? `＋祝日 ${holidayDays}日` : "") +
        ` × ${rateSaturday.toLocaleString("ja-JP")}円` +
        ` ＋ 日曜 ${sundayHours}h × ${rateSundayHour.toLocaleString("ja-JP")}円（自動）`);
  }

  // 早出残業（残業時給 × 時間。60時間超は ×1.20 を追加＝1.5倍）
  // 残業時給が未設定の社員は入れ直さない（手で入れた金額を0円で消さないため）。①が ON なら基礎から出す。
  const overtimeHours = overtimeHoursRaw + restOt;
  if (overtimeRate > 0) {
    const OT = 60;
    let pay: number;
    let note = `勤怠の残業 ${overtimeHoursRaw}h` + (restOt > 0 ? `＋土曜・祝日の8時間超 ${restOt}h` : "") + ` × ${overtimeRate.toLocaleString("ja-JP")}円`;
    if (rules.over60IncludesRestDays) {
      // ③ 60時間の判定に土曜・祝日の時間（日数×所定時間）を含める
      const restHours = (saturdayDays + holidayDays) * hpd;
      const over = Math.max(0, overtimeHours + restHours - OT);
      pay = Math.round(overtimeRate * overtimeHours) + Math.round(overtimeRate * 0.20 * over);
      if (over > 0) note += ` ＋ 60時間超 ${over}h × ${overtimeRate.toLocaleString("ja-JP")}円 × 0.2`;
    } else {
      pay = overtimeHours <= OT
        ? Math.round(overtimeRate * overtimeHours)
        : Math.round(overtimeRate * OT) + Math.round(overtimeRate * 1.20 * (overtimeHours - OT));
    }
    put("早出残業手当", pay, note + "（自動）");
  }
  if (overtimeRate > 0 || personalNightRate > 0) {
    const perHour = lateNightRateFor(personalNightRate, overtimeRate);
    put("深夜手当", Math.round(perHour * lateNightHours), `勤怠の深夜 ${lateNightHours}h × ${perHour.toLocaleString("ja-JP")}円（自動）`);
  }

  // ⑥ 歩合給の時間外の割増（労基則19条1項6号）：歩合給 ÷ 総労働時間 × 0.25 × 時間外の時間
  //   （60時間超の分はさらに0.25）。手当マスターに「歩合割増」を含む名前の手当がある場合だけ入れる。
  if (rules.commissionPremium && (ctx.commissionAmount ?? 0) > 0) {
    const total = (rec.actualWorkHours ?? 0) > 0
      ? rec.actualWorkHours!
      : (workDays + saturdayDays + holidayDays) * hpd + sundayHours + overtimeHours;
    if (total > 0) {
      const per = ctx.commissionAmount! / total;
      const over = Math.max(0, overtimeHours - 60);
      put("歩合割増", Math.round(per * 0.25 * overtimeHours + per * 0.25 * over),
        `業績手当 ${yen(ctx.commissionAmount!)} ÷ 総労働 ${total}h × 0.25 × 残業 ${overtimeHours}h（自動）`);
    }
  }

  return { base: emp.salaryType === "daily" ? Math.round(workDays * rateWeekday) : null, rows };
}

export function deriveAutoValues(
  emp: EmployeeForAuto,
  rec: AttendanceForAuto,
  company: CompanyForAuto,
  activeDefs: Array<{ id: number; name: string }>,
  ctx: AutoContext = {},
): AutoValues {
  const { base, rows } = deriveAutoRows(emp, rec, company, activeDefs, ctx);
  const a: Record<string, number> = {};
  for (const r of rows) a[String(r.defId)] = r.amount;
  return { base, a };
}

/** ① の算入手当・⑥ の歩合給を、その月の手当の行から集める */
export function autoContextFromAllowances(
  rows: Array<{ allowanceDefinitionId: number | null; amount: number; name?: string }>,
  premiumBaseDefIds: Set<number>,
  rules: PayRules,
): AutoContext {
  let premiumBaseAllowances = 0, commissionAmount = 0;
  for (const r of rows) {
    if (r.allowanceDefinitionId != null && premiumBaseDefIds.has(r.allowanceDefinitionId)) premiumBaseAllowances += r.amount || 0;
    if (r.name && /業績|歩合/.test(r.name) && !/歩合割増/.test(r.name)) commissionAmount += r.amount || 0;
  }
  return { rules, premiumBaseAllowances, commissionAmount };
}

// ────────────────────────────────────────────────────────────────────────────
// 欠勤控除（月給）⑨
// ────────────────────────────────────────────────────────────────────────────

export function absenceDeductionFor(monthlyBase: number, absenceDays: number, rules: PayRules, scheduledDaysInMonth?: number): number {
  if (!rules.absenceDeduction || absenceDays <= 0 || monthlyBase <= 0) return 0;
  const divisor = rules.absenceDeductionMethod === "monthlyAverage"
    ? rules.monthlyAverageWorkHours / (rules.scheduledHoursPerDay || 8)
    : rules.absenceDeductionMethod === "scheduledDays"
    ? (scheduledDaysInMonth ?? 0)
    : 22;
  if (!(divisor > 0)) return 0;
  return Math.round((monthlyBase / divisor) * Math.min(absenceDays, divisor));
}

// ────────────────────────────────────────────────────────────────────────────
// ブルーウィングの業績手当
// ────────────────────────────────────────────────────────────────────────────

export interface BluewingInput {
  bluewingSalesAmount: number;
  commissionRate: number;
  fixedOvertimeHours: number;
  overtimeHours: number;
  overtimeUnitPrice: number;
  baseSalary: number;
  fixedAllowancesTotal: number;
  holidayPay: number;
  fixedOvertimeAmount: number;
  lateNightPay: number;
}
export interface BluewingResult {
  actualOvertimeHours: number;
  actualOvertimePay: number;
  /** 60時間超の5割増の追加分（⑤） */
  over60Premium: number;
  solutionA: number;
  solutionB: number;
  solutionC: number;
  otRatio: number;
  adjustedRate: number;
  performanceAllowance: number;
  grossSalary: number;
}

/**
 * ブルーウィングの総支給 = 固定残業代 + 超過残業代 + 解答B + 業績手当
 *
 *   いまの式（④ OFF）：解答A＝売上 ×（歩合率 − 超過残業代÷売上）、業績手当＝A − B（0未満は0）
 *     → 残業代が増えるほど業績手当が減り、残業しても総額がほぼ変わらない形。
 *       国際自動車事件（最高裁 令和2年3月30日判決）で、この形は割増賃金を払ったことにならないと判断された。
 *   新しい式の候補（④ ON）：解答A＝売上 × 歩合率（残業代を差し引かない）、業績手当＝A − B（0未満は0）
 *     ※ 弁護士・社労士の確認が前提。賃金規程の書き換えも要る。
 */
export function bluewingCalc(i: BluewingInput, opts: { v2?: boolean; over60?: boolean } = {}): BluewingResult {
  const actualOvertimeHours = Math.max(0, i.overtimeHours - i.fixedOvertimeHours);
  let actualOvertimePay = Math.round(actualOvertimeHours * i.overtimeUnitPrice);
  // ⑤ 月60時間超の残業は5割増（残業単価は1.25倍込みなので 1.5/1.25 − 1 = 0.2 を足す）
  const over60Premium = opts.over60 ? Math.round(Math.max(0, i.overtimeHours - 60) * i.overtimeUnitPrice * 0.20) : 0;
  actualOvertimePay += over60Premium;
  const otRatio = !opts.v2 && i.bluewingSalesAmount > 0
    ? Math.round((actualOvertimePay / i.bluewingSalesAmount) * 1000) / 1000
    : 0;
  const adjustedRate = Math.max(0, i.commissionRate - otRatio);
  const solutionA = Math.floor(i.bluewingSalesAmount * adjustedRate);
  const solutionB = Math.floor(i.baseSalary + i.fixedAllowancesTotal + i.holidayPay + i.lateNightPay);
  const solutionC = solutionA - solutionB;
  const performanceAllowance = Math.max(0, solutionC);
  const grossSalary = Math.floor(i.fixedOvertimeAmount + actualOvertimePay + solutionB + performanceAllowance);
  return { actualOvertimeHours, actualOvertimePay, over60Premium, solutionA, solutionB, solutionC, otRatio, adjustedRate, performanceAllowance, grossSalary };
}

/** 固定残業代が「固定時間 × 残業時給」に足りているか（足りないと固定残業代として認められにくい） */
export function fixedOvertimeShortfall(fixedAmount: number, fixedHours: number, overtimeHourlyRate: number): number {
  if (fixedHours <= 0 || overtimeHourlyRate <= 0) return 0;
  return Math.max(0, Math.round(fixedHours * overtimeHourlyRate) - Math.round(fixedAmount));
}

// ────────────────────────────────────────────────────────────────────────────
// 最低賃金
// ────────────────────────────────────────────────────────────────────────────

/**
 * 最低賃金と比べる1時間あたりの額（最低賃金法4条・施行規則1条）。
 *   日給：日当 ÷ 1日の所定時間 ＋ 算入する手当 ÷ 月平均所定時間
 *   月給：（基本給＋算入する手当）÷ 月平均所定時間
 *   時給：時給 ＋ 算入する手当 ÷ 月平均所定時間
 * 時間外・休日・深夜の割増、通勤手当・家族手当・精皆勤手当、臨時の賃金は入れない
 * （このシステムでは「割増の基礎に入れる」印の手当を算入する手当として扱う）。
 */
export function hourlyForMinimumWage(
  salaryType: string | null,
  amounts: { weekdayDaily: number; monthlyBase: number; hourlyWage: number },
  includedAllowances: number,
  rules: Pick<PayRules, "scheduledHoursPerDay" | "monthlyAverageWorkHours">,
): number {
  return premiumBaseHourly(salaryType, amounts, includedAllowances, { ...DEFAULT_PAY_RULES, ...rules });
}

// ────────────────────────────────────────────────────────────────────────────
// 標準報酬月額の等級（算定基礎・月額変更の判定）
// ────────────────────────────────────────────────────────────────────────────

/** 健康保険の等級の並び（1〜50級）での位置。0 始まり。 */
export function healthGradeIndex(stdMonthly: number): number {
  const steps = [58, 68, 78, 88, 98, 104, 110, 118, 126, 134, 142, 150, 160, 170, 180, 190, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 410, 440, 470, 500, 530, 560, 590, 620, 650, 680, 710, 750, 790, 830, 880, 930, 980, 1030, 1090, 1150, 1210, 1270, 1330, 1390].map((x) => x * 1000);
  let best = 0;
  for (let k = 0; k < steps.length; k++) if (steps[k]! <= stdMonthly) best = k;
  return best;
}

export interface RemunerationMonth {
  /** 支払った月（年・月） */
  payYear: number;
  payMonth: number;
  /** 報酬の額（通勤手当を含む総支給。賞与は入れない） */
  amount: number;
  /** 支払基礎日数 */
  baseDays: number;
}

/** 定時決定：4〜6月に払った報酬のうち、支払基礎日数17日以上の月の平均を等級表に当てはめる */
export function teijiCandidate(months: RemunerationMonth[], minDays = 17): { average: number; standard: number; usedMonths: number } | null {
  const ok = months.filter((m) => m.baseDays >= minDays);
  if (ok.length === 0) return null;
  const average = Math.floor(ok.reduce((s, m) => s + m.amount, 0) / ok.length);
  return { average, standard: getInsuranceGrade(average).stdMonthly, usedMonths: ok.length };
}

/** 随時改定：固定的賃金が変わった月から3か月（いずれも17日以上）の平均で、2等級以上の差があるか */
export function zuijiCandidate(months: RemunerationMonth[], currentStandard: number, raised: boolean, minDays = 17): { average: number; standard: number; gradeDiff: number } | null {
  if (months.length < 3 || months.some((m) => m.baseDays < minDays)) return null;
  const average = Math.floor(months.reduce((s, m) => s + m.amount, 0) / months.length);
  const standard = getInsuranceGrade(average).stdMonthly;
  const gradeDiff = healthGradeIndex(standard) - healthGradeIndex(currentStandard);
  if (Math.abs(gradeDiff) < 2) return null;
  // 固定的賃金が上がったのに等級が下がる（またはその逆）は随時改定の対象外
  if ((raised && gradeDiff < 0) || (!raised && gradeDiff > 0)) return null;
  return { average, standard, gradeDiff };
}

// ────────────────────────────────────────────────────────────────────────────
// 有給休暇（労基法39条）
// ────────────────────────────────────────────────────────────────────────────

/** 継続勤務の年数ごとの付与日数（0.5年, 1.5年, …, 6.5年以上） */
const GRANT_FULL = [10, 11, 12, 14, 16, 18, 20];
/** 比例付与（週の所定労働日数が4日以下かつ週30時間未満）。労基則24条の3 */
const GRANT_PROPORTIONAL: Record<number, number[]> = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

export interface LeaveGrant {
  /** 付与日（YYYY-MM-DD） */
  date: string;
  days: number;
  /** 時効で消える日（付与日から2年。労基法115条） */
  expires: string;
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 入社日から、until の日までに付与される有給の一覧。
 * 出勤率8割以上は満たしているものとして数える（このシステムでは出勤率を判定できない）。
 */
export function paidLeaveGrants(hireDate: string | null | undefined, until: string, weeklyDays?: number | null, weeklyHours?: number | null): LeaveGrant[] {
  const h = parseYmd(hireDate);
  const u = parseYmd(until);
  if (!h || !u) return [];
  const proportional = (weeklyDays ?? 5) <= 4 && (weeklyHours ?? 40) < 30;
  const table = proportional ? GRANT_PROPORTIONAL[Math.max(1, Math.min(4, Math.floor(weeklyDays ?? 5)))] : GRANT_FULL;
  if (!table) return [];
  const out: LeaveGrant[] = [];
  const limit = Date.UTC(u.y, u.m - 1, u.d);
  for (let k = 0; k < 60; k++) {
    const g = new Date(Date.UTC(h.y, h.m - 1 + 6 + 12 * k, h.d));
    // 月末より後の日は月末に（例 8/31 入社 → 2/28）
    if (g.getUTCDate() !== h.d) g.setUTCDate(0);
    if (g.getTime() > limit) break;
    const ex = new Date(Date.UTC(g.getUTCFullYear() + 2, g.getUTCMonth(), g.getUTCDate()));
    out.push({ date: isoOf(g), days: table[Math.min(k, table.length - 1)]!, expires: isoOf(ex) });
  }
  return out;
}

export interface LeaveEvent {
  /** 取得日（YYYY-MM-DD） */
  date: string;
  days: number;
}
export interface LeaveAdjust {
  date: string;
  /** 付与として足す日数（＋）、取得済みとして引く日数（−） */
  days: number;
}
export interface LeaveLedgerRow extends LeaveGrant {
  used: number;
  remaining: number;
  expired: boolean;
}
export interface LeaveLedger {
  grants: LeaveLedgerRow[];
  /** 今日時点の残日数 */
  remaining: number;
  /** 付与で足りなかった取得（マイナスの残） */
  overdrawn: number;
  /** 年5日の取得義務（10日以上付与した日から1年）の状況 */
  obligations: Array<{ grantDate: string; deadline: string; taken: number; shortage: number }>;
}

/** 古い付与から順に使ったものとして、残日数と年5日の取得状況を出す */
export function paidLeaveLedger(grants: LeaveGrant[], taken: LeaveEvent[], adjustments: LeaveAdjust[], today: string): LeaveLedger {
  const rows: LeaveLedgerRow[] = [
    ...grants,
    ...adjustments.filter((a) => a.days > 0).map((a) => ({ date: a.date, days: a.days, expires: isoOf(new Date(Date.UTC(Number(a.date.slice(0, 4)) + 2, Number(a.date.slice(5, 7)) - 1, Number(a.date.slice(8, 10))))) })),
  ].sort((a, b) => a.date.localeCompare(b.date)).map((g) => ({ ...g, used: 0, remaining: g.days, expired: false }));
  const events = [
    ...taken,
    ...adjustments.filter((a) => a.days < 0).map((a) => ({ date: a.date, days: -a.days })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let overdrawn = 0;
  for (const e of events) {
    let need = e.days;
    for (const g of rows) {
      if (need <= 0) break;
      if (g.date > e.date || g.expires <= e.date || g.remaining <= 0) continue;
      const use = Math.min(g.remaining, need);
      g.used += use; g.remaining -= use; need -= use;
    }
    overdrawn += need;
  }
  for (const g of rows) g.expired = g.expires <= today;
  const remaining = rows.filter((g) => !g.expired && g.date <= today).reduce((s, g) => s + g.remaining, 0);
  const obligations = grants.filter((g) => g.days >= 10).map((g) => {
    const d = parseYmd(g.date)!;
    const deadline = isoOf(new Date(Date.UTC(d.y + 1, d.m - 1, d.d)));
    const t = taken.filter((e) => e.date >= g.date && e.date < deadline).reduce((s, e) => s + e.days, 0);
    return { grantDate: g.date, deadline, taken: t, shortage: Math.max(0, 5 - t) };
  });
  return { grants: rows, remaining, overdrawn, obligations };
}

// ────────────────────────────────────────────────────────────────────────────
// 賞与
// ────────────────────────────────────────────────────────────────────────────

/** 賞与に対する源泉徴収税額の算出率の表（会社設定に入れる。行＝前月の社保控除後の給与の「以上」と率） */
export interface BonusRateRow {
  /** 前月の社会保険料等控除後の給与等の金額（この額以上） */
  from: number;
  /** 扶養親族等の数 0〜7人の率（例 0.04084） */
  rates: number[];
}

export interface BonusInput {
  amount: number;
  /** その年度（4月〜翌3月）に、この賞与より前に払った標準賞与額の合計（健康保険の上限573万円用） */
  fiscalYearStandardBonusBefore: number;
  careInsuranceApplied: boolean;
  pensionApplied: boolean;
  healthApplied: boolean;
  employmentInsuranceApplied: boolean;
  /** 保険料率（合計の率ではなく本人負担） */
  rates: EmployeeRates;
  employmentInsuranceRate: number;
  socialInsuranceExempt?: boolean;
  employmentInsuranceExempt?: boolean;
  incomeTaxExempt?: boolean;
  withholding: WithholdingProfile;
  /** 前月の給与の社会保険料等控除後の金額（前月に給与が無ければ 0） */
  prevMonthAfterInsurance: number;
  /** 賞与の計算の対象になった期間の月数（6か月を超えるかで割る数が変わる） */
  periodMonths: number;
  /** 算出率の表（無いと通常の賞与の税額は出せない） */
  rateTable: BonusRateRow[] | null;
}

export interface BonusResult {
  standardBonus: number;
  healthStandard: number;
  pensionStandard: number;
  healthInsurance: number;
  childcareSupportContribution: number;
  pension: number;
  employmentInsurance: number;
  afterInsurance: number;
  incomeTax: number | null;
  incomeTaxMethod: "rate" | "monthly" | "none";
  incomeTaxError?: string;
  netAmount: number | null;
}

/** 標準賞与額の上限（健康保険法45条：年度573万円／厚生年金保険法24条の4：1回150万円） */
export const HEALTH_BONUS_ANNUAL_CAP = 5_730_000;
export const PENSION_BONUS_CAP = 1_500_000;

export function calcBonus(i: BonusInput): BonusResult {
  const standardBonus = Math.floor(Math.max(0, i.amount) / 1000) * 1000;
  const healthStandard = Math.max(0, Math.min(standardBonus, HEALTH_BONUS_ANNUAL_CAP - Math.max(0, i.fiscalYearStandardBonusBefore)));
  const pensionStandard = Math.min(standardBonus, PENSION_BONUS_CAP);
  const social = !i.socialInsuranceExempt;
  const healthOn = social && i.healthApplied;
  const healthRate = i.careInsuranceApplied ? i.rates.healthWithCareEmployeeRate : i.rates.healthEmployeeRate;
  const healthInsurance = healthOn ? round50sen(healthStandard * healthRate) : 0;
  const childcareSupportContribution = healthOn ? round50sen(healthStandard * i.rates.childcareEmployeeRate) : 0;
  const pension = social && i.pensionApplied ? round50sen(pensionStandard * i.rates.pensionEmployeeRate) : 0;
  const employmentInsurance = i.employmentInsuranceExempt || !i.employmentInsuranceApplied ? 0 : round50sen(i.amount * i.employmentInsuranceRate);
  const afterInsurance = i.amount - healthInsurance - childcareSupportContribution - pension - employmentInsurance;

  let incomeTax: number | null = 0;
  let incomeTaxMethod: BonusResult["incomeTaxMethod"] = "none";
  let incomeTaxError: string | undefined;
  if (!i.incomeTaxExempt) {
    // 前月に給与が無い、または賞与（社保控除後）が前月の給与（社保控除後）の10倍を超える：月額表で計算（所得税法186条2項）
    if (i.prevMonthAfterInsurance <= 0 || afterInsurance > i.prevMonthAfterInsurance * 10) {
      incomeTaxMethod = "monthly";
      const div = i.periodMonths > 6 ? 12 : 6;
      try {
        const per = Math.floor(afterInsurance / div);
        const t = monthlyWithholdingTax(Math.max(0, i.prevMonthAfterInsurance) + per, i.withholding)
          - monthlyWithholdingTax(Math.max(0, i.prevMonthAfterInsurance), i.withholding);
        incomeTax = Math.max(0, t) * div;
      } catch (e) {
        incomeTax = null;
        incomeTaxError = e instanceof Error ? e.message : String(e);
      }
    } else if (i.withholding.taxColumn === "otsu") {
      incomeTax = null; incomeTaxMethod = "rate";
      incomeTaxError = "乙欄の算出率は入っていません。";
    } else if (!i.rateTable || i.rateTable.length === 0) {
      incomeTax = null; incomeTaxMethod = "rate";
      incomeTaxError = "賞与に対する源泉徴収税額の算出率の表が会社設定に入っていません。";
    } else {
      incomeTaxMethod = "rate";
      const dep = Math.min(7, dependentEquivalentCount(i.withholding));
      const rows = [...i.rateTable].sort((a, b) => a.from - b.from);
      let row = rows[0]!;
      for (const r of rows) if (r.from <= i.prevMonthAfterInsurance) row = r;
      const rate = row.rates[dep] ?? 0;
      incomeTax = Math.floor(Math.max(0, afterInsurance) * rate);
    }
  }
  const netAmount = incomeTax === null ? null : i.amount - healthInsurance - childcareSupportContribution - pension - employmentInsurance - incomeTax;
  return { standardBonus, healthStandard, pensionStandard, healthInsurance, childcareSupportContribution, pension, employmentInsurance, afterInsurance, incomeTax, incomeTaxMethod, incomeTaxError, netAmount };
}

// ────────────────────────────────────────────────────────────────────────────
// 住民税（特別徴収）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 給与明細の年月から、住民税を「何年何月の徴収分」として引くか。
 * 明細の年月＝勤務した月、支払いは翌月。特別徴収は「支払った月」の分を引く
 * （6月分＝6月に払う給与＝5月分の明細）。
 */
export function residentTaxCollectMonth(payslipYear: number, payslipMonth: number): { year: number; month: number } {
  return payslipMonth === 12 ? { year: payslipYear + 1, month: 1 } : { year: payslipYear, month: payslipMonth + 1 };
}

/** 徴収の年月が属する年度（6月〜翌5月）の始まりの年 */
export function residentTaxFiscalYear(collectYear: number, collectMonth: number): number {
  return collectMonth >= 6 ? collectYear : collectYear - 1;
}

// ────────────────────────────────────────────────────────────────────────────
// 日付
// ────────────────────────────────────────────────────────────────────────────

/** タイムゾーンに左右されない YYYY-MM-DD（day が月末を超えたら月末にする） */
export function ymd(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(Math.max(1, day), last);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 給与明細の年月の締め日と支払日（支払日は翌月） */
export function payrollDates(year: number, month: number, closingDay: number, paymentDay: number): { closing: string; payment: string } {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { closing: ymd(year, month, closingDay || 31), payment: ymd(next.y, next.m, paymentDay || 25) };
}

// ────────────────────────────────────────────────────────────────────────────
// 給与の仕訳（振替伝票）
//   ※ 勘定科目・計上日の決まりは会社と税理士で決めるもの。ここは一般的な形（税理士に確認すること）。
//   本人負担の保険料・税＝預り金（貸方）／会社負担＝法定福利費（借方）／差引支給額＝未払金（未払給与）
// ────────────────────────────────────────────────────────────────────────────

export interface JournalPayrollRow {
  grossSalary: number;
  healthInsurance: number;
  childcareSupportContribution: number;
  pension: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  /** その他の控除（積立金・カスタム控除・その他控除） */
  otherDeductions: number;
  netSalary: number;
  /** 会社負担の計算に使う：標準報酬月額と料率（合計の率） */
  standardRemuneration: number;
  healthRateTotal: number;
  careRateTotal: number;
  childcareRateTotal: number;
  pensionRateTotal: number;
  pensionMaxStandard: number;
  /** 雇用保険の計算基礎（総支給 − 対象外の手当） */
  employmentInsuranceBase: number;
}

export interface JournalLine {
  date: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
}

export function buildPayrollJournal(
  rows: JournalPayrollRow[],
  opts: { label: string; entryDate: string; paymentDate: string; employerEmploymentRate: number; childContributionRate: number },
): JournalLine[] {
  const sum = (f: (r: JournalPayrollRow) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const gross = sum((r) => r.grossSalary);
  const health = sum((r) => r.healthInsurance);
  const childcare = sum((r) => r.childcareSupportContribution);
  const pension = sum((r) => r.pension);
  const ei = sum((r) => r.employmentInsurance);
  const tax = sum((r) => r.incomeTax);
  const resident = sum((r) => r.residentTax);
  const other = sum((r) => r.otherDeductions);
  // 差引支給額は、総支給から控除を引いた残り（明細ごとの丸めの差があっても借方と貸方が合うように）
  const net = gross - health - childcare - pension - ei - tax - resident - other;

  // 会社負担＝（全員の標準報酬 × 料率の合計を円未満切り捨て）−（本人負担の合計）。協会けんぽの納入告知と同じ考え方。
  const pensionBase = (r: JournalPayrollRow) => Math.min(Math.max(r.standardRemuneration, PENSION_MIN_STD), r.pensionMaxStandard || PENSION_MAX_STD);
  const healthTotal = Math.floor(rows.filter((r) => r.healthInsurance > 0).reduce((s, r) => s + r.standardRemuneration * (r.healthRateTotal + r.careRateTotal), 0));
  const childcareTotal = Math.floor(rows.filter((r) => r.childcareSupportContribution > 0).reduce((s, r) => s + r.standardRemuneration * r.childcareRateTotal, 0));
  const pensionRows = rows.filter((r) => r.pension > 0);
  const pensionTotal = Math.floor(pensionRows.reduce((s, r) => s + pensionBase(r) * r.pensionRateTotal, 0));
  const employerHealth = Math.max(0, healthTotal - health);
  const employerChildcare = Math.max(0, childcareTotal - childcare);
  const employerPension = Math.max(0, pensionTotal - pension);
  const childContribution = Math.floor(pensionRows.reduce((s, r) => s + pensionBase(r) * opts.childContributionRate, 0));
  const employerEi = rows.filter((r) => r.employmentInsurance > 0).reduce((s, r) => s + Math.round(r.employmentInsuranceBase * opts.employerEmploymentRate), 0);

  const L = opts.label;
  const d = opts.entryDate;
  const lines: JournalLine[] = [
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（健康保険料）", amount: health, description: `${L} 健康保険料・介護保険料（本人負担）` },
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（子ども・子育て支援金）", amount: childcare, description: `${L} 子ども・子育て支援金（本人負担）` },
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（厚生年金保険料）", amount: pension, description: `${L} 厚生年金保険料（本人負担）` },
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（雇用保険料）", amount: ei, description: `${L} 雇用保険料（本人負担）` },
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（源泉所得税）", amount: tax, description: `${L} 源泉所得税` },
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（住民税）", amount: resident, description: `${L} 住民税（特別徴収）` },
    { date: d, debitAccount: "給料手当", creditAccount: "預り金（その他）", amount: other, description: `${L} その他の控除（積立金など）` },
    { date: d, debitAccount: "給料手当", creditAccount: "未払金（未払給与）", amount: net, description: `${L} 差引支給額` },
    { date: d, debitAccount: "法定福利費", creditAccount: "未払金（社会保険料）", amount: employerHealth, description: `${L} 健康保険料・介護保険料（会社負担）` },
    { date: d, debitAccount: "法定福利費", creditAccount: "未払金（社会保険料）", amount: employerChildcare, description: `${L} 子ども・子育て支援金（会社負担）` },
    { date: d, debitAccount: "法定福利費", creditAccount: "未払金（社会保険料）", amount: employerPension, description: `${L} 厚生年金保険料（会社負担）` },
    { date: d, debitAccount: "法定福利費", creditAccount: "未払金（社会保険料）", amount: childContribution, description: `${L} 子ども・子育て拠出金（会社のみ）` },
    { date: d, debitAccount: "法定福利費", creditAccount: "未払費用（労働保険料）", amount: employerEi, description: `${L} 雇用保険料（会社負担）` },
    { date: opts.paymentDate, debitAccount: "未払金（未払給与）", creditAccount: "普通預金", amount: net, description: `${L} 給与の振込` },
  ];
  return lines.filter((l) => l.amount !== 0);
}
