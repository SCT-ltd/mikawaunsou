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
}

export interface Conversation {
  employee: Employee;
  latestMessage: Message | null;
  unreadCount: number;
}

export function formatTime(str: string): string {
  const d = new Date(str);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "昨日";
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
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
