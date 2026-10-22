/**
 * 給与計算エンジン（運送業特化）
 *
 * 令和8年（2026年）対応:
 *  - 健康保険料: 協会けんぽ東京支部 9.85%（介護ありは +1.62% = 11.47%）÷ 2
 *  - 子ども・子育て支援金: 0.23% ÷ 2（健保とは別控除）
 *  - 厚生年金: 18.3% ÷ 2（上限 650,000円）
 *  - 雇用保険: 総支給額 × 0.5%（令和8年度一般事業）
 *  - 源泉所得税: 令和8年分 月額表甲欄テーブル参照方式
 */

import {
  calculateInsuranceAndTax,
  calculateIncomeTaxReiwa8,
  EMP_INS_RATE_R8,
  type EmployeeInsuranceRates,
} from "./tax-tables-reiwa8";

/**
 * 端数処理：50銭以下切り捨て、50銭超え切り上げ
 */
export function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  return fraction <= 0.5 ? Math.floor(amount) : Math.ceil(amount);
}

/**
 * 支給額（時間 × 単価）の端数処理：四捨五入。
 *
 * roundJapanese は「50銭以下切り捨て」＝社会保険料の通達ルールで、支給額に使うと
 *   39.5h × 2,111円 = 83,384.5 → 83,384
 * となり、事務所の手計算（四捨五入で 83,385）と1円ズレる。
 * ブルーウィング分岐は元々 Math.round を使っていたため、標準計算もこちらに揃える。
 * 保険料・税・総支給の端数処理は roundJapanese のまま（1円単位の完全一致要件があるため）。
 */
export function roundPayYen(amount: number): number {
  return Math.round(amount);
}

/**
 * 深夜割増の1時間単価を「割増込みの残業時給」から復元する。
 *   残業時給 ÷ 1.25 = 素の時給 → × 0.25 = 深夜割増
 *   例) 2,111円/h → round(2111/1.25)=1,689 → round(1689×0.25)=422円/h
 *       1,750円/h → round(1750/1.25)=1,400 → round(1400×0.25)=350円/h
 *       1,909円/h → round(1909/1.25)=1,527 → round(1527×0.25)=382円/h
 *
 * 端数は四捨五入。事務所の手計算（上記3件）と一致するのは四捨五入だけで、
 * 切り捨てにすると 1,909円/h の社員が 381円/h になり1円ズレる。
 *
 * ブルーウィング分岐（routes/payroll.ts）が元々この式を使っており、標準計算だけが
 * 「基本給 ÷ 月平均労働時間 × 0.25」を使っていたため、残業単価で運用している社員の
 * 深夜手当が実態と合わない（基本給が0なら深夜手当も0）状態だった。両者をこの関数に揃える。
 */
export function lateNightPremiumPerHour(overtimeHourlyRate: number): number {
  return Math.round(Math.round(overtimeHourlyRate / 1.25) * 0.25);
}

/**
 * 深夜手当の1時間あたりの単価。
 * 社員マスタに個人の深夜単価があればそれを使い、無ければ残業単価から求める。
 * （残業単価と深夜単価の基礎が違う社員がいる。例: 残業 1,750円/h・深夜 393円/h）
 */
export function lateNightRateFor(personalLateNightRate: number | null | undefined, overtimeHourlyRate: number): number {
  return (personalLateNightRate ?? 0) > 0 ? personalLateNightRate! : lateNightPremiumPerHour(overtimeHourlyRate);
}

export interface CustomAllowanceItem {
  allowanceDefinitionId: number;
  allowanceName: string;
  isTaxable: boolean;
  /** 雇用保険の計算基礎から除外するか（携帯代など実費弁償の手当）*/
  excludeFromEmploymentInsurance?: boolean;
  amount: number;
}

