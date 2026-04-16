/**
 * 社会保険料・源泉徴収税額 計算モジュール
 *
 * 社会保険: 協会けんぽ東京支部 標準報酬月額等級テーブル方式
 * 源泉所得税: 国税庁 給与所得の源泉徴収税額表（月額表）甲欄
 *   - 令和7年版（現行デフォルト）
 *   - 令和8年版（将来切替用）
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. 社会保険料（健康保険・厚生年金）等級テーブル
// ────────────────────────────────────────────────────────────────────────────

const HEALTH_RATE_HALF = 0.04925;   // 健康保険料率 9.85% の折半
const PENSION_RATE_HALF = 0.09150;  // 厚生年金保険料率 18.300% の折半
const PENSION_MAX_STD = 650_000;    // 厚生年金標準報酬月額の上限

/**
 * 標準報酬月額等級テーブル
 * [報酬月額以上, 報酬月額未満, 標準報酬月額, 厚生年金適用]
 * 厚生年金適用 false = 健康保険のみ（グレード1-3）
 */
const INSURANCE_GRADES: [number, number, number, boolean][] = [
  [          0,  63_000,  58_000, false],
  [ 63_000,  73_000,  68_000, false],
  [ 73_000,  83_000,  78_000, false],
  [ 83_000,  93_000,  88_000,  true],
  [ 93_000, 101_000,  98_000,  true],
  [101_000, 107_000, 104_000,  true],
  [107_000, 114_000, 110_000,  true],
  [114_000, 122_000, 118_000,  true],
  [122_000, 130_000, 126_000,  true],
  [130_000, 138_000, 134_000,  true],
  [138_000, 146_000, 142_000,  true],
  [146_000, 155_000, 150_000,  true],
  [155_000, 165_000, 160_000,  true],
  [165_000, 175_000, 170_000,  true],
  [175_000, 185_000, 180_000,  true],
  [185_000, 195_000, 190_000,  true],
  [195_000, 210_000, 200_000,  true],
  [210_000, 230_000, 220_000,  true],
  [230_000, 250_000, 240_000,  true],
  [250_000, 270_000, 260_000,  true],
  [270_000, 290_000, 280_000,  true],
  [290_000, 310_000, 300_000,  true],
  [310_000, 330_000, 320_000,  true],
  [330_000, 350_000, 340_000,  true],
  [350_000, 370_000, 360_000,  true],
  [370_000, 395_000, 380_000,  true],
  [395_000, 425_000, 410_000,  true],
  [425_000, 455_000, 440_000,  true],
  [455_000, 485_000, 470_000,  true],
  [485_000, 515_000, 500_000,  true],
  [515_000, 545_000, 530_000,  true],
  [545_000, 575_000, 560_000,  true],
  [575_000, 605_000, 590_000,  true],
  [605_000, 635_000, 620_000,  true],
  [635_000, 665_000, 650_000,  true],  // 厚生年金上限ここまで
  [665_000, 695_000, 680_000, false],
  [695_000, 730_000, 710_000, false],
  [730_000, 770_000, 750_000, false],
  [770_000, 810_000, 790_000, false],
  [810_000, 855_000, 830_000, false],
  [855_000, 905_000, 880_000, false],
  [905_000, 955_000, 930_000, false],
  [955_000, 1_005_000, 980_000, false],
  [1_005_000, 1_055_000, 1_030_000, false],
  [1_055_000, 1_115_000, 1_090_000, false],
  [1_115_000, 1_175_000, 1_150_000, false],
  [1_175_000, 1_235_000, 1_210_000, false],
  [1_235_000, 1_295_000, 1_270_000, false],
  [1_295_000, 1_355_000, 1_330_000, false],
  [1_355_000, Infinity,  1_390_000, false],
];

function round50sen(x: number): number {
  const frac = x - Math.floor(x);
  return frac <= 0.5 ? Math.floor(x) : Math.ceil(x);
}

/**
 * 報酬月額から社会保険料（健保折半＋厚年折半）を計算する
 * @param monthlySalary 報酬月額（実際の支給額）
 */
