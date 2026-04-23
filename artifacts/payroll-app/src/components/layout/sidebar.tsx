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
  { name: "カレンダー", href: "/calendar", icon: CalendarRange, description: "配送スケジュールやイベントを確認します。" },
  { name: "マスター管理", href: "/allowances", icon: Tag, description: "手当の設定や社員情報の管理を行います。" },
  { name: "会社設定", href: "/settings", icon: Settings, description: "会社の基本情報や各種計算設定を変更します。" },
];

export function Sidebar() {
  const [location] = useLocation();

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
            return (
              <Tooltip key={item.name} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "mr-3 h-5 w-5 flex-shrink-0",
                        isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70 group-hover:text-sidebar-accent-foreground"
                      )}
                      aria-hidden="true"
                    />
                    {item.name}
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
