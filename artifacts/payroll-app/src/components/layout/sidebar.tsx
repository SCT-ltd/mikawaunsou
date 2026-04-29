import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnread } from "@/context/unread-context";
import { useNavigationGuard } from "@/context/navigation-guard-context";
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

const navigation = [
  { name: "ダッシュボード",     href: "/",              icon: LayoutDashboard, description: "全体の概要・給与サマリーを確認します" },
  { name: "リアルタイムマップ", href: "/realtime-map",  icon: MapPin,          description: "ドライバーのリアルタイム位置を地図で確認します" },
  { name: "メッセージ",         href: "/messages",      icon: MessageSquare,   description: "社員へのメッセージを送受信します", showUnread: true },
  { name: "勤怠管理",           href: "/attendance",    icon: ClipboardCheck,  description: "社員の出退勤・勤怠状況を管理します" },
  { name: "月次実績入力",       href: "/monthly-input", icon: CalendarDays,    description: "月次の売上・走行距離などの実績を入力します" },
  { name: "給与明細",           href: "/payroll",       icon: FileText,        description: "給与明細の作成・確認・印刷をします" },
  { name: "カレンダー",         href: "/calendar",      icon: CalendarRange,   description: "シフト・スケジュールを管理します" },
  { name: "マスター管理",       href: "/allowances",    icon: Tag,             description: "手当・控除定義などのマスターデータを管理します" },
  { name: "ユーザー管理",       href: "/users",         icon: Users,           description: "システムユーザーの追加・編集・権限設定をします" },
  { name: "会社設定",           href: "/settings",      icon: Settings,        description: "会社情報・保険料率・各種計算設定を管理します" },
];

export function Sidebar() {
  const [location, navigate] = useLocation();
  const { totalUnreadCount } = useUnread();
  const { requestNavigate } = useNavigationGuard();

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-14 items-center px-4 font-bold text-lg border-b border-sidebar-border gap-2">
        <Truck className="h-5 w-5" />
        <span>運送給与システム</span>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <TooltipProvider delayDuration={400}>
          <nav className="space-y-1 px-2">
            {navigation.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const showBadge = item.showUnread && totalUnreadCount > 0;
              return (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => requestNavigate(item.href, navigate)}
                      className={cn(
                        "w-full group flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors text-left",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <div className="relative mr-3 shrink-0">
                        <item.icon
                          className={cn(
                            "h-5 w-5",
                            isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70 group-hover:text-sidebar-accent-foreground"
                          )}
                          aria-hidden="true"
                        />
                        {showBadge && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                            {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
                          </span>
                        )}
                      </div>
                      {item.name}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[200px]">
                    {item.description}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </TooltipProvider>
      </div>
    </div>
  );
}
