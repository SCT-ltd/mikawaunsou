import { useRef, useEffect, useMemo } from "react";
import { Payroll } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { formatCurrency } from "@/lib/format";

export function filterPayrolls(payrolls: Payroll[], search: string): Payroll[] {
  const q = search.trim().toLowerCase();
  const sorted = [...payrolls].sort((a, b) =>
    (a.employeeCode ?? "").localeCompare(b.employeeCode ?? "")
  );
  if (!q) return sorted;
  return sorted.filter(
    (p) =>
      (p.employeeName ?? "").toLowerCase().includes(q) ||
      (p.employeeCode ?? "").toLowerCase().includes(q)
  );
}

function StatusBadge({ status }: { status: Payroll["status"] }) {
  return status === "confirmed" ? (
    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">確定済</Badge>
  ) : (
    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">未確定</Badge>
  );
}

export function PayrollListPane({
  payrolls,
  filtered,
  selectedId,
  onSelect,
  search,
  onSearchChange,
}: {
  payrolls: Payroll[];
  filtered: Payroll[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-payroll-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const confirmedCount = useMemo(
    () => payrolls.filter((p) => p.status === "confirmed").length,
    [payrolls]
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
            placeholder="氏名・社員コードで検索"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      {/* リスト本体 */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">該当する給与データがありません</div>
        ) : (
          filtered.map((p) => {
            const selected = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                data-payroll-id={p.id}
                onClick={() => onSelect(p.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset ${
                  selected
                    ? "bg-indigo-50 border-l-[3px] border-l-indigo-500"
                    : "border-l-[3px] border-l-transparent hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold truncate jp-tight ${selected ? "text-indigo-900" : ""}`}>
                        {p.employeeName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0">{p.employeeCode}</span>
                    </div>
                    <div className="mt-1">
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground">差引</div>
                    <div className="text-[13px] font-bold amount text-foreground">{formatCurrency(p.netSalary)}</div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 進捗フッター */}
      <div className="px-3 py-2 border-t bg-muted/30 shrink-0 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">確定</span>
        <span className="font-semibold amount">
          {confirmedCount}
          <span className="text-muted-foreground font-normal"> / {payrolls.length}件</span>
        </span>
      </div>
    </div>
  );
}
