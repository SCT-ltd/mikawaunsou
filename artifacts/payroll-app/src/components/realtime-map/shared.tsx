import L from "leaflet";

/* ── 型 ─────────────────────────────────────────────── */
export type Status = "未出勤" | "出勤中" | "休憩中" | "退勤済";
export type EventType = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface EventLocation {
  eventType: EventType;
  recordedAt: string;
  latitude: number;
  longitude: number;
}

export interface EmployeeLocation {
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
  /** 電話番号（社員マスター） */
  phone?: string | null;
  /** 勤務中なのに位置が届いていない（設定の分数を過ぎた） */
  stale?: boolean;
}

/* ── 道すじ・場所 ───────────────────────────────────── */
export interface TrackPoint { lat: number; lng: number; at: string; acc: number | null }
export interface Stop { lat: number; lng: number; from: string; to: string; minutes: number; place: string | null; ongoing: boolean }
export interface Visit { id: number; placeId: number; placeName: string; arrivedAt: string; leftAt: string | null; minutes: number; employeeId?: number; employeeName?: string | null }
export interface Track {
  date: string;
  points: TrackPoint[];
  distanceKm: number;
  stops: Stop[];
  visits: Visit[];
  events: Array<{ eventType: EventType; recordedAt: string; latitude: number | null; longitude: number | null }>;
  retentionDays: number;
}
export interface MonthDistance { ym: string; days: Array<{ date: string; km: number }>; totalKm: number; monthlyRecordKm: number | null }
export interface Place { id: number; name: string; kind: string; latitude: number; longitude: number; radiusM: number; address: string | null; note: string | null }
export const PLACE_KIND: Record<string, { label: string; color: string }> = {
  site: { label: "現場", color: "#7c3aed" },
  office: { label: "営業所・車庫", color: "#0f766e" },
  shipper: { label: "荷主", color: "#c2410c" },
  other: { label: "そのほか", color: "#475569" },
};

/** 2点の距離（m） */
export function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** 「3分前」「1時間5分前」 */
export function elapsedText(iso: string | null, now: number): string {
  if (!iso) return "";
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "いま";
  if (min < 60) return `${min}分前`;
  return `${Math.floor(min / 60)}時間${min % 60}分前`;
}
export const kmText = (m: number) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);

export interface FlyToTarget {
  lat: number;
  lng: number;
  seq: number;
}

/* 地図に描画する全社員の打刻イベント（社員名を付与） */
export type MapEventLocation = EventLocation & { name: string; employeeId: number };

/* ── 定数（色・バッジ・イベント設定）───────────────── */
export const STATUS_COLOR: Record<Status, string> = {
  "出勤中": "#22c55e",
  "休憩中": "#f59e0b",
  "退勤済": "#94a3b8",
  "未出勤": "#cbd5e1",
};
export const STATUS_BADGE: Record<Status, string> = {
  "出勤中": "bg-green-100 text-green-700 border-green-200",
  "休憩中": "bg-amber-100 text-amber-700 border-amber-200",
  "退勤済": "bg-slate-100 text-slate-500 border-slate-200",
  "未出勤": "bg-slate-100 text-slate-400 border-slate-100",
};
export const EVENT_CONFIG: Record<EventType, { label: string; color: string; emoji: string }> = {
  clock_in:    { label: "出勤",     color: "#16a34a", emoji: "🟢" },
  clock_out:   { label: "退勤",     color: "#dc2626", emoji: "🔴" },
  break_start: { label: "休憩開始", color: "#d97706", emoji: "🟡" },
  break_end:   { label: "休憩終了", color: "#2563eb", emoji: "🔵" },
};

/* ── Leaflet アイコン ───────────────────────────────── */
// ライブ位置マーカー（大・パルス付き）
export function makeLiveIcon(color: string, pulse: boolean, stale = false) {
  if (stale) color = "#ef4444";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
      ${pulse ? `<circle cx="16" cy="16" r="14" fill="${color}" opacity="0.25"/>` : ""}
      <path d="M16 2C9.925 2 5 6.925 5 13c0 8.25 11 25 11 25S27 21.25 27 13C27 6.925 22.075 2 16 2z"
        fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="13" r="${stale ? 7 : 5}" fill="white"/>
      ${stale ? `<text x="16" y="17.5" text-anchor="middle" font-size="12" font-weight="bold" fill="#ef4444" font-family="sans-serif">!</text>` : ""}
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
export function makeEventIcon(eventType: EventType) {
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

/* ── 時刻フォーマット ───────────────────────────────── */
export function formatTime(str: string | null): string {
  if (!str) return "-";
  return new Date(str).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
}

export function formatDateTime(str: string | null): string {
  if (!str) return "-";
  const d = new Date(str);
  const month = d.getMonth() + 1;
  const day   = d.getDate();
  const hh    = String(d.getHours()).padStart(2, "0");
  const mm    = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hh}:${mm}`;
}

/* 氏名・部署での絞り込み */
export function filterLocations(list: EmployeeLocation[], search: string): EmployeeLocation[] {
  const q = search.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (l) =>
      l.name.toLowerCase().includes(q) ||
      (l.department ?? "").toLowerCase().includes(q) ||
      (l.employeeCode ?? "").toLowerCase().includes(q)
  );
}
