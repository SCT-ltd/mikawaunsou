import { useRef, useEffect, useMemo } from "react";
import { Payroll } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, RefreshCw } from "lucide-react";
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
    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40 text-[10px] px-1.5 py-0">確定済</Badge>
  ) : (
    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40 text-[10px] px-1.5 py-0">未確定</Badge>
  );
}

/** 前の月との差（社員ごと）。給与明細画面が /office-tools/month-status から作って渡す */
export interface PrevDiff {
  grossDiff: number;
  netDiff: number;
  /** 前の月の差引に対する割合（％）。前の月が0円のときは null */
  netPct: number | null;
  grossPct: number | null;
}

/** 前月との差がこの割合（％）以上なら色を付けて知らせる */
export const BIG_DIFF_PCT = 20;

function DiffText({ d }: { d: PrevDiff | null | undefined }) {
  if (!d) return <span className="text-[10px] text-muted-foreground/60">前月なし</span>;
  const pct = d.netPct;
  const big = pct !== null && Math.abs(pct) >= BIG_DIFF_PCT;
  const sign = d.netDiff > 0 ? "+" : d.netDiff < 0 ? "−" : "±";
  return (
    <span
      className={`text-[10px] amount ${big ? "font-bold text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
      title={`前月との差：総支給 ${d.grossDiff >= 0 ? "+" : "−"}${Math.abs(d.grossDiff).toLocaleString("ja-JP")}円／差引 ${sign}${Math.abs(d.netDiff).toLocaleString("ja-JP")}円`}
    >
      前月比 {sign}{Math.abs(d.netDiff).toLocaleString("ja-JP")}
      {pct !== null && <>（{pct > 0 ? "+" : ""}{pct.toFixed(0)}%）</>}
    </span>
  );
}

export function PayrollListPane({
  payrolls,
  filtered,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  diffs,
  needsRecalc,
  checked,
  onCheckedChange,
}: {
  payrolls: Payroll[];
  filtered: Payroll[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  search: string;
  onSearchChange: (s: string) => void;
  /** 社員ID → 前月との差 */
  diffs?: Map<number, PrevDiff | null>;
  /** 再計算が要りそうな社員ID */
  needsRecalc?: Set<number>;
  /** 印刷する人を選ぶチェック（明細ID）*/
  checked?: Set<number>;
  onCheckedChange?: (next: Set<number>) => void;
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

  const toggle = (id: number) => {
    if (!checked || !onCheckedChange) return;
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    onCheckedChange(next);
  };
  const allChecked = !!checked && filtered.length > 0 && filtered.every((p) => checked.has(p.id));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 検索 */}
      <div className="p-2 border-b shrink-0 space-y-1.5">
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
        {checked && onCheckedChange && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground px-1 cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-600"
              checked={allChecked}
              onChange={() => {
                const next = new Set(checked);
                if (allChecked) filtered.forEach((p) => next.delete(p.id));
                else filtered.forEach((p) => next.add(p.id));
                onCheckedChange(next);
              }}
            />
            印刷する人を選ぶ（{checked.size}人を選択中）
          </label>
        )}
      </div>

      {/* リスト本体 */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">該当する給与データがありません</div>
        ) : (
          filtered.map((p) => {
            const selected = p.id === selectedId;
            const recalc = needsRecalc?.has(p.employeeId);
            return (
              <div
                key={p.id}
                className={`flex items-stretch border-b border-border/50 transition-colors ${
                  selected
                    ? "bg-indigo-50 dark:bg-indigo-500/15 border-l-[3px] border-l-indigo-500"
                    : "border-l-[3px] border-l-transparent hover:bg-muted/40"
                }`}
              >
                {checked && onCheckedChange && (
                  <label className="flex items-center pl-2 pr-1 cursor-pointer" title="印刷する人に入れる">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-600"
                      checked={checked.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label={`${p.employeeName}さんを印刷に入れる`}
                    />
                  </label>
                )}
                <button
                  type="button"
                  data-payroll-id={p.id}
                  onClick={() => onSelect(p.id)}
                  aria-current={selected ? "true" : undefined}
                  className="flex-1 min-w-0 text-left px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold truncate jp-tight ${selected ? "text-indigo-900 dark:text-indigo-200" : ""}`}>
                          {p.employeeName}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0">{p.employeeCode}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={p.status} />
                        {recalc && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300" title="計算したあとで勤怠・手当・単価などが変わっています">
                            <RefreshCw className="h-3 w-3" />要再計算
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-muted-foreground">差引</div>
                      <div className="text-[13px] font-bold amount text-foreground">{formatCurrency(p.netSalary)}</div>
                      {diffs && <DiffText d={diffs.get(p.employeeId)} />}
                    </div>
                  </div>
                </button>
              </div>
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
