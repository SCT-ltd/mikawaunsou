import { useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, Pencil, Check, Minus, Lock } from "lucide-react";
import {
  EmployeeExt,
  CompanySettings,
  RowData,
  computeQuickEstimate,
  hasAnyRecordData,
  formatYen,
} from "./estimate";
import type { MonthInsurance } from "@/lib/insurance-rates";

export type EmployeeStatus = "dirty" | "entered" | "empty" | "confirmed";

/** 給与明細の状態（明細が無い＝未計算）*/
export type PayrollState = "draft" | "confirmed" | undefined;

export function getEmployeeStatus(
  emp: EmployeeExt,
  edits: Record<number, RowData>,
  dirtyIds: Set<number>,
  payrollState?: PayrollState
): EmployeeStatus {
  if (payrollState === "confirmed") return "confirmed";
  if (dirtyIds.has(emp.id)) return "dirty";
  if (hasAnyRecordData(edits[emp.id])) return "entered";
  return "empty";
}

/**
 * 左の一覧の絞り込み。毎月「まだ入れていない人」「計算していない人」を探して
 * 17人を上から順に開いていたので、ここで絞れるようにする。
 */
export type ListFilter = "all" | "empty" | "dirty" | "uncalculated" | "confirmed";
export const LIST_FILTERS: Array<{ value: ListFilter; label: string; hint: string }> = [
  { value: "all", label: "全員", hint: "在籍している全員" },
  { value: "empty", label: "未入力", hint: "この月の実績をまだ入れていない人" },
  { value: "dirty", label: "変更あり", hint: "入力したけれど、まだ「保存して計算」していない人" },
  { value: "uncalculated", label: "未計算", hint: "この月の給与明細がまだ無い人" },
  { value: "confirmed", label: "確定済", hint: "給与明細を確定した人（表示のみ）" },
];

export function matchListFilter(
  f: ListFilter,
  emp: EmployeeExt,
  edits: Record<number, RowData>,
  dirtyIds: Set<number>,
  payrollState: PayrollState
): boolean {
  switch (f) {
    case "empty": return !dirtyIds.has(emp.id) && !hasAnyRecordData(edits[emp.id]) && payrollState !== "confirmed";
    case "dirty": return dirtyIds.has(emp.id);
    case "uncalculated": return payrollState === undefined;
    case "confirmed": return payrollState === "confirmed";
    default: return true;
  }
}

// 給与形態バッジ
export function SalaryTypeBadge({ emp }: { emp: EmployeeExt }) {
  const label = emp.salaryType === "daily" ? "日給" : emp.salaryType === "hourly" ? "時給" : "月給";
  const cls =
    emp.salaryType === "daily"
      ? "bg-amber-100 text-amber-700"
      : emp.salaryType === "hourly"
      ? "bg-indigo-100 text-indigo-700"
      : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function BWBadge() {
  return (
    <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
      BW
    </span>
  );
}

function StatusIndicator({ status }: { status: EmployeeStatus }) {
  if (status === "confirmed") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        <Lock className="h-3 w-3" />
        確定済
      </span>
    );
  }
  if (status === "dirty") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
        <Pencil className="h-3 w-3" />
        変更あり
      </span>
    );
  }
  if (status === "entered") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
        <Check className="h-3 w-3" />
        入力済
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
      <Minus className="h-3 w-3" />
      未入力
    </span>
  );
}

export function filterEmployees(employees: EmployeeExt[], search: string): EmployeeExt[] {
  const q = search.trim().toLowerCase();
  if (!q) return employees;
  return employees.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      (e.nameKana ?? "").toLowerCase().includes(q) ||
      (e.department ?? "").toLowerCase().includes(q)
  );
}

export function EmployeeList({
  employees,
  filtered,
  selectedId,
  onSelect,
  edits,
  dirtyIds,
  company,
  insurance,
  search,
  onSearchChange,
  payrollStates,
  listFilter = "all",
  onListFilterChange,
}: {
  employees: EmployeeExt[];
  /** 社員ごとの給与明細の状態（無い社員＝未計算）*/
  payrollStates?: Map<number, PayrollState>;
  listFilter?: ListFilter;
  onListFilterChange?: (f: ListFilter) => void;
  filtered: EmployeeExt[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  edits: Record<number, RowData>;
  dirtyIds: Set<number>;
  company: CompanySettings | undefined;
  /** 表示中の月の保険料率・標準報酬月額（概算用）*/
  insurance?: MonthInsurance;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // 選択変更時に選択行を可視範囲へスクロール
  useEffect(() => {
    if (selectedId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-emp-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const enteredCount = useMemo(
    () => employees.filter((e) => getEmployeeStatus(e, edits, dirtyIds) !== "empty").length,
    [employees, edits, dirtyIds]
  );
  const filterCounts = useMemo(() => {
    const out: Record<ListFilter, number> = { all: 0, empty: 0, dirty: 0, uncalculated: 0, confirmed: 0 };
    for (const e of employees) {
      for (const f of LIST_FILTERS) {
        if (matchListFilter(f.value, e, edits, dirtyIds, payrollStates?.get(e.id))) out[f.value]++;
      }
    }
    return out;
  }, [employees, edits, dirtyIds, payrollStates]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 検索 */}
      <div className="p-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="氏名・所属で検索"
            className="h-9 pl-8 text-sm"
          />
        </div>
        {onListFilterChange && (
          <div className="flex flex-wrap gap-1 mt-2" role="group" aria-label="一覧の絞り込み">
            {LIST_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                title={f.hint}
                aria-pressed={listFilter === f.value}
                onClick={() => onListFilterChange(f.value)}
                className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  listFilter === f.value
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
                <span className="ml-1 amount">{filterCounts[f.value]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* リスト本体 */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {listFilter !== "all" ? "この絞り込みに当てはまる社員はいません" : "該当する社員がいません"}
          </div>
        ) : (
          filtered.map((emp) => {
            const status = getEmployeeStatus(emp, edits, dirtyIds, payrollStates?.get(emp.id));
            const { gross, net } = computeQuickEstimate(emp, edits[emp.id] ?? {}, company, insurance);
            const selected = emp.id === selectedId;
            return (
              <button
                key={emp.id}
                type="button"
                data-emp-id={emp.id}
                onClick={() => onSelect(emp.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset ${
                  selected
                    ? "bg-indigo-50 dark:bg-indigo-500/15 border-l-[3px] border-l-indigo-500"
                    : "border-l-[3px] border-l-transparent hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold truncate jp-tight ${selected ? "text-indigo-900 dark:text-indigo-200" : ""}`}>
                      {emp.name}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-muted-foreground truncate max-w-[90px]">
                        {emp.department}
                      </span>
                      <SalaryTypeBadge emp={emp} />
                      {emp.useBluewingLogic && <BWBadge />}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-bold amount text-foreground">
                      {gross > 0 ? formatYen(net) : <span className="text-muted-foreground/40 font-normal">—</span>}
                    </div>
                    <div className="mt-0.5 flex justify-end">
                      <StatusIndicator status={status} />
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 進捗フッター */}
      <div className="px-3 py-2 border-t bg-muted/30 shrink-0 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">入力済</span>
        <span className="font-semibold amount">
          {enteredCount}
          <span className="text-muted-foreground font-normal"> / {employees.length}名</span>
        </span>
      </div>
    </div>
  );
}
