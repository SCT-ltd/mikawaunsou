import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RefreshCw, MapPin, WifiOff, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";
type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";

interface EventLocation {
  eventType: EventType;
  recordedAt: string;
  latitude: number;
  longitude: number;
}

interface EmployeeLocation {
  employeeId: number;
  employeeCode: string;
  name: string;
  department: string;
  status: Status;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  lastUpdated: string | null;
  eventLocations: EventLocation[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_COLOR: Record<Status, string> = {
  "出勤中": "#22c55e",
  "休憩中": "#f59e0b",
  "退勤済": "#94a3b8",
  "未出勤": "#cbd5e1",
};
const STATUS_BADGE: Record<Status, string> = {
  "出勤中": "bg-green-100 text-green-700 border-green-200",
  "休憩中": "bg-amber-100 text-amber-700 border-amber-200",
  "退勤済": "bg-slate-100 text-slate-500 border-slate-200",
  "未出勤": "bg-slate-100 text-slate-400 border-slate-100",
};

// 打刻イベントの表示設定
const EVENT_CONFIG: Record<EventType, { label: string; color: string; emoji: string }> = {
  clock_in:    { label: "出勤",     color: "#16a34a", emoji: "🟢" },
  clock_out:   { label: "退勤",     color: "#dc2626", emoji: "🔴" },
  break_start: { label: "休憩開始", color: "#d97706", emoji: "🟡" },
  break_end:   { label: "休憩終了", color: "#2563eb", emoji: "🔵" },
};

// ライブ位置マーカー（大・パルス付き）
function makeLiveIcon(color: string, pulse: boolean) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
      ${pulse ? `<circle cx="16" cy="16" r="14" fill="${color}" opacity="0.25"/>` : ""}
      <path d="M16 2C9.925 2 5 6.925 5 13c0 8.25 11 25 11 25S27 21.25 27 13C27 6.925 22.075 2 16 2z"
        fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="13" r="5" fill="white"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  });
}

// 打刻地点マーカー（小・四角バッジ）
function makeEventIcon(eventType: EventType) {
  const { color, label } = EVENT_CONFIG[eventType];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 20" width="48" height="20">
      <rect x="1" y="1" width="46" height="18" rx="4" fill="${color}" stroke="white" stroke-width="1.5"/>
      <text x="24" y="14" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif" font-weight="bold">${label}</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [48, 20],
    iconAnchor: [24, 20],
    popupAnchor: [0, -22],
  });
}

function FitBounds({ locations, eventLocations }: {
  locations: EmployeeLocation[];
  eventLocations: { latitude: number; longitude: number }[];
}) {
  const map = useMap();
  const hasfit = useRef(false);
  useEffect(() => {
    if (hasfit.current) return;
    const livePoints = locations
      .filter(l => l.latitude != null && l.longitude != null)
      .map(l => [l.latitude!, l.longitude!] as [number, number]);
    const evPoints = eventLocations.map(ev => [ev.latitude, ev.longitude] as [number, number]);
    const allPoints = [...livePoints, ...evPoints];
    if (allPoints.length === 0) return;
    if (allPoints.length === 1) {
      map.setView(allPoints[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [60, 60] });
    }
    hasfit.current = true;
  }, [locations, eventLocations, map]);
  return null;
}

interface FlyToTarget {
  lat: number;
  lng: number;
  seq: number;
}

function FlyToEmployee({ target }: { target: FlyToTarget | null }) {
  const map = useMap();
  const prevSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!target) return;
    if (prevSeq.current === target.seq) return;
    prevSeq.current = target.seq;
    map.flyTo([target.lat, target.lng], 16, { animate: true, duration: 1 });
  }, [target, map]);
  return null;
}

