import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Clock, QrCode, Pencil, Trash2, Save, X,
  UserCheck, Coffee, LogOut, AlarmClock, Plus, GripVertical,
  ChevronLeft, ChevronRight, CalendarOff, CalendarDays,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import QRCode from "react-qr-code";

type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";
type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";
type AbsenceType = "sick" | "paid_leave" | "bereavement" | "morning_half" | "afternoon_half" | "other";

interface AbsenceRecord {
  id: number;
  employeeId: number;
  absenceType: AbsenceType;
  workDate: string;
  note: string | null;
}

const ABSENCE_LABELS: Record<AbsenceType, string> = {
  sick:           "病欠",
  paid_leave:     "有給休暇",
  bereavement:    "忌引き",
  morning_half:   "午前休み",
  afternoon_half: "午後休み",
  other:          "その他",
};

const ABSENCE_COLORS: Record<AbsenceType, string> = {
  sick:           "bg-red-100 text-red-700 border-red-200",
  paid_leave:     "bg-emerald-100 text-emerald-700 border-emerald-200",
  bereavement:    "bg-purple-100 text-purple-700 border-purple-200",
  morning_half:   "bg-orange-100 text-orange-700 border-orange-200",
  afternoon_half: "bg-amber-100 text-amber-700 border-amber-200",
  other:          "bg-slate-100 text-slate-600 border-slate-200",
};

const geocodeCache = new Map<string, string>();

