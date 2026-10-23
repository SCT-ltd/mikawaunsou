import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { DaySeparator, jstDay } from "@/components/messages/shared";
import { AttachButton, AttachmentView, PendingStrip, addPending, uploadAttachment, type Attachment, type PendingFile } from "@/components/messages/attachments";
import { useParams } from "wouter";
import { qrKeyFor, isQrKeyError } from "@/lib/qr-key";
import { playNotificationSound, unlockAudio } from "@/lib/notification-sound";
import { newClientId, sendOrQueue, flushQueue, queuedFor, cleanupOldLocalKeys, type QueuedItem } from "@/lib/punch-queue";
import { pushState, subscribePush, type PushState } from "@/lib/push-setup";
import { openLiveStream } from "@/lib/live-stream";
import {
  ChoiceSheet, AlcoholSheet, CorrectionSheet, PushCard, VehiclePicker,
  fmtHM, fmtMD, todayJst, type Choice, type AlcoholValues, type CorrectionValues, type CorrectionRequest,
} from "@/components/driver/driver-parts";

type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";
type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";

interface AttendanceRecord {
  id: number;
  employeeId: number;
  eventType: EventType;
  workDate: string;
  recordedAt: string;
  note?: string | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
  /** まだサーバーに届いていない（端末に溜めている）打刻 */
  pending?: boolean;
}

interface Employee { id: number; employeeCode: string; name: string; department: string; isOfficeStaff?: boolean }
interface Message { id: number; employeeId: number; sender: "office" | "employee"; content: string; createdAt: string; pending?: boolean; attachments?: Attachment[] }
interface PublicSettings { requireChecklist: boolean; requireAlcohol: boolean; vehicles: string[]; /** 取引先マスターの荷主の名前（日報で選べる） */ shippers?: string[] }
interface AlcoholToday { items: Array<{ id: number; phase: string; valueMg: number | null; detected: boolean; checkedAt: string }>; lastChecker: string | null; lastMethod: string | null }

const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

function getStatus(records: AttendanceRecord[]): Status {
  if (records.length === 0) return "未出勤";
  const last = records[records.length - 1]!;
  if (last.eventType === "clock_in") return "出勤中";
  if (last.eventType === "break_start") return "休憩中";
  if (last.eventType === "break_end") return "出勤中";
  return "退勤済";
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** QR の合言葉（lib/qr-key.ts）。画面を開いたときに決まる */
let QR_KEY = "";
const qrHeaders = (): Record<string, string> => (QR_KEY ? { "X-QR-Key": QR_KEY } : {});
const qrQuery = () => (QR_KEY ? `&k=${encodeURIComponent(QR_KEY)}` : "");
/** 溜めた打刻を送るときの見出し（1台を何人かで使ったときは、その人の合言葉で送る） */
const headersFor = (empId: number): Record<string, string> => { const k = qrKeyFor(empId); return k ? { "X-QR-Key": k } : {}; };

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...qrHeaders(), ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    try { const b = JSON.parse(e.message); if (b?.error) return String(b.error); } catch { /* 本文が JSON でない */ }
  }
  return fallback;
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
const TOTAL_ITEMS = INSPECTION_SECTIONS.reduce((s, sec) => s + sec.items.length, 0);

/** メーターの値（空なら null。数字でなければ NaN） */
const odo = (s: string) => (s.trim() === "" ? null : Number(s));

