import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Users, RefreshCw, Clock, QrCode, Pencil, Trash2, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  employee: {
    id: number;
    employeeCode: string;
    name: string;
    department: string;
  };
  status: Status;
  clockInTime: string | null;
  records: AttendanceRecord[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function toTimeInput(dateStr: string): string {
  const d = new Date(dateStr);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function getElapsed(clockInTime: string | null, now: Date): string {
  if (!clockInTime) return "-";
  const ms = now.getTime() - new Date(clockInTime).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}時間${m}分`;
}

function getElapsedMs(clockInTime: string | null, now: Date): number {
  if (!clockInTime) return 0;
  return now.getTime() - new Date(clockInTime).getTime();
}

const EVENT_LABELS: Record<EventType, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

const EVENT_CHIP_COLORS: Record<EventType, string> = {
  clock_in: "bg-green-100 text-green-800 border-green-200",
  clock_out: "bg-gray-100 text-gray-700 border-gray-200",
  break_start: "bg-yellow-100 text-yellow-800 border-yellow-200",
  break_end: "bg-blue-100 text-blue-700 border-blue-200",
};

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    "未出勤": "bg-gray-100 text-gray-600 border-gray-200",
    "出勤中": "bg-green-100 text-green-700 border-green-200",
    "休憩中": "bg-yellow-100 text-yellow-700 border-yellow-200",
    "退勤済": "bg-blue-100 text-blue-600 border-blue-200",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status]}`}>
      {status}
    </span>
  );
}

function getRowBg(status: Status, elapsedMs: number): string {
  if (status === "休憩中") return "bg-yellow-50";
  if (status === "出勤中" && elapsedMs >= 10 * 3600000) return "bg-red-50";
  if (status === "出勤中" && elapsedMs >= 8 * 3600000) return "bg-orange-50";
  if (status === "退勤済") return "bg-gray-50";
  return "";
}

function getElapsedColor(elapsedMs: number, status: Status): string {
  if (status !== "出勤中" && status !== "休憩中") return "text-muted-foreground";
  if (elapsedMs >= 10 * 3600000) return "text-red-600 font-bold";
  if (elapsedMs >= 8 * 3600000) return "text-orange-600 font-semibold";
  return "text-foreground";
}

