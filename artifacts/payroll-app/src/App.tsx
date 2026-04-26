import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import MonthlyInput from "@/pages/monthly-input";
import PayrollList from "@/pages/payroll/list";
import JournalEntries from "@/pages/journal";
import Settings from "@/pages/settings";
import AllowanceSettings from "@/pages/allowances";
import GekkeiManagement from "@/pages/gekkei-management";
import CalendarPage from "@/pages/calendar";
import AttendancePage from "@/pages/attendance";
import DriverPage from "@/pages/driver";
import RealtimeMapPage from "@/pages/realtime-map";
import MessagesPage from "@/pages/messages";
import UserManagement from "@/pages/user-management";
import LoginPage from "@/pages/login";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/auth/protected-route";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        {(params) => <ProtectedRoute component={Dashboard} path="/" />}
      </Route>
      <Route path="/monthly-input">
        {(params) => <ProtectedRoute component={MonthlyInput} path="/monthly-input" />}
      </Route>
      <Route path="/payroll">
        {(params) => <ProtectedRoute component={PayrollList} path="/payroll" />}
      </Route>
      <Route path="/journal">
        {(params) => <ProtectedRoute component={JournalEntries} path="/journal" />}
      </Route>
      <Route path="/settings">
        {(params) => <ProtectedRoute component={Settings} path="/settings" />}
      </Route>
      <Route path="/allowances">
        {(params) => <ProtectedRoute component={AllowanceSettings} path="/allowances" />}
      </Route>
      <Route path="/calendar">
        {(params) => <ProtectedRoute component={CalendarPage} path="/calendar" />}
      </Route>
      <Route path="/attendance">
        {(params) => <ProtectedRoute component={AttendancePage} path="/attendance" />}
      </Route>
      <Route path="/gekkei">
        {(params) => <ProtectedRoute component={GekkeiManagement} path="/gekkei" />}
      </Route>
      <Route path="/realtime-map">
        {(params) => <ProtectedRoute component={RealtimeMapPage} path="/realtime-map" />}
      </Route>
      <Route path="/messages">
        {(params) => <ProtectedRoute component={MessagesPage} path="/messages" />}
      </Route>
      <Route path="/users">
        {(params) => <ProtectedRoute component={UserManagement} path="/users" />}
      </Route>
      <Route path="/driver/:id" component={DriverPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