export interface PayrollCalculationInput {
  /** 固定給の場合: 月額固定給。日給制の場合: 計算に使用しない（0でよい） */
  baseSalary: number;
  /** 'fixed' = 月額固定, 'daily' = 日給制 */
  salaryType: string;
  /** 日給制: 平日日給 */
  dailyRateWeekday: number;
  /** 日給制: 土曜日給 */
  dailyRateSaturday: number;
  transportationAllowance: number;
  safetyDrivingAllowance: number;
  longDistanceAllowance: number;
  positionAllowance: number;
  familyAllowance: number;
  earlyOvertimeAllowance: number;
  commissionRatePerKm: number;
  commissionRatePerCase: number;
  dependentCount: number;
  hasSpouse: boolean;
  /**
   * 標準報酬月額（健保・厚年の計算基礎）
   * > 0 の場合はその値を直接使用
   * = 0 の場合は grossSalary で計算
   */
  standardRemuneration: number;
  /** 介護保険適用（40〜64歳）*/
  careInsuranceApplied?: boolean;
  /** 雇用保険適用（false の場合は0円）*/
  employmentInsuranceApplied?: boolean;
  /** 雇用保険料を手で決めた額（null/undefined＝自動計算） */
  employmentInsuranceOverride?: number | null;
  /** 厚生年金適用（false の場合は0円）*/
  pensionApplied?: boolean;
  /** 雇用保険料率（省略時は EMP_INS_RATE_R8 = 0.005）*/
  employmentInsuranceRate?: number;
  /** 健保・介護・子育て支援金・厚年の本人負担率（保険料率マスター。省略時は令和8年度の内蔵値）*/
  insuranceRates?: EmployeeInsuranceRates;
  residentTax: number;
  monthlyAverageWorkHours: number;
  // Monthly record
  workDays: number;
  saturdayWorkDays: number;
  /**
   * 日曜・祝日の出勤「時間」。sundayHourlyRate × この時間 で計算する。
   * （2026-08 仕様変更: 以前は日数 × 日当 × 1.35 だった）
   */
  sundayWorkHours: number;
  /** 日曜・祝日の時給（会社設定 hourlyWageSunday。既定 1,655円/h）*/
  sundayHourlyRate: number;
  overtimeHours: number;
  lateNightHours: number;
  holidayWorkDays: number;
  drivingDistanceKm: number;
  deliveryCases: number;
  absenceDays: number;
  /** 時給制（hourly）の場合の月間実働時間（30分切り上げ済み）*/
  actualWorkHours?: number;
  /** 個人 平日日当（>0 の場合は dailyRateWeekday を上書き） */
  empDailyRateWeekday?: number;
  /** 個人 休日(土曜)日当（>0 の場合は dailyRateSaturday を上書き） */
  empDailyRateSaturday?: number;
  /**
   * 個人 残業時給（>0 の場合に採用）
   * overtimePay = overtimeHours × empOvertimeHourlyRate （1.25倍はかけず単価そのもの）
   */
  empOvertimeHourlyRate?: number;
  /** 個人 深夜単価（円/時）。>0 のときは残業単価からの自動計算より優先する */
  empLateNightHourlyRate?: number;
  /**
   * 残業を n 分単位で切り上げ計算する場合の単位（分）
   * 例: 10 → 10分未満でも 1 単位として計上
   * null / 0 = 標準計算（時間外時間 × 割増時給）
   */
  overtimeUnitMinutes?: number | null;
  /** overtimeUnitMinutes が設定されている場合の 1 単位あたり加算額（円）*/
  overtimeUnitRate?: number;
  // Custom allowances
  customAllowances?: CustomAllowanceItem[];
  /** 全額非課税フラグ（true=社会保険・所得税・住民税すべて控除なし、手取り=総支給）*/
  taxExempt?: boolean;
  /** デバッグ用トレースログを出力するか（省略時 false）*/
  enableTrace?: boolean;
  /** トレースログ出力時の期待値（照合用）*/
  traceExpectedIncomeTax?: number;
}

export interface PayrollCalculationResult {
  baseSalary: number;
  /** 土曜出勤分（日給制標準: 土曜出勤日数×土曜日当）。基本給からは別出し。*/
  saturdayPay: number;
  overtimePay: number;
  lateNightPay: number;
  holidayPay: number;
  /** 日曜・祝日出勤手当（日曜時給 × 出勤時間）*/
  sundayPay: number;
  commissionPay: number;
  transportationAllowance: number;
  safetyDrivingAllowance: number;
  longDistanceAllowance: number;
  positionAllowance: number;
  familyAllowance: number;
  earlyOvertimeAllowance: number;
  customAllowancesTotal: number;
  absenceDeduction: number;
  grossSalary: number;
  /** 健康保険料（介護保険込みまたはなし）*/
  healthInsurance: number;
  /** 子ども・子育て支援金 */
  childcareSupportContribution: number;
  /** 厚生年金保険料 */
  pension: number;
  /** 健保＋子育て支援金＋厚年の合計（社会保険料合計として DB に保存する値）*/
  socialInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  totalDeductions: number;
  netSalary: number;
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const {
    salaryType,
    dailyRateSaturday,
    transportationAllowance,
    safetyDrivingAllowance,
    longDistanceAllowance,
    positionAllowance,
    familyAllowance,
    earlyOvertimeAllowance,
    commissionRatePerKm,
    commissionRatePerCase,
    dependentCount,
    hasSpouse,
    standardRemuneration,
    careInsuranceApplied = false,
    employmentInsuranceApplied = true,
    pensionApplied = true,
    employmentInsuranceRate = EMP_INS_RATE_R8,
    residentTax,
    monthlyAverageWorkHours,
    workDays,
    saturdayWorkDays,
    sundayWorkHours,
    sundayHourlyRate,
    overtimeHours,
    lateNightHours,
    holidayWorkDays,
    drivingDistanceKm,
    deliveryCases,
    absenceDays,
    customAllowances = [],
  } = input;

