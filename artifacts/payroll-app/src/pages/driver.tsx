import { useState, useEffect, useCallback, useRef } from "react";
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
  startOdometer: number | null;
  endOdometer: number | null;
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

// ── 日常点検チェックリスト定義 ──────────────────────────────
interface InspectionItem { id: string; area: string; content: string; }

const INSPECTION_SECTIONS: { label: string; items: InspectionItem[] }[] = [
  {
    label: "🚗 運転者席",
    items: [
      { id: "eng",   area: "エンジン",                       content: "かかり具合・異音など" },
      { id: "brk",   area: "ブレーキ・ペダル",               content: "踏みしろ・きき具合" },
      { id: "pbrk",  area: "駐車ブレーキ・レバー",           content: "引きしろ" },
      { id: "wiper", area: "ウィンドウォッシャー・ワイパー", content: "液量・噴射状態" },
      { id: "boil",  area: "ブレーキオイル",                 content: "液量" },
      { id: "lamp",  area: "前照灯・方向指示器・非常点滅灯", content: "点灯・点滅具合" },
    ],
  },
  {
    label: "🔧 前部（車両の周り）",
    items: [
      { id: "rad",   area: "ラジエーター",       content: "冷却水の量" },
      { id: "belt",  area: "ファンベルト",        content: "張り具合・損傷" },
      { id: "oil",   area: "エンジン・オイル",   content: "量・汚れ" },
      { id: "bat",   area: "バッテリー",          content: "液量" },
      { id: "tyre_f",area: "タイヤ（前）",        content: "空気圧・損傷・溝の深さ・磨耗" },
      { id: "wheel", area: "ディスクホイール",    content: "取付状態" },
    ],
  },
  {
    label: "🔩 後部（車両の周り）・その他",
    items: [
      { id: "tail",  area: "制動灯・尾灯",           content: "損傷" },
      { id: "turn",  area: "方向指示器（後）",        content: "点灯・汚れ" },
      { id: "hazard",area: "非常点滅灯（後）",        content: "点滅具合" },
      { id: "refl",  area: "反射器",                  content: "変色" },
      { id: "tyre_r",area: "タイヤ（後）",             content: "空気圧・損傷・溝の深さ" },
      { id: "sig",   area: "非常信号用具",             content: "有・無" },
      { id: "sign",  area: "停止表示板",               content: "有・無" },
      { id: "cert",  area: "自動車検査証・保険証",     content: "有・無" },
      { id: "prev",  area: "前日異常箇所の処置確認",  content: "処置確認" },
    ],
  },
];

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
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [startOdometer, setStartOdometer] = useState("");
  const [endOdometer, setEndOdometer] = useState("");
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [checkShowAll, setCheckShowAll] = useState(false);

  const toggleCheck = (id: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalItems = INSPECTION_SECTIONS.reduce((s, sec) => s + sec.items.length, 0);
  const checkedCount = checkedItems.size;

  // PIN認証
  const [pinRequired, setPinRequired] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinVerifying, setPinVerifying] = useState(false);
  const shakeRef = useRef<HTMLDivElement>(null);

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

  // 初回取得 + PIN設定有無の確認
  useEffect(() => {
    fetchData();
    apiFetch(`/employees/${employeeId}/pin/status`)
      .then((res: { pinSet: boolean }) => {
        if (res.pinSet) setPinRequired(true);
        else setPinVerified(true);
      })
      .catch(() => setPinVerified(true));
  }, [fetchData, employeeId]);

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

  // PINキー入力処理
  const handlePinKey = useCallback(async (key: string) => {
    if (pinVerifying) return;
    if (key === "del") {
      setPinInput(p => p.slice(0, -1));
      setPinError(false);
      return;
    }
    const next = pinInput + key;
    setPinInput(next);
    setPinError(false);
    if (next.length < 4) return;

    // 4桁揃ったら自動検証
    setPinVerifying(true);
    try {
      const res: { ok: boolean; pinRequired: boolean } = await apiFetch(
        `/employees/${employeeId}/pin/verify`,
        { method: "POST", body: JSON.stringify({ pin: next }) }
      );
      if (res.ok) {
        setPinVerified(true);
      } else {
        setPinError(true);
        setPinInput("");
        shakeRef.current?.animate(
          [{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" },
           { transform: "translateX(-6px)" }, { transform: "translateX(6px)" },
           { transform: "translateX(0)" }],
          { duration: 400, easing: "ease-in-out" }
        );
      }
    } catch {
      setPinError(true);
      setPinInput("");
    } finally {
      setPinVerifying(false);
    }
  }, [pinInput, pinVerifying, employeeId]);

  const handleRecord = async (eventType: EventType) => {
    setRecording(true);
    setError(null);
    try {
      const startKm = startOdometer.trim() !== "" ? parseFloat(startOdometer) : null;
      const endKm = endOdometer.trim() !== "" ? parseFloat(endOdometer) : null;
      await apiFetch("/attendance/record", {
        method: "POST",
        body: JSON.stringify({
          employeeId, eventType,
          note: [departure.trim(), arrival.trim()].filter(Boolean).join(" → ") || null,
          startOdometer: startKm,
          endOdometer: endKm,
        }),
      });
      const loc = [departure.trim(), arrival.trim()].filter(Boolean).join(" → ");
      const odometerInfo = startKm !== null || endKm !== null
        ? `　走行距離：${startKm ?? "—"} → ${endKm ?? "—"} km`
        : "";
      setSuccessMsg(`${EVENT_LABELS[eventType]}を記録しました${loc ? `（${loc}）` : ""}${odometerInfo}`);
      setDeparture("");
      setArrival("");
      setStartOdometer("");
      setEndOdometer("");
      setTimeout(() => setSuccessMsg(null), 5000);
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

  // ── PIN入力画面 ───────────────────────────────────────────────
  if (pinRequired && !pinVerified) {
    const keys = ["1","2","3","4","5","6","7","8","9","","0","del"];
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        {/* 社員ヘッダー */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl mb-3">
            {employee.name[0]}
          </div>
          <p className="text-xl font-bold">{employee.name}</p>
          <p className="text-sm text-muted-foreground">{employee.department}</p>
        </div>

        {/* PINドット表示 */}
        <div ref={shakeRef} className="mb-6 text-center">
          <p className="text-sm text-muted-foreground mb-4 font-medium">PINコードを入力してください</p>
          <div className="flex gap-4 justify-center mb-2">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all
                ${i < pinInput.length
                  ? (pinError ? "bg-red-500 border-red-500" : "bg-primary border-primary")
                  : "border-gray-300 bg-transparent"}`} />
            ))}
          </div>
          {pinError && (
            <p className="text-sm text-red-600 font-medium mt-2">PINコードが違います</p>
          )}
          {pinVerifying && (
            <p className="text-sm text-muted-foreground mt-2">確認中...</p>
          )}
        </div>

        {/* テンキー */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
          {keys.map((key, idx) => {
            if (key === "") return <div key={idx} />;
            const isDel = key === "del";
            return (
              <button
                key={idx}
                onClick={() => handlePinKey(key)}
                disabled={pinVerifying || (!isDel && pinInput.length >= 4)}
                className={`h-16 rounded-2xl text-xl font-bold transition-all active:scale-95 shadow-sm
                  ${isDel
                    ? "bg-gray-200 text-gray-600 hover:bg-gray-300 text-base"
                    : "bg-white border border-gray-200 hover:bg-gray-50 text-gray-800"}
                  disabled:opacity-40`}
              >
                {isDel ? "⌫" : key}
              </button>
            );
          })}
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
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">📍 発着地（任意）</p>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1">発地</label>
            <input
              type="text"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              placeholder="例：本社"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
            />
          </div>
          <span className="text-gray-400 text-lg mt-4">→</span>
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1">着地</label>
            <input
              type="text"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
              placeholder="例：大阪営業所"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* 走行距離入力 */}
      <div className="mx-4 mt-2 mb-1">
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">🚛 走行距離（任意）</p>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1">出発時（km）</label>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={startOdometer}
                onChange={(e) => setStartOdometer(e.target.value)}
                placeholder="例：12345"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 pr-10 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">km</span>
            </div>
          </div>
          <span className="text-gray-400 text-lg mt-4">→</span>
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1">帰着時（km）</label>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={endOdometer}
                onChange={(e) => setEndOdometer(e.target.value)}
                placeholder="例：12567"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 pr-10 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">km</span>
            </div>
          </div>
        </div>
        {startOdometer && endOdometer && parseFloat(endOdometer) >= parseFloat(startOdometer) && (
          <div className="mt-1.5 text-center text-sm font-semibold text-primary">
            走行距離：{(parseFloat(endOdometer) - parseFloat(startOdometer)).toFixed(1)} km
          </div>
        )}
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

      {/* 日常点検チェックリスト */}
      <div className="mx-4 mb-4 bg-white rounded-xl border shadow-sm overflow-hidden">
        {/* ヘッダー */}
        <button
          className="w-full px-4 py-3 border-b flex items-center justify-between"
          onClick={() => setCheckShowAll(p => !p)}
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">日常点検チェックリスト</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold
              ${checkedCount === totalItems ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
              {checkedCount} / {totalItems}
            </span>
          </div>
          <span className="text-gray-400 text-sm">{checkShowAll ? "▲" : "▼"}</span>
        </button>

        {/* プログレスバー */}
        <div className="h-1.5 bg-gray-100">
          <div
            className="h-full bg-green-500 transition-all duration-300 rounded-r-full"
            style={{ width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%` }}
          />
        </div>

        {checkShowAll && (
          <div className="divide-y divide-gray-100">
            {INSPECTION_SECTIONS.map((sec) => (
              <div key={sec.label}>
                {/* セクションヘッダー */}
                <div className="px-4 py-2 bg-gray-50">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{sec.label}</p>
                </div>
                {/* 項目 */}
                {sec.items.map((item) => {
                  const checked = checkedItems.has(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggleCheck(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-gray-50
                        ${checked ? "bg-green-50" : "bg-white"}`}
                    >
                      {/* チェックボックス */}
                      <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all
                        ${checked
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 bg-white"}`}>
                        {checked && <span className="text-base font-bold leading-none">✓</span>}
                      </div>
                      {/* テキスト */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-tight ${checked ? "text-green-800" : "text-gray-800"}`}>
                          {item.area}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.content}</p>
                      </div>
                      {/* 良・否バッジ */}
                      {checked && (
                        <span className="shrink-0 text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">良</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* 全チェック完了メッセージ */}
            {checkedCount === totalItems && (
              <div className="px-4 py-4 text-center bg-green-50 border-t border-green-100">
                <p className="text-green-700 font-bold text-sm">✅ 日常点検完了！　今日も１日安全運転で！！</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 打刻履歴 */}
      {records.length > 0 && (
        <div className="mx-4 mb-4 bg-white rounded-xl border shadow-sm">
          <div className="px-4 py-3 border-b">
            <p className="font-semibold text-sm text-muted-foreground">本日の打刻履歴</p>
          </div>
          <div className="divide-y">
            {records.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 text-xs px-2 py-1 rounded-full border font-medium ${EVENT_COLORS[r.eventType as EventType]}`}>
                      {EVENT_LABELS[r.eventType as EventType]}
                    </span>
                    {r.note && (
                      <span className="text-xs text-muted-foreground truncate">
                        📍 {r.note}
                      </span>
                    )}
                  </div>
                  {(r.startOdometer !== null || r.endOdometer !== null) && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground ml-0.5">
                      <span>🚛</span>
                      {r.startOdometer !== null && (
                        <span>出発 {r.startOdometer.toLocaleString("ja-JP")} km</span>
                      )}
                      {r.startOdometer !== null && r.endOdometer !== null && (
                        <span className="text-gray-400">→</span>
                      )}
                      {r.endOdometer !== null && (
                        <span>帰着 {r.endOdometer.toLocaleString("ja-JP")} km</span>
                      )}
                      {r.startOdometer !== null && r.endOdometer !== null && r.endOdometer >= r.startOdometer && (
                        <span className="font-semibold text-primary ml-1">
                          （{(r.endOdometer - r.startOdometer).toFixed(1)} km）
                        </span>
                      )}
                    </div>
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
