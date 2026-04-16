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
  const [itemStatus, setItemStatus] = useState<Map<string, "良" | "否">>(new Map());
  const [gpsStatus, setGpsStatus] = useState<"inactive" | "active" | "denied" | "background">("inactive");
  const [messages, setMessages] = useState<{ id: number; employeeId: number; sender: "office" | "employee"; content: string; createdAt: string }[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"attendance" | "messages" | "checklist">("attendance");
  const msgBottomRef = useRef<HTMLDivElement>(null);
  const watchIdRef = useRef<number | null>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const checklistSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checklistLoadedRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLoadedRef = useRef(false);

  // localStorage キー (JST日付)
  function todayJstStr(): string {
    return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  }
  function clLsKey(empId: number): string {
    return `cl_${empId}_${todayJstStr()}`;
  }
  function draftLsKey(empId: number): string {
    return `draft_${empId}_${todayJstStr()}`;
  }

  const setItemResult = (id: string, result: "良" | "否") => {
    setItemStatus(prev => {
      const next = new Map(prev);
      if (next.get(id) === result) next.delete(id);
      else next.set(id, result);
      // localStorageに即座に保存（ページ更新対策）
      try {
        const items: Record<string, "良" | "否"> = {};
        next.forEach((v, k) => { items[k] = v; });
        localStorage.setItem(clLsKey(employeeId), JSON.stringify(items));
      } catch { /* quota error は無視 */ }
      return next;
    });
  };

  const totalItems = INSPECTION_SECTIONS.reduce((s, sec) => s + sec.items.length, 0);
  const checkedCount = itemStatus.size;
  const ngItems = INSPECTION_SECTIONS.flatMap(sec =>
    sec.items.filter(item => itemStatus.get(item.id) === "否")
  );

  // PIN認証 (useEffectより前に宣言する必要あり)
  const [pinRequired, setPinRequired] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinVerifying, setPinVerifying] = useState(false);
  const shakeRef = useRef<HTMLDivElement>(null);

  // PIN認証後: localStorageからチェックリスト状態を即座に復元
  useEffect(() => {
    if (!pinVerified || checklistLoadedRef.current) return;
    checklistLoadedRef.current = true;

    // ① localStorageから同期的に復元（確実・高速）
    try {
      const stored = localStorage.getItem(clLsKey(employeeId));
      if (stored) {
        const items = JSON.parse(stored) as Record<string, "良" | "否">;
        if (Object.keys(items).length > 0) {
          setItemStatus(new Map(Object.entries(items) as [string, "良" | "否"][]));
          return; // localStorageにデータがあればDB参照不要
        }
      }
    } catch { /* parse error */ }

    // ② localStorageにない場合はDBから取得（初回や端末変更時）
    apiFetch(`/attendance/checklist/${employeeId}`)
      .then(r => r.json() as Promise<{ checklistNgItems: string | null }>)
      .then(data => {
        if (!data.checklistNgItems) return;
        try {
          const parsed = JSON.parse(data.checklistNgItems) as {
            items?: Record<string, "良" | "否">;
          };
          if (parsed.items && Object.keys(parsed.items).length > 0) {
            setItemStatus(new Map(Object.entries(parsed.items) as [string, "良" | "否"][]));
            // DBから取得したデータをlocalStorageにも保存
            localStorage.setItem(clLsKey(employeeId), JSON.stringify(parsed.items));
          }
        } catch { /* 旧フォーマットは無視 */ }
      })
      .catch(() => {});
  }, [pinVerified, employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // チェック変更のたびにDBへも保存（800ms デバウンス）→ 管理画面にリアルタイム反映
  useEffect(() => {
    if (!pinVerified || !checklistLoadedRef.current) return;
    if (checklistSaveTimerRef.current) clearTimeout(checklistSaveTimerRef.current);
    checklistSaveTimerRef.current = setTimeout(() => {
      const allItems: Record<string, "良" | "否"> = {};
      itemStatus.forEach((v, k) => { allItems[k] = v; });
      const payload = JSON.stringify({
        total: totalItems,
        checked: checkedCount,
        ng: ngItems.map(i => i.area),
        items: allItems,
      });
      apiFetch(`/attendance/checklist/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ checklistNgItems: payload }),
      }).catch(() => {});
    }, 800);
    return () => {
      if (checklistSaveTimerRef.current) clearTimeout(checklistSaveTimerRef.current);
    };
  }, [itemStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // PIN認証後: localStorageから発着地・走行距離を即座に復元
  useEffect(() => {
    if (!pinVerified || draftLoadedRef.current) return;
    draftLoadedRef.current = true;

    // ① localStorageから同期的に復元
    try {
      const stored = localStorage.getItem(draftLsKey(employeeId));
      if (stored) {
        const d = JSON.parse(stored) as {
          departure?: string; arrival?: string;
          startOdometer?: string; endOdometer?: string;
        };
        if (d.departure)     setDeparture(d.departure);
        if (d.arrival)       setArrival(d.arrival);
        if (d.startOdometer) setStartOdometer(d.startOdometer);
        if (d.endOdometer)   setEndOdometer(d.endOdometer);
        return;
      }
    } catch { /* ignore */ }

    // ② DBから取得（別端末・初回）
    apiFetch(`/attendance/draft/${employeeId}`)
      .then(r => r.json() as Promise<{
        departure?: string | null; arrival?: string | null;
        startOdometer?: number | null; endOdometer?: number | null;
      } | null>)
      .then(data => {
        if (!data) return;
        if (data.departure)     setDeparture(data.departure);
        if (data.arrival)       setArrival(data.arrival);
        if (data.startOdometer != null) setStartOdometer(String(data.startOdometer));
        if (data.endOdometer != null)   setEndOdometer(String(data.endOdometer));
        // DBデータをlocalStorageにも保存
        try {
          localStorage.setItem(draftLsKey(employeeId), JSON.stringify({
            departure: data.departure ?? "",
            arrival: data.arrival ?? "",
            startOdometer: data.startOdometer != null ? String(data.startOdometer) : "",
            endOdometer: data.endOdometer != null ? String(data.endOdometer) : "",
          }));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, [pinVerified, employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 発着地・走行距離が変わるたびにlocalStorageに即時保存＋DBにデバウンス送信
  useEffect(() => {
    if (!pinVerified || !draftLoadedRef.current) return;
    // localStorageに即時保存
    try {
      localStorage.setItem(draftLsKey(employeeId), JSON.stringify({
        departure, arrival, startOdometer, endOdometer,
      }));
    } catch { /* ignore */ }
    // DBにデバウンス保存（管理画面リアルタイム反映）
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      apiFetch(`/attendance/draft/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          departure: departure || null,
          arrival: arrival || null,
          startOdometer: startOdometer ? parseFloat(startOdometer) : null,
          endOdometer: endOdometer ? parseFloat(endOdometer) : null,
        }),
      }).catch(() => {});
    }, 1000);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [departure, arrival, startOdometer, endOdometer]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // メッセージSSE（リアルタイム受信）
  useEffect(() => {
    if (!pinVerified) return;
    const es = new EventSource(`${BASE}/api/messages/stream?employeeId=${employeeId}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type: string; message: { id: number; employeeId: number; sender: "office" | "employee"; content: string; createdAt: string } };
        if (data.type === "message" && data.message.employeeId === employeeId) {
          setMessages(prev => prev.find(m => m.id === data.message.id) ? prev : [...prev, data.message]);
          if (data.message.sender === "office") setUnreadCount(c => c + 1);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [employeeId, pinVerified]);

  // 初回メッセージ取得
  useEffect(() => {
    if (!pinVerified) return;
    apiFetch(`/messages/${employeeId}`)
      .then((data: { id: number; sender: "office" | "employee"; content: string; createdAt: string }[]) => setMessages(data ?? []))
      .catch(() => {});
  }, [employeeId, pinVerified]);

  // プッシュ通知登録（PIN認証後）
  useEffect(() => {
    if (!pinVerified) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const keyRes = await fetch(`${BASE}/api/messages/vapid-public-key`);
        const { publicKey } = await keyRes.json() as { publicKey: string };
        if (!publicKey) return;
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const json = sub.toJSON();
        await fetch(`${BASE}/api/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            role: "employee",
            endpoint: json.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          }),
        });
      } catch { /* silent */ }
    })();
  }, [employeeId, pinVerified]);

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  const sendMessage = async () => {
    if (!msgInput.trim() || msgSending) return;
    setMsgSending(true);
    try {
      await fetch(`${BASE}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, sender: "employee", content: msgInput.trim() }),
      });
      setMsgInput("");
    } finally {
      setMsgSending(false);
    }
  };

  // メッセージタブ開封時に未読リセット＆自動スクロール
  useEffect(() => {
    if (activeTab === "messages") {
      setUnreadCount(0);
      setTimeout(() => msgBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [activeTab, messages]);

  // ライブ位置情報の継続送信（PINログイン後に開始）
  useEffect(() => {
    if (!pinVerified || !navigator.geolocation) return;

    const sendPos = (lat: number, lng: number, acc?: number) => {
      const now = Date.now();
      const last = lastPosSentRef.current;
      const dist = last ? Math.hypot(lat - last.lat, lng - last.lng) * 111320 : Infinity;
      if (last && now - last.time < 15000 && dist < 50) return;
      lastPosSentRef.current = { lat, lng, time: now };
      apiFetch("/attendance/location/live", {
        method: "POST",
        body: JSON.stringify({ employeeId, latitude: lat, longitude: lng, accuracy: acc }),
      }).catch(() => {});
    };

    const startWatch = () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsStatus("active");
          sendPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setGpsStatus("denied");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
      );
      watchIdRef.current = id;
    };

    // Wake Lock（スクリーンを消灯させない）
    const acquireWakeLock = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
      } catch {
        // 取得失敗は無視
      }
    };

    // バックグラウンド/フォアグラウンド切り替え検出
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setGpsStatus("active");
        startWatch();
        acquireWakeLock();
      } else {
        setGpsStatus("background");
      }
    };

    startWatch();
    acquireWakeLock();
    setGpsStatus("active");
    document.addEventListener("visibilitychange", handleVisibility);

    // フォールバック（15秒ごとにgetCurrentPosition）
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        (pos) => sendPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => {},
        { timeout: 8000, maximumAge: 10000 },
      );
    }, 15000);
    liveIntervalRef.current = interval;

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (liveIntervalRef.current !== null) clearInterval(liveIntervalRef.current);
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pinVerified, employeeId]);

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

  const getGps = (): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      const timer = setTimeout(() => resolve(null), 6000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); },
        () => { clearTimeout(timer); resolve(null); },
        { timeout: 6000, maximumAge: 0 },
      );
    });
  };

  const handleRecord = async (eventType: EventType) => {
    setRecording(true);
    setError(null);

    // 楽観的更新: APIレスポンスを待たずに即座に状態を反映
    const optimisticRecord: AttendanceRecord = {
      id: -1,
      employeeId,
      eventType,
      workDate: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
      recordedAt: new Date().toISOString(),
      note: null,
      startOdometer: null,
      endOdometer: null,
    };
    setRecords(prev => [...prev, optimisticRecord]);

    try {
      const startKm = startOdometer.trim() !== "" ? parseFloat(startOdometer) : null;
      const endKm = endOdometer.trim() !== "" ? parseFloat(endOdometer) : null;
      const gps = await getGps();
      const checklistPayload = eventType === "clock_in"
        ? JSON.stringify({
            total: totalItems,
            checked: checkedCount,
            ng: ngItems.map(i => i.area),
          })
        : null;
      await apiFetch("/attendance/record", {
        method: "POST",
        body: JSON.stringify({
          employeeId, eventType,
          note: [departure.trim(), arrival.trim()].filter(Boolean).join(" → ") || null,
          startOdometer: startKm,
          endOdometer: endKm,
          latitude: gps?.latitude ?? null,
          longitude: gps?.longitude ?? null,
          checklistNgItems: checklistPayload,
        }),
      });
      const loc = [departure.trim(), arrival.trim()].filter(Boolean).join(" → ");
      const odometerInfo = startKm !== null || endKm !== null
        ? `　走行距離：${startKm ?? "—"} → ${endKm ?? "—"} km`
        : "";
      setSuccessMsg(`${EVENT_LABELS[eventType]}を記録しました${loc ? `（${loc}）` : ""}${odometerInfo}`);
      // 退勤打刻時のみフィールドをクリア（それ以外は入力値を保持）
      if (eventType === "clock_out") {
        setDeparture("");
        setArrival("");
        setStartOdometer("");
        setEndOdometer("");
      }
      setTimeout(() => setSuccessMsg(null), 5000);
      await fetchData();
    } catch (e: unknown) {
      // 楽観的更新を元に戻してDB最新状態を再取得
      await fetchData();
      let msg = "記録に失敗しました。もう一度お試しください。";
      if (e instanceof Error) {
        try {
          const body = JSON.parse(e.message);
          if (body?.error) msg = body.error;
        } catch {
          if (e.message) msg = e.message;
        }
      }
      setError(msg);
    } finally {
      setRecording(false);
    }
  };

  // ボタン有効判定
  const canClockIn = status === "未出勤";
  const canBreakStart = status === "出勤中";
  const canBreakEnd = status === "休憩中";
  const canClockOut = status === "出勤中" && endOdometer.trim() !== "";

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
    <div className="min-h-screen bg-gray-50 flex flex-col pb-20">
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

      {/* ── 勤怠入力タブ ── */}
      {activeTab === "attendance" && (
        <>
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
            <button
              onClick={() => handleRecord("clock_in")}
              disabled={!canClockIn || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canClockIn && !recording ? "bg-green-500 hover:bg-green-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
            >
              <span className="text-4xl">🟢</span>
              <span>出勤</span>
            </button>
            <button
              onClick={() => handleRecord("clock_out")}
              disabled={!canClockOut || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canClockOut && !recording ? "bg-red-500 hover:bg-red-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
            >
              <span className="text-4xl">🔴</span>
              <span>退勤</span>
            </button>
            <button
              onClick={() => handleRecord("break_start")}
              disabled={!canBreakStart || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canBreakStart && !recording ? "bg-yellow-500 hover:bg-yellow-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
            >
              <span className="text-4xl">🟡</span>
              <span>休憩開始</span>
            </button>
            <button
              onClick={() => handleRecord("break_end")}
              disabled={!canBreakEnd || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canBreakEnd && !recording ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
            >
              <span className="text-4xl">🔵</span>
              <span>休憩終了</span>
            </button>
          </div>

          <div className="pb-4 text-center">
            <p className="text-xs text-muted-foreground">三川運送 勤怠管理システム</p>
          </div>
        </>
      )}

      {/* ── メッセージタブ ── */}
      {activeTab === "messages" && (
        <div className="flex flex-col flex-1 mx-4 mt-3 mb-3 bg-white rounded-xl border shadow-sm overflow-hidden" style={{ minHeight: "420px" }}>
          {/* チャット一覧 */}
          <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-3 space-y-2">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <span className="text-4xl opacity-30">💬</span>
                <p className="text-sm">メッセージはありません</p>
              </div>
            ) : messages.map(msg => {
              const isMe = msg.sender === "employee";
              return (
                <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  {!isMe && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold shrink-0 mr-2 mt-1">
                      事
                    </div>
                  )}
                  <div className="max-w-[80%]">
                    {!isMe && <p className="text-xs text-muted-foreground mb-1 ml-1">事務所</p>}
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
                      ${isMe
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-white border shadow-sm rounded-tl-sm"}`}>
                      {msg.content}
                    </div>
                    <p className={`text-xs text-muted-foreground mt-1 ${isMe ? "text-right mr-1" : "ml-1"}`}>
                      {new Date(msg.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={msgBottomRef} />
          </div>
          {/* 入力欄 */}
          <div className="px-3 py-3 border-t bg-white flex gap-2 shrink-0">
            <input
              type="text"
              value={msgInput}
              onChange={e => setMsgInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="事務所にメッセージを送る..."
              className="flex-1 rounded-xl border px-3 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={sendMessage}
              disabled={!msgInput.trim() || msgSending}
              className="bg-primary text-primary-foreground rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-40 active:scale-95 transition-all"
            >
              送信
            </button>
          </div>
        </div>
      )}

      {/* ── チェックリストタブ ── */}
      {activeTab === "checklist" && (
        <div className="mx-4 mt-3 mb-3 bg-white rounded-xl border shadow-sm overflow-hidden">
          {/* ヘッダー */}
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">日常点検チェックリスト</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold
                ${checkedCount === totalItems && ngItems.length === 0
                  ? "bg-green-100 text-green-700"
                  : ngItems.length > 0
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-500"}`}>
                {checkedCount} / {totalItems}
                {ngItems.length > 0 && ` (否${ngItems.length}件)`}
              </span>
            </div>
          </div>
          {/* プログレスバー */}
          <div className="h-1.5 bg-gray-100">
            <div
              className="h-full bg-green-500 transition-all duration-300 rounded-r-full"
              style={{ width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%` }}
            />
          </div>
          <div className="divide-y divide-gray-100">
            {INSPECTION_SECTIONS.map((sec) => (
              <div key={sec.label}>
                <div className="px-4 py-2 bg-gray-50">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{sec.label}</p>
                </div>
                {sec.items.map((item) => {
                  const st = itemStatus.get(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-4 py-3.5 transition-colors
                        ${st === "良" ? "bg-green-50" : st === "否" ? "bg-red-50" : "bg-white"}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-tight
                          ${st === "良" ? "text-green-800" : st === "否" ? "text-red-800" : "text-gray-800"}`}>
                          {item.area}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.content}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => setItemResult(item.id, "良")}
                          className={`w-12 h-9 rounded-lg text-sm font-bold border-2 transition-all active:scale-95
                            ${st === "良" ? "bg-green-500 border-green-500 text-white shadow-sm" : "bg-white border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600"}`}
                        >良</button>
                        <button
                          onClick={() => setItemResult(item.id, "否")}
                          className={`w-12 h-9 rounded-lg text-sm font-bold border-2 transition-all active:scale-95
                            ${st === "否" ? "bg-red-500 border-red-500 text-white shadow-sm" : "bg-white border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600"}`}
                        >否</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {ngItems.length > 0 && (
              <div className="px-4 py-3 bg-red-50 border-t border-red-100">
                <p className="text-red-700 font-bold text-xs mb-2">⚠️ 異常あり — 管理者に報告してください</p>
                <ul className="space-y-1">
                  {ngItems.map(item => (
                    <li key={item.id} className="text-xs text-red-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      {item.area}（{item.content}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {checkedCount === totalItems && ngItems.length === 0 && (
              <div className="px-4 py-4 text-center bg-green-50 border-t border-green-100">
                <p className="text-green-700 font-bold text-sm">✅ 日常点検完了！　今日も１日安全運転で！！</p>
              </div>
            )}
            {checkedCount === totalItems && ngItems.length > 0 && (
              <div className="px-4 py-3 text-center bg-orange-50 border-t border-orange-100">
                <p className="text-orange-700 font-bold text-sm">⚠️ 点検完了（異常 {ngItems.length}件）　管理者へ報告後に運行してください</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── フッターナビゲーション ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50 safe-area-pb"
           style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <button
          onClick={() => setActiveTab("attendance")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors
            ${activeTab === "attendance" ? "text-primary" : "text-gray-400"}`}
        >
          <span className="text-2xl">🟢</span>
          <span className={`text-xs font-semibold ${activeTab === "attendance" ? "text-primary" : "text-gray-400"}`}>勤怠入力</span>
          {activeTab === "attendance" && <span className="absolute bottom-0 w-12 h-0.5 bg-primary rounded-t-full" />}
        </button>
        <button
          onClick={() => { setActiveTab("messages"); setUnreadCount(0); }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors
            ${activeTab === "messages" ? "text-primary" : "text-gray-400"}`}
        >
          <div className="relative">
            <span className="text-2xl">💬</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          <span className={`text-xs font-semibold ${activeTab === "messages" ? "text-primary" : "text-gray-400"}`}>メッセージ</span>
          {activeTab === "messages" && <span className="absolute bottom-0 w-16 h-0.5 bg-primary rounded-t-full" />}
        </button>
        <button
          onClick={() => setActiveTab("checklist")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors
            ${activeTab === "checklist" ? "text-primary" : "text-gray-400"}`}
        >
          <div className="relative">
            <span className="text-2xl">📋</span>
            {checkedCount < totalItems && (
              <span className="absolute -top-1 -right-2 bg-gray-400 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {totalItems - checkedCount}
              </span>
            )}
          </div>
          <span className={`text-xs font-semibold ${activeTab === "checklist" ? "text-primary" : "text-gray-400"}`}>チェックリスト</span>
          {activeTab === "checklist" && <span className="absolute bottom-0 w-20 h-0.5 bg-primary rounded-t-full" />}
        </button>
      </div>
    </div>
  );
}