  // 個人単価（>0 の場合は会社共通単価を上書き）
  const effectiveWeekdayRate = (input.empDailyRateWeekday ?? 0) > 0
    ? input.empDailyRateWeekday!
    : input.dailyRateWeekday;
  const effectiveSaturdayRate = (input.empDailyRateSaturday ?? 0) > 0
    ? input.empDailyRateSaturday!
    : dailyRateSaturday;

  // ────────────────────────────────────────────────────────────────
  // 基本給・時給単価の決定
  // ────────────────────────────────────────────────────────────────
  let baseSalary: number;
  let hourlyRate: number;

  if (salaryType === "daily") {
    // 基本給は平日のみ（土曜分は saturdayPay として別出し）
    baseSalary = roundJapanese(workDays * effectiveWeekdayRate);
    hourlyRate = effectiveWeekdayRate / 8;
  } else if (salaryType === "hourly") {
    // 時給制: baseSalary = 時給単価。実働時間（30分切り上げ済み）× 時給 で基本給を算出
    hourlyRate = input.baseSalary;
    baseSalary = roundJapanese(hourlyRate * (input.actualWorkHours ?? 0));
  } else {
    baseSalary = input.baseSalary;
    hourlyRate = monthlyAverageWorkHours > 0 ? baseSalary / monthlyAverageWorkHours : 0;
  }

