import { useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, Pencil, Check, Minus } from "lucide-react";
import {
  EmployeeExt,
  CompanySettings,
  RowData,
  computeQuickEstimate,
  hasAnyRecordData,
  formatYen,
} from "./estimate";

export type EmployeeStatus = "dirty" | "entered" | "empty";

export function getEmployeeStatus(
  emp: EmployeeExt,
  edits: Record<number, RowData>,
  dirtyIds: Set<number>
): EmployeeStatus {
  if (dirtyIds.has(emp.id)) return "dirty";
  if (hasAnyRecordData(edits[emp.id])) return "entered";
  return "empty";
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
  search,
  onSearchChange,
}: {
  employees: EmployeeExt[];
  filtered: EmployeeExt[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  edits: Record<number, RowData>;
  dirtyIds: Set<number>;
  company: CompanySettings | undefined;
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
      </div>

      {/* リスト本体 */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            該当する社員がいません
          </div>
        ) : (
          filtered.map((emp) => {
            const status = getEmployeeStatus(emp, edits, dirtyIds);
            const { gross, net } = computeQuickEstimate(emp, edits[emp.id] ?? {}, company);
            const selected = emp.id === selectedId;
            return (
              <button
                key={emp.id}
                type="button"
                data-emp-id={emp.id}
                onClick={() => onSelect(emp.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset ${
                  selected
                    ? "bg-indigo-50 border-l-[3px] border-l-indigo-500"
                    : "border-l-[3px] border-l-transparent hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold truncate jp-tight ${selected ? "text-indigo-900" : ""}`}>
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
