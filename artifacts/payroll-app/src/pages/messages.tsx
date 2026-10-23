import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/app-layout";
import { useUnread } from "@/context/unread-context";
import { playNotificationSound, unlockAudio } from "@/lib/notification-sound";
import { MessageSquare } from "lucide-react";
import { Conversation, Message } from "@/components/messages/shared";
import { ConversationList } from "@/components/messages/conversation-list";
import { ChatView } from "@/components/messages/chat-view";
import { BroadcastDialog } from "@/components/messages/broadcast-dialog";
import { addPending, uploadAttachment, type PendingFile } from "@/components/messages/attachments";

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
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("emp")) || null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  /** 送る前の添付 */
  const [files, setFiles] = useState<PendingFile[]>([]);
  /** 一斉送信の添付 */
  const [broadcastFiles, setBroadcastFiles] = useState<PendingFile[]>([]);
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
        const data = JSON.parse(e.data) as { type: string; message: Message; reader?: string; ids?: number[]; at?: string };
        // 本人が読んだ（打刻ページで開いた）→ 事務所が送った吹き出しを「既読」に
        if (data.type === "read") {
          if (data.reader === "employee" && data.ids?.length) {
            const ids = new Set(data.ids);
            setMessages(prev => prev.map(m => ids.has(m.id) ? { ...m, readAt: data.at ?? new Date().toISOString() } : m));
          }
          return;
        }
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
    if ((!broadcastText.trim() && broadcastFiles.length === 0) || broadcasting || broadcastSelected.size === 0) return;
    setBroadcasting(true);
    try {
      // 添付は先に1つずつ上げる（一斉送信用）。送るときにサーバーが各人の会話へ写す
      const attachmentIds: number[] = [];
      try {
        for (const f of broadcastFiles) attachmentIds.push((await uploadAttachment(BASE, "broadcast", f.file)).id);
      } catch (e) {
        toast({ title: "添付を送れませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" });
        return;
      }
      const res = await fetch(`${BASE}/api/messages/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: broadcastText.trim(),
          employeeIds: Array.from(broadcastSelected),
          attachmentIds,
        }),
      });
      const data = await res.json().catch(() => ({})) as { count?: number; error?: string };
      if (!res.ok) {
        toast({ title: "一斉送信できませんでした", description: data.error ?? `もう一度お試しください（${res.status}）`, variant: "destructive" });
        return;
      }
      setBroadcastDone(data.count ?? 0);
      setBroadcastText("");
      broadcastFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setBroadcastFiles([]);
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
    if (!selectedId || (!input.trim() && files.length === 0) || sending) return;
    setSending(true);
    const content = input.trim();
    const sendingFiles = files;
    setInput("");
    try {
      // 添付は先に1つずつ上げて番号をもらう
      let attachmentIds: number[] = [];
      try {
        for (const f of sendingFiles) attachmentIds.push((await uploadAttachment(BASE, selectedId, f.file)).id);
      } catch (e) {
        setInput(content);
        toast({ title: "添付を送れませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" });
        return;
      }
      const res = await fetch(`${BASE}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, sender: "office", content, attachmentIds }),
      });
      if (res.ok) {
        const msg = await res.json() as Message;
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
        sendingFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
        setFiles([]);
        await fetchConversations();
      } else {
        setInput(content);
        toast({ title: "送信できませんでした", description: "入力した文はそのまま残っています。もう一度「送信」を押してください。", variant: "destructive" });
      }
    } catch {
      setInput(content);
      toast({ title: "送信できませんでした", description: "通信できませんでした。入力した文はそのまま残っています。", variant: "destructive" });
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
                  files={files}
                  onFiles={(list) => { const r = addPending(files, list); setFiles(r.next); if (r.error) toast({ title: r.error, variant: "destructive" }); }}
                  onRemoveFile={(key) => setFiles((prev) => { const f = prev.find((x) => x.key === key); if (f?.preview) URL.revokeObjectURL(f.preview); return prev.filter((x) => x.key !== key); })}
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
        files={broadcastFiles}
        onFiles={(list) => { const r = addPending(broadcastFiles, list); setBroadcastFiles(r.next); if (r.error) toast({ title: r.error, variant: "destructive" }); }}
        onRemoveFile={(key) => setBroadcastFiles((prev) => { const f = prev.find((x) => x.key === key); if (f?.preview) URL.revokeObjectURL(f.preview); return prev.filter((x) => x.key !== key); })}
        onCancel={closeBroadcast}
      />
    </AppLayout>
  );
}
