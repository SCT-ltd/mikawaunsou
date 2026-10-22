import { useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, AlertTriangle } from "lucide-react";
import {
  EmployeeStatus,
  AbsenceRecord,
  Status,
  ABSENCE_LABELS,
  ABSENCE_COLORS,
  STATUS_STYLE,
  Avatar,
  fmt,
  elapsedStr,
  elapsedMs,
  elapsedColor,
  minToStr,
  todayJST,
} from "./shared";
import { attentionOf, dayTotals, DayBar, segmentsOf, windowFor, planOf } from "./board";

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

/** 並べる順（いま動いている人を上に） */
export const STATUS_ORDER: Status[] = ["出勤中", "休憩中", "退勤済", "未出勤"];

/** 点検のしるし（運転の人だけ）。全項目に答えるまでは「未点検」 */
function inspectionTag(d: EmployeeStatus): { text: string; tone: string } | null {
  if (d.employee.isOfficeStaff) return null;
  let insp: { checked: number; total: number; ng: string[]; complete: boolean } | null = d.inspection ?? null;
  if (!insp) {
    const clockInRec = d.records.find((r) => r.eventType === "clock_in" && r.checklistNgItems);
    if (clockInRec?.checklistNgItems) {
      try {
        const p = JSON.parse(clockInRec.checklistNgItems) as { total: number; checked: number; ng: string[] };
        insp = { ...p, ng: p.ng ?? [], complete: p.total > 0 && p.checked >= p.total };
      } catch { /* 古い形 */ }
    }
  }
  if (insp && insp.ng.length > 0) return { text: `点検NG ${insp.ng.length}`, tone: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30" };
  if (insp && insp.complete) return { text: "点検OK", tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30" };
  if (d.status !== "未出勤") return { text: `未点検${insp ? ` ${insp.checked}/${insp.total}` : ""}`, tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30" };
  return null;
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
  live = true,
  workDate,
  showUninspected = true,
}: {
  data: EmployeeStatus[];
  filtered: EmployeeStatus[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  now: Date;
  absences: AbsenceRecord[];
  search: string;
  onSearchChange: (s: string) => void;
  /** 今日を見ているか（過去の日は「いま」まで伸ばさない） */
  live?: boolean;
  workDate?: string;
  /** 「未点検」の札を出すか（勤怠の設定） */
  showUninspected?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-emp-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // 状態ごとにまとめる（出勤中→休憩中→退勤済→未出勤）。同じ状態の中は元の並び（社員コード順）
  const groupOf = (d: EmployeeStatus): string => (d.missingOut ? "退勤なし" : d.status);
  const groups = (["退勤なし", ...STATUS_ORDER] as string[]).map((st) => ({ st, rows: filtered.filter((d) => groupOf(d) === st) })).filter((g) => g.rows.length > 0);
  // 1日の帯は全員同じ時間の幅にそろえる（並べて比べられるように）
  const win = windowFor(workDate ?? todayJST(), filtered.flatMap((d) => segmentsOf(d.records, now, live && !d.missingOut)));

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
          groups.map((g) => (
            <section key={g.st}>
              <div className="sticky top-0 z-[1] flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold text-muted-foreground bg-muted/70 backdrop-blur border-b border-border/50">
                <span className={`w-1.5 h-1.5 rounded-full ${g.st === "退勤なし" ? "bg-red-500" : STATUS_STYLE[g.st as Status].dot}`} />
                {g.st}
                <span className="amount font-semibold">{g.rows.length}</span>
              </div>
              {g.rows.map((d) => {
                const ms = elapsedMs(d.clockInTime, now);
                const isActive = (d.status === "出勤中" || d.status === "休憩中") && !d.missingOut;
                const selected = d.employee.id === selectedId;
                const empAbsences = absences.filter((a) => a.employeeId === d.employee.id);
                const att = attentionOf(d, now, live);
                const insp0 = inspectionTag(d);
                // 「未点検」は設定で隠せる（点検NG・点検OKは隠さない）
                const insp = insp0 && !showUninspected && insp0.text.startsWith("未点検") ? null : insp0;
                const t = dayTotals(d.records, now, live && !d.missingOut);
                const segs = segmentsOf(d.records, now, live && !d.missingOut);
                const fromPrevDay = d.workDate && d.workDate < (workDate ?? todayJST()) && d.status !== "未出勤";

                return (
                  <button
                    key={d.employee.id}
                    type="button"
                    data-emp-id={d.employee.id}
                    onClick={() => onSelect(d.employee.id)}
                    className={`w-full text-left px-3 py-2 border-b border-border/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset border-l-[3px] ${
                      selected ? "bg-indigo-50 border-l-indigo-500 dark:bg-indigo-500/10" : "border-l-transparent hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="relative shrink-0">
                        <Avatar name={d.employee.name} size="sm" />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${d.missingOut ? "bg-red-500" : STATUS_STYLE[d.status].dot}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-sm font-semibold truncate jp-tight ${selected ? "text-indigo-900 dark:text-indigo-200" : ""}`}>{d.employee.name}</span>
                          {att.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" aria-label={att.join("、")} />}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 min-w-0 overflow-hidden">
                          <span className="text-[11px] text-muted-foreground truncate leading-tight shrink min-w-0">
                            {d.employee.department || d.employee.employeeCode}
                            {fromPrevDay && <span className="text-indigo-600 dark:text-indigo-300">・前日から</span>}
                          </span>
                          {empAbsences.map((a) => (
                            <span key={a.id} className={`shrink-0 text-[10px] font-semibold px-1.5 rounded-full border leading-4 ${ABSENCE_COLORS[a.absenceType]}`}>{ABSENCE_LABELS[a.absenceType]}</span>
                          ))}
                          {insp && <span className={`shrink-0 text-[10px] font-semibold px-1.5 rounded-full border leading-4 ${insp.tone}`}>{insp.text}</span>}
                          {(d.plan?.lateMin ?? 0) > 0 && <span className="shrink-0 text-[10px] font-semibold px-1.5 rounded-full border leading-4 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30">遅刻{d.plan!.lateMin}分</span>}
                          {(d.plan?.earlyMin ?? 0) > 0 && <span className="shrink-0 text-[10px] font-semibold px-1.5 rounded-full border leading-4 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30">早退{d.plan!.earlyMin}分</span>}
                          {att.filter((x) => !x.startsWith("点検")).map((x) => (
                            <span key={x} className="shrink-0 text-[10px] font-bold px-1.5 rounded-full border leading-4 bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">{x}</span>
                          ))}
                        </div>
                      </div>
                      {/* 右：時刻と時間 */}
                      <div className="shrink-0 text-right leading-tight">
                        {t.clockIn ? (
                          <>
                            <p className="text-[13px] font-semibold amount text-slate-700 dark:text-slate-200">
                              {fmt(t.clockIn)}<span className="text-slate-300 mx-0.5">〜</span>{t.clockOut ? fmt(t.clockOut) : d.missingOut ? <span className="text-red-600 font-bold">退勤なし</span> : ""}
                            </p>
                            <p className={`text-[11px] amount ${isActive ? `font-semibold ${elapsedColor(ms)}` : "text-muted-foreground"}`}>
                              {isActive ? elapsedStr(d.clockInTime, now) : d.missingOut ? "退勤を入れてください" : `実働 ${minToStr(t.workMin)}`}
                            </p>
                          </>
                        ) : d.schedule && !d.schedule.off && d.schedule.start ? (
                          <p className={`text-[11px] amount ${d.plan?.noShow ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>予定 {d.schedule.start}〜</p>
                        ) : d.schedule?.off ? (
                          <p className="text-[11px] text-muted-foreground">予定は休み</p>
                        ) : (
                          <p className="text-xs text-slate-300 dark:text-slate-600">—</p>
                        )}
                      </div>
                    </div>
                    {/* 1日の帯（打刻がある人だけ） */}
                    {segs.length > 0 && (
                      <div className="mt-1 pl-[2.375rem]"><DayBar segs={segs} win={win} now={now} live={live} height="h-1.5" ticks={false} plan={planOf(d.workDate ?? workDate ?? todayJST(), d.schedule)} /></div>
                    )}
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>

      {/* フッター（合計） */}
      <div className="px-3 py-1.5 border-t bg-muted/30 shrink-0 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{filtered.length === data.length ? "社員" : `${data.length}名中`}</span>
        <span className="font-semibold amount">{filtered.length}名</span>
      </div>
    </div>
  );
}
