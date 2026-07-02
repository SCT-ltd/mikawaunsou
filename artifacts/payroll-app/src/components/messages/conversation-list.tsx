import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { MessageSquare, Megaphone, Bell, BellOff, Search } from "lucide-react";
import { Conversation, Avatar, formatTime } from "./shared";

/** 会話一覧（未読を上に、なければ最新メッセージ順） */
export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
    if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
    const aTime = a.latestMessage?.createdAt ?? "";
    const bTime = b.latestMessage?.createdAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  onOpenBroadcast,
  onEnablePush,
  pushEnabled,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  onSelect: (empId: number) => void;
  search: string;
  onSearchChange: (s: string) => void;
  onOpenBroadcast: () => void;
  onEnablePush: () => void;
  pushEnabled: boolean | null;
}) {
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = sortConversations(conversations);
    if (!q) return base;
    return base.filter(
      (c) =>
        c.employee.name.toLowerCase().includes(q) ||
        (c.employee.department ?? "").toLowerCase().includes(q)
    );
  }, [conversations, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ヘッダー */}
      <div className="px-3 py-2.5 border-b flex items-center justify-between shrink-0">
        <h2 className="font-bold text-sm flex items-center gap-1.5 jp-tight">
          <MessageSquare className="h-4 w-4" />メッセージ
        </h2>
        <div className="flex items-center gap-1">
          <button onClick={onOpenBroadcast} className="p-1.5 rounded-lg hover:bg-amber-50 hover:text-amber-600 transition-colors" title="一斉送信">
            <Megaphone className="h-4 w-4 text-amber-500" />
          </button>
          <button onClick={onEnablePush} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title={pushEnabled ? "通知ON" : "通知を有効にする"}>
            {pushEnabled ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          </button>
        </div>
      </div>

      {/* 検索 */}
      <div className="p-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="氏名・部署で検索"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      {/* 会話一覧 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">会話がありません</div>
        ) : (
          sorted.map((conv) => {
            const hasUnread = conv.unreadCount > 0;
            const isSelected = selectedId === conv.employee.id;
            return (
              <button
                key={conv.employee.id}
                className={`w-full text-left px-3 py-3 border-b border-border/50 flex items-start gap-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset ${
                  isSelected
                    ? "bg-indigo-50 border-l-[3px] border-l-indigo-500"
                    : `border-l-[3px] border-l-transparent hover:bg-muted/40 ${hasUnread ? "bg-blue-50/50" : ""}`
                }`}
                onClick={() => onSelect(conv.employee.id)}
              >
                <div className="relative shrink-0">
                  <Avatar name={conv.employee.name} />
                  {hasUnread && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none amount">
                      {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm truncate jp-tight ${hasUnread ? "font-bold text-foreground" : "font-semibold"} ${isSelected ? "text-indigo-900" : ""}`}>
                      {conv.employee.name}
                    </span>
                    {conv.latestMessage && (
                      <span className="text-[11px] text-muted-foreground shrink-0 amount">
                        {formatTime(conv.latestMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${hasUnread ? "font-semibold text-foreground/80" : "text-muted-foreground"}`}>
                    {conv.latestMessage
                      ? `${conv.latestMessage.sender === "office" ? "自分: " : ""}${conv.latestMessage.content}`
                      : "メッセージなし"}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
