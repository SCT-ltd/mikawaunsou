import { Sidebar } from "./sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppLayout({ children }: { children: React.ReactNode }) {
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
              <div className="text-sm font-medium text-muted-foreground">
                {new Date().getFullYear()}年{new Date().getMonth() + 1}月
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