function GpsAddressLink({ lat, lng }: { lat: number; lng: number }) {
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

interface AttendanceRecord {
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

interface AttendanceDraft {
  departure: string | null;
  arrival: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
}

interface EmployeeStatus {
  employee: { id: number; employeeCode: string; name: string; department: string; isOfficeStaff?: boolean };
  status: Status;
  clockInTime: string | null;
  records: AttendanceRecord[];
  draft: AttendanceDraft | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── 日付ユーティリティ ─────────────────── */
function todayJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
function nowTimeJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(11, 16); // "HH:MM"
}
// 指定した日付+時刻が現在より未来かどうかチェック（JST基準）
function isFuture(dateStr: string, timeStr: string): boolean {
  const dt = new Date(`${dateStr}T${timeStr}:00+09:00`);
  return dt.getTime() > Date.now() + 60 * 1000; // 1分の余裕
}
function formatDateJP(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dow = weekdays[new Date(dateStr).getDay()];
  return `${y}年${Number(m)}月${Number(d)}日（${dow}）`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ── ユーティリティ ──────────────────────── */
function fmt(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
function toTimeInput(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function elapsedStr(from: string | null, now: Date): string {
  if (!from) return "-";
  const ms = now.getTime() - new Date(from).getTime();
  return `${Math.floor(ms / 3600000)}時間${Math.floor((ms % 3600000) / 60000)}分`;
}
function elapsedMs(from: string | null, now: Date): number {
  if (!from) return 0;
  return now.getTime() - new Date(from).getTime();
}
function breakTotalMs(records: AttendanceRecord[], now: Date): number {
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
  // 休憩中（break_endがまだない）なら現在時刻まで加算
  if (breakStart) total += now.getTime() - breakStart.getTime();
  return total;
}
function msToStr(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

/* ── 定数 ──────────────────────────────── */
const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了",
};
const EVENT_ICONS: Record<EventType, React.ReactNode> = {
  clock_in: <UserCheck className="h-3.5 w-3.5" />,
  clock_out: <LogOut className="h-3.5 w-3.5" />,
  break_start: <Coffee className="h-3.5 w-3.5" />,
  break_end: <AlarmClock className="h-3.5 w-3.5" />,
};
const EVENT_COLORS: Record<EventType, string> = {
  clock_in: "bg-green-50 border-green-200 text-green-800",
  clock_out: "bg-slate-50 border-slate-200 text-slate-700",
  break_start: "bg-amber-50 border-amber-200 text-amber-800",
  break_end: "bg-sky-50 border-sky-200 text-sky-800",
};
const STATUS_STYLE: Record<Status, { badge: string; dot: string; rowBg: string; glow: string }> = {
  "未出勤": { badge: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-300", rowBg: "", glow: "" },
  "出勤中": { badge: "bg-emerald-100 text-emerald-700 border-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)]", dot: "bg-emerald-500", rowBg: "", glow: "shadow-emerald-100" },
  "休憩中": { badge: "bg-amber-100 text-amber-700 border-amber-300", dot: "bg-amber-400", rowBg: "bg-amber-50/40", glow: "" },
  "退勤済": { badge: "bg-sky-50 text-sky-600 border-sky-200", dot: "bg-sky-400", rowBg: "bg-slate-50/50", glow: "" },
};

/* ── サブコンポーネント ──────────────────── */
function StatusDot({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${s.dot} ${status === "出勤中" ? "animate-pulse" : ""}`} />
      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border tracking-wide ${s.badge}`}>{status}</span>
    </span>
  );
}

const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-700",
  "from-blue-500 to-indigo-700",
  "from-emerald-500 to-teal-700",
  "from-rose-500 to-pink-700",
  "from-orange-500 to-amber-700",
  "from-cyan-500 to-blue-700",
];

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-7 h-7 text-xs", md: "w-10 h-10 text-sm", lg: "w-13 h-13 text-base" }[size];
  const grad = AVATAR_GRADIENTS[(name.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length];
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br ${grad} text-white font-bold flex items-center justify-center shrink-0 shadow-md`}>
      {name[0]}
    </div>
  );
}

/* ── リッチ日付カレンダー ────────────────── */
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function RichDatePicker({
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

  // カレンダーグリッド生成
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
    <div className="w-[380px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-4 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-white font-bold text-lg leading-none">
            {viewYear}年{viewMonth + 1}月
          </p>
        </div>
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
          const isFuture = new Date(dateStr + "T00:00:00") > maxDateObj;
          const dow = (firstDay + day - 1) % 7;
          const isSun = dow === 0;
          const isSat = dow === 6;

          return (
            <button
              key={day}
              type="button"
              disabled={isFuture}
              onClick={() => { onChange(dateStr); onClose(); }}
              className={`
                relative h-11 w-full rounded-xl text-sm font-semibold transition-all duration-100
                flex flex-col items-center justify-center gap-0.5
                ${isFuture ? "opacity-25 cursor-not-allowed" : "hover:scale-105 active:scale-95"}
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
          onClick={() => {
            onChange(todayStr);
            onClose();
          }}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          今日
        </button>
      </div>
    </div>
  );
}

/* ── メインページ ────────────────────────── */
export default function AttendancePage() {
  const [selectedDate, setSelectedDate] = useState(() => todayJST());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarPos, setCalendarPos] = useState({ top: 0, left: 0 });
  const calendarBtnRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<EmployeeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [now, setNow] = useState(new Date());

  // 右サイドパネル
  const [selected, setSelected] = useState<EmployeeStatus | null>(null);

  // QR ダイアログ
  const [qrEmployee, setQrEmployee] = useState<EmployeeStatus["employee"] | null>(null);

  // 打刻編集
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [editEventType, setEditEventType] = useState<EventType>("clock_in");
  const [editTime, setEditTime] = useState("");
  const [editDate, setEditDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // 手動追加
  const [addMode, setAddMode] = useState(false);
  const [addEventType, setAddEventType] = useState<EventType>("clock_in");
  const [addTime, setAddTime] = useState(() => toTimeInput(new Date().toISOString()));

  // ドラッグ並び替え（打刻）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragInsertBefore, setDragInsertBefore] = useState(true);
  // ドラッグ並び替え（欠勤）
  const [absenceDragIndex, setAbsenceDragIndex] = useState<number | null>(null);
  const [absenceDragOverIndex, setAbsenceDragOverIndex] = useState<number | null>(null);
  const [absenceDragInsertBefore, setAbsenceDragInsertBefore] = useState(true);

  // 欠勤・休暇
  const [absences, setAbsences] = useState<AbsenceRecord[]>([]);
  const [absenceMode, setAbsenceMode] = useState(false);
  const [absenceType, setAbsenceType] = useState<AbsenceType>("sick");
  const [absenceNote, setAbsenceNote] = useState("");

  const isToday = selectedDate === todayJST();

  /* ── データ取得 ──────────────────────── */
  const fetchData = useCallback(async (date: string) => {
    try {
      const url = `${BASE}/api/attendance/today?date=${date}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const result: EmployeeStatus[] = await res.json();
      setData(result);
      setLastUpdated(new Date());
      setSelected(prev => prev ? (result.find(r => r.employee.id === prev.employee.id) ?? null) : null);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  const fetchAbsences = useCallback(async (date: string) => {
    try {
      const res = await fetch(`${BASE}/api/absences?date=${date}`, { cache: "no-store" });
      if (!res.ok) return;
      const result: AbsenceRecord[] = await res.json();
      setAbsences(result);
    } catch { /* silent */ }
  }, []);

  // 日付が変わったら再取得・サイドパネルを閉じる
  useEffect(() => {
    setLoading(true);
    setSelected(null);
    setAbsenceMode(false);
    fetchData(selectedDate);
    fetchAbsences(selectedDate);
  }, [selectedDate, fetchData, fetchAbsences]);

  // 今日の場合のみSSE＋ポーリング
  useEffect(() => {
    if (!isToday) return;
    const es = new EventSource(`${BASE}/api/attendance/stream`);
    es.onmessage = (e) => {
      try {
        const result: EmployeeStatus[] = JSON.parse(e.data);
        setData(result);
        setLastUpdated(new Date());
        setLoading(false);
        setSelected(prev => prev ? (result.find(r => r.employee.id === prev.employee.id) ?? null) : null);
      } catch { /* ignore */ }
    };
    const poll = setInterval(() => fetchData(selectedDate), 10000);
    return () => { es.close(); clearInterval(poll); };
  }, [isToday, selectedDate, fetchData]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── 打刻編集 ──────────────────────── */
  const openEdit = (r: AttendanceRecord) => {
    setEditRecord(r);
    setEditEventType(r.eventType);
    setEditTime(toTimeInput(r.recordedAt));
    setEditDate(r.workDate);
    setDeleteConfirm(false);
    setEditError(null);
  };
  const [editError, setEditError] = useState<string | null>(null);

  const saveEdit = async () => {
    if (!editRecord) return;
    setEditError(null);
    if (!editDate) {
      setEditError("日付を入力してください");
      return;
    }
    // JST日付＋入力時刻でタイムスタンプを構築（編集後の日付を使用）
    const recordedAt = new Date(`${editDate}T${editTime}:00+09:00`).toISOString();
    if (isFuture(editDate, editTime)) {
      setEditError("未来の時刻は登録できません");
      return;
    }
    const dateChanged = editDate !== editRecord.workDate;
    setSaving(true);
    try {
      const body: Record<string, string> = { eventType: editEventType, recordedAt };
      if (dateChanged) body.workDate = editDate;
      const res = await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEditError(err.error ?? "保存に失敗しました");
        return;
      }
      setEditRecord(null);
      // 日付が変わった場合は両日付を更新
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  };
  const deleteRec = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, { method: "DELETE" });
      setEditRecord(null);
      setDeleteConfirm(false);
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  };

  /* ── 手動追加 ──────────────────────── */
  const [addError, setAddError] = useState<string | null>(null);

  const addRecord = async () => {
    if (!selected) return;
    setAddError(null);
    if (isFuture(selectedDate, addTime)) {
      setAddError("未来の時刻は登録できません");
      return;
    }
    setSaving(true);
    try {
      // selectedDate（JST日付）＋入力時刻でタイムスタンプを生成（JST固定）
      const recordedAt = new Date(`${selectedDate}T${addTime}:00+09:00`).toISOString();
      const res = await fetch(`${BASE}/api/attendance/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selected.employee.id, eventType: addEventType, recordedAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAddError(body.error ?? "保存に失敗しました");
        return;
      }
      setAddMode(false);
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  };

  /* ── 欠勤登録 ──────────────────────── */
  const saveAbsence = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/absences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selected.employee.id,
          absenceType,
          workDate: selectedDate,
          note: absenceNote || null,
        }),
      });
      setAbsenceMode(false);
      setAbsenceNote("");
      await fetchAbsences(selectedDate);
    } finally { setSaving(false); }
  };

  const deleteAbsence = async (id: number) => {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/absences/${id}`, { method: "DELETE" });
      await fetchAbsences(selectedDate);
    } finally { setSaving(false); }
  };

  const swapAbsences = (employeeId: string, indexA: number, indexB: number) => {
    if (indexA === indexB) return;
    const empAbsences = absences.filter(a => a.employeeId === employeeId);
    if (indexA < 0 || indexB < 0 || indexA >= empAbsences.length || indexB >= empAbsences.length) return;
    const others = absences.filter(a => a.employeeId !== employeeId);
    const reordered = [...empAbsences];
    [reordered[indexA], reordered[indexB]] = [reordered[indexB], reordered[indexA]];
    setAbsences([...others, ...reordered]);
  };

  /* ── ドラッグ並び替え ─────────────────── */
  const swapRecordTimes = async (indexA: number, indexB: number) => {
    if (!selected || indexA === indexB) return;
    const recs = selected.records;
    const a = recs[indexA];
    const b = recs[indexB];

    // 楽観的更新：ドロップ直後にUIを即反映（時刻を交換）
    const optimisticRecs = recs.map((r, i) => {
      if (i === indexA) return { ...r, recordedAt: b.recordedAt };
      if (i === indexB) return { ...r, recordedAt: a.recordedAt };
      return r;
    });
    setSelected(prev => prev ? { ...prev, records: optimisticRecs } : prev);
    setDragIndex(null);
    setDragOverIndex(null);

    setSaving(true);
    try {
      await Promise.all([
        fetch(`${BASE}/api/attendance/records/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: a.eventType, recordedAt: b.recordedAt }),
        }),
        fetch(`${BASE}/api/attendance/records/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: b.eventType, recordedAt: a.recordedAt }),
        }),
      ]);
      await fetchData(selectedDate);
    } finally {
      setSaving(false);
    }
  };

  /* ── 集計 ──────────────────────────── */
  const counts = {
    working: data.filter(d => d.status === "出勤中").length,
    breaking: data.filter(d => d.status === "休憩中").length,
    absent: data.filter(d => d.status === "未出勤").length,
    left: data.filter(d => d.status === "退勤済").length,
  };

  const qrAttendancePath = qrEmployee?.isOfficeStaff ? "office" : "driver";
  const qrUrl = qrEmployee ? `${window.location.origin}${BASE}/${qrAttendancePath}/${qrEmployee.id}` : "";
  const panelOpen = !!selected;

  return (
    <AppLayout>
      <div className="flex gap-0 -m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-56px)]">

        {/* ── メインエリア ─────────────────────────────── */}
        <div className={`flex-1 p-4 md:p-6 lg:p-8 min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[420px]" : ""}`}>
          <div className="space-y-6 max-w-5xl">

            {/* ヘッダー */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-1 h-7 rounded-full bg-gradient-to-b from-indigo-500 to-violet-600" />
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                    勤怠ダッシュボード
                  </h2>
                  {isToday && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 tracking-wider uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />LIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground pl-3.5 hidden sm:block">
                  {isToday
                    ? `最終更新: ${lastUpdated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ・ 社員行をクリックで詳細表示`
                    : "過去の記録（読み取り専用）・ 社員行をクリックで詳細表示"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* 日付ナビゲーション */}
                <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <button
                    onClick={() => setSelectedDate(d => addDays(d, -1))}
                    className="px-2.5 py-2 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors border-r border-slate-100"
                    title="前の日"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="relative">
                    <button
                      ref={calendarBtnRef}
                      type="button"
                      onClick={() => {
                        if (!calendarOpen && calendarBtnRef.current) {
                          const r = calendarBtnRef.current.getBoundingClientRect();
                          setCalendarPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
                        }
                        setCalendarOpen(o => !o);
                      }}
                      className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors min-w-[180px] text-center flex items-center justify-center gap-1.5"
                    >
                      <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                      {formatDateJP(selectedDate)}
                    </button>
                    {calendarOpen && createPortal(
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setCalendarOpen(false)}
                        />
                        <div
                          className="fixed z-50 -translate-x-1/2"
                          style={{ top: calendarPos.top, left: calendarPos.left }}
                        >
                          <RichDatePicker
                            value={selectedDate}
                            onChange={setSelectedDate}
                            maxDate={todayJST()}
                            onClose={() => setCalendarOpen(false)}
                          />
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedDate(d => addDays(d, 1))}
                    disabled={isToday}
                    className="px-2.5 py-2 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors border-l border-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="次の日"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                {!isToday && (
                  <Button variant="outline" size="sm" onClick={() => setSelectedDate(todayJST())} className="text-xs rounded-lg">
                    今日
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => fetchData(selectedDate)} className="gap-1.5 rounded-lg border-slate-200">
                  <RefreshCw className="h-3.5 w-3.5" />更新
                </Button>
              </div>
            </div>

            {/* サマリーカード */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: "出勤中", value: counts.working,
                  gradient: "from-emerald-500 to-teal-600",
                  bg: "bg-gradient-to-br from-emerald-50 to-teal-50/50",
                  border: "border-emerald-200/80",
                  text: "text-emerald-700",
                  num: "text-emerald-800",
                  glow: "shadow-emerald-100",
                },
                {
                  label: "休憩中", value: counts.breaking,
                  gradient: "from-amber-400 to-orange-500",
                  bg: "bg-gradient-to-br from-amber-50 to-orange-50/50",
                  border: "border-amber-200/80",
                  text: "text-amber-700",
                  num: "text-amber-800",
                  glow: "shadow-amber-100",
                },
                {
                  label: "未出勤", value: counts.absent,
                  gradient: "from-slate-400 to-slate-500",
                  bg: "bg-gradient-to-br from-slate-50 to-slate-100/50",
                  border: "border-slate-200",
                  text: "text-slate-500",
                  num: "text-slate-700",
                  glow: "",
                },
                {
                  label: "退勤済", value: counts.left,
                  gradient: "from-sky-400 to-blue-600",
                  bg: "bg-gradient-to-br from-sky-50 to-blue-50/50",
                  border: "border-sky-200/80",
                  text: "text-sky-600",
                  num: "text-sky-800",
                  glow: "shadow-sky-100",
                },
              ].map(c => (
                <div key={c.label} className={`rounded-2xl border ${c.border} ${c.bg} p-4 shadow-sm ${c.glow} relative overflow-hidden`}>
                  <div className={`absolute -top-4 -right-4 w-16 h-16 rounded-full bg-gradient-to-br ${c.gradient} opacity-10`} />
                  <p className={`text-3xl font-black tabular-nums ${c.num} leading-none mb-1`}>{c.value}</p>
                  <p className={`text-xs font-semibold tracking-wide ${c.text}`}>{c.label}</p>
                </div>
              ))}
            </div>

            {/* 社員一覧 */}
            {loading ? (
              <div className="py-20 text-center">
                <div className="w-10 h-10 border-[3px] border-indigo-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">読み込み中...</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200">
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-slate-500 tracking-widest uppercase">社員</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-slate-500 tracking-widest uppercase hidden md:table-cell">部署</th>
                      <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-slate-500 tracking-widest uppercase">状況</th>
                      <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-slate-500 tracking-widest uppercase hidden sm:table-cell">出勤</th>
                      <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-slate-500 tracking-widest uppercase">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />経過</span>
                      </th>
                      <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-slate-500 tracking-widest uppercase">打刻</th>
                      <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-slate-500 tracking-widest uppercase">QR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.map(d => {
                      const ms = elapsedMs(d.clockInTime, now);
                      const isActive = d.status === "出勤中" || d.status === "休憩中";
                      const isSelected = selected?.employee.id === d.employee.id;
                      const rowBg = STATUS_STYLE[d.status].rowBg;
                      const longHour = ms >= 10 * 3600000 ? "bg-red-50/60" : ms >= 8 * 3600000 ? "bg-orange-50/60" : "";
                      const empAbsences = absences.filter(a => a.employeeId === d.employee.id);

                      return (
                        <tr
                          key={d.employee.id}
                          onClick={() => setSelected(isSelected ? null : d)}
                          className={`cursor-pointer transition-all duration-150 group
                            ${isSelected
                              ? "bg-indigo-50/80 ring-1 ring-inset ring-indigo-200"
                              : `hover:bg-slate-50/80 ${rowBg || longHour}`}`}
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <Avatar name={d.employee.name} />
                                {d.status === "出勤中" && (
                                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                                )}
                                {d.status === "休憩中" && (
                                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-white" />
                                )}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-800 leading-tight group-hover:text-indigo-700 transition-colors">{d.employee.name}</p>
                                <p className="text-[11px] text-slate-400 font-mono">{d.employee.employeeCode}</p>
                                {empAbsences.map(a => (
                                  <span key={a.id} className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border mt-0.5 mr-1 ${ABSENCE_COLORS[a.absenceType]}`}>
                                    {ABSENCE_LABELS[a.absenceType]}
                                  </span>
                                ))}
                                {(() => {
                                  const latest = [...d.records].reverse().find(r => r.note);
                                  if (latest?.note) {
                                    return <p className="text-[11px] text-indigo-600/80 mt-0.5 font-medium">📍 {latest.note}</p>;
                                  }
                                  const dep = d.draft?.departure;
                                  const arr = d.draft?.arrival;
                                  if (!dep && !arr) return null;
                                  return (
                                    <p className="text-[11px] text-indigo-500/60 mt-0.5">
                                      📍 {[dep, arr].filter(Boolean).join(" → ")}
                                    </p>
                                  );
                                })()}
                                {(() => {
                                  const startVal = d.records.find(r => r.startOdometer != null)?.startOdometer
                                    ?? d.draft?.startOdometer ?? null;
                                  if (startVal == null) return null;
                                  const endVal = [...d.records].reverse().find(r => r.endOdometer != null)?.endOdometer
                                    ?? d.draft?.endOdometer ?? null;
                                  const isDraft = d.records.find(r => r.startOdometer != null) == null;
                                  return (
                                    <p className={`text-[11px] font-medium mt-0.5 ${isDraft ? "text-sky-400" : "text-sky-600"}`}>
                                      🚛 {startVal.toLocaleString()} km{endVal != null ? ` → ${endVal.toLocaleString()} km` : ""}
                                    </p>
                                  );
                                })()}
                                {(() => {
                                  const clockInRec = d.records.find(r => r.eventType === "clock_in" && r.checklistNgItems);
                                  if (!clockInRec?.checklistNgItems) return null;
                                  let parsed: { total: number; checked: number; ng: string[] } | null = null;
                                  try { parsed = JSON.parse(clockInRec.checklistNgItems); } catch { return null; }
                                  if (!parsed) return null;
                                  return parsed.ng.length === 0 ? (
                                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border mt-0.5 bg-emerald-50 text-emerald-700 border-emerald-200">
                                      ✅ 点検OK {parsed.checked}/{parsed.total}
                                    </span>
                                  ) : (
                                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border mt-0.5 bg-red-50 text-red-700 border-red-200">
                                      ⚠️ 点検NG {parsed.ng.length}件
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-slate-500 text-xs hidden md:table-cell">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium">
                              {d.employee.department}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <StatusDot status={d.status} />
                          </td>
                          <td className="px-5 py-3.5 text-center tabular-nums text-sm font-semibold text-slate-700 hidden sm:table-cell">
                            {fmt(d.clockInTime)}
                          </td>
                          <td className={`px-5 py-3.5 text-center tabular-nums text-xs font-mono font-semibold
                            ${ms >= 10 * 3600000 ? "text-red-600" : ms >= 8 * 3600000 ? "text-orange-500" : "text-slate-400"}`}>
                            {isActive ? elapsedStr(d.clockInTime, now) : "—"}
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            {d.records.length > 0 ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold shadow-sm">
                                {d.records.length}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-sm">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setQrEmployee(d.employee)}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-all"
                              title={`${d.employee.name} のQRコード`}
                            >
                              <QrCode className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── 右サイドパネル ───────────────────────────── */}
        <div className={`fixed top-[56px] right-0 bottom-0 w-[420px] bg-white border-l border-slate-200 shadow-2xl
          flex flex-col transition-transform duration-300 ease-in-out z-30
          ${panelOpen ? "translate-x-0" : "translate-x-full"}`}>

          {selected && (
            <>
              {/* パネルヘッダー */}
              <div className="flex items-start justify-between px-5 py-5 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    <Avatar name={selected.employee.name} size="lg" />
                    {selected.status === "出勤中" && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-base leading-tight">{selected.employee.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="font-mono">{selected.employee.employeeCode}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      {selected.employee.department}
                    </p>
                    <div className="mt-2">
                      <StatusDot status={selected.status} />
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 出勤情報カード */}
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">出勤時刻</p>
                    <p className="text-lg font-black tabular-nums text-slate-800">{fmt(selected.clockInTime)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">経過時間</p>
                    <p className={`text-lg font-black tabular-nums
                      ${elapsedMs(selected.clockInTime, now) >= 10 * 3600000 ? "text-red-600" :
                        elapsedMs(selected.clockInTime, now) >= 8 * 3600000 ? "text-orange-500" : "text-slate-800"}`}>
                      {selected.status !== "未出勤" && selected.status !== "退勤済"
                        ? elapsedStr(selected.clockInTime, now) : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-3">
                    <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1">休憩合計</p>
                    <p className="text-lg font-black tabular-nums text-amber-700">
                      {(() => {
                        const ms = breakTotalMs(selected.records, now);
                        return ms > 0 ? msToStr(ms) : "—";
                      })()}
                    </p>
                  </div>
                </div>
                {(() => {
                  const latest = [...selected.records].reverse().find(r => r.note);
                  return latest?.note ? (
                    <div className="mt-3 rounded-xl bg-indigo-50/80 border border-indigo-100 px-3.5 py-3 flex items-center gap-2.5">
                      <span className="text-lg">📍</span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider leading-none mb-1">最新の発着地</p>
                        <p className="text-sm font-bold text-indigo-700 truncate">{latest.note}</p>
                      </div>
                    </div>
                  ) : null;
                })()}
                {(() => {
                  const allOdo = selected.records.filter(r => r.startOdometer != null || r.endOdometer != null);
                  if (allOdo.length === 0) return null;
                  const startVal = allOdo.find(r => r.startOdometer != null)?.startOdometer;
                  const endVal = [...allOdo].reverse().find(r => r.endOdometer != null)?.endOdometer;
                  const distance = startVal != null && endVal != null ? Math.round((endVal - startVal) * 10) / 10 : null;
                  return (
                    <div className="mt-2 rounded-xl bg-sky-50/80 border border-sky-100 px-3.5 py-3 flex items-center gap-2.5">
                      <span className="text-lg">🚛</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-sky-400 uppercase tracking-wider leading-none mb-1">走行メーター</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {startVal != null && (
                            <span className="text-sm font-bold text-sky-800">出発 {startVal.toLocaleString()} km</span>
                          )}
                          {startVal != null && endVal != null && <span className="text-sky-300 text-xs font-bold">→</span>}
                          {endVal != null && (
                            <span className="text-sm font-bold text-sky-800">帰着 {endVal.toLocaleString()} km</span>
                          )}
                          {distance != null && (
                            <span className="text-xs font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full border border-sky-200">
                              走行 {distance} km
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const clockInRec = selected.records.find(r => r.eventType === "clock_in" && r.checklistNgItems);
                  if (!clockInRec?.checklistNgItems) return null;
                  let parsed: { total: number; checked: number; ng: string[] } | null = null;
                  try { parsed = JSON.parse(clockInRec.checklistNgItems); } catch { return null; }
                  if (!parsed) return null;
                  const allOk = parsed.ng.length === 0;
                  return (
                    <div className={`mt-2 rounded-xl border px-3.5 py-3 flex items-start gap-2.5 ${allOk ? "bg-emerald-50/80 border-emerald-100" : "bg-red-50/80 border-red-200"}`}>
                      <span className="text-lg shrink-0">{allOk ? "✅" : "⚠️"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider leading-none ${allOk ? "text-emerald-600" : "text-red-600"}`}>
                            日常点検 {allOk ? "異常なし" : `異常${parsed.ng.length}件`}
                          </p>
                          <span className="text-[10px] text-slate-400">（{parsed.checked}/{parsed.total}項目）</span>
                        </div>
                        {parsed.ng.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {parsed.ng.map(item => (
                              <span key={item} className="text-xs bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full font-medium">{item}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* 打刻履歴 */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">打刻・休暇履歴</p>
                  <button
                    onClick={() => { setAddMode(true); setAddTime(nowTimeJST()); setAddEventType("clock_in"); setAddError(null); }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg"
                  >
                    <Plus className="h-3 w-3" />打刻を追加
                  </button>
                </div>

                {/* 手動追加フォーム */}
                {addMode && (
                  <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
                    <p className="text-xs font-medium text-primary">打刻を手動追加</p>
                    {addError && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{addError}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">種別</Label>
                        <Select value={addEventType} onValueChange={(v) => { setAddEventType(v as EventType); setAddError(null); }}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="clock_in">出勤</SelectItem>
                            <SelectItem value="break_start">休憩開始</SelectItem>
                            <SelectItem value="break_end">休憩終了</SelectItem>
                            <SelectItem value="clock_out">退勤</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">時刻</Label>
                        <Input
                          type="time"
                          value={addTime}
                          max={isToday ? nowTimeJST() : undefined}
                          onChange={(e) => { setAddTime(e.target.value); setAddError(null); }}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs" onClick={addRecord} disabled={saving}>
                        <Plus className="h-3 w-3 mr-1" />追加
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddMode(false)} disabled={saving}>
                        キャンセル
                      </Button>
                    </div>
                  </div>
                )}

                {(() => {
                  const empAbsences = absences.filter(a => a.employeeId === selected.employee.id);
                  const hasAny = selected.records.length > 0 || empAbsences.length > 0;
                  if (!hasAny) {
                    return (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        本日の打刻・休暇はありません
                      </div>
                    );
                  }
                  return (
                    <div className="relative">
                      {/* タイムライン縦線 */}
                      <div className="absolute left-[18px] top-2 bottom-2 w-px bg-border" />
                      <div className="flex flex-col gap-3">

                        {/* 欠勤・休暇エントリー */}
                        {empAbsences.map((a, ai) => {
                          const isDragging = absenceDragIndex === ai;
                          const isTarget = absenceDragOverIndex === ai && absenceDragIndex !== null && absenceDragIndex !== ai;
                          const isOther = absenceDragIndex !== null && absenceDragIndex !== ai;
                          return (
                            <div key={`absence-${a.id}`} className="relative">
                              {/* 挿入ライン（上） */}
                              {isTarget && absenceDragInsertBefore && (
                                <div className="absolute -top-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                  <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                                </div>
                              )}
                              <div
                                className={`flex items-start gap-3 select-none transition-all duration-150
                                  ${isDragging ? "opacity-20 scale-[0.96]" : ""}
                                  ${isOther ? "opacity-60" : ""}
                                `}
                                draggable
                                onDragStart={(e) => { setAbsenceDragIndex(ai); e.dataTransfer.effectAllowed = "move"; }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setAbsenceDragInsertBefore(e.clientY < rect.top + rect.height / 2);
                                  setAbsenceDragOverIndex(ai);
                                }}
                                onDragEnd={() => { setAbsenceDragIndex(null); setAbsenceDragOverIndex(null); }}
                                onDrop={(e) => { e.preventDefault(); if (absenceDragIndex !== null) swapAbsences(a.employeeId, absenceDragIndex, ai); }}
                              >
                                <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${ABSENCE_COLORS[a.absenceType]} border-current ${isDragging ? "shadow-lg" : ""}`}>
                                  <CalendarOff className="h-3.5 w-3.5" />
                                </div>
                                <div className={`flex-1 rounded-lg border px-3 py-2 ${ABSENCE_COLORS[a.absenceType]} ${isDragging ? "shadow-xl" : ""}`}>
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-xs font-semibold">{ABSENCE_LABELS[a.absenceType]}</p>
                                      <p className="text-sm font-medium opacity-70">終日</p>
                                      {a.note && <p className="text-xs opacity-60 mt-0.5">{a.note}</p>}
                                    </div>
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        onClick={() => deleteAbsence(a.id)}
                                        disabled={saving}
                                        className="p-1.5 rounded hover:bg-black/10 transition-colors opacity-50 hover:opacity-100"
                                        title="削除"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                      <div className="p-1.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-70" title="ドラッグで並び替え">
                                        <GripVertical className="h-3.5 w-3.5" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {/* 挿入ライン（下） */}
                              {isTarget && !absenceDragInsertBefore && (
                                <div className="absolute -bottom-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                  <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* 打刻履歴エントリー */}
                        {selected.records.map((r, i) => {
                          const isDragging = dragIndex === i;
                          const isTarget = dragOverIndex === i && dragIndex !== null && dragIndex !== i;
                          const isOther = dragIndex !== null && dragIndex !== i;
                          return (
                            <div key={r.id} className="relative">
                              {/* 挿入ライン（上） */}
                              {isTarget && dragInsertBefore && (
                                <div className="absolute -top-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                  <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                                </div>
                              )}
                              <div
                                className={`flex items-start gap-3 select-none transition-all duration-150
                                  ${isDragging ? "opacity-20 scale-[0.96]" : ""}
                                  ${isOther ? "opacity-60" : ""}
                                `}
                                draggable
                                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setDragInsertBefore(e.clientY < rect.top + rect.height / 2);
                                  setDragOverIndex(i);
                                }}
                                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                                onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) swapRecordTimes(dragIndex, i); }}
                              >
                                {/* ドット */}
                                <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${EVENT_COLORS[r.eventType as EventType]} border-current ${isDragging ? "shadow-lg" : ""}`}>
                                  {EVENT_ICONS[r.eventType as EventType]}
                                </div>
                                {/* カード */}
                                <div className={`flex-1 rounded-lg border px-3 py-2 ${EVENT_COLORS[r.eventType as EventType]} ${isDragging ? "shadow-xl" : ""}`}>
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-xs font-semibold">{EVENT_LABELS[r.eventType as EventType]}</p>
                                      <p className="text-base font-bold tabular-nums">{fmt(r.recordedAt)}</p>
                                      {r.note && (
                                        <p className="text-xs text-muted-foreground mt-0.5">📍 {r.note}</p>
                                      )}
                                      {r.latitude != null && r.longitude != null && (
                                        <GpsAddressLink lat={r.latitude} lng={r.longitude} />
                                      )}
                                    </div>
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        onClick={() => openEdit(r)}
                                        className="p-1.5 rounded hover:bg-black/5 transition-colors opacity-60 hover:opacity-100"
                                        title="修正"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <div className="p-1.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-70" title="ドラッグで並び替え">
                                        <GripVertical className="h-3.5 w-3.5" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {/* 挿入ライン（下） */}
                              {isTarget && !dragInsertBefore && (
                                <div className="absolute -bottom-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                  <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* 欠勤・休暇登録フォーム */}
              {absenceMode && (
                <div className="px-5 py-4 border-t">
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-3">
                    <p className="text-xs font-medium text-orange-800 flex items-center gap-1.5">
                      <CalendarOff className="h-3.5 w-3.5" />欠勤・休暇を登録
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">種別</Label>
                      <Select value={absenceType} onValueChange={v => setAbsenceType(v as AbsenceType)}>
                        <SelectTrigger className="h-8 text-xs bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sick">病欠</SelectItem>
                          <SelectItem value="paid_leave">有給休暇</SelectItem>
                          <SelectItem value="bereavement">忌引き</SelectItem>
                          <SelectItem value="morning_half">午前休み（0.5日）</SelectItem>
                          <SelectItem value="afternoon_half">午後休み（0.5日）</SelectItem>
                          <SelectItem value="other">その他</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">備考（任意）</Label>
                      <Textarea
                        value={absenceNote}
                        onChange={e => setAbsenceNote(e.target.value)}
                        className="h-16 text-xs resize-none bg-white"
                        placeholder="理由・コメント..."
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs" onClick={saveAbsence} disabled={saving}>
                        <Plus className="h-3 w-3 mr-1" />登録
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAbsenceMode(false)} disabled={saving}>
                        キャンセル
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* パネルフッター */}
              <div className="px-5 py-3.5 border-t border-slate-100 flex items-center gap-2 bg-gradient-to-r from-slate-50 to-white">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs rounded-lg border-slate-200 text-slate-600 hover:text-indigo-700 hover:border-indigo-200 hover:bg-indigo-50 transition-all"
                  onClick={() => setQrEmployee(selected.employee)}
                >
                  <QrCode className="h-3.5 w-3.5" />QRコード
                </Button>
                {!absenceMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs rounded-lg border-slate-200 text-slate-600 hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50 transition-all"
                    onClick={() => { setAbsenceMode(true); setAbsenceType("sick"); setAbsenceNote(""); }}
                  >
                    <CalendarOff className="h-3.5 w-3.5" />欠勤・休暇登録
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 打刻修正ダイアログ ─────────────────────── */}
      <Dialog open={!!editRecord} onOpenChange={(open) => { if (!open) { setEditRecord(null); setDeleteConfirm(false); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-4 w-4" />打刻修正
            </DialogTitle>
          </DialogHeader>
          {editRecord && (
            <div className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs">打刻種別</Label>
                <Select value={editEventType} onValueChange={(v) => setEditEventType(v as EventType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clock_in">出勤</SelectItem>
                    <SelectItem value="break_start">休憩開始</SelectItem>
                    <SelectItem value="break_end">休憩終了</SelectItem>
                    <SelectItem value="clock_out">退勤</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">日付（勤務日）</Label>
                <Input
                  type="date"
                  value={editDate}
                  max={todayJST()}
                  onChange={(e) => { setEditDate(e.target.value); setEditError(null); }}
                />
                {editDate !== editRecord.workDate && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    ⚠️ 日付を変更します（元: {editRecord.workDate}）
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">打刻時刻</Label>
                <Input
                  type="time"
                  value={editTime}
                  max={editDate === todayJST() ? nowTimeJST() : undefined}
                  onChange={(e) => { setEditTime(e.target.value); setEditError(null); }}
                />
              </div>

              {editError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{editError}</p>
              )}

              {deleteConfirm && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-sm text-red-700 font-medium">このレコードを削除しますか？</p>
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" className="flex-1" onClick={deleteRec} disabled={saving}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />削除
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(false)} disabled={saving}>
                      戻る
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50 mr-auto"
                  onClick={() => setDeleteConfirm(true)} disabled={saving || deleteConfirm}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />削除
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditRecord(null)} disabled={saving}>
                  キャンセル
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  <Save className="h-3.5 w-3.5 mr-1" />保存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── QRダイアログ ───────────────────────────── */}
      <Dialog open={!!qrEmployee} onOpenChange={(open) => !open && setQrEmployee(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{qrEmployee?.name} さんのQRコード</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrEmployee && (
              <>
                <div className="p-4 bg-white border rounded-xl shadow-inner">
                  <QRCode value={qrUrl} size={200} />
                </div>
                <p className="text-xs text-muted-foreground text-center break-all">{qrUrl}</p>
                <p className="text-sm text-center text-muted-foreground">
                  スマホで読み取ると打刻ページが開きます
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
