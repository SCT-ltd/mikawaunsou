import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

/**
 * 月ごとの手当・控除（社員 × 年月）の読み書き。
 *
 * 手当・控除は以前「社員ごとに1つ」で、年月を持たなかった。ほかの月を開いて保存すると
 * 今月用の内容が書き換わり、確定済みの明細を刷り直すと内訳だけが今の内容になっていた。
 * 画面と印刷は、ここを通して「その月」の内容を読み書きする。
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface MonthAllowanceRow {
  allowanceDefinitionId: number;
  allowanceName: string;
  isTaxable: boolean;
  excludeFromEmploymentInsurance: boolean;
  amount: number;
  sortOrder: number;
}
export interface MonthDeductionRow {
  deductionDefinitionId: number;
  deductionName: string;
  amount: number;
  sortOrder: number;
}
export interface MonthItems {
  /** その月の控えがあるか（false のときは直近の月の内容を初期値として返している） */
  exists: boolean;
  /** その月の給与明細が確定済みか（確定済みなら変更できない） */
  locked: boolean;
  /** 日給制の人の、その月の基本給（控えが無い・日給制でない場合は null） */
  baseSalary: number | null;
  /** その月の雇用保険料を手で決めた額（null＝自動計算） */
  employmentInsuranceOverride?: number | null;
  allowances: MonthAllowanceRow[];
  deductions: MonthDeductionRow[];
  year: number;
  month: number;
}

export class MonthItemsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request(employeeId: number, year: number, month: number, init?: RequestInit): Promise<MonthItems> {
  const res = await fetch(`${BASE}/api/employees/${employeeId}/month-items?year=${year}&month=${month}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new MonthItemsError(res.status, body?.error ?? "手当・控除を読み書きできませんでした。");
  }
  return res.json();
}

export const monthItemsQueryKey = (employeeId: number, year: number, month: number) =>
  ["month-items", employeeId, year, month] as const;

export const fetchMonthItems = (employeeId: number, year: number, month: number) => request(employeeId, year, month);

export function saveMonthItems(
  employeeId: number,
  year: number,
  month: number,
  body: {
    allowances: Array<{ allowanceDefinitionId: number; amount: number }>;
    deductions: Array<{ deductionDefinitionId: number; amount: number }>;
    /** 月給・日給の人の基本給。時給の人は送らない（マスターの時給を上書きしないため）。 */
    baseSalary?: number;
    /** 雇用保険料を手で決めた額。null＝自動計算に戻す。送らなければ変えない。 */
    employmentInsuranceOverride?: number | null;
  },
): Promise<MonthItems> {
  return request(employeeId, year, month, { method: "PUT", body: JSON.stringify(body) });
}

export function useMonthItems(
  employeeId: number,
  year: number | undefined,
  month: number | undefined,
  options?: Partial<UseQueryOptions<MonthItems, MonthItemsError>>,
) {
  const y = year ?? 0;
  const m = month ?? 0;
  return useQuery<MonthItems, MonthItemsError>({
    queryKey: monthItemsQueryKey(employeeId, y, m),
    queryFn: () => fetchMonthItems(employeeId, y, m),
    enabled: employeeId > 0 && y > 0 && m > 0,
    ...options,
  });
}

/** 印刷や一覧で使う、従来の「社員の手当」の形（id などを補ったもの）に直す。 */
export function toLegacyRows(items: MonthItems | undefined, employeeId: number) {
  if (!items) return { allowances: undefined, deductions: undefined };
  return {
    allowances: items.allowances.map((a, i) => ({
      id: i + 1,
      employeeId,
      allowanceDefinitionId: a.allowanceDefinitionId,
      allowanceName: a.allowanceName,
      isTaxable: a.isTaxable,
      amount: a.amount,
      sortOrder: a.sortOrder,
    })),
    deductions: items.deductions.map((d, i) => ({
      id: i + 1,
      employeeId,
      deductionDefinitionId: d.deductionDefinitionId,
      deductionName: d.deductionName,
      amount: d.amount,
      sortOrder: d.sortOrder,
    })),
  };
}
