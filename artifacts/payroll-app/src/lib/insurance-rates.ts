import {
  useGetEffectiveInsuranceRates,
  getGetEffectiveInsuranceRatesQueryKey,
  useListEffectiveStandardRemuneration,
  getListEffectiveStandardRemunerationQueryKey,
} from "@workspace/api-client-react";
import {
  HEALTH_EMPLOYEE_RATE_R8,
  HEALTH_WITH_CARE_EMPLOYEE_RATE_R8,
  CHILDCARE_SUPPORT_EMPLOYEE_RATE_R8,
  PENSION_EMPLOYEE_RATE_R8,
  EMP_INS_EMPLOYEE_RATE_R8,
} from "@/lib/tax-tables-reiwa8";

/**
 * 画面の概算・プレビューで使う「その給与明細の年月」の保険の基準。
 * 実際の計算はサーバが保険料率マスター・標準報酬月額の履歴から同じ値を解決する
 * （artifacts/api-server/src/lib/insurance-settings.ts）。
 */
export interface EmployeeInsuranceRates {
  /** 健康保険（本人）*/
  healthEmployeeRate: number;
  /** 健康保険＋介護保険（本人）*/
  healthWithCareEmployeeRate: number;
  /** 子ども・子育て支援金（本人）*/
  childcareEmployeeRate: number;
  /** 厚生年金（本人）*/
  pensionEmployeeRate: number;
  /** 雇用保険（本人）*/
  employmentInsuranceRate: number;
  /** 厚生年金の標準報酬月額の上限 */
  pensionMaxStandard: number;
}

/** 取得前・取得失敗時の値（令和8年度の内蔵値）*/
export const DEFAULT_INSURANCE_RATES_R8: EmployeeInsuranceRates = {
  healthEmployeeRate: HEALTH_EMPLOYEE_RATE_R8,
  healthWithCareEmployeeRate: HEALTH_WITH_CARE_EMPLOYEE_RATE_R8,
  childcareEmployeeRate: CHILDCARE_SUPPORT_EMPLOYEE_RATE_R8,
  pensionEmployeeRate: PENSION_EMPLOYEE_RATE_R8,
  employmentInsuranceRate: EMP_INS_EMPLOYEE_RATE_R8,
  pensionMaxStandard: 650_000,
};

export interface MonthInsurance {
  rates: EmployeeInsuranceRates;
  /** その月に使う標準報酬月額。履歴が無ければ社員マスタの初期値（fallback）を返す */
  standardRemunerationOf: (employeeId: number, fallback: number | undefined) => number;
}

/** 保険料率の取得キー（料率・標準報酬月額を変更したら invalidate する）*/
export const INSURANCE_RATES_EFFECTIVE_KEY = getGetEffectiveInsuranceRatesQueryKey()[0];
export const STANDARD_REMUNERATION_EFFECTIVE_KEY = getListEffectiveStandardRemunerationQueryKey()[0];

export function useMonthInsurance(year: number | undefined, month: number | undefined): MonthInsurance {
  const enabled = year != null && month != null && year > 0 && month > 0;
  const params = { year: year ?? 0, month: month ?? 0 };
  const { data: effRates } = useGetEffectiveInsuranceRates(params, {
    query: { enabled, queryKey: getGetEffectiveInsuranceRatesQueryKey(params), staleTime: 60_000 },
  });
  const { data: effStd } = useListEffectiveStandardRemuneration(params, {
    query: { enabled, queryKey: getListEffectiveStandardRemunerationQueryKey(params), staleTime: 60_000 },
  });

  const rates: EmployeeInsuranceRates = effRates
    ? {
        healthEmployeeRate: effRates.healthEmployeeRate,
        healthWithCareEmployeeRate: effRates.healthWithCareEmployeeRate,
        childcareEmployeeRate: effRates.childcareEmployeeRate,
        pensionEmployeeRate: effRates.pensionEmployeeRate,
        employmentInsuranceRate: effRates.employmentInsuranceRate,
        pensionMaxStandard: effRates.pensionMaxStandard,
      }
    : DEFAULT_INSURANCE_RATES_R8;

  const standardRemunerationOf = (employeeId: number, fallback: number | undefined) => {
    const row = effStd?.find((r) => r.employeeId === employeeId);
    return row ? row.standardRemuneration : (fallback ?? 0);
  };

  return { rates, standardRemunerationOf };
}

// ── 表示・入力の変換 ────────────────────────────────────────────────────

/** 0.0985 → "9.85"（% の数字部分。末尾の0は落とす）*/
export function rateToPercentInput(rate: number): string {
  return String(Math.round(rate * 100 * 1e6) / 1e6);
}

/** "9.85" → 0.0985（浮動小数の誤差を落とす）*/
export function percentInputToRate(input: string | number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1e6) / 1e8;
}

/** 0.0985 → "9.85%" */
export function formatRatePercent(rate: number): string {
  return `${rateToPercentInput(rate)}%`;
}

export const REMUNERATION_REASON_LABELS: Record<string, string> = {
  teiji: "定時決定",
  zuiji: "随時改定",
  shikaku: "資格取得",
  other: "その他",
};

export const formatYearMonth = (y: number, m: number) => `${y}年${m}月`;

/** サーバが返した日本語のエラー文（{ error }）を取り出す */
export function apiErrorMessage(e: unknown, fallback = "保存に失敗しました。"): string {
  const msg = (e as { data?: { error?: unknown } } | null)?.data?.error;
  return typeof msg === "string" && msg !== "" ? msg : fallback;
}
