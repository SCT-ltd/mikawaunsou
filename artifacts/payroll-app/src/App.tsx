import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { NavigationGuardProvider } from "@/context/navigation-guard-context";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";

import Dashboard from "@/pages/dashboard";
import MonthlyInput from "@/pages/monthly-input";
import PayrollList from "@/pages/payroll/list";
import PayrollDetail from "@/pages/payroll/detail";
import JournalEntries from "@/pages/journal";
import Settings from "@/pages/settings";
import AllowanceSettings from "@/pages/allowances";
import CalendarPage from "@/pages/calendar";
import AttendancePage from "@/pages/attendance";
import DriverPage from "@/pages/driver";
import RealtimeMapPage from "@/pages/realtime-map";
import MessagesPage from "@/pages/messages";
import UserManagement from "@/pages/users";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/monthly-input" component={MonthlyInput} />
      <Route path="/payroll" component={PayrollList} />
      <Route path="/payroll/:id" component={PayrollDetail} />
      <Route path="/journal" component={JournalEntries} />
      <Route path="/settings" component={Settings} />
      <Route path="/allowances" component={AllowanceSettings} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/attendance" component={AttendancePage} />
      <Route path="/realtime-map" component={RealtimeMapPage} />
      <Route path="/messages" component={MessagesPage} />
      <Route path="/driver/:id" component={DriverPage} />
      <Route path="/users" component={UserManagement} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route component={ProtectedRoutes} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <NavigationGuardProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
        </NavigationGuardProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
