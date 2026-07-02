import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, ArrowLeft } from "lucide-react";
import { Conversation, Message, Avatar, formatTime } from "./shared";

export function ChatView({
  conversation,
  messages,
  input,
  onInputChange,
  onSend,
  sending,
  onBack,
}: {
  conversation: Conversation | undefined;
  messages: Message[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  onBack: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自動スクロール（メッセージ変化時）
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, conversation?.employee.id]);

  const empId = conversation?.employee.id;
  const name = conversation?.employee.name ?? "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* チャットヘッダー */}
      <div className="px-3 md:px-4 py-2.5 border-b bg-muted/20 flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          className="md:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
          onClick={onBack}
          aria-label="会話一覧へ戻る"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar name={name} />
        <div className="min-w-0">
          <p className="font-bold text-sm leading-tight jp-tight truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {conversation?.employee.department}
            <span className="mx-1 text-slate-300">·</span>
            <span className="font-mono">{conversation?.employee.employeeCode}</span>
          </p>
        </div>
      </div>

      {/* メッセージ一覧 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/70">
        {messages
          .filter((m) => m.employeeId === empId)
          .map((msg) => {
            const isOffice = msg.sender === "office";
            return (
              <div key={msg.id} className={`flex ${isOffice ? "justify-end" : "justify-start"}`}>
                {!isOffice && (
                  <div className="mr-2 mt-1">
                    <Avatar name={name} size="sm" />
                  </div>
                )}
                <div className="max-w-[70%]">
                  <p className={`text-[11px] text-muted-foreground mb-1 ${isOffice ? "text-right mr-1" : "ml-1"}`}>
                    {isOffice ? "事務所" : name}
                  </p>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isOffice
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-white border shadow-sm rounded-tl-sm text-foreground"
                  }`}>
                    {msg.content}
                  </div>
                  <p className={`text-[11px] text-muted-foreground mt-1 amount ${isOffice ? "text-right mr-1" : "ml-1"}`}>
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      {/* 入力欄 */}
      <div className="px-3 md:px-4 py-3 border-t bg-card shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder={`${name}さんにメッセージを送る...`}
            rows={1}
            className="flex-1 resize-none rounded-xl border bg-muted/30 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-32 overflow-y-auto"
            style={{ minHeight: "42px" }}
          />
          <Button size="icon" className="h-[42px] w-[42px] rounded-xl shrink-0" onClick={onSend} disabled={!input.trim() || sending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 ml-1">Enterで送信 · Shift+Enterで改行</p>
      </div>
    </div>
  );
}
