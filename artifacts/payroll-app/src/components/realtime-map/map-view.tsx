import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Polyline, Circle, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  EmployeeLocation,
  MapEventLocation,
  FlyToTarget,
  Place,
  Track,
  STATUS_COLOR,
  EVENT_CONFIG,
  PLACE_KIND,
  makeLiveIcon,
  makeEventIcon,
  formatTime,
  formatDateTime,
  elapsedText,
  kmText,
} from "./shared";

export type PickMode = "none" | "nearest" | "place" | "move";
export interface Nearest { origin: { lat: number; lng: number }; list: Array<{ emp: EmployeeLocation; m: number }> }

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

// 道すじを読み込んだら、その全体が入るように合わせる
function FitTrack({ track }: { track: Track | null }) {
  const map = useMap();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!track || track.points.length === 0) return;
    const key = `${track.date}:${track.points.length}:${track.points[0]!.at}`;
    if (last.current === key) return;
    last.current = key;
    map.fitBounds(L.latLngBounds(track.points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [50, 50], maxZoom: 16 });
  }, [track, map]);
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

// 「近い人を探す」「場所を登録」のときだけ、地図を押した位置を受け取る
function PickHandler({ mode, onPick }: { mode: PickMode; onPick: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    click(e) { if (mode !== "none") onPick(e.latlng.lat, e.latlng.lng); },
  });
  useEffect(() => {
    map.getContainer().style.cursor = mode === "none" ? "" : "crosshair";
  }, [mode, map]);
  return null;
}