export default function AttendancePage() {
  const [data, setData] = useState<EmployeeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [now, setNow] = useState(new Date());
  const [qrEmployee, setQrEmployee] = useState<EmployeeStatus["employee"] | null>(null);

  // 打刻修正ダイアログ用 state
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [editEmployeeName, setEditEmployeeName] = useState("");
  const [editEventType, setEditEventType] = useState<EventType>("clock_in");
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // REST取得（手動更新・フォールバック用）
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/attendance/today`);
      if (!res.ok) return;
      const result = await res.json();
      setData(result);
      setLastUpdated(new Date());
    } catch {
      // サイレントに失敗
    } finally {
      setLoading(false);
    }
  }, []);

  // SSE（打刻を即時受信）+ 10秒ポーリング（フォールバック）
  useEffect(() => {
    fetchData();
    const es = new EventSource(`${BASE}/api/attendance/stream`);
    es.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data) as EmployeeStatus[];
        setData(result);
        setLastUpdated(new Date());
        setLoading(false);
      } catch { /* ignore */ }
    };
    const poll = setInterval(fetchData, 10000);
    return () => { es.close(); clearInterval(poll); };
  }, [fetchData]);

  // 1秒ごとに現在時刻を更新（経過時間表示用）
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 修正ダイアログを開く
  const openEdit = (record: AttendanceRecord, employeeName: string) => {
    setEditRecord(record);
    setEditEmployeeName(employeeName);
    setEditEventType(record.eventType);
    setEditTime(toTimeInput(record.recordedAt));
    setDeleteConfirm(false);
  };

  // 修正を保存
  const saveEdit = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      // recordedAt: 今日の日付 + 入力時刻
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
    } finally {
      setSaving(false);
    }
  };

  // レコードを削除
  const deleteRecord = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/attendance/records/${editRecord.id}`, { method: "DELETE" });
      setEditRecord(null);
      setDeleteConfirm(false);
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const counts = {
    total: data.length,
    working: data.filter(d => d.status === "出勤中").length,
    breaking: data.filter(d => d.status === "休憩中").length,
    absent: data.filter(d => d.status === "未出勤").length,
    left: data.filter(d => d.status === "退勤済").length,
  };

  const qrUrl = qrEmployee
    ? `${window.location.origin}${BASE}/driver/${qrEmployee.id}`
    : "";

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">勤怠ダッシュボード</h2>
              <p className="text-sm text-muted-foreground">
                最終更新: {lastUpdated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            更新
          </Button>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-700">{counts.working}</p>
            <p className="text-sm text-green-600 font-medium mt-1">出勤中</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-yellow-700">{counts.breaking}</p>
            <p className="text-sm text-yellow-600 font-medium mt-1">休憩中</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-600">{counts.absent}</p>
            <p className="text-sm text-gray-500 font-medium mt-1">未出勤</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{counts.left}</p>
            <p className="text-sm text-blue-500 font-medium mt-1">退勤済</p>
          </div>
        </div>

        {/* 色の凡例 */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200 inline-block" />休憩中</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-200 inline-block" />8時間以上（長時間注意）</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block" />10時間以上（要確認）</span>
          <span className="flex items-center gap-1.5 ml-auto"><Pencil className="h-3 w-3" />打刻チップをクリックで修正</span>
        </div>

        {/* テーブル */}
        {loading ? (
          <div className="py-16 text-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground">読み込み中...</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">社員</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">部署</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">状況</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground hidden sm:table-cell">出勤時刻</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    <span className="flex items-center justify-center gap-1"><Clock className="h-3.5 w-3.5" />経過時間</span>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">本日の打刻</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">QR</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map(d => {
                  const ms = getElapsedMs(d.clockInTime, now);
                  const showElapsed = d.status === "出勤中" || d.status === "休憩中";
                  return (
                    <tr key={d.employee.id} className={`transition-colors ${getRowBg(d.status, ms)}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
                            {d.employee.name[0]}
                          </div>
                          <div>
                            <p className="font-medium">{d.employee.name}</p>
                            <p className="text-xs text-muted-foreground">{d.employee.employeeCode}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {d.employee.department}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums hidden sm:table-cell">
                        {formatTime(d.clockInTime)}
                      </td>
                      <td className={`px-4 py-3 text-center tabular-nums ${getElapsedColor(ms, d.status)}`}>
                        {showElapsed ? getElapsed(d.clockInTime, now) : "-"}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1.5">
                          {d.records.map(r => (
                            <button
                              key={r.id}
                              onClick={() => openEdit(r, d.employee.name)}
                              className={`group inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium transition-all hover:shadow-sm hover:brightness-95 cursor-pointer ${EVENT_CHIP_COLORS[r.eventType as EventType]}`}
                              title="クリックして修正"
                            >
                              <span>{EVENT_LABELS[r.eventType as EventType]}</span>
                              <span className="tabular-nums">{formatTime(r.recordedAt)}</span>
                              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                            </button>
                          ))}
                          {d.records.length === 0 && <span className="text-xs text-muted-foreground">なし</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setQrEmployee(d.employee)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-muted transition-colors"
                          title="QRコードを表示"
                        >
                          <QrCode className="h-4 w-4 text-muted-foreground" />
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

      {/* 打刻修正ダイアログ */}
      <Dialog open={!!editRecord} onOpenChange={(open) => { if (!open) { setEditRecord(null); setDeleteConfirm(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              打刻修正
            </DialogTitle>
          </DialogHeader>

          {editRecord && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{editEmployeeName}</span> さんの打刻を修正します
              </p>

              <div className="space-y-2">
                <Label>打刻種別</Label>
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

              <div className="space-y-2">
                <Label>打刻時刻</Label>
                <Input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                />
              </div>

              {/* 削除確認 */}
              {deleteConfirm ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-3">
                  <p className="text-sm text-red-700 font-medium">本当にこの打刻を削除しますか？</p>
                  <p className="text-xs text-red-600">削除すると元に戻せません。</p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      onClick={deleteRecord}
                      disabled={saving}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      削除する
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setDeleteConfirm(false)}
                      disabled={saving}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter className="gap-2 flex-row">
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 mr-auto"
              onClick={() => setDeleteConfirm(true)}
              disabled={saving || deleteConfirm}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              削除
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setEditRecord(null); setDeleteConfirm(false); }} disabled={saving}>
              キャンセル
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={saving}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QRコードダイアログ */}
      <Dialog open={!!qrEmployee} onOpenChange={(open) => !open && setQrEmployee(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{qrEmployee?.name} さんのQRコード</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrEmployee && (
              <>
                <div className="p-4 bg-white border rounded-xl">
                  <QRCode value={qrUrl} size={220} />
                </div>
                <p className="text-xs text-muted-foreground text-center break-all">{qrUrl}</p>
                <p className="text-sm text-center text-muted-foreground">
                  このQRコードをスマホで読み取ると<br />打刻ページが開きます
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
