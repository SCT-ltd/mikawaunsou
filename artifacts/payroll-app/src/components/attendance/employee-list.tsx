import { useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, Clock } from "lucide-react";
import {
  EmployeeStatus,
  AbsenceRecord,
  ABSENCE_LABELS,
  ABSENCE_COLORS,
  STATUS_STYLE,
  Avatar,
  StatusBadge,
  fmt,
  elapsedStr,
  elapsedMs,
  elapsedColor,
} from "./shared";

export function filterAttendance(data: EmployeeStatus[], search: string): EmployeeStatus[] {
  const q = search.trim().toLowerCase();
  if (!q) return data;
  return data.filter(
    (d) =>
      d.employee.name.toLowerCase().includes(q) ||
      (d.employee.employeeCode ?? "").toLowerCase().includes(q) ||
      (d.employee.department ?? "").toLowerCase().includes(q)
  );
}

// 点検NGバッジ（clock_in の checklistNgItems をパース）
function ChecklistBadge({ d }: { d: EmployeeStatus }) {
  const clockInRec = d.records.find((r) => r.eventType === "clock_in" && r.checklistNgItems);
  if (!clockInRec?.checklistNgItems) return null;
  let parsed: { total: number; checked: number; ng: string[] } | null = null;
  try { parsed = JSON.parse(clockInRec.checklistNgItems); } catch { return null; }
  if (!parsed) return null;
  return parsed.ng.length === 0 ? (
    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
      ✅ 点検OK
    </span>
  ) : (
    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">
      ⚠️ 点検NG {parsed.ng.length}
    </span>
  );
}

export function EmployeeList({
  data,
  filtered,
  selectedId,
  onSelect,
  now,
  absences,
  search,
  onSearchChange,
}: {
  data: EmployeeStatus[];
  filtered: EmployeeStatus[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  now: Date;
  absences: AbsenceRecord[];
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-emp-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

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
            placeholder="氏名・社員コード・部署で検索"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      {/* リスト本体 */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">該当する社員がいません</div>
        ) : (
          filtered.map((d) => {
            const ms = elapsedMs(d.clockInTime, now);
            const isActive = d.status === "出勤中" || d.status === "休憩中";
            const selected = d.employee.id === selectedId;
            const empAbsences = absences.filter((a) => a.employeeId === d.employee.id);

            return (
              <button
                key={d.employee.id}
                type="button"
                data-emp-id={d.employee.id}
                onClick={() => onSelect(d.employee.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset ${
                  selected
                    ? "bg-indigo-50 border-l-[3px] border-l-indigo-500"
                    : `border-l-[3px] border-l-transparent hover:bg-muted/40 ${STATUS_STYLE[d.status].tint}`
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative shrink-0">
                    <Avatar name={d.employee.name} />
                    {d.status === "出勤中" && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                    )}
                    {d.status === "休憩中" && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-white" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold truncate jp-tight ${selected ? "text-indigo-900" : ""}`}>
                        {d.employee.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0">{d.employee.employeeCode}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <StatusBadge status={d.status} />
                      {d.clockInTime && (
                        <span className="text-[11px] text-slate-500 amount">{fmt(d.clockInTime)}</span>
                      )}
                      {isActive && (
                        <span className={`text-[11px] font-semibold amount ${elapsedColor(ms)}`}>
                          {elapsedStr(d.clockInTime, now)}
                        </span>
                      )}
                    </div>
                    {(empAbsences.length > 0 || d.records.length > 0) && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {empAbsences.map((a) => (
                          <span key={a.id} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ABSENCE_COLORS[a.absenceType]}`}>
                            {ABSENCE_LABELS[a.absenceType]}
                          </span>
                        ))}
                        <ChecklistBadge d={d} />
                      </div>
                    )}
                  </div>

                  {/* 打刻数 */}
                  <div className="shrink-0 flex flex-col items-center gap-0.5">
                    {d.records.length > 0 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold amount">
                        {d.records.length}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                    <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />打刻
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* フッター（合計） */}
      <div className="px-3 py-2 border-t bg-muted/30 shrink-0 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">社員</span>
        <span className="font-semibold amount">{data.length}名</span>
      </div>
    </div>
  );
}
