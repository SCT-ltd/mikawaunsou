import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Pencil, Trash2, Save,
  ChevronLeft, ChevronRight, CalendarDays, Users, List, GanttChart, ListChecks,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import QRCode from "react-qr-code";
import {
  EventType,
  AbsenceType,
  AbsenceRecord,
  AttendanceRecord,
  EmployeeStatus,
  todayJST,
  nowTimeJST,
  isFuture,
  formatDateJP,
  addDays,
  toTimeInput,
  RichDatePicker,
  isNextDayOf,
  toIsoAt,
} from "@/components/attendance/shared";
import { Link } from "wouter";
import { EmployeeList, filterAttendance } from "@/components/attendance/employee-list";
import { DetailPanel } from "@/components/attendance/detail-panel";
import { StatusFilter, TimelineView, attentionOf, type FilterKey } from "@/components/attendance/board";
import { TimeField } from "@/components/ui/time-field";
import { TodoView } from "@/components/attendance/todo";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * 勤怠ダッシュボード（マスターディテール型）。
 * 左: 社員リスト（検索・状態・経過）、右: 選択社員の詳細（情報カード・打刻タイムライン）。
 * SSE＋ポーリング・ドラッグ並べ替え・GPS・集計などのロジックは旧テーブル型 UI から変更なし。
 */
