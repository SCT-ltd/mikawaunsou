import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Clock, QrCode, Pencil, Trash2, Save, X,
  UserCheck, Coffee, LogOut, AlarmClock, Plus, GripVertical,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import QRCode from "react-qr-code";

type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";
type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";

interface AttendanceRecord {
  id: number;
  employeeId: number;
  eventType: EventType;
  workDate: string;
  recordedAt: string;
}

interface EmployeeStatus {
  employee: { id: number; employeeCode: string; name: string; department: string };
  status: Status;
  clockInTime: string | null;
  records: AttendanceRecord[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
const STATUS_STYLE: Record<Status, { badge: string; dot: string; rowBg: string }> = {
  "未出勤": { badge: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-300", rowBg: "" },
  "出勤中": { badge: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500", rowBg: "" },
  "休憩中": { badge: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-400", rowBg: "bg-amber-50/50" },
  "退勤済": { badge: "bg-blue-50 text-blue-600 border-blue-100", dot: "bg-blue-400", rowBg: "bg-slate-50/70" },
};

/* ── サブコンポーネント ──────────────────── */
function StatusDot({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${s.dot} ${status === "出勤中" ? "animate-pulse" : ""}`} />
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>{status}</span>
    </span>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-7 h-7 text-sm", md: "w-9 h-9 text-sm", lg: "w-12 h-12 text-base" }[size];
  return (
    <div className={`${sz} rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0`}>
      {name[0]}
    </div>
  );
}

/* ── メインページ ────────────────────────── */
export default function AttendancePage() {
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
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // 手動追加
  const [addMode, setAddMode] = useState(false);
  const [addEventType, setAddEventType] = useState<EventType>("clock_in");
  const [addTime, setAddTime] = useState(() => toTimeInput(new Date().toISOString()));

  // ドラッグ並び替え
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  /* ── データ取得 ──────────────────────── */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/attendance/today`);
      if (!res.ok) return;
      const result: EmployeeStatus[] = await res.json();
      setData(result);
      setLastUpdated(new Date());
      // サイドパネルも更新
      setSelected(prev => prev ? (result.find(r => r.employee.id === prev.employee.id) ?? null) : null);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
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
    const poll = setInterval(fetchData, 10000);
    return () => { es.close(); clearInterval(poll); };
  }, [fetchData]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── 打刻編集 ──────────────────────── */
  const openEdit = (r: AttendanceRecord) => {
    setEditRecord(r);
    setEditEventType(r.eventType);
    setEditTime(toTimeInput(r.recordedAt));
    setDeleteConfirm(false);
  };
  const saveEdit = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      const base = new Date(editRecord.recordedAt);
      const [h, m] = editTime.split(":").map(Number);
      base.setHours(h, m, 0, 0);
      await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: editEventType, recordedAt: base.toISOString() }),
      });
      setEditRecord(null);
      await fetchData();
    } finally { setSaving(false); }
  };
  const deleteRec = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, { method: "DELETE" });
      setEditRecord(null);
      setDeleteConfirm(false);
      await fetchData();
    } finally { setSaving(false); }
  };

  /* ── 手動追加 ──────────────────────── */
  const addRecord = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const d = new Date();
      const [h, m] = addTime.split(":").map(Number);
      d.setHours(h, m, 0, 0);
      await fetch(`${BASE}/api/attendance/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selected.employee.id, eventType: addEventType, recordedAt: d.toISOString() }),
      });
      setAddMode(false);
      await fetchData();
    } finally { setSaving(false); }
  };

  /* ── ドラッグ並び替え ─────────────────── */
  const swapRecordTimes = async (indexA: number, indexB: number) => {
    if (!selected || indexA === indexB) return;
    const recs = selected.records;
    const a = recs[indexA];
    const b = recs[indexB];
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
      await fetchData();
    } finally {
      setSaving(false);
      setDragIndex(null);
      setDragOverIndex(null);
    }
  };

  /* ── 集計 ──────────────────────────── */
  const counts = {
    working: data.filter(d => d.status === "出勤中").length,
    breaking: data.filter(d => d.status === "休憩中").length,
    absent: data.filter(d => d.status === "未出勤").length,
    left: data.filter(d => d.status === "退勤済").length,
  };

  const qrUrl = qrEmployee ? `${window.location.origin}${BASE}/driver/${qrEmployee.id}` : "";
  const panelOpen = !!selected;

  return (
    <AppLayout>
      <div className="flex gap-0 -m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-56px)]">

        {/* ── メインエリア ─────────────────────────────── */}
        <div className={`flex-1 p-4 md:p-6 lg:p-8 min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[420px]" : ""}`}>
          <div className="space-y-5 max-w-5xl">

            {/* ヘッダー */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">勤怠ダッシュボード</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  最終更新: {lastUpdated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  　社員をクリックすると詳細を表示
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />更新
              </Button>
            </div>

            {/* サマリーカード */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "出勤中", value: counts.working, cls: "border-green-200 bg-green-50 text-green-700" },
                { label: "休憩中", value: counts.breaking, cls: "border-amber-200 bg-amber-50 text-amber-700" },
                { label: "未出勤", value: counts.absent, cls: "border-slate-200 bg-slate-50 text-slate-600" },
                { label: "退勤済", value: counts.left, cls: "border-blue-100 bg-blue-50 text-blue-600" },
              ].map(c => (
                <div key={c.label} className={`rounded-xl border p-3 text-center ${c.cls}`}>
                  <p className="text-2xl font-bold tabular-nums">{c.value}</p>
                  <p className="text-xs font-medium mt-0.5">{c.label}</p>
                </div>
              ))}
            </div>

            {/* 社員一覧 */}
            {loading ? (
              <div className="py-16 text-center">
                <div className="w-9 h-9 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">読み込み中...</p>
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b text-xs">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">社員</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">部署</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">状況</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground hidden sm:table-cell">出勤</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />経過</span>
                      </th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">打刻数</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">QR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.map(d => {
                      const ms = elapsedMs(d.clockInTime, now);
                      const isActive = d.status === "出勤中" || d.status === "休憩中";
                      const isSelected = selected?.employee.id === d.employee.id;
                      const rowBg = STATUS_STYLE[d.status].rowBg;
                      const longHour = ms >= 10 * 3600000 ? "bg-red-50" : ms >= 8 * 3600000 ? "bg-orange-50" : "";

                      return (
                        <tr
                          key={d.employee.id}
                          onClick={() => setSelected(isSelected ? null : d)}
                          className={`cursor-pointer transition-all hover:bg-primary/5
                            ${isSelected ? "bg-primary/8 ring-1 ring-inset ring-primary/20" : rowBg || longHour}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={d.employee.name} />
                              <div>
                                <p className="font-semibold leading-tight">{d.employee.name}</p>
                                <p className="text-xs text-muted-foreground">{d.employee.employeeCode}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                            {d.employee.department}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusDot status={d.status} />
                          </td>
                          <td className="px-4 py-3 text-center tabular-nums text-sm hidden sm:table-cell">
                            {fmt(d.clockInTime)}
                          </td>
                          <td className={`px-4 py-3 text-center tabular-nums text-xs font-mono
                            ${ms >= 10 * 3600000 ? "text-red-600 font-bold" : ms >= 8 * 3600000 ? "text-orange-600 font-semibold" : "text-muted-foreground"}`}>
                            {isActive ? elapsedStr(d.clockInTime, now) : "-"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {d.records.length > 0 ? (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                {d.records.length}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setQrEmployee(d.employee)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
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
        <div className={`fixed top-[56px] right-0 bottom-0 w-[420px] bg-background border-l shadow-xl
          flex flex-col transition-transform duration-300 ease-in-out z-30
          ${panelOpen ? "translate-x-0" : "translate-x-full"}`}>

          {selected && (
            <>
              {/* パネルヘッダー */}
              <div className="flex items-start justify-between px-5 py-4 border-b bg-muted/20">
                <div className="flex items-center gap-3">
                  <Avatar name={selected.employee.name} size="lg" />
                  <div>
                    <p className="font-bold text-base">{selected.employee.name}</p>
                    <p className="text-xs text-muted-foreground">{selected.employee.department} · {selected.employee.employeeCode}</p>
                    <div className="mt-1.5">
                      <StatusDot status={selected.status} />
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 出勤情報カード */}
              <div className="px-5 py-4 border-b">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/30 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground mb-0.5">出勤時刻</p>
                    <p className="text-lg font-bold tabular-nums">{fmt(selected.clockInTime)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground mb-0.5">経過時間</p>
                    <p className={`text-lg font-bold tabular-nums
                      ${elapsedMs(selected.clockInTime, now) >= 10 * 3600000 ? "text-red-600" :
                        elapsedMs(selected.clockInTime, now) >= 8 * 3600000 ? "text-orange-600" : ""}`}>
                      {selected.status !== "未出勤" && selected.status !== "退勤済"
                        ? elapsedStr(selected.clockInTime, now) : "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 打刻履歴 */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">本日の打刻履歴</p>
                  <button
                    onClick={() => { setAddMode(true); setAddTime(toTimeInput(new Date().toISOString())); setAddEventType("clock_in"); }}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" />打刻を追加
                  </button>
                </div>

                {/* 手動追加フォーム */}
                {addMode && (
                  <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
                    <p className="text-xs font-medium text-primary">打刻を手動追加</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">種別</Label>
                        <Select value={addEventType} onValueChange={(v) => setAddEventType(v as EventType)}>
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
                        <Input type="time" value={addTime} onChange={(e) => setAddTime(e.target.value)} className="h-8 text-xs" />
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

                {selected.records.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    本日の打刻はありません
                  </div>
                ) : (
                  <div className="relative">
                    {/* タイムライン縦線 */}
                    <div className="absolute left-[18px] top-2 bottom-2 w-px bg-border" />
                    <div className="space-y-3">
                      {selected.records.map((r, i) => (
                        <div
                          key={r.id}
                          className={`flex items-start gap-3 transition-opacity ${dragIndex !== null && dragIndex !== i ? "opacity-60" : ""} ${dragOverIndex === i && dragIndex !== i ? "ring-2 ring-primary ring-offset-1 rounded-lg" : ""}`}
                          draggable
                          onDragStart={() => setDragIndex(i)}
                          onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
                          onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                          onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) swapRecordTimes(dragIndex, i); }}
                        >
                          {/* ドット */}
                          <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0
                            ${EVENT_COLORS[r.eventType as EventType]} border-current`}>
                            {EVENT_ICONS[r.eventType as EventType]}
                          </div>
                          {/* カード */}
                          <div className={`flex-1 rounded-lg border px-3 py-2 ${EVENT_COLORS[r.eventType as EventType]}`}>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold">{EVENT_LABELS[r.eventType as EventType]}</p>
                                <p className="text-base font-bold tabular-nums">{fmt(r.recordedAt)}</p>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => openEdit(r)}
                                  className="p-1.5 rounded hover:bg-black/5 transition-colors opacity-60 hover:opacity-100"
                                  title="修正"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <div
                                  className="p-1.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-70"
                                  title="ドラッグで並び替え"
                                >
                                  <GripVertical className="h-3.5 w-3.5" />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* パネルフッター */}
              <div className="px-5 py-3 border-t flex items-center gap-2 bg-muted/10">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setQrEmployee(selected.employee)}
                >
                  <QrCode className="h-3.5 w-3.5" />QRコード
                </Button>
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
                <Label className="text-xs">打刻時刻</Label>
                <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
              </div>

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
