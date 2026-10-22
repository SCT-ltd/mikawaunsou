import { useQuery } from "@tanstack/react-query";

/**
 * 事務所の締め作業の入口（api-server/src/routes/office_tools.ts）を読む。
 * 生成のフック（openapi）には入れず、ここで直接読む（給与計算・勤怠の担当と同時に直しているため、
 * 共通の openapi.yaml を触らないようにしている）。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface MonthStatusRow {
  employeeId: number;
  employeeCode: string;
  name: string;
  isActive: boolean;
  salaryType: string | null;
  overtimeHourlyRate: number;
  hasRecord: boolean;
  recordUpdatedAt: string | null;
  overtimeHours: number;
  lateNightHours: number;
  employmentInsuranceOverride: number | null;
  payroll: {
    id: number;
    status: string;
    grossSalary: number;
    netSalary: number;
    totalDeductions: number;
    calculationMode: string;
    updatedAt: string;
  } | null;
  prev: { grossSalary: number; netSalary: number; status: string } | null;
  needsRecalc: boolean;
  recalcReasons: string[];
}

export interface MonthStatus {
  year: number;
  month: number;
  prevYear: number;
  prevMonth: number;
  rows: MonthStatusRow[];
}

export const MONTH_STATUS_KEY = "office-month-status";
export const DRAFT_PAYROLLS_KEY = "office-draft-payrolls";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `読み込めませんでした（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export function useMonthStatus(year: number, month: number, enabled = true) {
  return useQuery<MonthStatus>({
    queryKey: [MONTH_STATUS_KEY, year, month],
    queryFn: () => getJson<MonthStatus>(`/office-tools/month-status?year=${year}&month=${month}`),
    enabled,
    staleTime: 10_000,
  });
}

export interface DraftPayroll { id: number; employeeId: number; year: number; month: number }

export function useDraftPayrolls(enabled = true) {
  return useQuery<DraftPayroll[]>({
    queryKey: [DRAFT_PAYROLLS_KEY],
    queryFn: () => getJson<DraftPayroll[]>("/office-tools/draft-payrolls"),
    enabled,
    staleTime: 0,
  });
}

/**
 * 明細を1件ずつ計算し直す。計算方法は送らない（＝その明細を作ったときの方法のまま）。
 * 確定済み（409）は飛ばす。結果を件数で返す。
 */
export async function recalcPayrolls(
  items: Array<{ employeeId: number; year: number; month: number }>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; skipped: number; failed: Array<{ employeeId: number; year: number; month: number; message: string }> }> {
  let ok = 0, skipped = 0;
  const failed: Array<{ employeeId: number; year: number; month: number; message: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    try {
      const res = await fetch(`${BASE}/api/payroll/calculate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: it.employeeId, year: it.year, month: it.month }),
      });
      if (res.ok) ok++;
      else if (res.status === 409) skipped++;
      else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        failed.push({ ...it, message: body?.error ?? `エラー（${res.status}）` });
      }
    } catch {
      failed.push({ ...it, message: "通信エラー" });
    }
    onProgress?.(i + 1, items.length);
  }
  return { ok, skipped, failed };
}

/** 給与明細の確定解除（理由を記録に残す）*/
export async function unconfirmPayroll(id: number, reason: string): Promise<void> {
  const res = await fetch(`${BASE}/api/payroll/${id}/unconfirm`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `確定解除できませんでした（${res.status}）`);
  }
}

export async function apiJson<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `うまくいきませんでした（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export const API_BASE = BASE;