export default function DriverPage() {
  const params = useParams<{ id: string }>();
  const employeeId = parseInt(params.id ?? "0", 10);
  QR_KEY = qrKeyFor(employeeId);
  /** QR が古い（合言葉が無い）ため使えない */
  const [qrKeyMissing, setQrKeyMissing] = useState(false);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [serverRecords, setServerRecords] = useState<AttendanceRecord[]>([]);
  /** いまの勤務の日付（深夜に日付をまたいでも出勤した日のまま） */
  const [shiftDate, setShiftDate] = useState(todayJst());
  /** 電波が無くて端末に溜めている打刻 */
  const [pending, setPending] = useState<QueuedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // 知らせは6秒で消す（新しい知らせが出たら数え直す。以前は前の知らせの時計で新しい知らせまで消えていた）
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), 6000);
    return () => clearTimeout(t);
  }, [successMsg]);
  const [now, setNow] = useState(new Date());
  const [routes, setRoutes] = useState<{ dep: string; arr: string }[]>([{ dep: "", arr: "" }]);
  const [startOdometer, setStartOdometer] = useState("");
  const [endOdometer, setEndOdometer] = useState("");
  const [shipper, setShipper] = useState("");
  const [waitingMin, setWaitingMin] = useState("");
  const [itemStatus, setItemStatus] = useState<Map<string, "良" | "否">>(new Map());
  const [vehicle, setVehicle] = useState("");
  const [settings, setSettings] = useState<PublicSettings>({ requireChecklist: false, requireAlcohol: false, vehicles: [] });
  const [alcohol, setAlcohol] = useState<AlcoholToday>({ items: [], lastChecker: null, lastMethod: null });
  const [myCorrections, setMyCorrections] = useState<CorrectionRequest[]>([]);
  const [gpsStatus, setGpsStatus] = useState<"inactive" | "active" | "denied" | "background">("inactive");
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  /** 送る前の添付（写真・PDF） */
  const [msgFiles, setMsgFiles] = useState<PendingFile[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"attendance" | "messages" | "checklist">("attendance");
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  /** 押してから1分は取り消せる（いちばん新しい打刻） */
  const [lastPunch, setLastPunch] = useState<{ id: number; eventType: EventType; at: number } | null>(null);
  const [choice, setChoice] = useState<{ title: string; message: React.ReactNode; choices: Choice[] } | null>(null);
  const [alcoholPhase, setAlcoholPhase] = useState<"before" | "after" | null>(null);
  /** アルコールチェックを記録したあとに出勤する */
  const afterAlcoholRef = useRef<(() => void) | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState<null | { kind?: "add" | "change" | "cancel"; eventType?: string; workDate?: string }>(null);
  const [push, setPush] = useState<{ state: PushState; message: string | null }>({ state: "default", message: null });
  /** 電波が無く、前に読み込んだ内容を出している */
  const [offlineView, setOfflineView] = useState(false);

  const msgBottomRef = useRef<HTMLDivElement>(null);
  const watchIdRef = useRef<number | null>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const latestGpsRef = useRef<{ latitude: number; longitude: number; time: number } | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const checklistSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 点検を読み込んだ勤務の日付（日付が変わったら読み直す） */
  const checklistLoadedForRef = useRef<string | null>(null);
  const checklistTouchedRef = useRef(false);
  const draftLoadedRef = useRef(false);
  const draftValuesRef = useRef<{ routes: { dep: string; arr: string }[]; startOdometer: string; endOdometer: string }>({ routes: [{ dep: "", arr: "" }], startOdometer: "", endOdometer: "" });
  const draftFocusedRef = useRef(false);
  /** まだサーバーに保存できていない下書きがある（電波が悪い）。そのあいだは取り直した値で上書きしない */
  const draftDirtyRef = useRef(false);

  const clLsKey = (empId: number, d: string) => `cl_${empId}_${d}`;
  const draftLsKey = (empId: number, d: string) => `draft_${empId}_${d}`;

  // 端末に残った古い控えを消す
  useEffect(() => { cleanupOldLocalKeys(); }, []);

  // ── 表示する打刻＝サーバーの打刻＋端末に溜めている打刻 ──
  const records: AttendanceRecord[] = useMemo(() => {
    const extra = pending.filter(p => p.kind === "record").map((p, i) => ({
      id: -(i + 1), employeeId, eventType: p.body.eventType as EventType, workDate: shiftDate,
      recordedAt: new Date(p.createdAt).toISOString(), pending: true,
    }));
    return [...serverRecords, ...extra].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }, [serverRecords, pending, employeeId, shiftDate]);
  const status = getStatus(records);
  const working = status === "出勤中" || status === "休憩中";
  const pendingCount = pending.length;

  const setItemResult = (id: string, result: "良" | "否") => {
    checklistTouchedRef.current = true;
    setItemStatus(prev => {
      const next = new Map(prev);
      if (next.get(id) === result) next.delete(id);
      else next.set(id, result);
      try {
        const items: Record<string, "良" | "否"> = {};
        next.forEach((v, k) => { items[k] = v; });
        localStorage.setItem(clLsKey(employeeId, shiftDate), JSON.stringify({ items, vehicle }));
      } catch { /* quota error は無視 */ }
      return next;
    });
  };

  const checkedCount = itemStatus.size;
  const checklistDone = checkedCount === TOTAL_ITEMS;
  const ngItems = INSPECTION_SECTIONS.flatMap(sec => sec.items.filter(item => itemStatus.get(item.id) === "否"));

  // PIN認証
  const [pinRequired, setPinRequired] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLockedUntil, setPinLockedUntil] = useState<number | null>(null);
  const [pinVerifying, setPinVerifying] = useState(false);
  const shakeRef = useRef<HTMLDivElement>(null);
  /** 暗証番号がまだ無い人は、最初に自分で決める（QR だけでは使えない） */
  const [pinSetup, setPinSetup] = useState(false);
  /** 決めるときの1回目の入力（2回目と一致したら登録） */
  const [pinFirst, setPinFirst] = useState<string | null>(null);

  // ── いまの勤務の打刻を取り直す ──
  const fetchData = useCallback(async () => {
    try {
      const [emp, recRes] = await Promise.all([
        apiFetch(`/employees/${employeeId}`),
        fetch(`${BASE}/api/attendance/employee/${employeeId}/today`, { headers: qrHeaders(), cache: "no-store" }),
      ]);
      if (!recRes.ok) throw new Error(await recRes.text());
      const recs = (await recRes.json()) as AttendanceRecord[];
      setEmployee(emp);
      setServerRecords(recs ?? []);
      const sd = recRes.headers.get("X-Shift-Date") ?? recs?.[0]?.workDate ?? todayJst();
      setShiftDate(sd);
      setOfflineView(false);
      // 電波が無いときに開いても使えるよう、最後に読み込んだ内容を端末に控えておく
      try { localStorage.setItem(`drv_cache_${employeeId}`, JSON.stringify({ at: Date.now(), employee: emp, records: recs, shiftDate: sd })); } catch { /* ignore */ }
      // ここでは error を消さない（打刻を断られた理由が、取り直したとたんに消えてしまうため）
    } catch (e) {
      if (isQrKeyError(String((e as Error)?.message ?? ""))) setQrKeyMissing(true);
      else {
        // 電波が無い：最後に読み込んだ内容（24時間以内）で画面を出す。押した打刻は端末に溜まる
        let cached: { at: number; employee: Employee; records: AttendanceRecord[]; shiftDate: string } | null = null;
        try { cached = JSON.parse(localStorage.getItem(`drv_cache_${employeeId}`) ?? "null"); } catch { cached = null; }
        if (cached && Date.now() - cached.at < 24 * 3600000) {
          setEmployee(prev => prev ?? cached!.employee);
          setServerRecords(prev => (prev.length ? prev : cached!.records));
          setShiftDate(cached.shiftDate);
          setOfflineView(true);
        } else setError("データの取得に失敗しました。電波の良いところで画面を読み込み直してください。");
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const reloadPending = useCallback(async () => {
    setPending(await queuedFor(employeeId));
  }, [employeeId]);

  // ── 溜めた打刻を送る（電波が戻ったとき・20秒ごと・画面に戻ったとき） ──
  const flush = useCallback(async () => {
    await flushQueue(headersFor, (item, r) => {
      if (item.employeeId !== employeeId) return;
      if (!r.ok && !r.queued) {
        const what = item.kind === "record" ? `${EVENT_LABELS[item.body.eventType as EventType] ?? "打刻"}（${fmtHM(item.createdAt)}）` : item.kind === "alcohol" ? "アルコールチェック" : "メッセージ";
        setError(`溜めていた${what}は送れませんでした：${r.error}`);
      } else if (r.ok && item.kind === "record") {
        setSuccessMsg(`溜めていた${EVENT_LABELS[item.body.eventType as EventType] ?? "打刻"}（${fmtHM(item.createdAt)}）を送りました`);
      }
    });
    await reloadPending();
    void fetchData();
  }, [employeeId, reloadPending, fetchData]);

  useEffect(() => {
    void reloadPending();
    const onOnline = () => { void flush(); };
    window.addEventListener("online", onOnline);
    const t = setInterval(() => { if (navigator.onLine !== false) void flush(); }, 20000);
    return () => { window.removeEventListener("online", onOnline); clearInterval(t); };
  }, [flush, reloadPending]);

  // ── 点検：勤務の日付ごとに、端末の控え→無ければサーバーから復元 ──
  useEffect(() => {
    if (!pinVerified || !shiftDate || checklistLoadedForRef.current === shiftDate) return;
    checklistLoadedForRef.current = shiftDate;
    checklistTouchedRef.current = false;
    setItemStatus(new Map());
    try {
      const stored = localStorage.getItem(clLsKey(employeeId, shiftDate));
      if (stored) {
        const parsed = JSON.parse(stored) as { items?: Record<string, "良" | "否">; vehicle?: string } | Record<string, "良" | "否">;
        const items = (parsed as { items?: Record<string, "良" | "否"> }).items ?? (parsed as Record<string, "良" | "否">);
        if (items && Object.keys(items).length > 0) {
          setItemStatus(new Map(Object.entries(items) as [string, "良" | "否"][]));
          const v = (parsed as { vehicle?: string }).vehicle;
          if (v) setVehicle(v);
          return;
        }
      }
    } catch { /* parse error */ }
    // 以前は .then(r => r.json()) を2回していたため必ず失敗し、端末を替えると点検が戻らず上書きされていた
    apiFetch(`/attendance/checklist/${employeeId}`)
      .then((data: { workDate?: string; inspection?: { items: Record<string, "良" | "否">; vehicle: string | null } | null }) => {
        if (checklistTouchedRef.current || !data?.inspection) return;
        const items = data.inspection.items ?? {};
        if (Object.keys(items).length > 0) setItemStatus(new Map(Object.entries(items) as [string, "良" | "否"][]));
        if (data.inspection.vehicle) setVehicle(data.inspection.vehicle);
        try { localStorage.setItem(clLsKey(employeeId, shiftDate), JSON.stringify({ items, vehicle: data.inspection.vehicle ?? "" })); } catch { /* ignore */ }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinVerified, employeeId, shiftDate]);

  // 点検を変えるたびにサーバーへ（800ms 待って）→ 管理画面にすぐ出る
  useEffect(() => {
    if (!pinVerified || !checklistTouchedRef.current) return;
    if (checklistSaveTimerRef.current) clearTimeout(checklistSaveTimerRef.current);
    checklistSaveTimerRef.current = setTimeout(() => {
      const allItems: Record<string, "良" | "否"> = {};
      itemStatus.forEach((v, k) => { allItems[k] = v; });
      const payload = JSON.stringify({ total: TOTAL_ITEMS, checked: checkedCount, ng: ngItems.map(i => i.area), items: allItems });
      apiFetch(`/attendance/checklist/${employeeId}`, { method: "PATCH", body: JSON.stringify({ checklistNgItems: payload, vehicle }) }).catch(() => {});
    }, 800);
    return () => { if (checklistSaveTimerRef.current) clearTimeout(checklistSaveTimerRef.current); };
  }, [itemStatus, vehicle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 発着地・メーターの下書き ──
  function serializeDep(rts: { dep: string; arr: string }[]) { const s = rts.map(r => r.dep).join("\n").trim(); return s || null; }
  function serializeArr(rts: { dep: string; arr: string }[]) { const s = rts.map(r => r.arr).join("\n").trim(); return s || null; }
  function parseRoutes(dep: string | null, arr: string | null): { dep: string; arr: string }[] {
    const deps = (dep || "").split("\n");
    const arrs = (arr || "").split("\n");
    const n = Math.max(deps.length, arrs.length, 1);
    const result = Array.from({ length: n }, (_, i) => ({ dep: deps[i] ?? "", arr: arrs[i] ?? "" }));
    const nonEmpty = result.filter(r => r.dep || r.arr);
    return nonEmpty.length > 0 ? nonEmpty : [{ dep: "", arr: "" }];
  }
  type Draft = { departure?: string | null; arrival?: string | null; startOdometer?: number | null; endOdometer?: number | null } | null;
  function applyDraft(data: Draft) {
    setRoutes(parseRoutes(data?.departure ?? null, data?.arrival ?? null));
    setStartOdometer(data?.startOdometer != null ? String(data.startOdometer) : "");
    setEndOdometer(data?.endOdometer != null ? String(data.endOdometer) : "");
  }

  // 下書きを読む：サーバーを正とする。届かなければ端末の控え
  useEffect(() => {
    if (!pinVerified || draftLoadedRef.current || loading) return;
    draftLoadedRef.current = true;
    apiFetch(`/attendance/draft/${employeeId}`, { cache: "no-store" })
      .then((data: Draft) => {
        const has = data && (data.departure || data.arrival || data.startOdometer != null || data.endOdometer != null);
        if (has) applyDraft(data);
        else {
          try {
            const stored = localStorage.getItem(draftLsKey(employeeId, shiftDate));
            if (stored) {
              const d = JSON.parse(stored) as { departure?: string; arrival?: string; startOdometer?: string; endOdometer?: string };
              setRoutes(parseRoutes(d.departure ?? null, d.arrival ?? null));
              if (d.startOdometer) setStartOdometer(d.startOdometer);
              if (d.endOdometer) setEndOdometer(d.endOdometer);
            }
          } catch { /* ignore */ }
        }
      })
      .catch(() => {
        try {
          const stored = localStorage.getItem(draftLsKey(employeeId, shiftDate));
          if (stored) {
            const d = JSON.parse(stored) as { departure?: string; arrival?: string; startOdometer?: string; endOdometer?: string };
            setRoutes(parseRoutes(d.departure ?? null, d.arrival ?? null));
            if (d.startOdometer) setStartOdometer(d.startOdometer);
            if (d.endOdometer) setEndOdometer(d.endOdometer);
            draftDirtyRef.current = true; // サーバーに届いていないかもしれない
          }
        } catch { /* ignore */ }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinVerified, employeeId, loading]);

  function saveDraftToApi(rts: { dep: string; arr: string }[], sOdo: string, eOdo: string) {
    if (!pinVerified || !draftLoadedRef.current) return;
    const s = odo(sOdo), e = odo(eOdo);
    apiFetch(`/attendance/draft/${employeeId}`, {
      method: "PATCH",
      body: JSON.stringify({
        departure: serializeDep(rts),
        arrival: serializeArr(rts),
        startOdometer: s !== null && Number.isFinite(s) ? s : null,
        endOdometer: e !== null && Number.isFinite(e) ? e : null,
      }),
    }).then(() => { draftDirtyRef.current = false; }).catch(() => { draftDirtyRef.current = true; });
  }
  function saveDraftLocal(rts: { dep: string; arr: string }[], sOdo: string, eOdo: string) {
    if (!pinVerified || !draftLoadedRef.current) return;
    draftDirtyRef.current = true;
    try {
      localStorage.setItem(draftLsKey(employeeId, shiftDate), JSON.stringify({
        departure: serializeDep(rts), arrival: serializeArr(rts), startOdometer: sOdo, endOdometer: eOdo,
      }));
    } catch { /* ignore */ }
  }

  useEffect(() => { draftValuesRef.current = { routes, startOdometer, endOdometer }; }, [routes, startOdometer, endOdometer]);

  // 画面が裏に回ったら保存、表に戻ったら取り直す（まだ保存できていない値があるときは上書きしない）
  useEffect(() => {
    if (!pinVerified) return;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (!draftLoadedRef.current) return;
        const v = draftValuesRef.current;
        if (draftDirtyRef.current) saveDraftToApi(v.routes, v.startOdometer, v.endOdometer);
      } else if (document.visibilityState === "visible") {
        void flush();
        if (draftLoadedRef.current && !draftDirtyRef.current && !draftFocusedRef.current) {
          apiFetch(`/attendance/draft/${employeeId}`, { cache: "no-store" }).then((data: Draft) => {
            if (!draftDirtyRef.current && !draftFocusedRef.current) applyDraft(data);
          }).catch(() => {});
        }
      }
    };
    const handlePageHide = () => {
      if (!draftLoadedRef.current || !draftDirtyRef.current) return;
      const v = draftValuesRef.current;
      saveDraftToApi(v.routes, v.startOdometer, v.endOdometer);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [pinVerified, employeeId, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // 別の端末で入れた値を15秒ごとに取り直す。入力中・まだ保存できていない値があるときは上書きしない
  // （以前は電波の悪い所で入れた帰着メーターが、サーバーの古い値で上書きされていた）
  useEffect(() => {
    if (!pinVerified) return;
    const t = setInterval(() => {
      if (draftFocusedRef.current || !draftLoadedRef.current) return;
      if (draftDirtyRef.current) { const v = draftValuesRef.current; saveDraftToApi(v.routes, v.startOdometer, v.endOdometer); return; }
      apiFetch(`/attendance/draft/${employeeId}`, { cache: "no-store" }).then((data: Draft) => {
        if (draftFocusedRef.current || draftDirtyRef.current) return;
        applyDraft(data);
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [pinVerified, employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 現在時刻を毎秒更新
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 初回取得 + PIN設定有無の確認
  useEffect(() => {
    fetchData();
    apiFetch(`/employees/${employeeId}/pin/status`)
      .then((res: { pinSet: boolean; verified?: boolean }) => {
        if (!res.pinSet) { setPinSetup(true); return; }
        setPinRequired(true);
        if (res.verified) setPinVerified(true);
      })
      .catch((e) => {
        if (isQrKeyError(String((e as Error)?.message ?? ""))) setQrKeyMissing(true);
        else setPinVerified(true);
      });
    apiFetch(`/attendance/settings/public`).then((s: PublicSettings) => setSettings(s)).catch(() => {});
  }, [fetchData, employeeId]);

  const loadSide = useCallback(() => {
    apiFetch(`/attendance/alcohol/${employeeId}/today`).then((a: AlcoholToday) => setAlcohol(a)).catch(() => {});
    apiFetch(`/attendance/corrections/mine/${employeeId}`).then((c: CorrectionRequest[]) => setMyCorrections(c)).catch(() => {});
  }, [employeeId]);
  useEffect(() => { if (pinVerified) loadSide(); }, [pinVerified, loadSide, shiftDate]);

  // 管理者の操作（打刻の追加・修正・削除）をリアルタイムで受ける（QR ページには「取り直して」の合図が届く）
  useEffect(() => {
    if (!pinVerified) return;
    return openLiveStream(`${BASE}/api/attendance/stream?employeeId=${employeeId}${qrQuery()}`, { onOpen: () => { void fetchData(); }, onMessage: (event) => {
      try {
        const data = JSON.parse(event.data) as { type: "refresh" } | Array<{ employee: { id: number }; records: AttendanceRecord[] }>;
        if (!Array.isArray(data)) { if (data.type === "refresh") { void fetchData(); loadSide(); } return; }
        const mine = data.find(s => s.employee.id === employeeId);
        if (mine) { setServerRecords(mine.records); setLoading(false); }
      } catch { /* ignore */ }
    } });
  }, [employeeId, pinVerified, fetchData, loadSide]);

  // 音声アンロック（最初のユーザー操作で解除）
  useEffect(() => {
    const unlock = () => { unlockAudio(); };
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  // ── メッセージ ──
  const loadMessages = useCallback(() => {
    apiFetch(`/messages/${employeeId}`).then((data: Message[]) => setMessages(data ?? [])).catch(() => {});
    apiFetch(`/messages/${employeeId}/unread-count`).then((data: { unreadCount: number }) => setUnreadCount(data?.unreadCount ?? 0)).catch(() => {});
  }, [employeeId]);
  const markRead = useCallback(() => {
    apiFetch(`/messages/${employeeId}/read`, { method: "POST", body: JSON.stringify({ reader: "employee" }) })
      .then(() => setUnreadCount(0)).catch(() => {});
  }, [employeeId]);

  useEffect(() => {
    if (!pinVerified) return;
    // つながり直したときは、切れていた間のメッセージを取り直す（以前は電波が戻っても届いていなかった）。
    // サーバーの入れ替え中などで切れたままになったら、自分でつなぎ直す。
    return openLiveStream(`${BASE}/api/messages/stream?employeeId=${employeeId}${qrQuery()}`, { onOpen: () => { loadMessages(); }, onMessage: (e) => {
      try {
        const data = JSON.parse(e.data) as { type: string; message: Message };
        if (data.type === "message" && data.message.employeeId === employeeId) {
          setMessages(prev => prev.find(m => m.id === data.message.id) ? prev : [...prev, data.message]);
          if (data.message.sender === "office") {
            playNotificationSound(data.message.id, { conversationId: data.message.employeeId });
            // メッセージを開いている間に届いた分は、その場で既読にする
            if (activeTabRef.current === "messages" && document.visibilityState === "visible") {
              markRead();
              setTimeout(() => msgBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            } else setUnreadCount(c => c + 1);
          }
        }
      } catch { /* ignore */ }
    } });
  }, [employeeId, pinVerified, loadMessages, markRead]);

  useEffect(() => { if (pinVerified) loadMessages(); }, [pinVerified, loadMessages]);

  // ── スマホの通知：許可されていれば黙って登録し直す（許可を求めるのはボタンを押したときだけ） ──
  useEffect(() => {
    if (!pinVerified) return;
    const st = pushState();
    setPush({ state: st, message: null });
    if (st === "granted") void subscribePush(employeeId, qrHeaders(), false);
  }, [employeeId, pinVerified]);
  const enablePush = async () => {
    const r = await subscribePush(employeeId, qrHeaders(), true);
    setPush({ state: r.state, message: r.ok ? (r.replacedEmployeeId ? "この端末の通知を、あなたあてに切り替えました（前に使っていた人には届かなくなります）。" : "通知をオンにしました。") : r.state === "denied" ? null : "通知をオンにできませんでした。" });
  };

  const sendMessage = async () => {
    const content = msgInput.trim();
    if ((!content && msgFiles.length === 0) || msgSending) return;
    setMsgSending(true);
    setMsgError(null);
    // 添付は電波のある所でだけ送れる（写真は端末に溜めておかない）。先に1つずつ上げて番号をもらう
    let attachmentIds: number[] = [];
    if (msgFiles.length) {
      if (!navigator.onLine) { setMsgSending(false); setMsgError("写真・PDFは電波のある所で送ってください（文だけなら端末に溜めて後で送れます）。"); return; }
      try {
        for (const f of msgFiles) attachmentIds.push((await uploadAttachment(BASE, employeeId, f.file, qrHeaders())).id);
      } catch (e) {
        setMsgSending(false);
        setMsgError(e instanceof Error && e.message ? e.message : "写真・PDFを送れませんでした。電波の良いところでもう一度送ってください。");
        return;
      }
    }
    const clientId = newClientId();
    const r = await sendOrQueue({ clientId, employeeId, path: "/messages", body: { employeeId, sender: "employee", content, ...(attachmentIds.length ? { attachmentIds } : {}) }, kind: "message" }, qrHeaders());
    setMsgSending(false);
    if (r.ok) {
      setMsgInput("");
      msgFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setMsgFiles([]);
      const m = r.json as Message;
      setMessages(prev => prev.find(x => x.id === m.id) ? prev : [...prev, m]);
    } else if (r.queued) {
      setMsgInput("");
      setMsgError("電波が無いため、端末に溜めました。電波が戻ったら送ります。");
      void reloadPending();
    } else {
      setMsgError(r.status === 403
        ? "暗証番号が設定されていないため、メッセージを送れません。事務所に暗証番号の設定を頼んでください。"
        : r.error || "送れませんでした。電波の良いところでもう一度送ってください。");
    }
  };

  // メッセージを開いたら既読・下へ
  useEffect(() => {
    if (activeTab === "messages" && pinVerified) {
      markRead();
      setTimeout(() => msgBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [activeTab, employeeId, pinVerified, markRead]);

  // ── 位置の送信と画面の点けっぱなしは、出勤中・休憩中だけ ──
  // （以前は勤務時間外も位置を送り続け、画面も消えなかった）
  useEffect(() => {
    if (!pinVerified || !navigator.geolocation || !working) { setGpsStatus("inactive"); return; }

    const sendPos = (lat: number, lng: number, acc?: number) => {
      const t = Date.now();
      const last = lastPosSentRef.current;
      const dist = last ? Math.hypot(lat - last.lat, lng - last.lng) * 111320 : Infinity;
      if (last && t - last.time < 15000 && dist < 50) return;
      lastPosSentRef.current = { lat, lng, time: t };
      apiFetch("/attendance/location/live", { method: "POST", body: JSON.stringify({ employeeId, latitude: lat, longitude: lng, accuracy: acc }) }).catch(() => {});
    };
    const startWatch = () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsStatus("active");
          latestGpsRef.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, time: Date.now() };
          sendPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        (err) => { if (err.code === err.PERMISSION_DENIED) setGpsStatus("denied"); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
      );
    };
    const acquireWakeLock = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
      } catch { /* 取得失敗は無視 */ }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") { setGpsStatus("active"); startWatch(); acquireWakeLock(); }
      else setGpsStatus("background");
    };
    startWatch();
    acquireWakeLock();
    setGpsStatus("active");
    document.addEventListener("visibilitychange", handleVisibility);
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
      if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      if (liveIntervalRef.current !== null) clearInterval(liveIntervalRef.current);
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pinVerified, employeeId, working]);

  // ── 暗証番号を決める（まだ無い人） ──
  const handleSetupKey = useCallback(async (key: string) => {
    if (pinVerifying) return;
    if (key === "del") { setPinInput(p => p.slice(0, -1)); setPinError(null); return; }
    const next = pinInput + key;
    setPinInput(next);
    setPinError(null);
    if (next.length < 4) return;
    if (pinFirst === null) {
      if (/^(\d)\1{3}$/.test(next) || "0123456789012".includes(next) || "9876543210987".includes(next)) {
        setPinError("同じ数字の繰り返しや「1234」のような並びは使えません");
        setPinInput("");
        return;
      }
      setPinFirst(next);
      setPinInput("");
      return;
    }
    if (next !== pinFirst) {
      setPinError("1回目と違います。はじめから決め直してください");
      setPinFirst(null);
      setPinInput("");
      return;
    }
    setPinVerifying(true);
    try {
      const res = await fetch(`${BASE}/api/employees/${employeeId}/pin/setup`, {
        method: "POST", headers: { "Content-Type": "application/json", ...qrHeaders() }, body: JSON.stringify({ pin: next }),
      });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string };
      if (res.ok && body.ok) {
        setPinSetup(false);
        setPinRequired(true);
        setPinVerified(true);
        fetchData();
        return;
      }
      if (body.code === "pin-already-set") {
        // 別の端末で先に決めた／事務所が設定した → 入力の画面へ
        setPinSetup(false);
        setPinRequired(true);
      }
      setPinError(body.error ?? "決められませんでした。電波の良いところでもう一度入れてください。");
      setPinFirst(null);
      setPinInput("");
    } catch {
      setPinError("決められませんでした。電波の良いところでもう一度入れてください。");
      setPinFirst(null);
      setPinInput("");
    } finally {
      setPinVerifying(false);
    }
  }, [pinInput, pinFirst, pinVerifying, employeeId, fetchData]);

  // ── 暗証番号 ──
  const handlePinKey = useCallback(async (key: string) => {
    if (pinVerifying) return;
    if (pinLockedUntil && pinLockedUntil > Date.now()) return;
    if (key === "del") { setPinInput(p => p.slice(0, -1)); setPinError(null); return; }
    const next = pinInput + key;
    setPinInput(next);
    setPinError(null);
    if (next.length < 4) return;
    setPinVerifying(true);
    try {
      const res = await fetch(`${BASE}/api/employees/${employeeId}/pin/verify`, {
        method: "POST", headers: { "Content-Type": "application/json", ...qrHeaders() }, body: JSON.stringify({ pin: next }),
      });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; minutes?: number; lockedUntil?: string };
      if (res.status === 429) {
        // 続けて間違えたときは、あと何分で入れられるかを出す
        setPinLockedUntil(body.lockedUntil ? new Date(body.lockedUntil).getTime() : Date.now() + (body.minutes ?? 10) * 60000);
        setPinError(body.error ?? "しばらく入力できません");
        setPinInput("");
        return;
      }
      if (res.ok && body.ok) {
        setPinVerified(true);
        fetchData();
      } else {
        setPinError(res.ok ? "PINコードが違います" : body.error ?? "確認できませんでした。電波の良いところでもう一度入れてください。");
        setPinInput("");
        shakeRef.current?.animate(
          [{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
          { duration: 400, easing: "ease-in-out" },
        );
      }
    } catch {
      setPinError("確認できませんでした。電波の良いところでもう一度入れてください。");
      setPinInput("");
    } finally {
      setPinVerifying(false);
    }
  }, [pinInput, pinVerifying, pinLockedUntil, employeeId, fetchData]);

  /** 位置：直近30秒に取れていればそれを使う（打刻を待たせない） */
  const cachedGps = () => {
    const c = latestGpsRef.current;
    return c && Date.now() - c.time < 30000 ? { latitude: c.latitude, longitude: c.longitude } : null;
  };
  /** 打刻のあとで位置を取り、取れたら付け足す */
  const attachLocationLater = (recordId: number) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        apiFetch(`/attendance/records/${recordId}/location`, { method: "PATCH", body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) }).catch(() => {});
      },
      () => {},
      { timeout: 15000, maximumAge: 60000 },
    );
  };

  const lastEndKey = `lastEndOdo_${employeeId}`;

  /** 実際に打刻を送る（確かめ終わったあと） */
  const doPunch = async (eventType: EventType) => {
    setRecording(true);
    setError(null);
    setLastPunch(null);
    const startKm = odo(startOdometer), endKm = odo(endOdometer);
    const gps = cachedGps();
    const note = routes.map(r => [r.dep.trim(), r.arr.trim()].filter(Boolean).join("→")).filter(Boolean).join(" / ") || null;
    const allItems: Record<string, "良" | "否"> = {};
    itemStatus.forEach((v, k) => { allItems[k] = v; });
    const body: Record<string, unknown> = {
      employeeId, eventType, note,
      startOdometer: startKm, endOdometer: endKm,
      latitude: gps?.latitude ?? null, longitude: gps?.longitude ?? null,
      // 出勤のときの点検の内容（以前は items を入れていなかったため、管理画面で中身が見えなかった）
      checklistNgItems: eventType === "clock_in" && checkedCount > 0
        ? JSON.stringify({ total: TOTAL_ITEMS, checked: checkedCount, ng: ngItems.map(i => i.area), items: allItems })
        : null,
      report: eventType === "clock_out" ? {
        shipper: shipper.trim() || null,
        waitingMinutes: waitingMin.trim() === "" ? null : Number(waitingMin),
        vehicle: vehicle || null,
        departure: serializeDep(routes), arrival: serializeArr(routes),
      } : null,
    };
    const clientId = newClientId();
    const item = { clientId, employeeId, path: "/attendance/record", body, kind: "record" as const, createdAt: Date.now() };
    // 先に画面へ出す（押したらすぐ次のボタンが押せるように）
    setPending(p => [...p, { ...item, attempts: 0 }]);
    const r = await sendOrQueue(item, qrHeaders());
    const loc = note ?? "";
    if (r.ok) {
      const rec = r.json as AttendanceRecord & { autoBreakEnd?: AttendanceRecord | null };
      setPending(p => p.filter(x => x.clientId !== clientId));
      setServerRecords(prev => [...prev.filter(x => x.id !== rec.id), ...(rec.autoBreakEnd ? [rec.autoBreakEnd] : []), rec]);
      setLastPunch({ id: rec.id, eventType, at: Date.now() });
      setSuccessMsg(`${EVENT_LABELS[eventType]}を記録しました${loc ? `（${loc}）` : ""}${rec.autoBreakEnd ? "。休憩中だったので休憩終了も入れました" : ""}`);
      if (!gps) attachLocationLater(rec.id);
      void fetchData();
    } else if (r.queued) {
      setSuccessMsg(`${EVENT_LABELS[eventType]}を端末に記録しました（${fmtHM(item.createdAt)}）。電波が戻ったら自動で送ります`);
    } else {
      // 断られた：画面に出した仮の打刻を必ず取り消す（以前は「出勤中」のまま押し直せなかった）
      setPending(p => p.filter(x => x.clientId !== clientId));
      setError(r.error);
      void fetchData();
    }
    if (eventType === "clock_out" && (r.ok || r.queued)) {
      if (endKm !== null && Number.isFinite(endKm)) { try { localStorage.setItem(lastEndKey, String(endKm)); } catch { /* ignore */ } }
      setRoutes([{ dep: "", arr: "" }]);
      setStartOdometer(""); setEndOdometer(""); setShipper(""); setWaitingMin("");
      draftDirtyRef.current = false;
      try { localStorage.removeItem(draftLsKey(employeeId, shiftDate)); } catch { /* ignore */ }
    }
    setRecording(false);
  };

  /** 押したときの確かめ（点検・アルコールチェック・メーター・退勤の確認） */
  const requestPunch = (eventType: EventType, skip: { checklist?: boolean; alcohol?: boolean } = {}) => {
    setError(null);
    const close = () => setChoice(null);
    if (eventType === "clock_in") {
      if (!skip.checklist && !checklistDone) {
        if (settings.requireChecklist) {
          setError(`日常点検がまだです（${checkedCount}/${TOTAL_ITEMS}）。チェックリストを全部つけてから出勤してください。`);
          setActiveTab("checklist");
          return;
        }
        setChoice({
          title: "日常点検がまだです",
          message: <>チェックリストが {checkedCount}/{TOTAL_ITEMS} 項目です。運転する前に点検してください。</>,
          choices: [
            { label: "点検をする", onClick: () => { close(); setActiveTab("checklist"); } },
            { label: "このまま出勤する", tone: "plain", onClick: () => { close(); requestPunch("clock_in", { ...skip, checklist: true }); } },
          ],
        });
        return;
      }
      const hasBefore = alcohol.items.some(a => a.phase === "before");
      if (!skip.alcohol && !hasBefore && !employee?.isOfficeStaff) {
        if (settings.requireAlcohol) {
          afterAlcoholRef.current = () => requestPunch("clock_in", { ...skip, alcohol: true });
          setAlcoholPhase("before");
          return;
        }
        setChoice({
          title: "アルコールチェックがまだです",
          message: "乗る前のアルコールチェックを記録してください（運送業の決まりで1年間残します）。",
          choices: [
            { label: "アルコールチェックを記録する", onClick: () => { close(); afterAlcoholRef.current = () => requestPunch("clock_in", { ...skip, alcohol: true }); setAlcoholPhase("before"); } },
            { label: "このまま出勤する", tone: "plain", onClick: () => { close(); requestPunch("clock_in", { ...skip, alcohol: true }); } },
          ],
        });
        return;
      }
      void doPunch("clock_in");
      return;
    }
    if (eventType === "clock_out") {
      const s = odo(startOdometer), e = odo(endOdometer);
      if (e === null) { setError("退勤するには「帰着時（km）」を入れてください。"); return; }
      if (!Number.isFinite(e) || e < 0 || e > 9999999 || (s !== null && (!Number.isFinite(s) || s < 0 || s > 9999999))) { setError("メーターの数字が正しくありません。"); return; }
      if (s !== null && e < s) { setError("帰着のメーターが出発のメーターより小さくなっています。数字を確かめてください。"); return; }
      const warns: string[] = [];
      if (s !== null && e - s > 1500) warns.push(`走行距離が ${(e - s).toFixed(1)} km になります。桁が多くないか確かめてください。`);
      const prevEnd = Number(localStorage.getItem(lastEndKey) ?? "NaN");
      if (s !== null && Number.isFinite(prevEnd) && s < prevEnd) warns.push(`出発のメーター（${s}）が、前の勤務の帰着（${prevEnd}）より小さくなっています。車を替えていなければ数字を確かめてください。`);
      setChoice({
        title: "退勤しますか？",
        message: (
          <div className="space-y-1.5">
            <p>帰着メーター <b>{e.toLocaleString()} km</b>{s !== null && <>（走行 <b>{(e - s).toFixed(1)} km</b>）</>}</p>
            {status === "休憩中" && <p className="text-amber-700">休憩中です。休憩終了も一緒に入れます。</p>}
            {warns.map(w => <p key={w} className="text-red-700 font-semibold">⚠️ {w}</p>)}
          </div>
        ),
        choices: [
          { label: "退勤する", tone: "danger", onClick: () => { close(); void doPunch("clock_out"); } },
          { label: "やめる", tone: "plain", onClick: close },
        ],
      });
      return;
    }
    void doPunch(eventType);
  };

  // 押して1分以内の取り消し
  const undoSecondsLeft = lastPunch ? Math.max(0, 60 - Math.floor((now.getTime() - lastPunch.at) / 1000)) : 0;
  const undoPunch = async () => {
    if (!lastPunch) return;
    try {
      await apiFetch(`/attendance/records/${lastPunch.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "押し間違いの取り消し（本人）" }) });
      setSuccessMsg(`${EVENT_LABELS[lastPunch.eventType]}を取り消しました`);
    } catch (e) {
      setError(errMessage(e, "取り消せませんでした。「打刻の修正を申請」から直してください。"));
    }
    setLastPunch(null);
    void fetchData();
  };

  const submitAlcohol = async (v: AlcoholValues): Promise<string | null> => {
    const r = await sendOrQueue({ clientId: newClientId(), employeeId, path: "/attendance/alcohol", kind: "alcohol", body: { employeeId, ...v, vehicle: v.vehicle || null, note: v.note || null } }, qrHeaders());
    if (!r.ok && !r.queued) return r.error;
    if (v.vehicle) setVehicle(v.vehicle);
    setAlcohol(a => ({ ...a, lastChecker: v.checker, lastMethod: v.method, items: [...a.items, { id: -Date.now(), phase: v.phase, valueMg: v.valueMg, detected: v.detected, checkedAt: new Date().toISOString() }] }));
    setAlcoholPhase(null);
    setSuccessMsg(r.ok ? "アルコールチェックを記録しました" : "アルコールチェックを端末に記録しました。電波が戻ったら送ります");
    if (v.detected) setError("アルコールを検知しています。運転しないで、すぐ事務所に連絡してください。");
    loadSide();
    const next = afterAlcoholRef.current;
    afterAlcoholRef.current = null;
    if (next && !v.detected) next();
    return null;
  };

  const submitCorrection = async (v: CorrectionValues): Promise<string | null> => {
    try {
      await apiFetch("/attendance/corrections", { method: "POST", body: JSON.stringify({ employeeId, ...v, clientId: newClientId() }) });
    } catch (e) {
      return errMessage(e, "申請できませんでした。電波の良いところでもう一度送ってください。");
    }
    setCorrectionOpen(null);
    setSuccessMsg("修正を申請しました。事務所が確かめると直ります");
    loadSide();
    return null;
  };

  // ボタン有効判定
  const clockInRecord = records.find(r => r.eventType === "clock_in");
  const today = todayJst();
  /** 前の日の勤務が退勤されないまま残っている（14時間を過ぎていれば、今日の出勤もできる） */
  const staleOpen = working && shiftDate < today && clockInRecord && now.getTime() - new Date(clockInRecord.recordedAt).getTime() > 14 * 3600000;
  const canClockIn = status === "未出勤" || !!staleOpen;
  const canBreakStart = status === "出勤中";
  const canBreakEnd = status === "休憩中";
  const canClockOut = working && endOdometer.trim() !== "";

  const elapsedMs = clockInRecord && working ? now.getTime() - new Date(clockInRecord.recordedAt).getTime() : null;
  const elapsedH = elapsedMs !== null ? Math.floor(elapsedMs / 3600000) : 0;
  const elapsedM = elapsedMs !== null ? Math.floor((elapsedMs % 3600000) / 60000) : 0;
  const hasAlcoholBefore = alcohol.items.some(a => a.phase === "before");
  const hasAlcoholAfter = alcohol.items.some(a => a.phase === "after");

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

  if (qrKeyMissing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8 max-w-sm">
          <p className="text-xl font-bold text-amber-700 mb-2">QRコードが新しくなりました</p>
          <p className="text-muted-foreground text-sm leading-relaxed">事務所で新しいQRコードを受け取って、読み取り直してください。（前のQRコードやブックマークからは開けません）</p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <p className="text-xl font-bold text-red-600 mb-2">{error ? "読み込めませんでした" : "社員が見つかりません"}</p>
          <p className="text-muted-foreground mb-4">{error ? "電波の良いところで、もう一度読み込んでください" : "QRコードを確認してください"}</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">読み込み直す</button>
        </div>
      </div>
    );
  }

  // ── PIN入力画面 ───────────────────────────────────────────────
  if ((pinSetup || pinRequired) && !pinVerified) {
    const keys = ["1","2","3","4","5","6","7","8","9","","0","del"];
    const onKey = pinSetup ? handleSetupKey : handlePinKey;
    const lockLeft = pinLockedUntil ? Math.max(0, Math.ceil((pinLockedUntil - now.getTime()) / 1000)) : 0;
    const locked = lockLeft > 0;
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl mb-3">{employee.name[0]}</div>
          <p className="text-xl font-bold">{employee.name}</p>
          <p className="text-sm text-muted-foreground">{employee.department}</p>
        </div>
        <div ref={shakeRef} className="mb-6 text-center">
          {pinSetup ? (
            <div className="mb-4 max-w-[280px]">
              <p className="text-base font-bold text-gray-800">{pinFirst === null ? "暗証番号（4桁）を決めてください" : "確認のため、もう一度入れてください"}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">QRコードだけでは、他の人がスマホで読み取ると打刻できてしまいます。あなただけが知っている4桁を決めてください。忘れたら事務所に連絡してください。</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-4 font-medium">PINコードを入力してください</p>
          )}
          <div className="flex gap-4 justify-center mb-2">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all
                ${i < pinInput.length ? (pinError ? "bg-red-500 border-red-500" : "bg-primary border-primary") : "border-gray-300 bg-transparent"}`} />
            ))}
          </div>
          {locked ? (
            <p className="text-sm text-red-600 font-medium mt-2 max-w-[280px]">
              続けて間違えたため、あと <b>{Math.floor(lockLeft / 60)}分{String(lockLeft % 60).padStart(2, "0")}秒</b> は入力できません。わからないときは事務所に連絡してください。
            </p>
          ) : pinError && <p className="text-sm text-red-600 font-medium mt-2 max-w-[280px]">{pinError}</p>}
          {pinVerifying && <p className="text-sm text-muted-foreground mt-2">確認中...</p>}
        </div>
        <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
          {keys.map((key, idx) => {
            if (key === "") return <div key={idx} />;
            const isDel = key === "del";
            return (
              <button key={idx} onClick={() => onKey(key)}
                disabled={locked || pinVerifying || (!isDel && pinInput.length >= 4)}
                className={`h-16 rounded-2xl text-xl font-bold transition-all active:scale-95 shadow-sm
                  ${isDel ? "bg-gray-200 text-gray-600 hover:bg-gray-300 text-base" : "bg-white border border-gray-200 hover:bg-gray-50 text-gray-800"}
                  disabled:opacity-40`}>
                {isDel ? "⌫" : key}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const shiftLabel = shiftDate !== today ? `${fmtMD(shiftDate)}の勤務` : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-20">
      {/* ヘッダー */}
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">{employee.name[0]}</div>
        <div className="flex-1">
          <p className="font-bold text-lg leading-tight">{employee.name}</p>
          <p className="text-sm text-muted-foreground">{employee.department} · {employee.employeeCode}</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${statusColor[status]}`}>{status}</div>
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
          <p className="text-sm font-medium text-primary mt-1">{shiftLabel ? `${shiftLabel}・` : ""}出勤から {elapsedH}時間{elapsedM}分経過</p>
        )}
        {gpsStatus === "denied" && working && <p className="text-xs text-amber-700 mt-1">位置情報が「許可しない」になっています（打刻はできます）</p>}
      </div>

      {offlineView && (
        <div className="mx-4 mt-3 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5 text-gray-700 text-sm">
          📵 電波がありません。前に読み込んだ内容を出しています。押した打刻は端末に溜めて、電波が戻ったら送ります。
        </div>
      )}

      {/* 溜めている打刻 */}
      {pendingCount > 0 && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-900 text-sm flex items-center gap-2">
          <span className="text-lg">📡</span>
          <span className="flex-1">電波が戻ったら送る記録が <b>{pendingCount}件</b> あります。この画面を閉じても消えません。</span>
          <button type="button" onClick={() => void flush()} className="shrink-0 rounded-md bg-amber-600 text-white px-2.5 py-1 text-xs font-bold">いま送る</button>
        </div>
      )}

      {successMsg && (
        <div className="mx-4 mt-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-center font-medium">✓ {successMsg}</div>
      )}
      {lastPunch && undoSecondsLeft > 0 && (
        <div className="mx-4 mt-2 flex justify-center">
          <button type="button" onClick={undoPunch} className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm">
            ↩ いまの{EVENT_LABELS[lastPunch.eventType]}を取り消す（あと{undoSecondsLeft}秒）
          </button>
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-center">{error}</div>
      )}

      {/* ── 勤怠入力タブ ── */}
      {activeTab === "attendance" && (
        <>
          {staleOpen && (
            <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-2">
              <p className="font-bold">⚠️ {fmtMD(shiftDate)}の勤務が退勤になっていません（出勤 {fmtHM(clockInRecord!.recordedAt)}）</p>
              <p className="text-xs leading-relaxed">退勤を押し忘れたときは、退勤した時刻を申請してから、今日の「出勤」を押してください。</p>
              <button type="button" onClick={() => setCorrectionOpen({ kind: "add", eventType: "clock_out", workDate: shiftDate })}
                className="rounded-lg bg-red-600 text-white px-3 py-2 text-sm font-bold">退勤の時刻を申請する</button>
            </div>
          )}

          {/* 出勤の前の確認（点検・アルコールチェック） */}
          {status === "未出勤" && (
            <div className="mx-4 mt-3 rounded-xl border bg-white px-4 py-3 space-y-2">
              <p className="text-xs font-bold text-gray-500">出勤の前に</p>
              <button type="button" onClick={() => setActiveTab("checklist")} className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
                <span>📋 日常点検</span>
                <span className={`font-bold ${checklistDone ? (ngItems.length ? "text-red-600" : "text-emerald-600") : "text-amber-600"}`}>
                  {checklistDone ? (ngItems.length ? `否 ${ngItems.length}件` : "済み") : `未点検（${checkedCount}/${TOTAL_ITEMS}）`}
                </span>
              </button>
              {!employee.isOfficeStaff && (
                <button type="button" onClick={() => { afterAlcoholRef.current = null; setAlcoholPhase("before"); }} className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
                  <span>🍺 乗る前のアルコールチェック</span>
                  <span className={`font-bold ${hasAlcoholBefore ? "text-emerald-600" : "text-amber-600"}`}>{hasAlcoholBefore ? "記録済み" : "まだ"}</span>
                </button>
              )}
            </div>
          )}

          {/* 発着地入力（複数行対応） */}
          <div className="mx-4 mt-3 mb-1">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">📍 発着地（任意・退勤のとき日報に残ります）</p>
            <div className="space-y-2">
              {routes.map((route, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="flex-1">
                    {idx === 0 && <label className="block text-xs text-muted-foreground mb-1">発地</label>}
                    <input type="text" value={route.dep}
                      onChange={(e) => { const next = routes.map((r, i) => i === idx ? { ...r, dep: e.target.value } : r); setRoutes(next); saveDraftLocal(next, startOdometer, endOdometer); }}
                      onFocus={() => { draftFocusedRef.current = true; }}
                      onBlur={(e) => { draftFocusedRef.current = false; const next = routes.map((r, i) => i === idx ? { ...r, dep: e.target.value } : r); saveDraftToApi(next, startOdometer, endOdometer); }}
                      placeholder="例：本社"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm" />
                  </div>
                  <span className="text-gray-400 text-lg pb-3">→</span>
                  <div className="flex-1">
                    {idx === 0 && <label className="block text-xs text-muted-foreground mb-1">着地</label>}
                    <input type="text" value={route.arr}
                      onChange={(e) => { const next = routes.map((r, i) => i === idx ? { ...r, arr: e.target.value } : r); setRoutes(next); saveDraftLocal(next, startOdometer, endOdometer); }}
                      onFocus={() => { draftFocusedRef.current = true; }}
                      onBlur={(e) => { draftFocusedRef.current = false; const next = routes.map((r, i) => i === idx ? { ...r, arr: e.target.value } : r); saveDraftToApi(next, startOdometer, endOdometer); }}
                      placeholder="例：大阪営業所"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm" />
                  </div>
                  {routes.length > 1 && (
                    <button onClick={() => { const next = routes.filter((_, i) => i !== idx); setRoutes(next); saveDraftLocal(next, startOdometer, endOdometer); saveDraftToApi(next, startOdometer, endOdometer); }}
                      className="pb-3 text-gray-300 hover:text-red-400 transition-colors text-xl leading-none" title="この行を削除">✕</button>
                  )}
                </div>
              ))}
              <button onClick={() => setRoutes([...routes, { dep: "", arr: "" }])}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors px-2 py-1.5 rounded-lg">
                <span className="text-sm">＋</span> 行を追加
              </button>
            </div>
          </div>

          {/* 走行メーター */}
          <div className="mx-4 mt-2 mb-1">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">🚛 走行メーター（出発は出勤のあとでも入れられます・<span className="text-amber-700">退勤には帰着が必要</span>）</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">出発時（km）</label>
                <div className="relative">
                  <input type="number" inputMode="decimal" min="0" value={startOdometer}
                    onChange={(e) => { const v = e.target.value; setStartOdometer(v); saveDraftLocal(routes, v, endOdometer); }}
                    onFocus={() => { draftFocusedRef.current = true; }}
                    onBlur={(e) => { draftFocusedRef.current = false; saveDraftToApi(routes, e.target.value, endOdometer); }}
                    placeholder="例：12345"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 pr-10 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">km</span>
                </div>
              </div>
              <span className="text-gray-400 text-lg mt-4">→</span>
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">帰着時（km）</label>
                <div className="relative">
                  <input type="number" inputMode="decimal" min="0" value={endOdometer}
                    onChange={(e) => { const v = e.target.value; setEndOdometer(v); saveDraftLocal(routes, startOdometer, v); }}
                    onFocus={() => { draftFocusedRef.current = true; }}
                    onBlur={(e) => { draftFocusedRef.current = false; saveDraftToApi(routes, startOdometer, e.target.value); }}
                    placeholder="例：12567"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 pr-10 text-base placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">km</span>
                </div>
              </div>
            </div>
            {(() => {
              const s = odo(startOdometer), e = odo(endOdometer);
              if (s === null || e === null || !Number.isFinite(s) || !Number.isFinite(e)) return null;
              if (e < s) return <div className="mt-1.5 text-center text-sm font-semibold text-red-600">帰着が出発より小さくなっています</div>;
              return <div className={`mt-1.5 text-center text-sm font-semibold ${e - s > 1500 ? "text-red-600" : "text-primary"}`}>走行距離：{(e - s).toFixed(1)} km{e - s > 1500 ? "（桁を確かめてください）" : ""}</div>;
            })()}
            {working && endOdometer.trim() === "" && (
              <div className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                ⚠️ 退勤するには「帰着時（km）」の入力が必要です
              </div>
            )}
          </div>

          {/* 日報（荷主・待機時間）：退勤のときにまとめて残す */}
          {working && (
            <div className="mx-4 mt-2 mb-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">📝 日報（任意・退勤のとき残します）</p>
              <div className="grid grid-cols-2 gap-2">
                {/* 取引先マスターの荷主から選べる（一覧に無ければ打ち込む） */}
                <input type="text" value={shipper} onChange={e => setShipper(e.target.value)} placeholder="荷主（例：A社）" list="shipper-list" aria-label="荷主"
                  className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-base placeholder:text-gray-300 shadow-sm" />
                <datalist id="shipper-list">{(settings?.shippers ?? []).map((n) => <option key={n} value={n} />)}</datalist>
                <div className="relative">
                  <input type="number" inputMode="numeric" min="0" value={waitingMin} onChange={e => setWaitingMin(e.target.value)} placeholder="待機時間"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 pr-10 text-base placeholder:text-gray-300 shadow-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">分</span>
                </div>
              </div>
            </div>
          )}

          {/* 4大ボタン */}
          <div className="flex-1 p-4 grid grid-cols-2 gap-4 content-start mt-2">
            <button onClick={() => requestPunch("clock_in")} disabled={!canClockIn || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canClockIn && !recording ? "bg-green-500 hover:bg-green-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}>
              <span className="text-4xl">🟢</span><span>出勤</span>
            </button>
            <button onClick={() => requestPunch("clock_out")} disabled={!canClockOut || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canClockOut && !recording ? "bg-red-500 hover:bg-red-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}>
              <span className="text-4xl">🔴</span><span>退勤</span>
            </button>
            <button onClick={() => requestPunch("break_start")} disabled={!canBreakStart || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canBreakStart && !recording ? "bg-yellow-500 hover:bg-yellow-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}>
              <span className="text-4xl">🟡</span><span>休憩開始</span>
            </button>
            <button onClick={() => requestPunch("break_end")} disabled={!canBreakEnd || recording}
              className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] text-white font-bold text-xl shadow-md transition-all active:scale-95
                ${canBreakEnd && !recording ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}>
              <span className="text-4xl">🔵</span><span>休憩終了</span>
            </button>
          </div>

          {/* 退勤のあと：乗った後のアルコールチェック */}
          {status === "退勤済" && !hasAlcoholAfter && !employee.isOfficeStaff && (
            <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3">
              <p className="flex-1 text-sm text-amber-900">🍺 乗った後のアルコールチェックを記録してください</p>
              <button type="button" onClick={() => { afterAlcoholRef.current = null; setAlcoholPhase("after"); }} className="shrink-0 rounded-lg bg-amber-600 text-white px-3 py-2 text-sm font-bold">記録する</button>
            </div>
          )}

          {/* いまの勤務の打刻 */}
          {records.length > 0 && (
            <div className="mx-4 mb-2 rounded-xl border bg-white px-4 py-3">
              <p className="text-xs font-bold text-gray-500 mb-2">{shiftLabel ?? "今日"}の打刻</p>
              <ul className="space-y-1">
                {records.map(r => (
                  <li key={r.id} className="flex justify-between text-sm">
                    <span>{EVENT_LABELS[r.eventType]}{r.pending && <span className="ml-1.5 text-xs text-amber-600 font-semibold">（送信待ち）</span>}</span>
                    <span className="font-mono">{fmtHM(r.recordedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mx-4 mb-2 flex justify-center">
            <button type="button" onClick={() => setCorrectionOpen({})} className="text-sm font-semibold text-primary underline underline-offset-4 py-2">
              ✏️ 打刻の修正を申請する{myCorrections.some(c => c.status === "pending") ? `（確認待ち ${myCorrections.filter(c => c.status === "pending").length}件）` : ""}
            </button>
          </div>

          <PushCard state={push.state} message={push.message} onEnable={enablePush} />

          <div className="py-4 text-center">
            <p className="text-xs text-muted-foreground">三川運送 勤怠管理システム</p>
          </div>
        </>
      )}

      {/* ── メッセージタブ ── */}
      {activeTab === "messages" && (
        <div className="flex flex-col flex-1 mx-4 mt-3 mb-3 bg-white rounded-xl border shadow-sm overflow-hidden" style={{ minHeight: "420px" }}>
          <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-3 space-y-2">
            {messages.length === 0 && !pending.some(p => p.kind === "message") ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <span className="text-4xl opacity-30">💬</span>
                <p className="text-sm">メッセージはありません</p>
              </div>
            ) : [...messages, ...pending.filter(p => p.kind === "message").map((p, i): Message => ({ id: -(i + 1), employeeId, sender: "employee", content: String(p.body.content ?? ""), createdAt: new Date(p.createdAt).toISOString(), pending: true }))].map((msg, i, arr) => {
              const isMe = msg.sender === "employee";
              // 日が変わるところに日付の区切りを入れる（時刻だけだと何日のことか分からない）
              const newDay = i === 0 || jstDay(arr[i - 1]!.createdAt) !== jstDay(msg.createdAt);
              return (
                <div key={msg.id} className="space-y-2">
                {newDay && <DaySeparator at={msg.createdAt} />}
                <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  {!isMe && <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold shrink-0 mr-2 mt-1">事</div>}
                  <div className="max-w-[80%]">
                    {!isMe && <p className="text-xs text-muted-foreground mb-1 ml-1">事務所</p>}
                    {msg.content && (
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-white border shadow-sm rounded-tl-sm"} ${msg.pending ? "opacity-60" : ""}`}>
                      {msg.content}
                    </div>
                    )}
                    {(msg.attachments?.length ?? 0) > 0 && (
                      <div className={`${msg.content ? "mt-1.5" : ""} flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <AttachmentView items={msg.attachments!} mine={false}
                          urlOf={(a) => `${BASE}/api/messages/${employeeId}/attachments/${a.id}?x=1${qrQuery()}`} />
                      </div>
                    )}
                    <p className={`text-xs text-muted-foreground mt-1 ${isMe ? "text-right mr-1" : "ml-1"}`}>
                      {msg.pending ? "送信待ち" : fmtHM(msg.createdAt)}
                    </p>
                  </div>
                </div>
                </div>
              );
            })}
            <div ref={msgBottomRef} />
          </div>
          {msgError && <div className="px-3 py-2 border-t bg-red-50 text-red-700 text-xs">{msgError}</div>}
          {msgFiles.length > 0 && <div className="px-3 pt-2 border-t bg-white"><PendingStrip files={msgFiles} onRemove={(key) => setMsgFiles((prev) => { const f = prev.find((x) => x.key === key); if (f?.preview) URL.revokeObjectURL(f.preview); return prev.filter((x) => x.key !== key); })} /></div>}
          <div className="px-3 py-3 border-t bg-white flex gap-2 shrink-0">
            <AttachButton disabled={msgSending} className="w-12 h-12" onFiles={(list) => { const r = addPending(msgFiles, list); setMsgFiles(r.next); setMsgError(r.error); }} />
            <input type="text" value={msgInput} onChange={e => setMsgInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && sendMessage()}
              placeholder="事務所にメッセージを送る..."
              className="flex-1 rounded-xl border px-3 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <button onClick={sendMessage} disabled={(!msgInput.trim() && msgFiles.length === 0) || msgSending}
              className="shrink-0 whitespace-nowrap bg-primary text-primary-foreground rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40 active:scale-95 transition-all">送信</button>
          </div>
        </div>
      )}

      {/* ── チェックリストタブ ── */}
      {activeTab === "checklist" && (
        <div className="mx-4 mt-3 mb-3 bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">日常点検チェックリスト</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold
                ${checklistDone && ngItems.length === 0 ? "bg-green-100 text-green-700" : ngItems.length > 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
                {checkedCount} / {TOTAL_ITEMS}{ngItems.length > 0 && ` (否${ngItems.length}件)`}
              </span>
            </div>
            {shiftLabel && <span className="text-xs text-gray-400">{shiftLabel}</span>}
          </div>
          <div className="px-4 py-3 border-b">
            <VehiclePicker vehicles={settings.vehicles} value={vehicle} onChange={(v) => { checklistTouchedRef.current = true; setVehicle(v); }} />
          </div>
          <div className="h-1.5 bg-gray-100">
            <div className="h-full bg-green-500 transition-all duration-300 rounded-r-full" style={{ width: `${(checkedCount / TOTAL_ITEMS) * 100}%` }} />
          </div>
          <div className="divide-y divide-gray-100">
            {INSPECTION_SECTIONS.map((sec) => (
              <div key={sec.label}>
                <div className="px-4 py-2 bg-gray-50"><p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{sec.label}</p></div>
                {sec.items.map((item) => {
                  const st = itemStatus.get(item.id);
                  return (
                    <div key={item.id} className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${st === "良" ? "bg-green-50" : st === "否" ? "bg-red-50" : "bg-white"}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-tight ${st === "良" ? "text-green-800" : st === "否" ? "text-red-800" : "text-gray-800"}`}>{item.area}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.content}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => setItemResult(item.id, "良")}
                          className={`w-12 h-9 rounded-lg text-sm font-bold border-2 transition-all active:scale-95 ${st === "良" ? "bg-green-500 border-green-500 text-white shadow-sm" : "bg-white border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600"}`}>良</button>
                        <button onClick={() => setItemResult(item.id, "否")}
                          className={`w-12 h-9 rounded-lg text-sm font-bold border-2 transition-all active:scale-95 ${st === "否" ? "bg-red-500 border-red-500 text-white shadow-sm" : "bg-white border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600"}`}>否</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {ngItems.length > 0 && (
              <div className="px-4 py-3 bg-red-50 border-t border-red-100">
                <p className="text-red-700 font-bold text-xs mb-2">⚠️ 異常あり — 事務所に自動で知らせました。事務所の判断を待ってから運行してください</p>
                <ul className="space-y-1">
                  {ngItems.map(item => (
                    <li key={item.id} className="text-xs text-red-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />{item.area}（{item.content}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {checklistDone && ngItems.length === 0 && (
              <div className="px-4 py-4 text-center bg-green-50 border-t border-green-100">
                <p className="text-green-700 font-bold text-sm">✅ 日常点検完了！　今日も１日安全運転で！！</p>
              </div>
            )}
            {checklistDone && ngItems.length > 0 && (
              <div className="px-4 py-3 text-center bg-orange-50 border-t border-orange-100">
                <p className="text-orange-700 font-bold text-sm">⚠️ 点検完了（異常 {ngItems.length}件）　事務所の判断のあとで運行してください</p>
              </div>
            )}
            {!checklistDone && checkedCount > 0 && (
              <div className="px-4 py-3 text-center bg-gray-50 border-t">
                <p className="text-gray-500 text-xs">あと {TOTAL_ITEMS - checkedCount} 項目。全部つけるまでは「未点検」のままです</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── フッターナビゲーション ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50 safe-area-pb" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <button onClick={() => setActiveTab("attendance")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors ${activeTab === "attendance" ? "text-primary" : "text-gray-400"}`}>
          <span className="text-2xl">🟢</span>
          <span className={`text-xs font-semibold ${activeTab === "attendance" ? "text-primary" : "text-gray-400"}`}>勤怠入力</span>
        </button>
        <button onClick={() => { setActiveTab("messages"); setUnreadCount(0); }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors ${activeTab === "messages" ? "text-primary" : "text-gray-400"}`}>
          <div className="relative">
            <span className="text-2xl">💬</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </div>
          <span className={`text-xs font-semibold ${activeTab === "messages" ? "text-primary" : "text-gray-400"}`}>メッセージ</span>
        </button>
        <button onClick={() => setActiveTab("checklist")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors ${activeTab === "checklist" ? "text-primary" : "text-gray-400"}`}>
          <div className="relative">
            <span className="text-2xl">📋</span>
            {checkedCount < TOTAL_ITEMS && (
              <span className="absolute -top-1 -right-2 bg-gray-400 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">{TOTAL_ITEMS - checkedCount}</span>
            )}
          </div>
          <span className={`text-xs font-semibold ${activeTab === "checklist" ? "text-primary" : "text-gray-400"}`}>チェックリスト</span>
        </button>
      </div>

      <ChoiceSheet open={!!choice} title={choice?.title ?? ""} message={choice?.message ?? null} choices={choice?.choices ?? []} onClose={() => setChoice(null)} />
      <AlcoholSheet open={alcoholPhase !== null} phase={alcoholPhase ?? "before"}
        defaultChecker={alcohol.lastChecker ?? ""} defaultMethod={alcohol.lastMethod ?? "face"}
        vehicles={settings.vehicles} defaultVehicle={vehicle}
        onSubmit={submitAlcohol} onClose={() => { setAlcoholPhase(null); afterAlcoholRef.current = null; }} />
      <CorrectionSheet open={correctionOpen !== null} records={serverRecords} shiftDate={shiftDate} mine={myCorrections}
        initial={correctionOpen ?? undefined} onSubmit={submitCorrection} onClose={() => setCorrectionOpen(null)} />
    </div>
  );
}
