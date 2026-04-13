import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import EmployeeList from "@/pages/employees/list";
import EmployeeCreate from "@/pages/employees/create";
import EmployeeEdit from "@/pages/employees/edit";
import MonthlyInput from "@/pages/monthly-input";
import PayrollList from "@/pages/payroll/list";
import PayrollDetail from "@/pages/payroll/detail";
import JournalEntries from "@/pages/journal";
import Settings from "@/pages/settings";
import AllowanceSettings from "@/pages/allowances";

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
      <Route path="/" component={Dashboard} />
      <Route path="/employees" component={EmployeeList} />
      <Route path="/employees/new" component={EmployeeCreate} />
      <Route path="/employees/:id" component={EmployeeEdit} />
      <Route path="/monthly-input" component={MonthlyInput} />
      <Route path="/payroll" component={PayrollList} />
      <Route path="/payroll/:id" component={PayrollDetail} />
      <Route path="/journal" component={JournalEntries} />
      <Route path="/settings" component={Settings} />
      <Route path="/allowances" component={AllowanceSettings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