  // ────────────────────────────────────────────────────────────────
  // 時間外手当・深夜手当・休日手当・日曜出勤手当
  // 労基法37条3項: 月60時間超の時間外は×1.50（60時間以内は×1.25）
  // ────────────────────────────────────────────────────────────────
  const OT_THRESHOLD = 60; // 時間
  let overtimePay: number;
  if ((input.empOvertimeHourlyRate ?? 0) > 0) {
    // 個人残業時給: 入力値がそのまま残業時給（割増込み）
    // 60h超部分は ×(1.50/1.25)=1.20 を追加乗算
    const baseRate = input.empOvertimeHourlyRate!;
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = roundPayYen(baseRate * overtimeHours);
    } else {
      overtimePay =
        roundPayYen(baseRate * OT_THRESHOLD) +
        roundPayYen(baseRate * 1.20 * (overtimeHours - OT_THRESHOLD));
    }
  } else if ((input.overtimeUnitMinutes ?? 0) > 0 && (input.overtimeUnitRate ?? 0) > 0) {
    // 単位切り上げ計算: 例）10分単位で2031円
    // 60h超部分のユニットには割増係数(1.50/1.25=1.20)を乗じる
    const unitMins = input.overtimeUnitMinutes!;
    const unitRate = input.overtimeUnitRate!;
    const overtimeMins = overtimeHours * 60;
    if (overtimeHours <= OT_THRESHOLD) {
      const units = overtimeMins > 0 ? Math.ceil(overtimeMins / unitMins) : 0;
      overtimePay = roundPayYen(units * unitRate);
    } else {
      const unitsNormal = Math.ceil((OT_THRESHOLD * 60) / unitMins);
      const overMins = overtimeMins - OT_THRESHOLD * 60;
      const unitsOver = overMins > 0 ? Math.ceil(overMins / unitMins) : 0;
      overtimePay =
        roundPayYen(unitsNormal * unitRate) +
        roundPayYen(unitsOver * unitRate * 1.20);
    }
  } else {
    // 標準計算: 60h以内×1.25、60h超×1.50
    if (overtimeHours <= OT_THRESHOLD) {
      overtimePay = roundPayYen(hourlyRate * 1.25 * overtimeHours);
    } else {
      overtimePay =
        roundPayYen(hourlyRate * 1.25 * OT_THRESHOLD) +
        roundPayYen(hourlyRate * 1.50 * (overtimeHours - OT_THRESHOLD));
    }
  }
  // 深夜手当: 個人残業時給が設定されていれば、そこから復元した素の時給の25%を使う。
  // （設定が無い社員だけ従来どおり 基本給ベースの時給 × 0.25）
  const lateNightPay = (input.empLateNightHourlyRate ?? 0) > 0 || (input.empOvertimeHourlyRate ?? 0) > 0
    ? Math.floor(lateNightRateFor(input.empLateNightHourlyRate, input.empOvertimeHourlyRate ?? 0) * lateNightHours)
    : roundJapanese(hourlyRate * 0.25 * lateNightHours);
  // 祝日手当（holidayWorkDays）は 日当 × 1.25 × 日数（土曜と同じ。1.35倍は日曜だけ）。
  // 日曜・祝日手当（sundayWorkHours）は 2026-08 から「時間 × 日曜時給（既定1,655円/h）」。
  let holidayPay: number;
  let sundayPay: number;
  let saturdayPay: number;
  {
    const standardDailyRate = salaryType === "daily" ? effectiveWeekdayRate : hourlyRate * 8;
    holidayPay  = roundJapanese(standardDailyRate * 1.25 * holidayWorkDays);
    sundayPay   = roundPayYen(sundayHourlyRate * sundayWorkHours);
    saturdayPay = salaryType === "daily"
      ? roundJapanese(saturdayWorkDays * effectiveSaturdayRate)
      : 0;
  }

  // 歩合給
  const commissionPay = roundJapanese(
    drivingDistanceKm * commissionRatePerKm + deliveryCases * commissionRatePerCase
  );

  // 欠勤控除
  let absenceDeduction: number;
  if (salaryType === "daily") {
    absenceDeduction = roundJapanese(effectiveWeekdayRate * absenceDays);
  } else {
    absenceDeduction = roundJapanese((baseSalary / 22) * absenceDays);
  }

  // カスタム手当合計（課税・非課税別に集計）
  const taxableCustomTotal    = customAllowances.filter(a =>  a.isTaxable).reduce((s, a) => s + a.amount, 0);
  const nonTaxableCustomTotal = customAllowances.filter(a => !a.isTaxable).reduce((s, a) => s + a.amount, 0);
  const customAllowancesTotal = taxableCustomTotal + nonTaxableCustomTotal;

  // 支給合計
  const grossSalary = roundJapanese(
    baseSalary +
    saturdayPay +
    overtimePay +
    lateNightPay +
    holidayPay +
    sundayPay +
    commissionPay +
    transportationAllowance +
    safetyDrivingAllowance +
    longDistanceAllowance +
    positionAllowance +
    familyAllowance +
    earlyOvertimeAllowance +
    customAllowancesTotal -
    absenceDeduction
  );

  // ────────────────────────────────────────────────────────────────
  // 社会保険料・雇用保険・源泉所得税
  // standard_remuneration > 0 → その値を直接使用
  // standard_remuneration = 0 → grossSalary を計算基礎とする
  // ────────────────────────────────────────────────────────────────
  const insBase = (standardRemuneration ?? 0) > 0 ? standardRemuneration : grossSalary;

  // 非課税手当（通勤手当＋非課税カスタム手当）
  // transportationAllowance は非課税扱い（月15万以内の通勤手当）
  const nonTaxableAllowances = transportationAllowance + nonTaxableCustomTotal;

  // 雇用保険の計算基礎から除外する手当合計（「雇用保険の対象外」ON の手当のみ。通勤手当は含めない）
  const empInsExcludedTotal = customAllowances
    .filter(a => a.excludeFromEmploymentInsurance)
    .reduce((s, a) => s + a.amount, 0);

  const ins = calculateInsuranceAndTax({
    standardRemuneration: insBase,
    grossSalary,
    nonTaxableAllowances,
    employmentInsuranceExcludedAllowances: empInsExcludedTotal,
    dependentCount,
    hasSpouse,
    careInsuranceApplied,
    pensionApplied,
    employmentInsuranceApplied,
    employmentInsuranceOverride: input.employmentInsuranceOverride,
    residentTax,
    customDeductionsTotal: 0,
    employmentInsuranceRate,
    insuranceRates: input.insuranceRates,
    enableTrace: input.enableTrace,
    traceExpectedIncomeTax: input.traceExpectedIncomeTax,
  });

  // 全額非課税の場合は社会保険料・雇用保険・所得税を0にする（住民税は引き続き控除）
  const isExempt = input.taxExempt === true;

  const healthInsurance             = isExempt ? 0 : ins.healthInsurance;
  const childcareSupportContribution = isExempt ? 0 : ins.childcareSupportContribution;
  const pension                     = isExempt ? 0 : ins.pension;
  const socialInsurance             = healthInsurance + childcareSupportContribution + pension;
  const employmentInsurance         = isExempt ? 0 : ins.employmentInsurance;
  const incomeTax                   = isExempt ? 0 : ins.incomeTax;
  const effectiveResidentTax        = residentTax;

  // 控除合計（社保＋雇保＋源泉＋住民税）
  const totalDeductions = roundJapanese(
    socialInsurance + employmentInsurance + incomeTax + effectiveResidentTax
  );

  // 差引支給額
  const netSalary = roundJapanese(grossSalary - totalDeductions);

  return {
    baseSalary,
    saturdayPay,
    overtimePay,
    lateNightPay,
    holidayPay,
    sundayPay,
    commissionPay,
    transportationAllowance,
    safetyDrivingAllowance,
    longDistanceAllowance,
    positionAllowance,
    familyAllowance,
    earlyOvertimeAllowance,
    customAllowancesTotal,
    absenceDeduction,
    grossSalary,
    healthInsurance,
    childcareSupportContribution,
    pension,
    socialInsurance,
    employmentInsurance,
    incomeTax,
    residentTax,
    totalDeductions,
    netSalary,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ブルーウィング給与計算ロジック
// ────────────────────────────────────────────────────────────────────────────

export interface BluewingPayrollInput {
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

export interface BluewingPayrollResult {
  actualOvertimeHours: number;
  actualOvertimePay: number;
  /** 公式A: 売上 × (歩合率 - 超過残業代/売上) */
  solutionA: number;
  /** 公式B: 基本給 + 各手当 + 休日出勤 + 深夜手当（固定残業代・超過残業代は含まない） */
  solutionB: number;
  /** 解答C = A - B（マイナスなら業績手当なし） */
  solutionC: number;
  performanceAllowance: number;
  grossSalary: number;
}

export function calculateBluewingPayroll(input: BluewingPayrollInput): BluewingPayrollResult {
  const {
    bluewingSalesAmount,
    commissionRate,
    fixedOvertimeHours,
    overtimeHours,
    overtimeUnitPrice,
    baseSalary,
    fixedAllowancesTotal,
    holidayPay,
    fixedOvertimeAmount,
    lateNightPay,
  } = input;

  // 超過残業（固定時間を超えた分）
  const actualOvertimeHours = Math.max(0, overtimeHours - fixedOvertimeHours);
  const actualOvertimePay   = Math.round(actualOvertimeHours * overtimeUnitPrice);

  // 公式A: 超過残業代の売上比率を歩合率から差し引いた実効歩合率 × 売上
  const otRatio      = bluewingSalesAmount > 0
    ? Math.round((actualOvertimePay / bluewingSalesAmount) * 1000) / 1000  // 小数第3位まで
    : 0;
  const adjustedRate = Math.max(0, commissionRate - otRatio);
  const solutionA    = Math.floor(bluewingSalesAmount * adjustedRate);

  // 公式B: 基本給 + 各手当 + 休日出勤 + 深夜手当（固定残業代・超過残業代は含まない）
  const solutionB = Math.floor(baseSalary + fixedAllowancesTotal + holidayPay + lateNightPay);

  // 解答C = A - B → プラスのときのみ業績手当
  const solutionC            = solutionA - solutionB;
  const performanceAllowance = Math.max(0, solutionC);

  // 総支給 = 固定残業代 + 超過残業代 + 解答B + 業績手当
  const grossSalary = Math.floor(fixedOvertimeAmount + actualOvertimePay + solutionB + performanceAllowance);

  return {
    actualOvertimeHours,
    actualOvertimePay,
    solutionA,
    solutionB,
    solutionC,
    performanceAllowance,
    grossSalary,
  };
}
