import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RefreshCw, MapPin, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";

interface EmployeeLocation {
  employeeId: number;
  employeeCode: string;
  name: string;
  department: string;
  status: Status;
  latitude: number | null;
  longitude: number | null;
  lastEventType: string | null;
  lastGpsTime: string | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EVENT_JP: Record<string, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

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

function makeIcon(color: string, pulse: boolean) {
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

function FitBounds({ locations }: { locations: EmployeeLocation[] }) {
  const map = useMap();
  const hasfit = useRef(false);
  useEffect(() => {
    if (hasfit.current) return;
    const points = locations.filter(l => l.latitude != null && l.longitude != null);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude!, points[0].longitude!], 14);
    } else {
      const bounds = L.latLngBounds(points.map(p => [p.latitude!, p.longitude!] as [number, number]));
      map.fitBounds(bounds, { padding: [60, 60] });
    }
    hasfit.current = true;
  }, [locations, map]);
  return null;
}

function formatTime(str: string | null): string {
  if (!str) return "-";
  return new Date(str).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export default function RealtimeMapPage() {
  const [locations, setLocations] = useState<EmployeeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  const fetchLocations = async () => {
    try {
      const res = await fetch(`${BASE}/api/attendance/gps-locations`);
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
    const interval = setInterval(fetchLocations, 30000);
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

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* 左サイドパネル */}
        <div className="w-72 shrink-0 border-r bg-background flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm">リアルタイムマップ</h2>
              {lastUpdated && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  更新: {formatTime(lastUpdated.toISOString())}
                </p>
              )}
            </div>
            <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={fetchLocations} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              更新
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* GPS位置表示中の従業員 */}
            {withGps.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wide">
                  📍 GPS取得済み ({withGps.length}名)
                </p>
                {withGps.map(emp => (
                  <div key={emp.employeeId} className="px-4 py-2.5 border-b last:border-0 hover:bg-muted/50 transition-colors">
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
                      <p className="text-xs text-muted-foreground">
                        {emp.lastEventType ? EVENT_JP[emp.lastEventType] ?? emp.lastEventType : ""}
                        {emp.lastGpsTime ? ` — ${formatTime(emp.lastGpsTime)}（${elapsedLabel(emp.lastGpsTime)}）` : ""}
                      </p>
                    </div>
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
                {withoutGps.map(emp => (
                  <div key={emp.employeeId} className="px-4 py-2 border-b last:border-0 opacity-60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-300" />
                        <span className="text-sm truncate">{emp.name}</span>
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[emp.status]}`}>
                        {emp.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 pl-4.5">{emp.department}</p>
                  </div>
                ))}
              </div>
            )}

            {loading && locations.length === 0 && (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                読み込み中...
              </div>
            )}
          </div>

          {/* 凡例 */}
          <div className="px-4 py-3 border-t bg-muted/30">
            <p className="text-xs font-bold text-muted-foreground mb-2">凡例</p>
            <div className="grid grid-cols-2 gap-1">
              {(["出勤中", "休憩中", "退勤済"] as Status[]).map(s => (
                <div key={s} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
                  <span className="text-xs text-muted-foreground">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 地図エリア */}
        <div className="flex-1 relative">
          {withGps.length === 0 && !loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 pointer-events-none">
              <MapPin className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-muted-foreground font-medium text-sm">GPS情報を持つ打刻がありません</p>
              <p className="text-muted-foreground/60 text-xs mt-1">従業員が出退勤を記録するとここに表示されます</p>
            </div>
          )}
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
            <FitBounds locations={withGps} />
            {withGps.map(emp => (
              <Marker
                key={emp.employeeId}
                position={[emp.latitude!, emp.longitude!]}
                icon={makeIcon(STATUS_COLOR[emp.status], emp.status === "出勤中")}
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
                        {emp.status}
                      </span>
                    </div>
                    {emp.lastEventType && (
                      <p className="text-xs text-gray-600">
                        {EVENT_JP[emp.lastEventType] ?? emp.lastEventType}: {formatTime(emp.lastGpsTime)}
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
          </MapContainer>
        </div>
      </div>
    </AppLayout>
  );
}