function formatTime(str: string | null): string {
  if (!str) return "-";
  return new Date(str).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(str: string | null): string {
  if (!str) return "-";
  const d = new Date(str);
  const month = d.getMonth() + 1;
  const day   = d.getDate();
  const hh    = String(d.getHours()).padStart(2, "0");
  const mm    = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hh}:${mm}`;
}

/* ── 凡例（共通）────────────────────────────── */
function Legend() {
  return (
    <div className="px-4 py-3 border-t bg-muted/30">
      <p className="text-xs font-bold text-muted-foreground mb-2">凡例</p>
      <div className="grid grid-cols-2 gap-1">
        {(["出勤中", "休憩中", "退勤済"] as Status[]).map(s => (
          <div key={s} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
            <span className="text-xs text-muted-foreground">{s} (現在地)</span>
          </div>
        ))}
        {(Object.entries(EVENT_CONFIG) as [EventType, typeof EVENT_CONFIG[EventType]][]).map(([, cfg]) => (
          <div key={cfg.label} className="flex items-center gap-1.5">
            <span className="text-xs">{cfg.emoji}</span>
            <span className="text-xs text-muted-foreground">{cfg.label}地点</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 社員リストパネル（共通本体）─────────────── */
interface EmployeePanelProps {
  withGps: EmployeeLocation[];
  withoutGps: EmployeeLocation[];
  selectedId: number | null;
  loading: boolean;
  hasAnyData: boolean;
  elapsedLabel: (gpsTime: string | null) => string;
  onEmpClick: (emp: EmployeeLocation) => void;
  onEventClick: (ev: EventLocation) => void;
  onSelectGpslessEmp: (emp: EmployeeLocation) => void;
  showHeader?: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
}

function EmployeePanel({
  withGps,
  withoutGps,
  selectedId,
  loading,
  hasAnyData,
  elapsedLabel,
  onEmpClick,
  onEventClick,
  onSelectGpslessEmp,
  showHeader = true,
  lastUpdated,
  onRefresh,
}: EmployeePanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {showHeader && (
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-sm">リアルタイムマップ</h2>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground mt-0.5">
                更新: {formatTime(lastUpdated.toISOString())}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            更新
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* GPS位置表示中の従業員 */}
        {withGps.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wide">
              📍 GPS取得済み ({withGps.length}名)
            </p>
            {withGps.map(emp => (
              <div
                key={emp.employeeId}
                className={`border-b last:border-0 transition-colors ${
                  selectedId === emp.employeeId
                    ? "bg-primary/8 border-l-2 border-l-primary"
                    : ""
                }`}
              >
                {/* 社員行 — クリックでライブ位置へ移動 */}
                <div
                  className="px-4 py-2.5 cursor-pointer hover:bg-muted/50 active:bg-muted"
                  onClick={() => onEmpClick(emp)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white" style={{ backgroundColor: STATUS_COLOR[emp.status] }} />
                      <span className="text-sm font-semibold truncate">{emp.name}</span>
                    </div>
                    <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[emp.status]}`}>
                      {emp.status}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-4.5 space-y-0.5">
                    <p className="text-xs text-muted-foreground">{emp.department}</p>
                    {emp.lastUpdated && (
                      <p className="text-xs text-muted-foreground">
                        現在地更新: {formatTime(emp.lastUpdated)}（{elapsedLabel(emp.lastUpdated)}）
                      </p>
                    )}
                    {emp.accuracy != null && (
                      <p className="text-xs text-muted-foreground/60">精度: ±{Math.round(emp.accuracy)}m</p>
                    )}
                  </div>
                </div>

                {/* 打刻地点一覧 */}
                {(emp.eventLocations ?? []).length > 0 && (
                  <div className="px-4 pb-2 pl-7 space-y-1">
                    {(emp.eventLocations ?? []).map((ev, i) => {
                      const cfg = EVENT_CONFIG[ev.eventType];
                      return (
                        <button
                          key={i}
                          onClick={() => onEventClick(ev)}
                          className="w-full text-left flex items-center gap-1.5 text-xs hover:underline group"
                          title="クリックで打刻地点へ移動"
                        >
                          <span style={{ color: cfg.color }} className="font-bold shrink-0">{cfg.emoji}</span>
                          <span className="font-medium text-muted-foreground group-hover:text-foreground">{cfg.label}</span>
                          <span className="text-muted-foreground/70">{formatDateTime(ev.recordedAt)}</span>
                          <MapPin className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0 ml-auto" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* GPS未取得の従業員 */}
        {withoutGps.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <WifiOff className="h-3 w-3" /> GPS未取得 ({withoutGps.length}名)
            </p>
            {withoutGps.map(emp => {
              const evs = emp.eventLocations ?? [];
              const hasEvents = evs.length > 0;
              return (
                <div
                  key={emp.employeeId}
                  className={`border-b last:border-0 transition-colors ${
                    selectedId === emp.employeeId ? "bg-primary/8 border-l-2 border-l-primary" : ""
                  } ${hasEvents ? "" : "opacity-60"}`}
                >
                  {/* 社員行 — 打刻地点があればクリック可能 */}
                  <div
                    className={`px-4 py-2.5 ${hasEvents ? "cursor-pointer hover:bg-muted/50 active:bg-muted" : ""}`}
                    onClick={() => {
                      if (!hasEvents) return;
                      onSelectGpslessEmp(emp);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-300" />
                        <span className="text-sm font-semibold truncate">{emp.name}</span>
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[emp.status]}`}>
                        {emp.status}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-4.5 space-y-0.5">
                      <p className="text-xs text-muted-foreground">{emp.department}</p>
                      <p className="text-xs text-muted-foreground/60 flex items-center gap-1">
                        <WifiOff className="h-2.5 w-2.5" />
                        {hasEvents ? `打刻地点 ${evs.length}件（クリックで表示）` : "リアルタイムGPS未取得"}
                      </p>
                    </div>
                  </div>

                  {/* 打刻地点一覧（GPS取得済み社員と同じ） */}
                  {hasEvents && (
                    <div className="px-4 pb-2 pl-7 space-y-1">
                      {evs.map((ev, i) => {
                        const cfg = EVENT_CONFIG[ev.eventType];
                        return (
                          <button
                            key={i}
                            onClick={() => onEventClick(ev)}
                            className="w-full text-left flex items-center gap-1.5 text-xs hover:underline group"
                            title="クリックで打刻地点へ移動"
                          >
                            <span style={{ color: cfg.color }} className="font-bold shrink-0">{cfg.emoji}</span>
                            <span className="font-medium text-muted-foreground group-hover:text-foreground">{cfg.label}</span>
                            <span className="text-muted-foreground/70">{formatDateTime(ev.recordedAt)}</span>
                            <MapPin className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0 ml-auto" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {loading && !hasAnyData && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            読み込み中...
          </div>
        )}

        {!loading && !hasAnyData && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2 px-4 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground/30" />
            <p>表示できる社員データがありません</p>
          </div>
        )}
      </div>

      <Legend />
    </div>
  );
}

export default function RealtimeMapPage() {
  const [locations, setLocations] = useState<EmployeeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());
  const [flyTarget, setFlyTarget] = useState<FlyToTarget | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const fetchLocations = async () => {
    try {
      const res = await fetch(`${BASE}/api/attendance/location/live`);
      if (!res.ok) throw new Error("fetch error");
      const data: EmployeeLocation[] = await res.json();
      setLocations(data);
      setLastUpdated(new Date());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const withGps = locations.filter(l => l.latitude != null && l.longitude != null);
  const withoutGps = locations.filter(l => l.latitude == null);

  const defaultCenter: [number, number] = [35.681236, 139.767125];

  const elapsedLabel = (gpsTime: string | null): string => {
    if (!gpsTime) return "";
    const diff = now.getTime() - new Date(gpsTime).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min}分前`;
    const h = Math.floor(min / 60);
    return `${h}時間${min % 60}分前`;
  };

  const handleEmpClick = (emp: EmployeeLocation) => {
    if (emp.latitude == null || emp.longitude == null) return;
    setSelectedId(emp.employeeId);
    setFlyTarget({ lat: emp.latitude, lng: emp.longitude, seq: Date.now() });
    setMobileListOpen(false);
  };

  const handleEventClick = (ev: EventLocation) => {
    setFlyTarget({ lat: ev.latitude, lng: ev.longitude, seq: Date.now() });
    setMobileListOpen(false);
  };

  const handleSelectGpslessEmp = (emp: EmployeeLocation) => {
    const evs = emp.eventLocations ?? [];
    if (evs.length === 0) return;
    setSelectedId(emp.employeeId);
    setFlyTarget({ lat: evs[0].latitude, lng: evs[0].longitude, seq: Date.now() });
    setMobileListOpen(false);
  };

  // 地図に表示する全員の全打刻イベント（eventLocations が未定義のデータに備えてデフォルトを設定）
  const allEventLocations = locations.flatMap(emp =>
    (emp.eventLocations ?? []).map(ev => ({ ...ev, name: emp.name, employeeId: emp.employeeId }))
  );

  const hasAnyData = locations.length > 0;
  const liveCount = withGps.length;

  const panelProps: EmployeePanelProps = {
    withGps,
    withoutGps,
    selectedId,
    loading,
    hasAnyData,
    elapsedLabel,
    onEmpClick: handleEmpClick,
    onEventClick: handleEventClick,
    onSelectGpslessEmp: handleSelectGpslessEmp,
    lastUpdated,
    onRefresh: fetchLocations,
  };

  return (
    <AppLayout>
      <div
        className="
          flex flex-col md:flex-row overflow-hidden
          -m-3 md:-m-6 lg:-m-8
          h-[calc(100dvh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)]
        "
      >
        {/* ── デスクトップ サイドパネル ── */}
        <div className="hidden md:flex w-72 shrink-0 border-r bg-background flex-col">
          <EmployeePanel {...panelProps} />
        </div>

        {/* ── 地図エリア ── */}
        <div className="flex-1 relative min-h-0">
          {withGps.length === 0 && allEventLocations.length === 0 && !loading && (
            <div className="absolute inset-0 z-[800] flex flex-col items-center justify-center bg-background/80 pointer-events-none px-6 text-center">
              <MapPin className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-muted-foreground font-medium text-sm">GPS情報を持つ打刻がありません</p>
              <p className="text-muted-foreground/60 text-xs mt-1">従業員が出退勤を記録するとここに表示されます</p>
            </div>
          )}

          {/* モバイル：地図上の上部バー（タイトル + 更新時刻） */}
          <div className="md:hidden absolute top-2 left-2 right-2 z-[800] flex items-center gap-2 pointer-events-none">
            <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-slate-200 px-3 py-2 flex items-center gap-2 pointer-events-auto">
              <MapPin className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <div className="leading-tight min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">リアルタイムマップ</p>
                {lastUpdated && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    更新: {formatTime(lastUpdated.toISOString())}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 p-0 bg-white/95 backdrop-blur-sm shadow-md pointer-events-auto shrink-0"
              onClick={fetchLocations}
              disabled={loading}
              title="更新"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* モバイル：リスト表示ボタン（地図右下） */}
          <button
            type="button"
            onClick={() => setMobileListOpen(true)}
            className="
              md:hidden absolute right-3 bottom-3 z-[800]
              flex items-center gap-2 px-4 py-2.5
              rounded-full shadow-lg
              bg-indigo-600 text-white font-semibold text-sm
              hover:bg-indigo-700 active:scale-95 transition-all
              border-2 border-white
            "
          >
            <Users className="h-4 w-4" />
            社員リスト
            {liveCount > 0 && (
              <span className="bg-white/20 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {liveCount}
              </span>
            )}
          </button>

          <MapContainer
            center={defaultCenter}
            zoom={10}
            className="h-full w-full"
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <FitBounds locations={withGps} eventLocations={allEventLocations} />
            <FlyToEmployee target={flyTarget} />

            {/* ライブ位置マーカー（現在地・大きいピン） */}
            {withGps.map(emp => (
              <Marker
                key={`live-${emp.employeeId}`}
                position={[emp.latitude!, emp.longitude!]}
                icon={makeLiveIcon(STATUS_COLOR[emp.status], emp.status === "出勤中")}
              >
                <Popup>
                  <div className="min-w-[160px]">
                    <p className="font-bold text-sm mb-1">{emp.name}</p>
                    <p className="text-xs text-gray-500 mb-1">{emp.department}</p>
                    <div className="flex items-center gap-1 mb-1">
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLOR[emp.status] + "33", color: STATUS_COLOR[emp.status] }}
                      >
                        {emp.status}（現在地）
                      </span>
                    </div>
                    {emp.lastUpdated && (
                      <p className="text-xs text-gray-600">
                        位置更新: {formatTime(emp.lastUpdated)}
                        {emp.accuracy != null && ` (±${Math.round(emp.accuracy)}m)`}
                      </p>
                    )}
                    {emp.latitude != null && (
                      <a
                        href={`https://www.google.com/maps?q=${emp.latitude},${emp.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline mt-1 block"
                      >
                        Google Maps で開く →
                      </a>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* 打刻地点マーカー（出勤・退勤・休憩 — 小さいバッジ） */}
            {allEventLocations.map((ev, i) => {
              const cfg = EVENT_CONFIG[ev.eventType];
              return (
                <Marker
                  key={`ev-${ev.employeeId}-${ev.eventType}-${i}`}
                  position={[ev.latitude, ev.longitude]}
                  icon={makeEventIcon(ev.eventType)}
                >
                  <Popup>
                    <div className="min-w-[140px]">
                      <p className="font-bold text-sm mb-0.5">{ev.name}</p>
                      <p className="text-xs font-semibold mb-1" style={{ color: cfg.color }}>
                        {cfg.emoji} {cfg.label}地点
                      </p>
                      <p className="text-xs text-gray-600">時刻: {formatDateTime(ev.recordedAt)}</p>
                      <a
                        href={`https://www.google.com/maps?q=${ev.latitude},${ev.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline mt-1 block"
                      >
                        Google Maps で開く →
                      </a>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      {/* ── モバイル ボトムシート（社員リスト）── */}
      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent
          side="bottom"
          className="md:hidden p-0 h-[85dvh] rounded-t-2xl flex flex-col gap-0"
        >
          <SheetHeader className="px-4 py-3 pr-12 border-b shrink-0 flex-row items-center justify-between space-y-0 gap-3">
            <div className="text-left min-w-0">
              <SheetTitle className="text-base">社員リスト</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                {lastUpdated
                  ? `更新: ${formatTime(lastUpdated.toISOString())}`
                  : "読み込み中..."}
              </SheetDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 gap-1 text-xs shrink-0"
              onClick={fetchLocations}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              更新
            </Button>
          </SheetHeader>
          <div className="flex-1 min-h-0 flex flex-col">
            <EmployeePanel {...panelProps} showHeader={false} />
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
