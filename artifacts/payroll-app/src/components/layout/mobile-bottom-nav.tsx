import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useUnread } from "@/context/unread-context";
import { useNavigationGuard } from "@/context/navigation-guard-context";
import {
  LayoutDashboard,
  CalendarDays,
  FileText,
  ClipboardCheck,
  MessageSquare,
} from "lucide-react";

const NAV_ITEMS = [
  { name: "ホーム",   href: "/",              icon: LayoutDashboard },
  { name: "月次実績", href: "/monthly-input",  icon: CalendarDays },
  { name: "給与明細", href: "/payroll",        icon: FileText },
  { name: "勤怠管理", href: "/attendance",     icon: ClipboardCheck },
  { name: "メッセージ", href: "/messages",     icon: MessageSquare,  showUnread: true },
];

export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  const { totalUnreadCount } = useUnread();
  const { requestNavigate } = useNavigationGuard();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t bg-card shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      {NAV_ITEMS.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== "/" && location.startsWith(item.href));
        const showBadge = item.showUnread && totalUnreadCount > 0;

        return (
          <button
            key={item.href}
            type="button"
            onClick={() => requestNavigate(item.href, navigate)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors relative",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="relative">
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              {showBadge && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
                </span>
              )}
            </div>
            <span className="leading-none">{item.name}</span>
            {isActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
