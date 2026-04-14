import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, RefreshCw, Clock, QrCode } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

async function apiFetch(path: string) {
  const res = await fetch(`${BASE}/api${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
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

  const fetchData = useCallback(async () => {
    try {
      const result = await apiFetch("/attendance/today");
      setData(result);
      setLastUpdated(new Date());
    } catch {
      // サイレントに失敗
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回取得＋1分ごとに自動更新
  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  // 1秒ごとに現在時刻を更新（経過時間表示用）
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground hidden lg:table-cell">本日の打刻</th>
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
                        <div className="flex flex-wrap gap-1 justify-center">
                          {d.records.map(r => (
                            <span key={r.id} className="text-xs bg-muted px-1.5 py-0.5 rounded tabular-nums">
                              {EVENT_LABELS[r.eventType]} {formatTime(r.recordedAt)}
                            </span>
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
