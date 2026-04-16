import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Clock, Coffee, LogOut, UserCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";

interface AttendanceRecord {
  id: number;
  employeeId: number;
  eventType: EventType;
  workDate: string;
  recordedAt: string;
  note: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
}

interface DayData {
  date: string;
  records: AttendanceRecord[];
  clockIn: AttendanceRecord | null;
  clockOut: AttendanceRecord | null;
  breaks: { start: AttendanceRecord; end: AttendanceRecord | null }[];
  workMinutes: number;
  dayOfWeek: number;
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatMinutes(mins: number): string {
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}時間${m > 0 ? m + "分" : ""}` : `${m}分`;
}

function calcWorkMinutes(records: AttendanceRecord[]): number {
  let total = 0;
  let clockInTime: Date | null = null;
  let breakStart: Date | null = null;
  let breakTotal = 0;

  for (const r of records) {
    const t = new Date(r.recordedAt);
    if (r.eventType === "clock_in") clockInTime = t;
    else if (r.eventType === "break_start") breakStart = t;
    else if (r.eventType === "break_end" && breakStart) {
      breakTotal += (t.getTime() - breakStart.getTime()) / 60000;
      breakStart = null;
    } else if (r.eventType === "clock_out" && clockInTime) {
      total = (t.getTime() - clockInTime.getTime()) / 60000 - breakTotal;
    }
  }
  return Math.round(Math.max(0, total));
}

function buildDayData(records: AttendanceRecord[]): DayData[] {
  const byDate = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    if (!byDate.has(r.workDate)) byDate.set(r.workDate, []);
    byDate.get(r.workDate)!.push(r);
  }

  return Array.from(byDate.entries()).map(([date, recs]) => {
    const sorted = [...recs].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    const clockIn = sorted.find(r => r.eventType === "clock_in") ?? null;
    const clockOut = sorted.filter(r => r.eventType === "clock_out").at(-1) ?? null;
    const breaks: { start: AttendanceRecord; end: AttendanceRecord | null }[] = [];
    let pendingBreak: AttendanceRecord | null = null;
    for (const r of sorted) {
      if (r.eventType === "break_start") pendingBreak = r;
      else if (r.eventType === "break_end" && pendingBreak) {
        breaks.push({ start: pendingBreak, end: r });
        pendingBreak = null;
      }
    }
    if (pendingBreak) breaks.push({ start: pendingBreak, end: null });
    const d = new Date(date);
    return {
      date,
      records: sorted,
      clockIn,
      clockOut,
      breaks,
      workMinutes: calcWorkMinutes(sorted),
      dayOfWeek: d.getDay(),
    };
  });
}

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DOW_COLORS = [
  "text-red-500",
  "text-foreground",
  "text-foreground",
  "text-foreground",
  "text-foreground",
  "text-foreground",
  "text-blue-500",
];

interface Props {
  open: boolean;
  onClose: () => void;
  employeeId: number;
  employeeName: string;
  year: number;
  month: number;
}

export function AttendanceCalendarDialog({ open, onClose, employeeId, employeeName, year: initYear, month: initMonth }: Props) {
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setYear(initYear);
    setMonth(initMonth);
  }, [initYear, initMonth]);

  useEffect(() => {
    if (!open || !employeeId) return;
    setLoading(true);
    setSelectedDate(null);
    fetch(`${BASE}/api/attendance/employee/${employeeId}/month?year=${year}&month=${month}`)
      .then(r => r.json())
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [open, employeeId, year, month]);

  const dayDataMap = new Map<string, DayData>();
  for (const d of buildDayData(records)) dayDataMap.set(d.date, d);

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const startDow = firstDay.getDay();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) {
    const mm = String(month).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    cells.push(`${year}-${mm}-${dd}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedDay = selectedDate ? dayDataMap.get(selectedDate) : null;

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const workedDays = dayDataMap.size;
  const totalMinutes = Array.from(dayDataMap.values()).reduce((s, d) => s + d.workMinutes, 0);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-full p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">{employeeName} — 勤怠カレンダー</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">出勤日に丸印が表示されます。日付をタップすると詳細を確認できます。</DialogDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm font-semibold w-20 text-center">{year}年{month}月</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col md:flex-row h-[520px] overflow-hidden">
          {/* ── カレンダーグリッド ── */}
          <div className="flex-1 p-4 overflow-y-auto">
            {/* 月次サマリー */}
            <div className="flex gap-4 mb-4 text-sm">
              <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-3 py-1.5">
                <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">出勤</span>
                <span className="font-semibold">{workedDays}日</span>
              </div>
              <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-3 py-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">合計</span>
                <span className="font-semibold">{formatMinutes(totalMinutes)}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">読み込み中...</div>
            ) : (
              <div>
                {/* 曜日ヘッダー */}
                <div className="grid grid-cols-7 mb-1">
                  {DOW_LABELS.map((d, i) => (
                    <div key={d} className={cn("text-center text-xs font-medium py-1", DOW_COLORS[i])}>{d}</div>
                  ))}
                </div>
                {/* 日付グリッド */}
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((dateStr, idx) => {
                    if (!dateStr) return <div key={`empty-${idx}`} />;
                    const day = parseInt(dateStr.slice(-2), 10);
                    const dow = new Date(dateStr).getDay();
                    const dd = dayDataMap.get(dateStr);
                    const hasRecord = !!dd;
                    const isSelected = selectedDate === dateStr;
                    const isToday = dateStr === new Date().toISOString().slice(0, 10);

                    return (
                      <button
                        key={dateStr}
                        onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                        className={cn(
                          "relative flex flex-col items-center justify-start pt-1.5 pb-1.5 rounded-lg min-h-[56px] transition-all",
                          "hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40",
                          isSelected && "ring-2 ring-primary bg-primary/5",
                          isToday && !isSelected && "bg-muted/40",
                        )}
                      >
                        <span className={cn(
                          "text-sm font-medium leading-none",
                          dow === 0 && "text-red-500",
                          dow === 6 && "text-blue-500",
                          isToday && "font-bold",
                        )}>
                          {day}
                        </span>

                        {hasRecord && (
                          <>
                            {/* 出勤丸 */}
                            <span className={cn(
                              "mt-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                              dow === 0
                                ? "bg-red-100 text-red-600 border border-red-300"
                                : dow === 6
                                  ? "bg-blue-100 text-blue-600 border border-blue-300"
                                  : "bg-emerald-100 text-emerald-700 border border-emerald-300",
                            )}>
                              出
                            </span>
                            {/* 出勤時刻 */}
                            {dd.clockIn && (
                              <span className="text-[9px] text-muted-foreground mt-0.5 leading-none">
                                {formatTime(dd.clockIn.recordedAt)}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {records.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm mt-6">この月の打刻記録はありません</p>
                )}
              </div>
            )}
          </div>

          {/* ── 日別詳細パネル ── */}
          <div className={cn(
            "border-t md:border-t-0 md:border-l transition-all duration-200 overflow-y-auto",
            selectedDate ? "w-full md:w-[260px] min-h-[180px]" : "w-0 hidden md:block md:w-0 overflow-hidden",
          )}>
            {selectedDay ? (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{formatDateJP(selectedDay.date)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedDay.dayOfWeek === 0 ? "日曜日" : selectedDay.dayOfWeek === 6 ? "土曜日" : "平日"}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedDate(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* 勤務時間サマリー */}
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5" />出勤</span>
                    <span className="font-mono font-medium">{formatTime(selectedDay.clockIn?.recordedAt)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><LogOut className="h-3.5 w-3.5" />退勤</span>
                    <span className="font-mono font-medium">{formatTime(selectedDay.clockOut?.recordedAt)}</span>
                  </div>
                  {selectedDay.breaks.length > 0 && selectedDay.breaks.map((b, i) => (
                    <div key={i} className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground flex items-center gap-1.5"><Coffee className="h-3.5 w-3.5" />休憩{selectedDay.breaks.length > 1 ? i + 1 : ""}</span>
                      <span className="font-mono text-xs">
                        {formatTime(b.start.recordedAt)} 〜 {formatTime(b.end?.recordedAt)}
                      </span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 flex justify-between items-center">
                    <span className="text-muted-foreground text-sm flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />実働</span>
                    <span className="font-semibold text-sm">{formatMinutes(selectedDay.workMinutes)}</span>
                  </div>
                </div>

                {/* オドメーター */}
                {(selectedDay.clockIn?.startOdometer != null || selectedDay.clockOut?.endOdometer != null) && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">走行記録</p>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                      {selectedDay.clockIn?.startOdometer != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">出発</span>
                          <span className="font-mono">{selectedDay.clockIn.startOdometer.toLocaleString()} km</span>
                        </div>
                      )}
                      {selectedDay.clockOut?.endOdometer != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">帰着</span>
                          <span className="font-mono">{selectedDay.clockOut.endOdometer.toLocaleString()} km</span>
                        </div>
                      )}
                      {selectedDay.clockIn?.startOdometer != null && selectedDay.clockOut?.endOdometer != null && (
                        <div className="flex justify-between border-t border-border pt-1 font-semibold">
                          <span className="text-muted-foreground">走行距離</span>
                          <span className="font-mono">{(selectedDay.clockOut.endOdometer - selectedDay.clockIn.startOdometer).toLocaleString()} km</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 打刻タイムライン */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">打刻ログ</p>
                  <div className="space-y-1">
                    {selectedDay.records.map((r, i) => (
                      <div key={r.id} className="flex items-center gap-2 text-xs">
                        <EventIcon type={r.eventType} />
                        <span className="text-muted-foreground">{EVENT_LABELS[r.eventType]}</span>
                        <span className="font-mono ml-auto">{formatTime(r.recordedAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* メモ */}
                {selectedDay.records.some(r => r.note) && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">メモ</p>
                    {selectedDay.records.filter(r => r.note).map(r => (
                      <p key={r.id} className="text-xs bg-muted/50 rounded p-2">{r.note}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden md:flex items-center justify-center h-full text-muted-foreground text-xs p-4 text-center">
                日付をタップすると<br />詳細を表示します
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDateJP(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dow = weekdays[new Date(dateStr).getDay()];
  return `${y}年${Number(m)}月${Number(d)}日（${dow}）`;
}

const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

function EventIcon({ type }: { type: EventType }) {
  const cls = "h-3 w-3 shrink-0";
  if (type === "clock_in") return <UserCheck className={cn(cls, "text-emerald-500")} />;
  if (type === "clock_out") return <LogOut className={cn(cls, "text-red-400")} />;
  if (type === "break_start") return <Coffee className={cn(cls, "text-amber-500")} />;
  return <Coffee className={cn(cls, "text-amber-300")} />;
}
