import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useUnread } from "@/context/unread-context";
import { playNotificationSound, unlockAudio } from "@/lib/notification-sound";
import { MessageSquare } from "lucide-react";
import { Conversation, Message } from "@/components/messages/shared";
import { ConversationList } from "@/components/messages/conversation-list";
import { ChatView } from "@/components/messages/chat-view";
import { BroadcastDialog } from "@/components/messages/broadcast-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function registerPush(employeeId: number | null, role: "office" | "employee") {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${BASE}/api/messages/vapid-public-key`);
    const { publicKey } = await keyRes.json() as { publicKey: string };
    if (!publicKey) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
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
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const selectedIdRef = useRef<number | null>(null);
  const { refreshUnread } = useUnread();

  // 一斉送信
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastDone, setBroadcastDone] = useState<number | null>(null);
  const [broadcastSelected, setBroadcastSelected] = useState<Set<number>>(new Set());

  // selectedIdRef を selectedId と同期
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // ── 音声アンロック（最初のユーザー操作で解除） ──
  useEffect(() => {
    const unlock = () => { unlockAudio(); };
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  const fetchConversations = useCallback(async () => {
    const res = await fetch(`${BASE}/api/messages/conversations`);
    if (res.ok) setConversations(await res.json());
  }, []);

  const fetchMessages = useCallback(async (empId: number) => {
    const res = await fetch(`${BASE}/api/messages/${empId}`);
    if (res.ok) setMessages(await res.json());
  }, []);

  // ── 既読処理 ──
  const markRead = useCallback(async (empId: number) => {
    try {
      await fetch(`${BASE}/api/messages/${empId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reader: "office" }),
      });
      setConversations(prev =>
        prev.map(c => c.employee.id === empId ? { ...c, unreadCount: 0 } : c)
      );
      refreshUnread();
    } catch { /* silent */ }
  }, [refreshUnread]);

  // SSE接続
  useEffect(() => {
    const es = new EventSource(`${BASE}/api/messages/stream?employeeId=0`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type: string; message: Message };
        if (data.type !== "message") return;
        const msg = data.message;

        // 重複排除してメッセージ追加
        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // ── 通知音（社員からのメッセージのみ） ──
        if (msg.sender === "employee") {
          playNotificationSound(msg.id, { conversationId: msg.employeeId });

          // 該当会話を開いていれば即既読
          if (selectedIdRef.current === msg.employeeId) {
            markRead(msg.employeeId);
          } else {
            setConversations(prev =>
              prev.map(c =>
                c.employee.id === msg.employeeId
                  ? { ...c, unreadCount: c.unreadCount + 1, latestMessage: msg }
                  : c
              )
            );
          }
          refreshUnread();
        }

        // 会話一覧の最新メッセージ更新
        fetchConversations();
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [fetchConversations, markRead, refreshUnread]);

  // 初期読み込み
  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // 会話選択時：メッセージ取得 + 既読
  useEffect(() => {
    if (selectedId != null) {
      fetchMessages(selectedId);
      markRead(selectedId);
    }
  }, [selectedId, fetchMessages, markRead]);

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

  const openBroadcast = () => {
    setBroadcastSelected(new Set(conversations.map(c => c.employee.id)));
    setBroadcastText("");
    setBroadcastDone(null);
    setBroadcastOpen(true);
  };

  const toggleBroadcastEmployee = (id: number) => {
    setBroadcastSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleBroadcastAll = () => {
    if (broadcastSelected.size === conversations.length) {
      setBroadcastSelected(new Set());
    } else {
      setBroadcastSelected(new Set(conversations.map(c => c.employee.id)));
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastText.trim() || broadcasting || broadcastSelected.size === 0) return;
    setBroadcasting(true);
    try {
      const res = await fetch(`${BASE}/api/messages/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: broadcastText.trim(),
          employeeIds: Array.from(broadcastSelected),
        }),
      });
      const data = await res.json() as { count: number };
      setBroadcastDone(data.count);
      setBroadcastText("");
      await fetchConversations();
      setTimeout(() => {
        setBroadcastDone(null);
        setBroadcastOpen(false);
      }, 2500);
    } finally {
      setBroadcasting(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedId || !input.trim() || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    try {
      const res = await fetch(`${BASE}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, sender: "office", content }),
      });
      if (res.ok) {
        const msg = await res.json() as Message;
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
        await fetchConversations();
      } else {
        setInput(content);
        alert("送信に失敗しました。再試行してください。");
      }
    } catch {
      setInput(content);
      alert("送信に失敗しました。通信エラーが発生しました。");
    } finally {
      setSending(false);
    }
  };

  const selected = conversations.find(c => c.employee.id === selectedId);

  const handleSelectConversation = (empId: number) => {
    setSelectedId(empId);
    setMobileView("chat");
  };

  const closeBroadcast = () => {
    setBroadcastOpen(false);
    setBroadcastText("");
    setBroadcastDone(null);
  };

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        <div className="flex-1 min-h-0 flex md:gap-4">
          {/* 左：会話一覧 */}
          <div className={`${mobileView === "chat" ? "hidden md:flex" : "flex"} w-full md:w-72 lg:w-80 shrink-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden`}>
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              onSelect={handleSelectConversation}
              search={search}
              onSearchChange={setSearch}
              onOpenBroadcast={openBroadcast}
              onEnablePush={handleEnablePush}
              pushEnabled={pushEnabled}
            />
          </div>

          {/* 右：チャット */}
          <div className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 min-w-0 flex-col min-h-0`}>
            {selectedId == null ? (
              <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-2 rounded-xl border bg-card text-muted-foreground">
                <MessageSquare className="h-10 w-10 opacity-20" />
                <p className="font-medium text-sm">従業員を選択してください</p>
                <p className="text-xs opacity-60">左のリストから会話を開始できます</p>
              </div>
            ) : (
              <div className="flex flex-col h-full min-h-0 rounded-xl border bg-card overflow-hidden">
                <ChatView
                  conversation={selected}
                  messages={messages}
                  input={input}
                  onInputChange={setInput}
                  onSend={sendMessage}
                  sending={sending}
                  onBack={() => setMobileView("list")}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 一斉送信ダイアログ */}
      <BroadcastDialog
        open={broadcastOpen}
        onOpenChange={(o) => { if (!o) closeBroadcast(); else setBroadcastOpen(true); }}
        conversations={conversations}
        text={broadcastText}
        onTextChange={setBroadcastText}
        selected={broadcastSelected}
        onToggleEmployee={toggleBroadcastEmployee}
        onToggleAll={toggleBroadcastAll}
        broadcasting={broadcasting}
        done={broadcastDone}
        onSend={sendBroadcast}
        onCancel={closeBroadcast}
      />
    </AppLayout>
  );
}
