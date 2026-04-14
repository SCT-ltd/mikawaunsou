import { useState, useEffect, useCallback } from "react";
import { useParams } from "wouter";

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
}

const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

const EVENT_COLORS: Record<EventType, string> = {
  clock_in: "bg-green-100 text-green-800 border-green-200",
  clock_out: "bg-gray-100 text-gray-700 border-gray-200",
  break_start: "bg-yellow-100 text-yellow-800 border-yellow-200",
  break_end: "bg-blue-100 text-blue-800 border-blue-200",
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

export default function DriverPage() {
  const params = useParams<{ id: string }>();
  const employeeId = parseInt(params.id ?? "0", 10);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [locationNote, setLocationNote] = useState("");

  // 現在時刻を毎秒更新
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [emp, recs] = await Promise.all([
        apiFetch(`/employees/${employeeId}`),
        apiFetch(`/attendance/employee/${employeeId}/today`),
      ]);
      setEmployee(emp);
      setRecords(recs ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  // 初回取得
  useEffect(() => { fetchData(); }, [fetchData]);

  // SSEで管理者操作（打刻追加・修正・削除）をリアルタイム受信
  useEffect(() => {
    const es = new EventSource(`${BASE}/api/attendance/stream`);
    es.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as Array<{
          employee: { id: number };
          records: AttendanceRecord[];
        }>;
        const mine = snapshot.find(s => s.employee.id === employeeId);
        if (mine) {
          setRecords(mine.records);
          setLoading(false);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [employeeId]);

  const status = getStatus(records);

  const handleRecord = async (eventType: EventType) => {
    setRecording(true);
    setError(null);
    try {
      await apiFetch("/attendance/record", {
        method: "POST",
        body: JSON.stringify({ employeeId, eventType, note: locationNote.trim() || null }),
      });
      setSuccessMsg(`${EVENT_LABELS[eventType]}を記録しました${locationNote.trim() ? `（${locationNote.trim()}）` : ""}`);
      setLocationNote("");
      setTimeout(() => setSuccessMsg(null), 4000);
      await fetchData();
    } catch {
      setError("記録に失敗しました。もう一度お試しください。");
    } finally {
      setRecording(false);
    }
  };

  // ボタン有効判定
  const canClockIn = status === "未出勤";
  const canBreakStart = status === "出勤中";
  const canBreakEnd = status === "休憩中";
  const canClockOut = status === "出勤中";

  // 経過時間の計算
  const clockInRecord = records.find(r => r.eventType === "clock_in");
  const elapsedMs = clockInRecord && status !== "未出勤" && status !== "退勤済"
    ? now.getTime() - new Date(clockInRecord.recordedAt).getTime()
    : null;
  const elapsedH = elapsedMs !== null ? Math.floor(elapsedMs / 3600000) : 0;
  const elapsedM = elapsedMs !== null ? Math.floor((elapsedMs % 3600000) / 60000) : 0;

  const statusColor: Record<Status, string> = {
    "未出勤": "bg-gray-100 text-gray-600",
    "出勤中": "bg-green-100 text-green-700",
    "休憩中": "bg-yellow-100 text-yellow-700",
    "退勤済": "bg-blue-100 text-blue-700",
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <p className="text-xl font-bold text-red-600 mb-2">社員が見つかりません</p>
          <p className="text-muted-foreground">QRコードを確認してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
          {employee.name[0]}
        </div>
        <div className="flex-1">
          <p className="font-bold text-lg leading-tight">{employee.name}</p>
          <p className="text-sm text-muted-foreground">{employee.department} · {employee.employeeCode}</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${statusColor[status]}`}>
          {status}
        </div>
      </div>

      {/* 時刻表示 */}
      <div className="bg-white border-b px-4 py-4 text-center">
        <p className="text-4xl font-mono font-bold tabular-nums tracking-widest">
          {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
        </p>
        {elapsedMs !== null && (
          <p className="text-sm font-medium text-primary mt-1">
            出勤から {elapsedH}時間{elapsedM}分経過
          </p>
        )}
      </div>

      {/* メッセージ */}
      {successMsg && (
        <div className="mx-4 mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-center font-medium">
          ✓ {successMsg}
        </div>
      )}
      {error && (
        <div className="mx-4 mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-center">
          {error}
        </div>
      )}

      {/* 発着地入力 */}
      <div className="mx-4 mt-3 mb-1">
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          📍 発着地（任意）
        </label>
        <input
          type="text"
          value={locationNote}
          onChange={(e) => setLocationNote(e.target.value)}
          placeholder="例：本社 → 大阪営業所"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
        />
      </div>

      {/* 4大ボタン */}
      <div className="flex-1 p-4 grid grid-cols-2 gap-4 content-start mt-2">
        {/* 出勤 */}
        <button
          onClick={() => handleRecord("clock_in")}
          disabled={!canClockIn || recording}
          className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
            ${canClockIn && !recording
              ? "bg-green-500 hover:bg-green-600"
              : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
        >
          <span className="text-4xl">🟢</span>
          <span>出勤</span>
        </button>

        {/* 退勤 */}
        <button
          onClick={() => handleRecord("clock_out")}
          disabled={!canClockOut || recording}
          className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
            ${canClockOut && !recording
              ? "bg-red-500 hover:bg-red-600"
              : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
        >
          <span className="text-4xl">🔴</span>
          <span>退勤</span>
        </button>

        {/* 休憩開始 */}
        <button
          onClick={() => handleRecord("break_start")}
          disabled={!canBreakStart || recording}
          className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
            ${canBreakStart && !recording
              ? "bg-yellow-500 hover:bg-yellow-600"
              : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
        >
          <span className="text-4xl">🟡</span>
          <span>休憩開始</span>
        </button>

        {/* 休憩終了 */}
        <button
          onClick={() => handleRecord("break_end")}
          disabled={!canBreakEnd || recording}
          className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
            ${canBreakEnd && !recording
              ? "bg-blue-500 hover:bg-blue-600"
              : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
        >
          <span className="text-4xl">🔵</span>
          <span>休憩終了</span>
        </button>
      </div>

      {/* 打刻履歴 */}
      {records.length > 0 && (
        <div className="mx-4 mb-4 bg-white rounded-xl border shadow-sm">
          <div className="px-4 py-3 border-b">
            <p className="font-semibold text-sm text-muted-foreground">本日の打刻履歴</p>
          </div>
          <div className="divide-y">
            {records.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`shrink-0 text-xs px-2 py-1 rounded-full border font-medium ${EVENT_COLORS[r.eventType as EventType]}`}>
                    {EVENT_LABELS[r.eventType as EventType]}
                  </span>
                  {r.note && (
                    <span className="text-xs text-muted-foreground truncate">
                      📍 {r.note}
                    </span>
                  )}
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                  {formatTime(r.recordedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pb-8 text-center">
        <p className="text-xs text-muted-foreground">三川運送 勤怠管理システム</p>
      </div>
    </div>
  );
}
