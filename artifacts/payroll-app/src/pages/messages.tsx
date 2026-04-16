import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Send, MessageSquare, Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Employee {
  id: number;
  employeeCode: string;
  name: string;
  department: string;
}

interface Message {
  id: number;
  employeeId: number;
  sender: "office" | "employee";
  content: string;
  readAt: string | null;
  createdAt: string;
}

interface Conversation {
  employee: Employee;
  latestMessage: Message | null;
  unreadCount: number;
}

function formatTime(str: string): string {
  const d = new Date(str);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "昨日";
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

async function registerPush(employeeId: number | null, role: "office" | "employee") {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${BASE}/api/messages/vapid-public-key`);
    const { publicKey } = await keyRes.json() as { publicKey: string };
    if (!publicKey) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = sub.toJSON();
    await fetch(`${BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        role,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }),
    });
  } catch { /* silent */ }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchConversations = useCallback(async () => {
    const res = await fetch(`${BASE}/api/messages/conversations`);
    if (res.ok) setConversations(await res.json());
  }, []);

  const fetchMessages = useCallback(async (empId: number) => {
    const res = await fetch(`${BASE}/api/messages/${empId}`);
    if (res.ok) setMessages(await res.json());
  }, []);

  // SSE接続
  useEffect(() => {
    const es = new EventSource(`${BASE}/api/messages/stream?employeeId=0`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { type: string; message: Message };
      if (data.type === "message") {
        setMessages(prev => {
          if (prev.find(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        fetchConversations();
      }
    };
    return () => es.close();
  }, [fetchConversations]);

  // 初期読み込み
  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // 選択変更
  useEffect(() => {
    if (selectedId != null) fetchMessages(selectedId);
  }, [selectedId, fetchMessages]);

  // 自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 通知許可状態チェック
  useEffect(() => {
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

  const handleEnablePush = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      await registerPush(null, "office");
      setPushEnabled(true);
    }
  };

  const sendMessage = async () => {
    if (!selectedId || !input.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`${BASE}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, sender: "office", content: input.trim() }),
      });
      setInput("");
      await fetchMessages(selectedId);
      await fetchConversations();
    } finally {
      setSending(false);
    }
  };

  const selected = conversations.find(c => c.employee.id === selectedId);

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden -m-4 md:-m-6 lg:-m-8">

        {/* 左：会話一覧 */}
        <div className="w-72 shrink-0 border-r bg-background flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="font-bold text-sm flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" />メッセージ
            </h2>
            <button
              onClick={handleEnablePush}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title={pushEnabled ? "通知ON" : "通知を有効にする"}
            >
              {pushEnabled
                ? <Bell className="h-4 w-4 text-primary" />
                : <BellOff className="h-4 w-4 text-muted-foreground" />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.map(conv => (
              <button
                key={conv.employee.id}
                className={`w-full text-left px-4 py-3 border-b flex items-start gap-3 hover:bg-muted/50 transition-colors
                  ${selectedId === conv.employee.id ? "bg-primary/8 border-l-2 border-l-primary" : ""}`}
                onClick={() => setSelectedId(conv.employee.id)}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base shrink-0">
                  {conv.employee.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm truncate">{conv.employee.name}</span>
                    {conv.latestMessage && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatTime(conv.latestMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {conv.latestMessage
                      ? `${conv.latestMessage.sender === "office" ? "事務所: " : ""}${conv.latestMessage.content}`
                      : "メッセージなし"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 右：チャット画面 */}
        {selectedId == null ? (
          <div className="flex-1 flex items-center justify-center bg-muted/20">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">従業員を選択してください</p>
              <p className="text-sm mt-1 opacity-60">左のリストから会話を開始できます</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0">
            {/* チャットヘッダー */}
            <div className="px-5 py-3 border-b bg-white flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                {selected?.employee.name[0]}
              </div>
              <div>
                <p className="font-bold text-sm leading-tight">{selected?.employee.name}</p>
                <p className="text-xs text-muted-foreground">{selected?.employee.department} · {selected?.employee.employeeCode}</p>
              </div>
            </div>

            {/* メッセージ一覧 */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
              {messages
                .filter(m => m.employeeId === selectedId)
                .map(msg => {
                  const isOffice = msg.sender === "office";
                  return (
                    <div key={msg.id} className={`flex ${isOffice ? "justify-end" : "justify-start"}`}>
                      {!isOffice && (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0 mr-2 mt-1">
                          {selected?.employee.name[0]}
                        </div>
                      )}
                      <div className={`max-w-[70%] group`}>
                        {!isOffice && (
                          <p className="text-xs text-muted-foreground mb-1 ml-1">{selected?.employee.name}</p>
                        )}
                        {isOffice && (
                          <p className="text-xs text-muted-foreground mb-1 text-right mr-1">事務所</p>
                        )}
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
                          ${isOffice
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-white border shadow-sm rounded-tl-sm text-foreground"
                          }`}>
                          {msg.content}
                        </div>
                        <p className={`text-xs text-muted-foreground mt-1 ${isOffice ? "text-right mr-1" : "ml-1"}`}>
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              <div ref={bottomRef} />
            </div>

            {/* 入力欄 */}
            <div className="px-4 py-3 border-t bg-white shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder={`${selected?.employee.name}さんにメッセージを送る...`}
                  rows={1}
                  className="flex-1 resize-none rounded-xl border bg-muted/30 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-32 overflow-y-auto"
                  style={{ minHeight: "42px" }}
                />
                <Button
                  size="icon"
                  className="h-[42px] w-[42px] rounded-xl shrink-0"
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 ml-1">Enterで送信 · Shift+Enterで改行</p>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
