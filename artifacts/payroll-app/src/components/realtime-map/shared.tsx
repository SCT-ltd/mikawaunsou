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
}

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
export function makeLiveIcon(color: string, pulse: boolean) {
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
  return new Date(str).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
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
