import { useState, useEffect, useRef } from "react";
import {
  UserCheck, Coffee, LogOut, AlarmClock,
  ChevronLeft, ChevronRight,
} from "lucide-react";

/* ── 型 ─────────────────────────────────────────────── */
export type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";
export type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";
export type AbsenceType = "sick" | "paid_leave" | "bereavement" | "morning_half" | "afternoon_half" | "other";

export interface AbsenceRecord {
  id: number;
  employeeId: number;
  absenceType: AbsenceType;
  workDate: string;
  note: string | null;
}

export interface AttendanceRecord {
  id: number;
  employeeId: number;
  eventType: EventType;
  workDate: string;
  recordedAt: string;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  checklistNgItems: string | null;
}

export interface AttendanceDraft {
  departure: string | null;
  arrival: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
}

export interface EmployeeStatus {
  employee: { id: number; employeeCode: string; name: string; department: string; isOfficeStaff?: boolean };
  status: Status;
  clockInTime: string | null;
  records: AttendanceRecord[];
  draft: AttendanceDraft | null;
}

/* ── 定数（ラベル・色・アイコン）───────────────────────── */
export const ABSENCE_LABELS: Record<AbsenceType, string> = {
  sick:           "病欠",
  paid_leave:     "有給休暇",
  bereavement:    "忌引き",
  morning_half:   "午前休み",
  afternoon_half: "午後休み",
  other:          "その他",
};

export const ABSENCE_COLORS: Record<AbsenceType, string> = {
  sick:           "bg-red-100 text-red-700 border-red-200",
  paid_leave:     "bg-emerald-100 text-emerald-700 border-emerald-200",
  bereavement:    "bg-purple-100 text-purple-700 border-purple-200",
  morning_half:   "bg-orange-100 text-orange-700 border-orange-200",
  afternoon_half: "bg-amber-100 text-amber-700 border-amber-200",
  other:          "bg-slate-100 text-slate-600 border-slate-200",
};

export const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了",
};
export const EVENT_ICONS: Record<EventType, React.ReactNode> = {
  clock_in: <UserCheck className="h-3.5 w-3.5" />,
  clock_out: <LogOut className="h-3.5 w-3.5" />,
  break_start: <Coffee className="h-3.5 w-3.5" />,
  break_end: <AlarmClock className="h-3.5 w-3.5" />,
};
export const EVENT_COLORS: Record<EventType, string> = {
  clock_in: "bg-green-50 border-green-200 text-green-800",
  clock_out: "bg-slate-50 border-slate-200 text-slate-700",
  break_start: "bg-amber-50 border-amber-200 text-amber-800",
  break_end: "bg-sky-50 border-sky-200 text-sky-800",
};

