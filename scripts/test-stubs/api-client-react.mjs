// 試験のときだけ使う @workspace/api-client-react の代わり（画面の式だけを試すため。通信はしない）
export const getGetEffectiveInsuranceRatesQueryKey = () => ["effective-insurance-rates"];
export const getListEffectiveStandardRemunerationQueryKey = () => ["effective-standard-remuneration"];
export const useGetEffectiveInsuranceRates = () => ({ data: undefined });
export const useListEffectiveStandardRemuneration = () => ({ data: undefined });