export default function AttendancePage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new URLSearchParams(window.location.search).get("date");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayJST() ? d : todayJST();
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarPos, setCalendarPos] = useState({ top: 0, left: 0 });
  const calendarBtnRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<EmployeeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [now, setNow] = useState(new Date());

  const [selectedId, setSelectedId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("emp")) || null);
  const [search, setSearch] = useState("");
  /** 状態で絞り込む（全員／出勤中／…／要確認） */
  const [statusFilter, setStatusFilter] = useState<FilterKey>("all");
  /** 見え方：一覧（左に社員・右に詳細）／タイムライン（全員の1日を帯で並べる）。端末に覚えておく */
  type View = "list" | "timeline" | "todo";
  const [view, setViewState] = useState<View>(() => {
    try { const v = localStorage.getItem("mk_att_view"); return v === "timeline" || v === "todo" ? v : "list"; } catch { return "list"; }
  });
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem("mk_att_view", v); } catch { /* ignore */ } };
  /** 一覧に「未点検」の札を出すか（勤怠の設定） */
  const [showUninspected, setShowUninspected] = useState(true);
  useEffect(() => {
    fetch(`${BASE}/api/attendance/settings/public`).then((r) => r.json()).then((s: { showUninspected?: boolean }) => setShowUninspected(s.showUninspected !== false)).catch(() => {});
  }, []);

  // QR ダイアログ
  const [qrEmployee, setQrEmployee] = useState<EmployeeStatus["employee"] | null>(null);

  // 打刻編集ダイアログ
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [editEventType, setEditEventType] = useState<EventType>("clock_in");
  const [editTime, setEditTime] = useState("");
  const [editDate, setEditDate] = useState("");
  /** 翌日の時刻（日をまたいだ退勤など）。勤務日はそのままで、時刻だけ翌日にする */
  const [editNextDay, setEditNextDay] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // 欠勤・休暇
  const [absences, setAbsences] = useState<AbsenceRecord[]>([]);

  const isToday = selectedDate === todayJST();

  /* ── データ取得 ──────────────────────── */
  const fetchData = useCallback(async (date: string) => {
    try {
      // 今日を見ているときは日付を付けない＝社員ごとに「いまの勤務の日付」（深夜に前の日の勤務が続いていればその日）。
      // 以前は今日の日付で全員を見ていたため、深夜は勤務中の人まで「未出勤」に見えた。
      const url = date === todayJST() ? `${BASE}/api/attendance/today` : `${BASE}/api/attendance/today?date=${date}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const result: EmployeeStatus[] = await res.json();
      setData(result);
      setLastUpdated(new Date());
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

  // 日付が変わったら再取得
  useEffect(() => {
    setLoading(true);
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
      } catch { /* ignore */ }
    };
    const poll = setInterval(() => fetchData(selectedDate), 10000);
    return () => { es.close(); clearInterval(poll); };
  }, [isToday, selectedDate, fetchData]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── 選択社員（data から常に最新を導出）─────────── */
  const live = isToday;
  const searched = useMemo(() => filterAttendance(data, search), [data, search]);
  // 17人ほどなので毎回数え直してよい（要確認は時刻で変わる＝打ち忘れ・休憩の長さ）
  const filtered = searched.filter((d) =>
    statusFilter === "all" ? true : statusFilter === "attention" ? attentionOf(d, now, live).length > 0 : d.status === statusFilter);
  const selected = useMemo(
    () => data.find((d) => d.employee.id === selectedId) ?? null,
    [data, selectedId]
  );

  // 初回ロード時（デスクトップのみ）先頭社員を自動選択（一度きり。
  // 以降は selectedId=null でも再選択しない＝閉じるボタンを機能させる）
  const didInitSelectRef = useRef(false);
  useEffect(() => {
    if (didInitSelectRef.current || data.length === 0) return;
    didInitSelectRef.current = true;
    // タイムラインのときは、詳細を横に並べられる広い画面だけ（狭いと帯が隠れる）
    if (selectedId === null && window.matchMedia(view === "timeline" ? "(min-width: 1280px)" : "(min-width: 768px)").matches) {
      setSelectedId(data[0].employee.id);
    }
  }, [data, selectedId]);

  // 選択中の社員が data から消えた（退職等でSSE更新）場合は選択解除。
  // これがないと selectedId 非null・selected null でモバイルが空白の袋小路になる。
  useEffect(() => {
    if (selectedId !== null && data.length > 0 && !data.some((d) => d.employee.id === selectedId)) {
      setSelectedId(null);
    }
  }, [data, selectedId]);

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (filtered.length === 0) return;
      const idx = filtered.findIndex((d) => d.employee.id === selectedId);
      const nextIdx = idx === -1 ? 0 : Math.min(filtered.length - 1, Math.max(0, idx + delta));
      setSelectedId(filtered[nextIdx].employee.id);
    },
    [filtered, selectedId]
  );

  // Ctrl(⌘)+↑↓ で社員切り替え（入力欄フォーカス中は無効）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveSelection]);

  /* ── 打刻編集 ──────────────────────── */
  const openEdit = (r: AttendanceRecord) => {
    setEditRecord(r);
    setEditEventType(r.eventType);
    setEditTime(toTimeInput(r.recordedAt));
    setEditDate(r.workDate);
    setEditNextDay(isNextDayOf(r.recordedAt, r.workDate));
    setDeleteConfirm(false);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editRecord) return;
    setEditError(null);
    if (!editDate) { setEditError("日付を入力してください"); return; }
    const recordedAt = toIsoAt(editDate, editTime, editNextDay);
    if (new Date(recordedAt).getTime() > Date.now() + 60_000) { setEditError("未来の時刻は登録できません"); return; }
    const dateChanged = editDate !== editRecord.workDate;
    setSaving(true);
    try {
      const body: Record<string, string | boolean> = { eventType: editEventType, recordedAt };
      if (dateChanged) body.workDate = editDate;
      let res = await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // 打刻の順番が合わない（退勤のあとに休憩 など）ときは、確かめてから保存する
      if (res.status === 409) {
        const err = await res.clone().json().catch(() => ({}));
        if (err.canForce && window.confirm(`${err.error}\n\n順番が合いませんが、このまま保存しますか？`)) {
          res = await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, force: true }),
          });
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEditError(err.error ?? "保存に失敗しました");
        return;
      }
      setEditRecord(null);
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  };

  const deleteRec = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      // 消さずに「取り消し」の印を付けて残す（だれが・いつ消したかは打刻の変更の記録に残る）
      await fetch(`${BASE}/api/attendance/records/${editRecord.id}?reason=${encodeURIComponent("管理画面で削除")}`, { method: "DELETE" });
      setEditRecord(null);
      setDeleteConfirm(false);
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  };

  /* ── 手動追加（DetailPanel から呼ばれる。error文字列 or null を返す）── */
  const handleAddRecord = useCallback(
    async (eventType: EventType, time: string, nextDay: boolean): Promise<string | null> => {
      if (!selected) return "社員が選択されていません";
      // 勤務日はその行の勤務日（深夜に前の日の勤務が続いていれば前の日）。翌日の時刻なら1日足す。
      const workDate = selected.workDate ?? selectedDate;
      const recordedAt = toIsoAt(workDate, time, nextDay);
      if (new Date(recordedAt).getTime() > Date.now() + 60_000) return "未来の時刻は登録できません";
      setSaving(true);
      try {
        const body = { employeeId: selected.employee.id, eventType, recordedAt, workDate };
        let res = await fetch(`${BASE}/api/attendance/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          const err = await res.clone().json().catch(() => ({}));
          if (err.canForce && window.confirm(`${err.error}\n\n順番が合いませんが、このまま追加しますか？`)) {
            res = await fetch(`${BASE}/api/attendance/record`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, force: true }),
            });
          }
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return body.error ?? "保存に失敗しました";
        }
        await fetchData(selectedDate);
        return null;
      } finally { setSaving(false); }
    },
    [selected, selectedDate, fetchData]
  );

  /* ── 欠勤登録（成功で true）── */
  const handleSaveAbsence = useCallback(
    async (absenceType: AbsenceType, note: string): Promise<boolean> => {
      if (!selected) return false;
      setSaving(true);
      try {
        const res = await fetch(`${BASE}/api/absences`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: selected.employee.id,
            absenceType,
            workDate: selectedDate,
            note: note || null,
          }),
        });
        const body = await res.json().catch(() => ({})) as { warning?: string | null; error?: string };
        if (!res.ok) { window.alert(body.error ?? "登録できませんでした"); return false; }
        // 1日休みなのに出勤もある・休みが重なっている ときは知らせる（登録はしてある）
        if (body.warning) window.alert(body.warning);
        await fetchAbsences(selectedDate);
        return true;
      } finally { setSaving(false); }
    },
    [selected, selectedDate, fetchAbsences]
  );

  const deleteAbsence = useCallback(async (id: number) => {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/absences/${id}`, { method: "DELETE" });
      await fetchAbsences(selectedDate);
    } finally { setSaving(false); }
  }, [selectedDate, fetchAbsences]);

  const swapAbsences = useCallback((employeeId: number, indexA: number, indexB: number) => {
    if (indexA === indexB) return;
    setAbsences((prev) => {
      const empAbsences = prev.filter((a) => a.employeeId === employeeId);
      if (indexA < 0 || indexB < 0 || indexA >= empAbsences.length || indexB >= empAbsences.length) return prev;
      const others = prev.filter((a) => a.employeeId !== employeeId);
      const reordered = [...empAbsences];
      [reordered[indexA], reordered[indexB]] = [reordered[indexB], reordered[indexA]];
      return [...others, ...reordered];
    });
  }, []);

  /* ── ドラッグ並び替え（打刻の時刻を交換）── */
  const swapRecordTimes = useCallback(async (indexA: number, indexB: number) => {
    if (!selected || indexA === indexB) return;
    const recs = selected.records;
    const a = recs[indexA];
    const b = recs[indexB];
    if (!a || !b) return;

    // 楽観的更新：ドロップ直後にUIを即反映（時刻を交換）
    const optimisticRecs = recs.map((r, i) => {
      if (i === indexA) return { ...r, recordedAt: b.recordedAt };
      if (i === indexB) return { ...r, recordedAt: a.recordedAt };
      return r;
    });
    setData((prev) => prev.map((d) => d.employee.id === selected.employee.id ? { ...d, records: optimisticRecs } : d));

    setSaving(true);
    try {
      // 2つを1回で入れ替える（以前は2回に分けて直していたため、途中の順番の確認で断られることがあった）
      let res = await fetch(`${BASE}/api/attendance/records/swap`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: a.id, b: b.id }),
      });
      if (res.status === 409) {
        const err = await res.clone().json().catch(() => ({}));
        if (err.canForce && window.confirm(`${err.error}\n\n順番が合いませんが、入れ替えますか？`)) {
          res = await fetch(`${BASE}/api/attendance/records/swap`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: a.id, b: b.id, force: true }),
          });
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error) window.alert(err.error);
      }
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  }, [selected, selectedDate, fetchData]);

  /* ── 修正申請を決める（承認して直す／見送る） ── */
  const decideCorrection = useCallback(async (id: number, approve: boolean, note: string): Promise<string | null> => {
    setSaving(true);
    try {
      let res = await fetch(`${BASE}/api/attendance/corrections/${id}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, note }),
      });
      if (res.status === 409) {
        const err = await res.clone().json().catch(() => ({}));
        if (err.canForce && window.confirm(`${err.error}\n\n順番が合いませんが、このまま直しますか？`)) {
          res = await fetch(`${BASE}/api/attendance/corrections/${id}/decide`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, note, force: true }),
          });
        }
      }
      if (!res.ok) { const e = await res.json().catch(() => ({})); return e.error ?? "できませんでした"; }
      await fetchData(selectedDate);
      return null;
    } finally { setSaving(false); }
  }, [fetchData, selectedDate]);

  /* ── 日常点検の「否」への処置と判断 ── */
  const decideInspection = useCallback(async (id: number, officeAction: string, officeDecision: "ok" | "ng" | null) => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/attendance/inspections/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeAction, officeDecision }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); window.alert(e.error ?? "保存できませんでした"); }
      await fetchData(selectedDate);
    } finally { setSaving(false); }
  }, [fetchData, selectedDate]);

  /* ── 集計 ──────────────────────────── */
  const counts: Record<FilterKey, number> = {
    all: searched.length,
    "出勤中": searched.filter((d) => d.status === "出勤中").length,
    "休憩中": searched.filter((d) => d.status === "休憩中").length,
    "退勤済": searched.filter((d) => d.status === "退勤済").length,
    "未出勤": searched.filter((d) => d.status === "未出勤").length,
    attention: searched.filter((d) => attentionOf(d, now, live).length > 0).length,
  };

  const qrAttendancePath = qrEmployee?.isOfficeStaff ? "office" : "driver";
  // QRは「公開ホスト」を指さなければならない。管理画面は Cloudflare Access の背後にあるため、
  // window.location.origin（＝admin.…）でQRを作るとドライバーが Access に弾かれて打刻できない。
  // VITE_PUBLIC_ORIGIN（公開ホストのURL）が設定されていればそれを使う。未設定なら従来どおり現在のオリジン。
  const publicOrigin = import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin;
  // QR の合言葉（?k=）を入れる。合言葉の無い URL では開けない（番号を順に試すだけで他人の打刻ができないように）
  const [qrKeyOverride, setQrKeyOverride] = useState<Record<number, string>>({});
  const qrKeyNow = qrEmployee ? (qrKeyOverride[qrEmployee.id] ?? (qrEmployee as { qrKey?: string | null }).qrKey ?? "") : "";
  const qrUrl = qrEmployee ? `${publicOrigin}${BASE}/${qrAttendancePath}/${qrEmployee.id}${qrKeyNow ? `?k=${encodeURIComponent(qrKeyNow)}` : ""}` : "";
  const rotateQrKey = async () => {
    if (!qrEmployee) return;
    if (!window.confirm(`${qrEmployee.name}さんのQRコードを作り直しますか？\n前のQRコードは使えなくなります（スマホを替えた・なくした・退職したときに使います）。`)) return;
    const res = await fetch(`${BASE}/api/employees/${qrEmployee.id}/qr-key/rotate`, { method: "POST" });
    if (!res.ok) { window.alert("作り直せませんでした"); return; }
    const data = (await res.json()) as { qrKey: string };
    setQrKeyOverride((m) => ({ ...m, [qrEmployee.id]: data.qrKey }));
  };

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        {/* ── ツールバー ── */}
        <div className="shrink-0 pb-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-1 h-7 rounded-full bg-indigo-500 shrink-0" />
              <h2 className="text-base md:text-lg font-bold jp-tight leading-tight">勤怠ダッシュボード</h2>
              {isToday && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 tracking-wider uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />LIVE
                </span>
              )}
              <span className="hidden lg:inline text-[11px] text-muted-foreground">
                {isToday
                  ? `最終更新 ${lastUpdated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "過去の日を表示中（打刻の追加・修正・休みの登録ができます）"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {/* 日付ナビゲーション */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900">
                <button
                  onClick={() => setSelectedDate((d) => addDays(d, -1))}
                  className="px-2.5 py-2 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors border-r border-slate-100 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
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
                        const vw = window.innerWidth;
                        const calWidth = Math.min(380, vw - 16);
                        const halfWidth = calWidth / 2;
                        const padding = 8;
                        const desiredLeft = r.left + r.width / 2;
                        const clampedLeft = Math.max(halfWidth + padding, Math.min(vw - halfWidth - padding, desiredLeft));
                        setCalendarPos({ top: r.bottom + 6, left: clampedLeft });
                      }
                      setCalendarOpen((o) => !o);
                    }}
                    className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors min-w-[180px] text-center flex items-center justify-center gap-1.5 jp-tight dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                    {formatDateJP(selectedDate)}
                  </button>
                  {calendarOpen && createPortal(
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setCalendarOpen(false)} />
                      <div className="fixed z-50 -translate-x-1/2" style={{ top: calendarPos.top, left: calendarPos.left }}>
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
                  onClick={() => setSelectedDate((d) => addDays(d, 1))}
                  disabled={isToday}
                  className="px-2.5 py-2 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors border-l border-slate-100 disabled:opacity-30 disabled:cursor-not-allowed dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                  title="次の日"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {!isToday && (
                <Button variant="outline" size="sm" onClick={() => setSelectedDate(todayJST())} className="text-xs">今日</Button>
              )}
              <Button variant="outline" size="sm" onClick={() => fetchData(selectedDate)} className="gap-1.5 border-slate-200">
                <RefreshCw className="h-3.5 w-3.5" />更新
              </Button>
              <Link href={`/attendance-month?y=${selectedDate.slice(0, 4)}&m=${Number(selectedDate.slice(5, 7))}`}>
                <Button variant="outline" size="sm" className="gap-1.5 border-slate-200">月の勤怠表</Button>
              </Link>
              <Link href="/attendance-records">
                <Button variant="outline" size="sm" className="gap-1.5 border-slate-200">
                  修正申請・アルコール・日報{(() => { const n = data.reduce((s, d) => s + (d.pendingCorrections ?? 0), 0); return n > 0 ? <span className="ml-1 rounded-full bg-red-500 text-white text-[10px] px-1.5">{n}</span> : null; })()}
                </Button>
              </Link>
            </div>
          </div>

          {/* 状態で絞り込む札＋見え方の切り替え */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0"><StatusFilter value={statusFilter} onChange={setStatusFilter} counts={counts} /></div>
            <div className="shrink-0 self-end sm:self-auto flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5" role="tablist" aria-label="見え方">
              {([["todo", "やること", ListChecks], ["list", "一覧", List], ["timeline", "タイムライン", GanttChart]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-semibold transition-colors ${view === v ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"}`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 2ペイン本体 ── */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border bg-card">
            <div className="w-10 h-10 border-[3px] border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          </div>
        ) : data.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm rounded-xl border bg-card">
            社員が見つかりません
          </div>
        ) : (
          view === "todo" ? (
            <div className="flex-1 min-h-0 rounded-xl border bg-card overflow-hidden">
              <TodoView
                refreshKey={lastUpdated.getTime()}
                onChanged={() => { void fetchData(selectedDate); void fetchAbsences(selectedDate); }}
                onOpen={(date, id) => { setSelectedDate(date); setSelectedId(id); setStatusFilter("all"); setView("list"); }}
              />
            </div>
          ) : (
          <div className="flex-1 min-h-0 flex md:gap-4">
            {/* 左ペイン: 社員リスト */}
            <div
              className={view === "timeline"
                ? `${selectedId !== null ? "hidden xl:flex" : "flex"} flex-1 min-w-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden`
                : `${selectedId !== null ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-[23rem] shrink-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden`}
            >
              {view === "timeline" ? (
                <TimelineView
                  rows={filtered}
                  now={now}
                  live={live}
                  workDate={selectedDate}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  absences={absences}
                />
              ) : (
                <EmployeeList
                  data={data}
                  filtered={filtered}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  now={now}
                  absences={absences}
                  search={search}
                  onSearchChange={setSearch}
                  live={live}
                  workDate={selectedDate}
                  showUninspected={showUninspected}
                />
              )}
            </div>

            {/* 右ペイン: 詳細 */}
            <div className={view === "timeline"
              ? `${selectedId === null ? "hidden xl:flex" : "flex"} w-full xl:w-[27rem] shrink-0 flex-col min-h-0`
              : `${selectedId === null ? "hidden md:flex" : "flex"} flex-1 min-w-0 flex-col min-h-0`}>
              {selected ? (
                <div className="flex flex-col h-full min-h-0 rounded-xl border bg-card overflow-hidden">
                  <DetailPanel
                    key={`${selected.employee.id}:${selected.workDate ?? selectedDate}`}
                    selected={selected}
                    now={now}
                    saving={saving}
                    isToday={isToday}
                    absences={absences}
                    onEditRecord={openEdit}
                    onSwapRecords={swapRecordTimes}
                    onSwapAbsences={swapAbsences}
                    onDeleteAbsence={deleteAbsence}
                    onAddRecord={handleAddRecord}
                    onSaveAbsence={handleSaveAbsence}
                    onShowQR={setQrEmployee}
                    onClose={() => setSelectedId(null)}
                    onDecideInspection={decideInspection}
                    onDecideCorrection={decideCorrection}
                  />
                </div>
              ) : (
                <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-2 rounded-xl border bg-card text-muted-foreground">
                  <Users className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm">左のリストから社員を選択してください</p>
                </div>
              )}
            </div>
          </div>
          )
        )}
      </div>

      {/* ── 打刻修正ダイアログ ── */}
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <TimeField
                  value={editTime}
                  onChange={(v) => { setEditTime(v); setEditError(null); }}
                  className="h-9 w-full"
                  aria-label="打刻の時刻"
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={editNextDay} onChange={(e) => { setEditNextDay(e.target.checked); setEditError(null); }} />
                  翌日の時刻（日をまたいだ退勤など。勤務日はそのまま）
                </label>
              </div>

              {editError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{editError}</p>
              )}

              {deleteConfirm && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-sm text-red-700 font-medium">この打刻を削除しますか？（集計から外れます。消した記録は残ります）</p>
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
                <Button variant="outline" size="sm" onClick={() => setEditRecord(null)} disabled={saving}>キャンセル</Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  <Save className="h-3.5 w-3.5 mr-1" />保存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── QRダイアログ ── */}
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
                <p className="text-sm text-center text-muted-foreground">スマホで読み取ると打刻ページが開きます</p>
                {!qrKeyNow && <p className="text-xs text-center text-red-600">QRの合言葉がまだありません。画面を読み込み直してください。</p>}
                <button type="button" onClick={rotateQrKey} className="text-xs text-muted-foreground underline hover:text-foreground">QRコードを作り直す（前のQRを使えなくする）</button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