/** 状態ごとの表示スタイル（洗練系・グロー撤去） */
export const STATUS_STYLE: Record<Status, { badge: string; dot: string; tint: string }> = {
  "未出勤": { badge: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",   dot: "bg-slate-300 dark:bg-slate-500",   tint: "" },
  "出勤中": { badge: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40", dot: "bg-emerald-500", tint: "" },
  "休憩中": { badge: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40",   dot: "bg-amber-400",   tint: "bg-amber-50/40 dark:bg-amber-500/10" },
  "退勤済": { badge: "bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",          dot: "bg-sky-400",     tint: "bg-slate-50/50 dark:bg-slate-800/40" },
};

/* ── 日付・時刻ユーティリティ ─────────────────────────── */
export function todayJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
export function nowTimeJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(11, 16); // "HH:MM"
}
/** 指定した日付+時刻が現在より未来かどうか（JST基準、1分の余裕） */
export function isFuture(dateStr: string, timeStr: string): boolean {
  const dt = new Date(`${dateStr}T${timeStr}:00+09:00`);
  return dt.getTime() > Date.now() + 60 * 1000;
}
export function formatDateJP(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dow = weekdays[new Date(dateStr).getDay()];
  return `${y}年${Number(m)}月${Number(d)}日（${dow}）`;
}
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function fmt(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
export function toTimeInput(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function elapsedStr(from: string | null, now: Date): string {
  if (!from) return "-";
  const ms = now.getTime() - new Date(from).getTime();
  return `${Math.floor(ms / 3600000)}時間${Math.floor((ms % 3600000) / 60000)}分`;
}
export function elapsedMs(from: string | null, now: Date): number {
  if (!from) return 0;
  return now.getTime() - new Date(from).getTime();
}
export function breakTotalMs(records: AttendanceRecord[], now: Date): number {
  let total = 0;
  const sorted = [...records].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  let breakStart: Date | null = null;
  for (const r of sorted) {
    if (r.eventType === "break_start") {
      breakStart = new Date(r.recordedAt);
    } else if (r.eventType === "break_end" && breakStart) {
      total += new Date(r.recordedAt).getTime() - breakStart.getTime();
      breakStart = null;
    }
  }
  if (breakStart) total += now.getTime() - breakStart.getTime();
  return total;
}
export function msToStr(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

/** 経過時間の警告色（8h超=橙、10h超=赤） */
export function elapsedColor(ms: number): string {
  return ms >= 10 * 3600000 ? "text-red-600" : ms >= 8 * 3600000 ? "text-orange-500" : "text-slate-400";
}

/* ── GPS 逆ジオコーディング ───────────────────────────── */
const geocodeCache = new Map<string, string>();

export function GpsAddressLink({ lat, lng }: { lat: number; lng: number }) {
  const [address, setAddress] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    if (geocodeCache.has(key)) {
      setAddress(geocodeCache.get(key)!);
      return;
    }
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja`,
      { headers: { "Accept-Language": "ja" } }
    )
      .then(r => r.json())
      .then(data => {
        const a = data.address ?? {};
        const parts = [
          a.prefecture ?? a.state,
          a.city ?? a.town ?? a.village ?? a.county,
          a.suburb ?? a.neighbourhood ?? a.city_district,
          a.road,
          a.house_number,
        ].filter(Boolean);
        const result = parts.length > 0 ? parts.join("") : (data.display_name ?? key);
        geocodeCache.set(key, result);
        setAddress(result);
      })
      .catch(() => {
        geocodeCache.set(key, key);
        setAddress(key);
      });
  }, [key, lat, lng]);

  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline mt-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      🛰️ {address ?? "住所取得中..."}
    </a>
  );
}

/* ── アバター（落ち着いた単色系）─────────────────────── */
const AVATAR_TONES = [
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-7 h-7 text-xs", md: "w-10 h-10 text-sm", lg: "w-12 h-12 text-base" }[size];
  const tone = AVATAR_TONES[(name.charCodeAt(0) ?? 0) % AVATAR_TONES.length];
  return (
    <div className={`${sz} rounded-full ${tone} font-bold flex items-center justify-center shrink-0`}>
      {name[0]}
    </div>
  );
}

/* ── 状態バッジ ───────────────────────────────────────── */
export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === "出勤中" ? "animate-pulse" : ""}`} />
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border jp-tight ${s.badge}`}>{status}</span>
    </span>
  );
}

/* ── 集計サマリータイル（フラット）──────────────────── */
export function SummaryStats({
  counts,
}: {
  counts: { working: number; breaking: number; absent: number; left: number };
}) {
  const tiles = [
    { label: "出勤中", value: counts.working,  dot: "bg-emerald-500", num: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50/60 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/25" },
    { label: "休憩中", value: counts.breaking, dot: "bg-amber-400",   num: "text-amber-700 dark:text-amber-300",   bg: "bg-amber-50/60 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/25" },
    { label: "未出勤", value: counts.absent,   dot: "bg-slate-300",   num: "text-slate-600 dark:text-slate-300",   bg: "bg-slate-50 border-slate-200 dark:bg-slate-800/40 dark:border-slate-700" },
    { label: "退勤済", value: counts.left,     dot: "bg-sky-400",     num: "text-sky-700 dark:text-sky-300",     bg: "bg-sky-50/60 border-sky-100 dark:bg-sky-500/10 dark:border-sky-500/25" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {tiles.map(t => (
        <div key={t.label} className={`rounded-xl border ${t.bg} px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${t.dot}`} />
            <span className="text-xs font-semibold text-muted-foreground jp-tight">{t.label}</span>
          </div>
          <span className={`text-2xl font-bold amount ${t.num} leading-none`}>{t.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── リッチ日付カレンダー ────────────────────────────── */
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function RichDatePicker({
  value,
  onChange,
  maxDate,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  maxDate: string;
  onClose: () => void;
}) {
  const selectedDate = new Date(value + "T00:00:00");
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const todayStr = todayJST();
  const maxDateObj = new Date(maxDate + "T23:59:59");

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    const firstOfNext = new Date(nextY, nextM, 1);
    if (firstOfNext <= maxDateObj) {
      if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
      else setViewMonth(m => m + 1);
    }
  };

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const toStr = (d: number) => {
    const m = String(viewMonth + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${viewYear}-${m}-${dd}`;
  };

  const canGoNext = (() => {
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    return new Date(nextY, nextM, 1) <= maxDateObj;
  })();

  return (
    <div className="w-[min(380px,calc(100vw-16px))] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="bg-indigo-600 px-5 py-4 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-white font-bold text-lg leading-none amount">{viewYear}年{viewMonth + 1}月</p>
        <button
          type="button"
          onClick={nextMonth}
          disabled={!canGoNext}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 text-center text-xs font-bold tracking-wider
              ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="grid grid-cols-7 p-2 gap-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} />;
          const dateStr = toStr(day);
          const isSelected = dateStr === value;
          const isToday = dateStr === todayStr;
          const isFutureDay = new Date(dateStr + "T00:00:00") > maxDateObj;
          const dow = (firstDay + day - 1) % 7;
          const isSun = dow === 0;
          const isSat = dow === 6;

          return (
            <button
              key={day}
              type="button"
              disabled={isFutureDay}
              onClick={() => { onChange(dateStr); onClose(); }}
              className={`
                relative h-11 w-full rounded-xl text-sm font-semibold amount transition-all duration-100
                flex flex-col items-center justify-center gap-0.5
                ${isFutureDay ? "opacity-25 cursor-not-allowed" : "hover:scale-105 active:scale-95"}
                ${isSelected
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                  : isToday
                    ? "bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400 ring-offset-1"
                    : isSun
                      ? "text-red-500 hover:bg-red-50"
                      : isSat
                        ? "text-blue-500 hover:bg-blue-50"
                        : "text-slate-700 hover:bg-slate-100"}
              `}
            >
              <span>{day}</span>
              {isToday && !isSelected && (
                <span className="w-1 h-1 rounded-full bg-indigo-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* フッター */}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          選択中：<span className="text-slate-600 font-medium">{formatDateJP(value)}</span>
        </span>
        <button
          type="button"
          onClick={() => { onChange(todayStr); onClose(); }}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          今日
        </button>
      </div>
    </div>
  );
}
