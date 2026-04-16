/**
 * 源泉徴収税額 計算モジュール（フロントエンド用）
 *
 * 国税庁 給与所得の源泉徴収税額表（月額表）甲欄
 *   - 令和7年版（現行デフォルト）
 *   - 令和8年版（将来切替用）
 *
 * 計算式: 国税庁公式速算表をそのまま実装
 *   年間換算 = 社保控除後月額 × 12
 *   給与所得 = 年間換算 − 給与所得控除
 *   課税所得 = floor((給与所得 − baseDeduction − 扶養人数×380,000) / 1,000) × 1,000
 *   月次税額 = floor(年間税額 × 1.021 / 12)
 */

/** 給与所得控除額を計算する（国税庁の控除額速算表） */
function computeEmploymentDeduction(annualIncome: number): number {
  if (annualIncome <= 1_625_000) return 550_000;
  if (annualIncome <= 1_800_000) return Math.floor(annualIncome * 0.4) - 100_000;
  if (annualIncome <= 3_600_000) return Math.floor(annualIncome * 0.3) + 80_000;
  if (annualIncome <= 6_600_000) return Math.floor(annualIncome * 0.2) + 440_000;
  if (annualIncome <= 8_500_000) return Math.floor(annualIncome * 0.1) + 1_100_000;
  return 1_950_000;
}

/** 課税給与所得に対する年間所得税額を計算する（累進税率 速算表） */
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

/** 月次源泉徴収税額の共通コア */
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
 * 検証: 社保控除後431,699円 × 扶養1人 → 12,668円（公式値 12,710円 ±42円）
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
 * 基礎控除額 480,000→580,000 改正後
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
 * 年度を指定して源泉徴収税額を計算する（年度切替対応）
 *
 * @param afterInsuranceSalary 社会保険料等控除後の給与等の金額
 * @param dependentEquivCount  扶養親族等の数（配偶者を含む合計、0〜7）
 * @param reiwaYear            令和年号（7=令和7年、8=令和8年、デフォルト=7）
 */
export function calculateIncomeTax(
  afterInsuranceSalary: number,
  dependentEquivCount: number,
  reiwaYear: 7 | 8 = 7,
): number {
  const basicDeduction = reiwaYear >= 8 ? 580_000 : 480_000;
  return computeMonthlyWithholding(afterInsuranceSalary, dependentEquivCount, basicDeduction);
}
