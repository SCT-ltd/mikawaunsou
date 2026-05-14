import { useState, useCallback, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar, RotateCcw, Printer } from "lucide-react";
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

function isRedDay(dateStr: string, overrides: Record<string, boolean>, holidays: Map<string, string>): boolean {
  if (dateStr in overrides) return overrides[dateStr];
  const dt = new Date(dateStr);
  const dow = dt.getDay();
  return dow === 0 || dow === 6 || holidays.has(dateStr);
}

const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const DAY_HEADERS = ["日","月","火","水","木","金","土"];

// ── MonthCalendar コンポーネント ─────────────────────────────────────
function MonthCalendar({
  year, month, holidays, overrides, onToggle,
}: {
  year: number;
  month: number;
  holidays: Map<string, string>;
  overrides: Record<string, boolean>;
  onToggle: (dateStr: string) => void;
}) {
  const today = fmtDate(new Date());
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDow = new Date(year, month - 1, 1).getDay();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  let workDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(new Date(year, month - 1, d));
    if (!isRedDay(ds, overrides, holidays)) workDays++;
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="bg-muted/50 px-3 py-2 flex justify-between items-center border-b">
        <span className="font-semibold text-sm">{year}年 {MONTH_NAMES[month - 1]}</span>
        <span className="text-xs text-muted-foreground">
          出勤 <strong className="text-foreground">{workDays}</strong>日
          <span className="text-red-500 ml-1">休 <strong>{daysInMonth - workDays}</strong>日</span>
        </span>
      </div>
      <div className="p-2">
        <div className="grid grid-cols-7 gap-px mb-1">
          {DAY_HEADERS.map((h, i) => (
            <div key={h} className={`text-center text-xs font-semibold py-0.5 ${i === 0 || i === 6 ? "text-red-500" : "text-muted-foreground"}`}>
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

// ── 年度の月リスト（4月〜翌3月）
function getFiscalMonths(fiscalYear: number): { year: number; month: number }[] {
  return [
    ...Array.from({ length: 9 }, (_, i) => ({ year: fiscalYear,     month: i + 4 })),
    ...Array.from({ length: 3 }, (_, i) => ({ year: fiscalYear + 1, month: i + 1 })),
  ];
}

// ── 年度内の override かどうか
function isInFiscalYear(dateStr: string, fiscalYear: number): boolean {
  const [y, m] = dateStr.split("-").map(Number);
  if (y === fiscalYear     && m >= 4) return true;
  if (y === fiscalYear + 1 && m <= 3) return true;
  return false;
}

const API_BASE = "/api";

export default function CalendarPage() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear  = now.getFullYear();
  const defaultFiscalYear = currentMonth >= 4 ? currentYear : currentYear - 1;
  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear);
  const [overrides, setOverrides]   = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // ── SSE でリアルタイム受信 ────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/calendar/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, boolean>;
        setOverrides(data);
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      // 再接続はブラウザが自動で行う
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // 年度の月リスト
  const fiscalMonths = getFiscalMonths(fiscalYear);

  // 祝日（年度をまたぐため両年分マージ）
  const holidays = new Map([
    ...getJapaneseHolidays(fiscalYear),
    ...getJapaneseHolidays(fiscalYear + 1),
  ]);

  // ── 日付クリック → API へ POST ──────────────────────────────────
  const handleToggle = useCallback((dateStr: string) => {
    const dt = new Date(dateStr);
    const dow = dt.getDay();
    const y = dt.getFullYear();
    const hols = new Map([...getJapaneseHolidays(y)]);
    const isNaturallyRed = dow === 0 || dow === 6 || hols.has(dateStr);

    setOverrides(prev => {
      const currentlyRed = dateStr in prev ? prev[dateStr] : isNaturallyRed;
      const newIsRed = !currentlyRed;
      // 自然な状態に戻る場合は override を削除
      const isRed = newIsRed === isNaturallyRed ? null : newIsRed;

      setSyncing(true);
      fetch(`${API_BASE}/calendar/overrides/${dateStr}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRed }),
      }).finally(() => setSyncing(false));

      // 楽観的更新（SSE で正式な状態を受け取るまでの間）
      if (isRed === null) {
        const next = { ...prev };
        delete next[dateStr];
        return next;
      }
      return { ...prev, [dateStr]: isRed };
    });
  }, []);

  // ── 年度リセット → API へ DELETE ────────────────────────────────
  const handleReset = () => {
    const from = `${fiscalYear}-04-01`;
    const to   = `${fiscalYear + 1}-03-31`;
    setSyncing(true);
    fetch(`${API_BASE}/calendar/overrides?from=${from}&to=${to}`, {
      method: "DELETE",
    })
      .then(r => r.json())
      .then((data: Record<string, boolean>) => setOverrides(data))
      .finally(() => setSyncing(false));
  };

  const handlePrint = () => {
    const title = `${fiscalYear}年度 カレンダー（${fiscalYear}年4月〜${fiscalYear + 1}年3月）`;

    const monthsHTML = fiscalMonths.map(({ year, month }) => {
      const daysInMonth = new Date(year, month, 0).getDate();
      const startDow = new Date(year, month - 1, 1).getDay();

      const cells: (number | null)[] = [];
      for (let i = 0; i < startDow; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) cells.push(d);
      while (cells.length % 7 !== 0) cells.push(null);

      let workDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = fmtDate(new Date(year, month - 1, d));
        if (!isRedDay(ds, overrides, holidays)) workDays++;
      }

      const dayHeadersHTML = ["日","月","火","水","木","金","土"].map((h, i) => {
        const color = (i === 0 || i === 6) ? "#dc2626" : "#6b7280";
        return `<div style="text-align:center;font-size:8px;color:${color};font-weight:600;padding:1px 0;">${h}</div>`;
      }).join("");

      const cellsHTML = cells.map((day) => {
        if (!day) return `<div></div>`;
        const dateStr = fmtDate(new Date(year, month - 1, day));
        const red = isRedDay(dateStr, overrides, holidays);
        const holidayName = holidays.get(dateStr);
        const textColor = red ? "#dc2626" : "#111827";
        const dot = holidayName
          ? `<span style="display:block;width:4px;height:4px;border-radius:50%;background:#f87171;margin:-1px auto 0;line-height:1;"></span>`
          : "";
        const titleAttr = holidayName ? ` title="${holidayName}"` : "";
        return `<div style="text-align:center;padding:1px 0;">
          <div${titleAttr} style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:20px;height:20px;border-radius:3px;font-size:9px;font-weight:${red?"600":"400"};color:${textColor};box-sizing:border-box;">${day}${dot}</div>
        </div>`;
      }).join("");

      return `<div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;background:#fff;break-inside:avoid;">
        <div style="background:#f3f4f6;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;">
          <span style="font-weight:700;font-size:10px;">${year}年 ${MONTH_NAMES[month - 1]}</span>
          <span style="font-size:8px;color:#6b7280;">出勤<strong style="color:#111;">${workDays}</strong>日 <span style="color:#ef4444;">休<strong>${daysInMonth - workDays}</strong>日</span></span>
        </div>
        <div style="padding:4px;">
          <div style="display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:2px;">${dayHeadersHTML}</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);">${cellsHTML}</div>
        </div>
      </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,'MS PGothic',Arial,sans-serif; background:#fff; padding: 0; }
  .header { text-align:center; margin-bottom:8px; }
  .header h1 { font-size:14px; font-weight:bold; margin-bottom:2px; }
  .header p { font-size:9px; color:#6b7280; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
</style>
</head>
<body>
<div class="header">
  <h1>${title}</h1>
  <p>年間出勤日数 ${totalWorkDays}日　年間休日数 ${totalFiscalDays - totalWorkDays}日</p>
</div>
<div class="grid">${monthsHTML}</div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) { alert("ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。"); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.addEventListener("load", () => {
      win.focus();
      win.print();
      win.close();
    });
  };

  // 年度内の override 数
  const overrideCount = Object.keys(overrides).filter(k => isInFiscalYear(k, fiscalYear)).length;

  // 年度の総日数・出勤日数
  const totalFiscalDays = fiscalMonths.reduce(
    (sum, { year, month }) => sum + new Date(year, month, 0).getDate(), 0
  );
  const totalWorkDays = fiscalMonths.reduce((sum, { year, month }) => {
    const days = new Date(year, month, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!isRedDay(ds, overrides, holidays)) sum++;
    }
    return sum;
  }, 0);

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* ── ページヘッダー ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">カレンダー</h2>
              <p className="text-sm text-muted-foreground">
                祝日・土日は<span className="text-red-600 font-medium">赤</span>、平日（出勤日）は<span className="font-medium">黒</span>。日付クリックで切り替え。
                {syncing && <span className="ml-2 text-blue-500 text-xs">同期中…</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {overrideCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-muted-foreground">
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{fiscalYear}年度のリセット</span><span className="sm:hidden">リセット</span>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">印刷</span>
            </Button>
            <div className="flex items-center gap-1 border rounded-md px-1">
              <button onClick={() => setFiscalYear(y => y - 1)} className="p-1.5 hover:bg-muted rounded transition-colors" title="前年度">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-sm font-semibold tabular-nums text-center whitespace-nowrap">
                {fiscalYear}年度
              </span>
              <button onClick={() => setFiscalYear(y => y + 1)} className="p-1.5 hover:bg-muted rounded transition-colors" title="翌年度">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── 年度表示サブタイトル ── */}
        <div className="text-xs text-muted-foreground -mt-3">
          {fiscalYear}年4月〜{fiscalYear + 1}年3月
        </div>

        {/* ── カレンダーグリッド ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {fiscalMonths.map(({ year, month }) => (
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

        {/* ── 凡例・統計 ── */}
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
          <span className="ml-auto flex items-center gap-6">
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{fiscalYear}年度 年間出勤日数</span>
              <span className="text-lg font-bold text-foreground tabular-nums">{totalWorkDays}</span>
              <span>日</span>
            </span>
            <span className="w-px h-5 bg-border" />
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">年間休日数</span>
              <span className="text-lg font-bold text-red-600 tabular-nums">{totalFiscalDays - totalWorkDays}</span>
              <span>日</span>
            </span>
          </span>
        </div>
      </div>
    </AppLayout>
  );
}
