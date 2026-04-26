import { Sidebar } from "./sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, User } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 items-center justify-between border-b bg-card px-4 lg:px-6 shadow-sm">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                給与管理
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm font-medium text-muted-foreground hidden sm:block">
                {new Date().getFullYear()}年{new Date().getMonth() + 1}月
              </div>
              {user && (
                <div className="flex items-center gap-3 border-l pl-4 ml-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4 text-primary" />
                    <span>{user.displayName ?? user.username}</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={logout} title="ログアウト">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </header>
          <main className="flex-1 overflow-hidden p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl h-full overflow-y-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