const originIcon = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="11" fill="#4f46e5" fill-opacity="0.18" stroke="#4f46e5" stroke-width="2"/><circle cx="14" cy="14" r="3.5" fill="#4f46e5"/></svg>`,
  className: "", iconSize: [28, 28], iconAnchor: [14, 14],
});

export function MapView({
  withGps,
  allEventLocations,
  flyTarget,
  center,
  places,
  showPlaces,
  track,
  nearest,
  pickMode,
  onPick,
  showLabels,
  now,
  onOpenTrack,
}: {
  withGps: EmployeeLocation[];
  allEventLocations: MapEventLocation[];
  flyTarget: FlyToTarget | null;
  center: [number, number];
  places: Place[];
  showPlaces: boolean;
  track: Track | null;
  nearest: Nearest | null;
  pickMode: PickMode;
  onPick: (lat: number, lng: number) => void;
  showLabels: boolean;
  now: number;
  onOpenTrack: (emp: EmployeeLocation) => void;
}) {
  const trackLine = track ? track.points.map((p) => [p.lat, p.lng] as [number, number]) : [];
  return (
    <MapContainer center={center} zoom={10} className="h-full w-full" zoomControl={true}>
      {/* OpenStreetMap はどのサイトから使われているか（リファラー）が無い取得を断る（403「Access blocked」）。
          このサイトは全体で Referrer-Policy: same-origin にしているので、地図の絵の取得だけサイト名（ドメイン）を送る。
          サブドメイン付きの {s}.tile… は今は勧められていないので、1つの名前にしている。 */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        referrerPolicy="strict-origin-when-cross-origin"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitBounds locations={withGps} eventLocations={allEventLocations} />
      <FitTrack track={track} />
      <FlyToEmployee target={flyTarget} />
      <PickHandler mode={pickMode} onPick={onPick} />

      {/* よく行く場所（半径の円） */}
      {showPlaces && places.filter((p) => p.latitude != null && p.longitude != null).map((p) => {
        const k = PLACE_KIND[p.kind] ?? PLACE_KIND["other"]!;
        return (
          <Circle key={`place-${p.id}`} center={[p.latitude!, p.longitude!]} radius={p.radiusM}
            pathOptions={{ color: k.color, weight: 1.5, fillColor: k.color, fillOpacity: 0.12, dashArray: "4 4" }}>
            <Tooltip direction="center" permanent className="!bg-white/90 !border-0 !shadow-sm !text-[10px] !font-semibold !px-1.5 !py-0.5">{p.name}</Tooltip>
          </Circle>
        );
      })}

      {/* 1日の道すじ */}
      {track && trackLine.length > 1 && (
        <>
          <Polyline positions={trackLine} pathOptions={{ color: "#4f46e5", weight: 4, opacity: 0.8 }} />
          <CircleMarker center={trackLine[0]!} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#16a34a", fillOpacity: 1 }}>
            <Tooltip direction="top">はじめ {formatTime(track.points[0]!.at)}</Tooltip>
          </CircleMarker>
          <CircleMarker center={trackLine.at(-1)!} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }}>
            <Tooltip direction="top">おわり {formatTime(track.points.at(-1)!.at)}</Tooltip>
          </CircleMarker>
        </>
      )}
      {track && track.stops.map((s, i) => (
        <CircleMarker key={`stop-${i}`} center={[s.lat, s.lng]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.95 }}>
          <Tooltip direction="top" permanent className="!text-[10px] !font-semibold !px-1.5 !py-0.5">{s.minutes}分</Tooltip>
          <Popup>
            <p className="text-sm font-bold mb-1">止まっていたところ</p>
            <p className="text-xs">{formatTime(s.from)}〜{formatTime(s.to)}（{s.minutes}分）</p>
            {s.place && <p className="text-xs text-gray-600">場所：{s.place}</p>}
          </Popup>
        </CircleMarker>
      ))}

      {/* 近い人を探す */}
      {nearest && (
        <>
          <Marker position={[nearest.origin.lat, nearest.origin.lng]} icon={originIcon} />
          {nearest.list.slice(0, 5).map(({ emp, m }) => (
            <Polyline key={`near-${emp.employeeId}`} positions={[[nearest.origin.lat, nearest.origin.lng], [emp.latitude!, emp.longitude!]]}
              pathOptions={{ color: "#4f46e5", weight: 2, dashArray: "6 6", opacity: 0.7 }}>
              <Tooltip sticky>{emp.name}：{kmText(m)}</Tooltip>
            </Polyline>
          ))}
        </>
      )}

      {/* ライブ位置マーカー（現在地・大きいピン） */}
      {withGps.map((emp) => (
        <Marker
          key={`live-${emp.employeeId}`}
          position={[emp.latitude!, emp.longitude!]}
          icon={makeLiveIcon(STATUS_COLOR[emp.status], emp.status === "出勤中" && !emp.stale, !!emp.stale)}
        >
          {showLabels && (
            <Tooltip direction="top" offset={[0, -38]} permanent
              className={`!px-1.5 !py-0.5 !text-[10px] !font-semibold !leading-tight ${emp.stale ? "!bg-red-50 !text-red-700 !border-red-300" : ""}`}>
              <span data-live-label="">{emp.name.split(/[\s　]/)[0]}・{emp.stale ? `${elapsedText(emp.lastUpdated, now)}から届かない` : elapsedText(emp.lastUpdated, now)}</span>
            </Tooltip>
          )}
          <Popup>
            <div className="min-w-[190px]">
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
              {emp.stale && <p className="text-xs font-semibold text-red-600 mb-1">位置が届いていません（電池切れ・電波なし・打刻ページを閉じた可能性）</p>}
              {emp.lastUpdated && (
                <p className="text-xs text-gray-600">
                  位置更新: {formatTime(emp.lastUpdated)}（{elapsedText(emp.lastUpdated, now)}）
                  {emp.accuracy != null && ` ±${Math.round(emp.accuracy)}m`}
                </p>
              )}
              {/* その場で連絡（メッセージ・電話）と道すじ */}
              <div className="grid grid-cols-2 gap-1.5 mt-2" data-popup-actions="">
                <a href={`/messages?emp=${emp.employeeId}`} className="text-center text-xs font-semibold rounded-md bg-indigo-600 !text-white px-2 py-1.5 no-underline">メッセージ</a>
                {emp.phone
                  ? <a href={`tel:${emp.phone}`} className="text-center text-xs font-semibold rounded-md bg-emerald-600 !text-white px-2 py-1.5 no-underline">電話する</a>
                  : <span className="text-center text-[10px] rounded-md border text-gray-400 px-1 py-1.5" title="社員マスターで電話番号を入れると押せます">電話番号なし</span>}
                <button type="button" onClick={() => onOpenTrack(emp)} className="col-span-2 text-xs font-semibold rounded-md border border-indigo-300 text-indigo-700 px-2 py-1.5 hover:bg-indigo-50">今日の道すじを見る</button>
              </div>
              {emp.latitude != null && (
                <a
                  href={`https://www.google.com/maps?q=${emp.latitude},${emp.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 underline mt-1.5 block"
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
