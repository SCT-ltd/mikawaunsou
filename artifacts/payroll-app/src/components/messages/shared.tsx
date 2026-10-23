/* メッセージ機能の共有: 型・時刻フォーマット・アバター */

export interface Employee {
  id: number;
  employeeCode: string;
  name: string;
  department: string;
}

export interface Message {
  id: number;
  employeeId: number;
  sender: "office" | "employee";
  content: string;
  readAt: string | null;
  createdAt: string;
  /** 添付（写真・PDF） */
  attachments?: Array<{ id: number; fileName: string; mime: string; size: number }>;
}

export interface Conversation {
  employee: Employee;
  latestMessage: Message | null;
  unreadCount: number;
}

// 時刻はいつも日本時間で出す
const TZ = "Asia/Tokyo";
/** 日本時間の日付（YYYY-MM-DD） */
export function jstDay(str: string | number | Date): string {
  return new Date(str).toLocaleDateString("sv-SE", { timeZone: TZ });
}
/** 時分（14:05） */
export function formatHM(str: string): string {
  return new Date(str).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
/**
 * 会話の一覧に出す時刻。以前は昨日より前だと「昨日」「10/21」だけで時分が無かった。
 *   今日＝14:05／昨日＝昨日 14:05／それより前＝10/21 14:05（年が違えば 2025/10/21 14:05）
 */
export function formatTime(str: string): string {
  const day = jstDay(str), today = jstDay(Date.now()), yday = jstDay(Date.now() - 86400000);
  const hm = formatHM(str);
  if (day === today) return hm;
  if (day === yday) return `昨日 ${hm}`;
  const [y, m, d] = day.split("-").map(Number);
  return `${y === Number(today.slice(0, 4)) ? "" : `${y}/`}${m}/${d} ${hm}`;
}
/** チャットの日付の区切り（今日／昨日／10月21日（火）） */
export function formatDayLabel(str: string): string {
  const day = jstDay(str);
  if (day === jstDay(Date.now())) return "今日";
  if (day === jstDay(Date.now() - 86400000)) return "昨日";
  const d = new Date(str);
  const sameYear = day.slice(0, 4) === jstDay(Date.now()).slice(0, 4);
  return d.toLocaleDateString("ja-JP", { timeZone: TZ, ...(sameYear ? {} : { year: "numeric" }), month: "long", day: "numeric", weekday: "short" });
}
/** 日付の区切り線 */
export function DaySeparator({ at }: { at: string }) {
  return (
    <div className="flex items-center gap-3 py-1" data-day-sep="">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium text-muted-foreground px-2 py-0.5 rounded-full bg-muted">{formatDayLabel(at)}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/* ── 落ち着いた単色アバター（他ページと統一） ── */
const AVATAR_TONES = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-10 h-10 text-base" }[size];
  const tone = AVATAR_TONES[(name.charCodeAt(0) ?? 0) % AVATAR_TONES.length];
  return (
    <div className={`${sz} rounded-full ${tone} font-bold flex items-center justify-center shrink-0`}>
      {name[0]}
    </div>
  );
}