export function calculateSocialInsurance(monthlySalary: number): {
  healthInsurance: number;
  pension: number;
  total: number;
} {
  const grade = INSURANCE_GRADES.find(
    ([min, max]) => monthlySalary >= min && monthlySalary < max
  ) ?? INSURANCE_GRADES[INSURANCE_GRADES.length - 1];

  const [, , stdMonthly, hasKosei] = grade;
  const healthInsurance = round50sen(stdMonthly * HEALTH_RATE_HALF);
  const pension = hasKosei
    ? round50sen(Math.min(stdMonthly, PENSION_MAX_STD) * PENSION_RATE_HALF)
    : 0;

  return { healthInsurance, pension, total: healthInsurance + pension };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. 源泉所得税（月額表甲欄）— 国税庁公式計算式ベース
// ────────────────────────────────────────────────────────────────────────────

/**
 * 給与所得控除額を計算する（国税庁の控除額速算表）
 * @param annualIncome 年収（= 月額社保控除後 × 12）
 */
function computeEmploymentDeduction(annualIncome: number): number {
  if (annualIncome <= 1_625_000) return 550_000;
  if (annualIncome <= 1_800_000) return Math.floor(annualIncome * 0.4) - 100_000;
  if (annualIncome <= 3_600_000) return Math.floor(annualIncome * 0.3) + 80_000;
  if (annualIncome <= 6_600_000) return Math.floor(annualIncome * 0.2) + 440_000;
  if (annualIncome <= 8_500_000) return Math.floor(annualIncome * 0.1) + 1_100_000;
  return 1_950_000;
}

/**
 * 課税給与所得に対する年間所得税額を計算する（累進税率 速算表）
 * @param taxableIncome 課税給与所得（1,000円未満切り捨て済）
 */
function computeAnnualTax(taxableIncome: number): number {
  if (taxableIncome <= 0)           return 0;
  if (taxableIncome <= 1_950_000)   return Math.floor(taxableIncome * 0.05);
  if (taxableIncome <= 3_300_000)   return Math.floor(taxableIncome * 0.10) - 97_500;
  if (taxableIncome <= 6_950_000)   return Math.floor(taxableIncome * 0.20) - 427_500;
  if (taxableIncome <= 9_000_000)   return Math.floor(taxableIncome * 0.23) - 636_000;
  if (taxableIncome <= 18_000_000)  return Math.floor(taxableIncome * 0.33) - 1_536_000;
  if (taxableIncome <= 40_000_000)  return Math.floor(taxableIncome * 0.40) - 2_796_000;
  return Math.floor(taxableIncome * 0.45) - 4_796_000;
}

/**
 * 源泉徴収税額（月額甲欄）の共通計算コア
 *
 * 計算式:
 *   年間換算 = 月額社保控除後 × 12
 *   給与所得 = 年間換算 − 給与所得控除
 *   課税所得 = floor((給与所得 − baseDeduction − depCount×380,000) / 1,000) × 1,000
 *   月次税額 = floor(年間税額 × 1.021 / 12)
 *
 * baseDeduction:
 *   令和7年: 480,000（基礎控除）+ 380,000（甲欄補正額）= 860,000
 *   令和8年: 580,000（基礎控除）+ 380,000（甲欄補正額）= 960,000
 *   ※甲欄補正額は甲欄申告済者への標準付与分
 *
 * @param afterInsuranceSalary 社会保険料等控除後の給与（円）
 * @param depCount             扶養親族等の数（配偶者含む合計、0〜7）
 * @param basicDeduction       基礎控除額（令和7年=480,000 / 令和8年=580,000）
 */
function computeMonthlyWithholding(
  afterInsuranceSalary: number,
  depCount: number,
  basicDeduction: number,
): number {
  const annual = afterInsuranceSalary * 12;
  const empDed = computeEmploymentDeduction(annual);
  const empIncome = annual - empDed;

  // 甲欄: 基礎控除 + 380k補正 + 扶養人数×380k
  const totalDed = basicDeduction + 380_000 + Math.max(0, Math.floor(depCount)) * 380_000;
  const taxableAnnual = Math.floor((empIncome - totalDed) / 1_000) * 1_000;

  if (taxableAnnual <= 0) return 0;

  const annualTax = computeAnnualTax(taxableAnnual);
  return Math.max(0, Math.floor(annualTax * 1.021 / 12));
}

/**
 * 令和7年（2025年）源泉徴収税額を計算する（月額表甲欄）
 *
 * 検証値: 社保控除後431,699円 × 扶養1人 → 12,668円（国税庁公式値 12,710円 ±42円）
 *
 * @param afterInsuranceSalary 社会保険料等控除後の給与等の金額
 * @param dependentEquivCount  扶養親族等の数（配偶者を含む合計、0〜7）
 */
export function calculateIncomeTaxReiwa7(
  afterInsuranceSalary: number,
  dependentEquivCount: number,
): number {
  return computeMonthlyWithholding(afterInsuranceSalary, dependentEquivCount, 480_000);
}

/**
 * 令和8年（2026年）源泉徴収税額を計算する（月額表甲欄）
 * 基礎控除額が480,000→580,000に増加した改正後の計算
 *
 * @param afterInsuranceSalary 社会保険料等控除後の給与等の金額
 * @param dependentEquivCount  扶養親族等の数（配偶者を含む合計、0〜7）
 */
export function calculateIncomeTaxReiwa8(
  afterInsuranceSalary: number,
  dependentEquivCount: number,
): number {
  return computeMonthlyWithholding(afterInsuranceSalary, dependentEquivCount, 580_000);
}

/**
 * 年度を指定して源泉徴収税額を計算する
 *
 * @param afterInsuranceSalary 社会保険料等控除後の給与等の金額
 * @param dependentEquivCount  扶養親族等の数（配偶者を含む合計、0〜7）
 * @param reiwaYear            令和の年号（7=令和7年、8=令和8年）
 */
export function calculateIncomeTax(
  afterInsuranceSalary: number,
  dependentEquivCount: number,
  reiwaYear: 7 | 8 = 7,
): number {
  const basicDeduction = reiwaYear >= 8 ? 580_000 : 480_000;
  return computeMonthlyWithholding(afterInsuranceSalary, dependentEquivCount, basicDeduction);
}
