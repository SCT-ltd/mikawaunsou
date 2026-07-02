import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  EmployeeLocation,
  MapEventLocation,
  FlyToTarget,
  STATUS_COLOR,
  EVENT_CONFIG,
  makeLiveIcon,
  makeEventIcon,
  formatTime,
  formatDateTime,
} from "./shared";

// 初回のみ全ポイントに収まるよう地図を合わせる
function FitBounds({
  locations,
  eventLocations,
}: {
  locations: EmployeeLocation[];
  eventLocations: { latitude: number; longitude: number }[];
}) {
  const map = useMap();
  const hasfit = useRef(false);
  useEffect(() => {
    if (hasfit.current) return;
    const livePoints = locations
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => [l.latitude!, l.longitude!] as [number, number]);
    const evPoints = eventLocations.map((ev) => [ev.latitude, ev.longitude] as [number, number]);
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

// 指定座標へフライ（社員/打刻クリック時）
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

export function MapView({
  withGps,
  allEventLocations,
  flyTarget,
  center,
}: {
  withGps: EmployeeLocation[];
  allEventLocations: MapEventLocation[];
  flyTarget: FlyToTarget | null;
  center: [number, number];
}) {
  return (
    <MapContainer center={center} zoom={10} className="h-full w-full" zoomControl={true}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitBounds locations={withGps} eventLocations={allEventLocations} />
      <FlyToEmployee target={flyTarget} />

      {/* ライブ位置マーカー（現在地・大きいピン） */}
      {withGps.map((emp) => (
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
  );
}
