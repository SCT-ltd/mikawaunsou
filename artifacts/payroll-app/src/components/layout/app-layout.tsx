import { useState } from "react";
import { Sidebar } from "./sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { useAuth } from "@/context/auth-context";
import { UnreadProvider } from "@/context/unread-context";
import { useNavigationGuard } from "@/context/navigation-guard-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LogOut, UserCircle, ChevronDown, Menu } from "lucide-react";
import { useLocation } from "wouter";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { pendingHref, cancelPending, confirmPending } = useNavigationGuard();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  return (
    <UnreadProvider>
      <div id="layout-root" className="flex h-screen overflow-hidden bg-background">

        {/* ── デスクトップ サイドバー ── */}
        <div id="layout-sidebar" className="hidden md:flex h-full">
          <Sidebar />
        </div>

        {/* ── モバイル サイドバー オーバーレイ ── */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 md:hidden">
              <Sidebar onClose={() => setSidebarOpen(false)} />
            </div>
          </>
        )}

        <div id="layout-main-panel" className="flex flex-1 flex-col overflow-hidden">
          {/* ── ヘッダー ── */}
          <header id="layout-header" className="flex h-14 items-center justify-between border-b bg-card px-3 md:px-4 lg:px-6 shadow-sm shrink-0">
            <div className="flex items-center gap-2 md:gap-4">
              {/* モバイル ハンバーガー */}
              <button
                type="button"
                className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={() => setSidebarOpen(true)}
                aria-label="メニューを開く"
              >
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="text-base md:text-lg font-semibold tracking-tight text-foreground">
                給与管理
              </h1>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              <div className="text-sm font-medium text-muted-foreground hidden sm:block">
                {new Date().getFullYear()}年{new Date().getMonth() + 1}月
              </div>
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 h-9 px-2 md:px-3">
                      <UserCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium hidden sm:inline-block max-w-[120px] truncate">
                        {user.displayName}
                      </span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-semibold leading-none">{user.displayName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">@{user.username}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer gap-2"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4" />
                      ログアウト
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>

          {/* ── メインコンテンツ ── */}
          <main id="layout-main" className="flex-1 overflow-y-auto p-3 md:p-6 lg:p-8 pb-20 md:pb-6 lg:pb-8">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* ── モバイル フッターナビ ── */}
      <MobileBottomNav />

      <AlertDialog open={pendingHref !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>未保存の変更があります</AlertDialogTitle>
            <AlertDialogDescription>
              入力内容がまだ保存されていません。このまま移動すると変更が失われます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPending}>
              キャンセル（入力を続ける）
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              保存せずに移動
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnreadProvider>
  );
}
