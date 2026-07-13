import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "wouter";
import { playFeedbackSound, unlockAudio } from "@/lib/notification-sound";

type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";
type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";

interface AttendanceRecord {
  id: number;
  employeeId: number;
  eventType: EventType;
  workDate: string;
  recordedAt: string;
  note: string | null;
}

interface Employee {
  id: number;
  employeeCode: string;
  name: string;
  department: string;
  scheduledWorkStart: string | null;
  scheduledWorkEnd: string | null;
}

const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

const EVENT_COLORS: Record<EventType, string> = {
  clock_in: "bg-emerald-100 text-emerald-800 border-emerald-200",
  clock_out: "bg-gray-100 text-gray-700 border-gray-200",
  break_start: "bg-amber-100 text-amber-800 border-amber-200",
  break_end: "bg-sky-100 text-sky-800 border-sky-200",
};

const STATUS_CONFIG: Record<Status, { color: string; bg: string; icon: string }> = {
  未出勤: { color: "text-gray-500", bg: "bg-gray-50 border-gray-200", icon: "⏰" },
  出勤中: { color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: "💼" },
  休憩中: { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: "☕" },
  退勤済: { color: "text-slate-600", bg: "bg-slate-50 border-slate-200", icon: "🏠" },
};

function getStatus(records: AttendanceRecord[]): Status {
  if (records.length === 0) return "未出勤";
  const last = records[records.length - 1];
  if (last.eventType === "clock_in") return "出勤中";
  if (last.eventType === "break_start") return "休憩中";
  if (last.eventType === "break_end") return "出勤中";
  return "退勤済";
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function calcRawWorkMinutes(records: AttendanceRecord[]): number {
  let totalMs = 0;
  let clockInTime: Date | null = null;
  let breakStartTime: Date | null = null;
  for (const r of records) {
    const t = new Date(r.recordedAt);
    if (r.eventType === "clock_in") { clockInTime = t; breakStartTime = null; }
    else if (r.eventType === "break_start" && clockInTime) { totalMs += t.getTime() - clockInTime.getTime(); clockInTime = null; breakStartTime = t; }
    else if (r.eventType === "break_end" && breakStartTime) { clockInTime = t; breakStartTime = null; }
    else if (r.eventType === "clock_out" && clockInTime) { totalMs += t.getTime() - clockInTime.getTime(); clockInTime = null; }
  }
  if (clockInTime) { totalMs += Date.now() - clockInTime.getTime(); }
  return Math.floor(totalMs / 60000);
}

// 30分単位で切り上げ（事務員時給計算用）
function roundUpTo30Min(minutes: number): number {
  if (minutes === 0) return 0;
  return Math.ceil(minutes / 30) * 30;
}

function calcWorkMinutes(records: AttendanceRecord[]): number {
  return roundUpTo30Min(calcRawWorkMinutes(records));
}

function calcBreakMinutes(records: AttendanceRecord[]): number {
  let totalMs = 0;
  let breakStart: Date | null = null;
  for (const r of records) {
    const t = new Date(r.recordedAt);
    if (r.eventType === "break_start") { breakStart = t; }
    else if (r.eventType === "break_end" && breakStart) { totalMs += t.getTime() - breakStart.getTime(); breakStart = null; }
  }
  if (breakStart) { totalMs += Date.now() - breakStart.getTime(); }
  return Math.floor(totalMs / 60000);
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}時間${String(m).padStart(2, "0")}分`;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

export default function OfficePage() {
  const params = useParams<{ id: string }>();
  const employeeId = Number(params.id);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // PIN
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [hasPinSet, setHasPinSet] = useState<boolean | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioUnlockedRef = useRef(false);

  // 現在時刻 tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const todayStr = now.toLocaleDateString("sv-SE");

  async function fetchData() {
    try {
      const [emp, att] = await Promise.all([
        apiFetch(`/employees/${employeeId}`),
        apiFetch(`/attendance/employee/${employeeId}/today`),
      ]);
      setEmployee(emp);
      setRecords(att ?? []);
    } catch {
      setError("データの読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function checkPin() {
    try {
      const data = await apiFetch(`/employees/${employeeId}/pin/status`);
      setHasPinSet(data?.hasPinSet ?? false);
    } catch { setHasPinSet(false); }
  }

  useEffect(() => {
    fetchData();
    checkPin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  // SSE / polling（PIN認証後）
  useEffect(() => {
    if (!pinVerified) return;

    function startSSE() {
      const es = new EventSource(`${BASE}/api/attendance/stream`);
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "snapshot") fetchData();
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); sseRef.current = null; };
      sseRef.current = es;
    }
    startSSE();
    pollingRef.current = setInterval(fetchData, 30000);

    return () => {
      sseRef.current?.close();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinVerified]);

  async function handlePinSubmit() {
    if (pinInput.length < 4) { setPinError("PINは4桁以上で入力してください"); return; }
    setPinLoading(true);
    setPinError(null);
    try {
      await apiFetch(`/employees/${employeeId}/pin/verify`, {
        method: "POST",
        body: JSON.stringify({ pin: pinInput }),
      });
      setPinVerified(true);
    } catch {
      setPinError("PINが正しくありません");
    } finally {
      setPinLoading(false);
    }
  }

  async function handleRecord(eventType: EventType) {
    if (!audioUnlockedRef.current) { unlockAudio(); audioUnlockedRef.current = true; }
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch("/attendance/record", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          eventType,
          note: null,
          startOdometer: null,
          endOdometer: null,
          latitude: null,
          longitude: null,
          checklistNgItems: null,
        }),
      });
      playFeedbackSound();
      setSuccessMsg(`${EVENT_LABELS[eventType]}を記録しました`);
      setTimeout(() => setSuccessMsg(null), 4000);
      await fetchData();
    } catch (e: unknown) {
      await fetchData();
      let msg = "記録に失敗しました";
      if (e instanceof Error) {
        try {
          const body = JSON.parse(e.message);
          if (body?.error) msg = body.error;
        } catch { msg = e.message; }
      }
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Loading ────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
          <p className="text-sm font-medium">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-lg max-w-sm">
          <p className="text-4xl mb-3">⚠️</p>
          <p className="text-slate-700 font-semibold">従業員が見つかりません</p>
          <p className="text-slate-400 text-sm mt-1">ID: {employeeId}</p>
        </div>
      </div>
    );
  }

  const status = getStatus(records);
  const statusConf = STATUS_CONFIG[status];
  const rawWorkMin = calcRawWorkMinutes(records);
  const workMin = roundUpTo30Min(rawWorkMin);
  const breakMin = calcBreakMinutes(records);
  const clockInRecord = records.find(r => r.eventType === "clock_in");
  const clockOutRecord = [...records].reverse().find(r => r.eventType === "clock_out");

  // ─── PIN画面 ─────────────────────────────────────
  if (!pinVerified && hasPinSet) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-blue-100 p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8 text-white text-center">
            <p className="text-4xl mb-2">🏢</p>
            <h1 className="text-2xl font-bold">{employee.name}</h1>
            <p className="text-blue-200 text-sm mt-1">{employee.department}　事務</p>
          </div>
          <div className="p-6">
            <p className="text-center text-slate-600 font-medium mb-4">PINを入力してください</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value); setPinError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handlePinSubmit(); }}
              placeholder="••••"
              className="w-full text-center text-2xl tracking-widest border-2 border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 mb-3"
              autoFocus
            />
            {pinError && <p className="text-red-500 text-sm text-center mb-3">{pinError}</p>}
            <button
              onClick={handlePinSubmit}
              disabled={pinLoading || pinInput.length < 4}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-base disabled:opacity-40 active:scale-95 transition-all"
            >
              {pinLoading ? "確認中..." : "確認"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── ボタン表示ロジック ───────────────────────────
  const canClockIn = status === "未出勤";
  const canBreakStart = status === "出勤中";
  const canBreakEnd = status === "休憩中";
  const canClockOut = status === "出勤中" || status === "休憩中";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* ヘッダー */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white px-4 pt-safe-top">
        <div className="max-w-md mx-auto py-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl flex-shrink-0">
              🏢
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold leading-tight truncate">{employee.name}</h1>
              <p className="text-blue-200 text-sm">{employee.department}</p>
            </div>
          </div>
          {/* 現在時刻 */}
          <div className="mt-4 text-center">
            <p className="text-blue-200 text-xs">{formatDate(now)}</p>
            <p className="text-5xl font-bold tracking-tight tabular-nums mt-1">
              {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 space-y-4">

        {/* メッセージ */}
        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-2">
            <span className="text-emerald-600 text-lg">✅</span>
            <p className="text-emerald-800 text-sm font-medium">{successMsg}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-2">
            <span className="text-red-500 text-lg">⚠️</span>
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* ステータスカード */}
        <div className={`rounded-2xl border-2 px-5 py-4 ${statusConf.bg}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium mb-0.5">現在のステータス</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{statusConf.icon}</span>
                <span className={`text-2xl font-bold ${statusConf.color}`}>{status}</span>
              </div>
            </div>
            {status !== "未出勤" && (
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-0.5">計算時間 <span className="text-[10px] text-indigo-400">30分単位</span></p>
                <p className="text-lg font-bold text-indigo-700 tabular-nums">{fmtDuration(workMin)}</p>
                <p className="text-xs text-slate-400">実績 {fmtDuration(rawWorkMin)}</p>
                {breakMin > 0 && (
                  <p className="text-xs text-slate-400">休憩 {fmtDuration(breakMin)}</p>
                )}
              </div>
            )}
          </div>

          {/* 出退勤時刻 */}
          {(clockInRecord || clockOutRecord) && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex gap-4 text-sm">
              {clockInRecord && (
                <div>
                  <span className="text-slate-400 text-xs">出勤</span>
                  <p className="font-semibold text-slate-700">{formatTime(clockInRecord.recordedAt)}</p>
                </div>
              )}
              {clockOutRecord && (
                <div>
                  <span className="text-slate-400 text-xs">退勤</span>
                  <p className="font-semibold text-slate-700">{formatTime(clockOutRecord.recordedAt)}</p>
                </div>
              )}
              {employee.scheduledWorkStart && employee.scheduledWorkEnd && (
                <div className="ml-auto text-right">
                  <span className="text-slate-400 text-xs">所定</span>
                  <p className="font-medium text-slate-500 text-xs">
                    {employee.scheduledWorkStart} 〜 {employee.scheduledWorkEnd}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 打刻ボタン */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">打刻</p>
          <div className="grid grid-cols-2 gap-3">
            {/* 出勤 */}
            <button
              onClick={() => handleRecord("clock_in")}
              disabled={!canClockIn || submitting}
              className={`
                flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl font-bold text-sm
                transition-all active:scale-95
                ${canClockIn
                  ? "bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-200"
                  : "bg-slate-100 text-slate-300 cursor-not-allowed"}
              `}
            >
              <span className="text-3xl">🟢</span>
              <span>出勤</span>
            </button>

            {/* 退勤 */}
            <button
              onClick={() => handleRecord("clock_out")}
              disabled={!canClockOut || submitting}
              className={`
                flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl font-bold text-sm
                transition-all active:scale-95
                ${canClockOut
                  ? "bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-lg shadow-slate-200"
                  : "bg-slate-100 text-slate-300 cursor-not-allowed"}
              `}
            >
              <span className="text-3xl">🔵</span>
              <span>退勤</span>
            </button>

            {/* 休憩開始 */}
            <button
              onClick={() => handleRecord("break_start")}
              disabled={!canBreakStart || submitting}
              className={`
                flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl font-bold text-sm
                transition-all active:scale-95
                ${canBreakStart
                  ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-200"
                  : "bg-slate-100 text-slate-300 cursor-not-allowed"}
              `}
            >
              <span className="text-2xl">☕</span>
              <span>休憩開始</span>
            </button>

            {/* 休憩終了 */}
            <button
              onClick={() => handleRecord("break_end")}
              disabled={!canBreakEnd || submitting}
              className={`
                flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl font-bold text-sm
                transition-all active:scale-95
                ${canBreakEnd
                  ? "bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-lg shadow-sky-200"
                  : "bg-slate-100 text-slate-300 cursor-not-allowed"}
              `}
            >
              <span className="text-2xl">▶️</span>
              <span>休憩終了</span>
            </button>
          </div>

          {submitting && (
            <div className="mt-3 flex items-center justify-center gap-2 text-slate-400 text-sm">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
              <span>処理中...</span>
            </div>
          )}
        </div>

        {/* 本日の打刻履歴 */}
        {records.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">本日の打刻履歴</p>
            <div className="space-y-2">
              {[...records].reverse().map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${EVENT_COLORS[r.eventType]}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{EVENT_LABELS[r.eventType]}</span>
                    {r.note && (
                      <span className="text-xs opacity-70 truncate max-w-[120px]">{r.note}</span>
                    )}
                  </div>
                  <span className="text-sm font-mono font-semibold tabular-nums">
                    {formatTime(r.recordedAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {records.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <p className="text-4xl mb-2">📋</p>
            <p className="text-sm">本日の打刻はまだありません</p>
          </div>
        )}

        <p className="text-center text-slate-300 text-xs pb-6">
          三川運送 給与管理システム — 事務用打刻
        </p>
      </div>
    </div>
  );
}
