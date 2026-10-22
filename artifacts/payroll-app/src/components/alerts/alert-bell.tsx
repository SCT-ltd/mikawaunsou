import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, ChevronRight, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 従業員のお知らせ（年齢の節目・設定の確認・残業・未確定の明細）。
 * 中身はサーバーが社員マスターなどから毎回作る（api-server/src/lib/alerts.ts）。
 * 右上のベル（AlertBell）とダッシュボードの枠（AlertsCard）で同じ一覧を使う。
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface EmployeeAlert {
  key: string;
  level: "danger" | "warn" | "info";
  title: string;
  body: string;
  employeeId?: number;
  employeeName?: string;
  href: string;
  date?: string;
  daysLeft?: number;
  read: boolean;
}

const ALERTS_KEY = ["employee-alerts"] as const;

function useAlerts() {
  return useQuery<{ items: EmployeeAlert[]; unread: number }>({
    queryKey: ALERTS_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/alerts`, { credentials: "include" });
      if (!res.ok) throw new Error("お知らせを読み込めませんでした");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

async function postRead(path: string, body?: unknown) {
  await fetch(`${BASE}/api/alerts/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const DOT: Record<EmployeeAlert["level"], string> = {
  danger: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-sky-500",
};
const LABEL: Record<EmployeeAlert["level"], string> = { danger: "至急", warn: "要対応", info: "お知らせ" };

function AlertRow({ a, onOpen }: { a: EmployeeAlert; onOpen: (a: EmployeeAlert) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className={`w-full text-left flex gap-2.5 px-3 py-2.5 rounded-md hover:bg-accent transition-colors ${a.read ? "opacity-60" : ""}`}
    >
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${DOT[a.level]}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground shrink-0">{LABEL[a.level]}</span>
          {!a.read && <span className="text-[10px] font-semibold text-red-600 shrink-0">未読</span>}
        </span>
        <span className="block text-sm font-medium leading-snug">{a.title}</span>
        <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{a.body}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
    </button>
  );
}

function useOpenAlert() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  return async (a: EmployeeAlert) => {
    if (!a.read) {
      await postRead("read", { keys: [a.key] });
      qc.invalidateQueries({ queryKey: ALERTS_KEY });
    }
    setLocation(a.href);
  };
}

// ── PCのプッシュ通知の登録（事務所として購読する）──────────────────────
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribeOfficePush(): Promise<"ok" | "denied" | "unsupported" | "error"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${BASE}/api/messages/vapid-public-key`);
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    if (!publicKey) return "error";
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const json = sub.toJSON();
    const res = await fetch(`${BASE}/api/push/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: null, role: "office", endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

function PushToggle() {
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(supported ? Notification.permission : "unsupported");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // すでに許可済みなら、念のため購読を登録し直しておく（サーバー側で無効化されていても戻る）
  useEffect(() => {
    if (perm === "granted") void subscribeOfficePush();
  }, [perm]);

  if (perm === "unsupported") return <p className="text-[11px] text-muted-foreground">このブラウザはPCの通知に対応していません。</p>;
  if (perm === "granted") return <p className="text-[11px] text-emerald-700">✓ このPCに通知が届きます（要対応のお知らせが出たとき）</p>;
  if (perm === "denied") {
    return <p className="text-[11px] text-muted-foreground">通知がブロックされています。アドレスバー左の鍵マーク→「通知」を「許可」にしてください。</p>;
  }
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await subscribeOfficePush();
          setBusy(false);
          setPerm(supported ? Notification.permission : "unsupported");
          setMsg(r === "ok" ? null : r === "denied" ? "通知が許可されませんでした。" : "登録できませんでした。時間をおいてもう一度お試しください。");
        }}
        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
      >
        {busy ? "登録中..." : "このPCに通知を出す"}
      </button>
      {msg && <p className="text-[11px] text-red-600 mt-0.5">{msg}</p>}
    </div>
  );
}

// ── 右上のベル ─────────────────────────────────────────────────────────
export function AlertBell() {
  const { data } = useAlerts();
  const qc = useQueryClient();
  const openAlert = useOpenAlert();
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;
  const urgent = items.some((a) => !a.read && a.level !== "info");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="従業員のお知らせ"
          aria-label={`従業員のお知らせ${unread > 0 ? `（未読 ${unread}件）` : ""}`}
        >
          {urgent ? <BellRing className="h-4 w-4 text-amber-600" /> : <Bell className="h-4 w-4" />}
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">従業員のお知らせ</span>
          {unread > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={async () => { await postRead("read-all"); qc.invalidateQueries({ queryKey: ALERTS_KEY }); }}
            >
              <CheckCheck className="h-3.5 w-3.5" />すべて既読
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {items.length === 0
            ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">いま対応が必要なお知らせはありません</p>
            : items.map((a) => <AlertRow key={a.key} a={a} onOpen={openAlert} />)}
        </div>
        <div className="border-t px-3 py-2"><PushToggle /></div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── ダッシュボードの枠 ─────────────────────────────────────────────────
export function AlertsCard() {
  const { data, isLoading } = useAlerts();
  const openAlert = useOpenAlert();
  const items = data?.items ?? [];
  if (isLoading || items.length === 0) return null;
  const need = items.filter((a) => a.level !== "info").length;
  return (
    <Card className={need > 0 ? "border-amber-300" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BellRing className={`h-4 w-4 ${need > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
          従業員のお知らせ
          <span className="text-xs font-normal text-muted-foreground">
            {need > 0 ? `要対応 ${need}件` : ""}{need > 0 && items.length > need ? "・" : ""}{items.length > need ? `お知らせ ${items.length - need}件` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-0.5 md:grid-cols-2">
          {items.map((a) => <AlertRow key={a.key} a={a} onOpen={openAlert} />)}
        </div>
        <div className="mt-2 px-3"><PushToggle /></div>
      </CardContent>
    </Card>
  );
}
