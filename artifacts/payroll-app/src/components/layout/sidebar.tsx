import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  CalendarDays, 
  FileText, 
  Settings,
  Truck,
  Tag,
  CalendarRange,
  ClipboardCheck,
  MapPin,
  MessageSquare,
  Users,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navigation = [
  { name: "ダッシュボード", href: "/", icon: LayoutDashboard, description: "全体の統計や重要なお知らせを確認します。" },
  { name: "リアルタイムマップ", href: "/realtime-map", icon: MapPin, description: "配送状況や車両の位置をリアルタイムで確認します。" },
  { name: "メッセージ", href: "/messages", icon: MessageSquare, description: "従業員とのチャットや通知を確認します。" },
  { name: "勤怠管理", href: "/attendance", icon: ClipboardCheck, description: "出退勤や休暇申請の管理を行います。" },
  { name: "月次実績入力", href: "/monthly-input", icon: CalendarDays, description: "月ごとの売上や走行距離などの実績を入力します。" },
  { name: "給与明細", href: "/payroll", icon: FileText, description: "給与計算結果の確認や明細の発行を行います。" },
  { name: "随時改定管理", href: "/gekkei", icon: ClipboardCheck, description: "固定的賃金の変動に伴う社会保険料の改定候補を確認します。" },
  { name: "カレンダー", href: "/calendar", icon: CalendarRange, description: "配送スケジュールやイベントを確認します。" },
  { name: "マスター管理", href: "/allowances", icon: Tag, description: "手当の設定や社員情報の管理を行います。" },
  { name: "ユーザー管理", href: "/users", icon: Users, description: "システムにログインできるスタッフアカウントを管理します。" },
  { name: "会社設定", href: "/settings", icon: Settings, description: "会社の基本情報や各種計算設定を変更します。" },
];

export function Sidebar() {
  const [location] = useLocation();
  const [totalUnread, setTotalUnread] = useState(0);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${BASE}/api/messages/conversations`);
      if (res.ok) {
        const data = await res.json() as { unreadCount: number }[];
        const total = data.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
        setTotalUnread(total);
      }
    } catch (e) {
      console.error("Failed to fetch unread count", e);
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(`${BASE}/api/messages/stream?employeeId=0`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "message" || data.type === "read") {
        fetchUnreadCount();
      }
    };
    return () => es.close();
  }, [fetchUnreadCount]);

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-14 items-center px-4 font-bold text-lg border-b border-sidebar-border gap-2">
        <Truck className="h-5 w-5" />
        <span>運送給与システム</span>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-2">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const isMessages = item.href === "/messages";
            
            return (
              <Tooltip key={item.name} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center justify-between rounded-md px-2 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <div className="flex items-center">
                      <item.icon
                        className={cn(
                          "mr-3 h-5 w-5 flex-shrink-0",
                          isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70 group-hover:text-sidebar-accent-foreground"
                        )}
                        aria-hidden="true"
                      />
                      {item.name}
                    </div>
                    {isMessages && totalUnread > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-md">
                        {totalUnread}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p>{item.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
