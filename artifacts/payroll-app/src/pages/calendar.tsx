import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar, RotateCcw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ── 祝日データ（年 → Map<"YYYY-MM-DD", 祝日名>）───────────────────
function getJapaneseHolidays(year: number): Map<string, string> {
  const d = (m: number, day: number) => `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const nthMonday = (m: number, n: number) => {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(year, m - 1, day);
      if (dt.getMonth() !== m - 1) break;
      if (dt.getDay() === 1) { count++; if (count === n) return d(m, day); }
    }
    return "";
  };

  const vernal = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumnal = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

  const holidays = new Map<string, string>([
    [d(1, 1),        "元日"],
    [d(2, 11),       "建国記念の日"],
    [d(2, 23),       "天皇誕生日"],
    [d(3, vernal),   "春分の日"],
    [d(4, 29),       "昭和の日"],
    [d(5, 3),        "憲法記念日"],
    [d(5, 4),        "みどりの日"],
    [d(5, 5),        "こどもの日"],
    [d(8, 11),       "山の日"],
    [d(9, autumnal), "秋分の日"],
    [d(11, 3),       "文化の日"],
    [d(11, 23),      "勤労感謝の日"],
  ]);

  const movable: [string, string][] = [
    [nthMonday(1, 2),  "成人の日"],
    [nthMonday(7, 3),  "海の日"],
    [nthMonday(9, 3),  "敬老の日"],
    [nthMonday(10, 2), "スポーツの日"],
  ];
  movable.filter(([k]) => k).forEach(([k, v]) => holidays.set(k, v));

  // 振替休日（日曜祝日 → 翌月曜、既存祝日を跳ばして）
  const substitutes: string[] = [];
  holidays.forEach((_name, h) => {
    const dt = new Date(h);
    if (dt.getDay() === 0) {
      const next = new Date(dt);
      next.setDate(next.getDate() + 1);
      while (holidays.has(fmtDate(next))) next.setDate(next.getDate() + 1);
      substitutes.push(fmtDate(next));
    }
  });
  substitutes.forEach(s => holidays.set(s, "振替休日"));

  return holidays;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STORAGE_KEY = "calendar_overrides";

function loadOverrides(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveOverrides(overrides: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const DAY_HEADERS = ["日","月","火","水","木","金","土"];

function isRedDay(dateStr: string, overrides: Record<string, boolean>, holidays: Map<string, string>): boolean {
  if (dateStr in overrides) return overrides[dateStr];
  const dt = new Date(dateStr);
  const dow = dt.getDay();
  return dow === 0 || dow === 6 || holidays.has(dateStr);
}

function MonthCalendar({
  year, month, holidays, overrides, onToggle,
}: {
  year: number;
  month: number;
  holidays: Map<string, string>;
  overrides: Record<string, boolean>;
  onToggle: (dateStr: string) => void;
}) {
  const firstDay = new Date(year, month - 1, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = fmtDate(new Date());

  // 月ごとの出勤日数
  let workDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(new Date(year, month - 1, d));
    if (!isRedDay(ds, overrides, holidays)) workDays++;
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-card shadow-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center justify-between border-b">
        <span className="font-semibold text-sm">{MONTH_NAMES[month - 1]}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          出勤 <span className="font-semibold text-foreground">{workDays}</span>日
        </span>
      </div>
      <div className="p-2">
        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map((h, i) => (
            <div key={h} className={`text-center text-xs font-medium py-0.5 ${i === 0 || i === 6 ? "text-red-500" : "text-muted-foreground"}`}>
              {h}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px">
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} />;
            const dateStr = fmtDate(new Date(year, month - 1, day));
            const red = isRedDay(dateStr, overrides, holidays);
            const isToday = dateStr === today;
            const holidayName = holidays.get(dateStr);
            const btn = (
              <button
                onClick={() => onToggle(dateStr)}
                className={`
                  relative flex items-center justify-center rounded text-xs h-7 w-full
                  transition-colors select-none cursor-pointer
                  ${red ? "text-red-600 font-medium hover:bg-red-50" : "text-gray-800 hover:bg-gray-100"}
                  ${isToday ? "ring-2 ring-primary ring-offset-1 font-bold" : ""}
                `}
              >
                {day}
                {holidayName && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400" />
                )}
              </button>
            );
            if (holidayName) {
              return (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent side="top" className="text-xs px-2 py-1">
                    {holidayName}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return <div key={idx}>{btn}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(loadOverrides);

  const holidays = getJapaneseHolidays(year);

  const handleToggle = useCallback((dateStr: string) => {
    setOverrides(prev => {
      const dt = new Date(dateStr);
      const dow = dt.getDay();
      const isNaturallyRed = dow === 0 || dow === 6 || holidays.has(dateStr);
      const currentlyRed = dateStr in prev ? prev[dateStr] : isNaturallyRed;
      const next = { ...prev };
      if (currentlyRed === isNaturallyRed) {
        next[dateStr] = !currentlyRed;
      } else {
        delete next[dateStr];
      }
      saveOverrides(next);
      return next;
    });
  }, [holidays]);

  const handleReset = () => {
    const yearPrefix = `${year}-`;
    setOverrides(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.startsWith(yearPrefix)) delete next[k]; });
      saveOverrides(next);
      return next;
    });
  };

  // 年間出勤日数合計
  const totalWorkDays = (() => {
    let count = 0;
    for (let m = 1; m <= 12; m++) {
      const days = new Date(year, m, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const ds = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (!isRedDay(ds, overrides, holidays)) count++;
      }
    }
    return count;
  })();

  const overrideCount = Object.keys(overrides).filter(k => k.startsWith(`${year}-`)).length;

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">カレンダー</h2>
              <p className="text-sm text-muted-foreground">
                祝日・土日は<span className="text-red-600 font-medium">赤</span>、平日（出勤日）は<span className="font-medium">黒</span>。日付クリックで切り替え。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {overrideCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-muted-foreground">
                <RotateCcw className="h-3.5 w-3.5" />
                {year}年のリセット
              </Button>
            )}
            <div className="flex items-center gap-1 border rounded-md px-1">
              <button onClick={() => setYear(y => y - 1)} className="p-1.5 hover:bg-muted rounded transition-colors" title="前年">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-sm font-semibold tabular-nums w-16 text-center">{year}年</span>
              <button onClick={() => setYear(y => y + 1)} className="p-1.5 hover:bg-muted rounded transition-colors" title="翌年">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
            <MonthCalendar
              key={`${year}-${month}`}
              year={year}
              month={month}
              holidays={holidays}
              overrides={overrides}
              onToggle={handleToggle}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border rounded-md px-4 py-3 bg-muted/30 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded bg-red-100 border border-red-200" />
            祝日・土曜・日曜（クリックで出勤日に変更）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded bg-gray-100 border border-gray-200" />
            平日・出勤日（クリックで休日に変更）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded ring-2 ring-primary" />
            今日
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded bg-red-100 border border-red-200 relative">
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400" />
            </span>
            祝日（ホバーで名称表示）
          </span>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">{year}年 年間出勤日数</span>
            <span className="text-lg font-bold text-foreground tabular-nums">{totalWorkDays}</span>
            <span>日</span>
          </span>
        </div>
      </div>
    </AppLayout>
  );
}
