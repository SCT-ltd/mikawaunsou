import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useListPayrolls, 
  useCalculatePayroll,
  useListEmployees,
  getListPayrollsQueryKey,
  useGetPayroll,
  getGetPayrollQueryKey,
  useConfirmPayroll,
  useListMonthlyRecords,
  useListAllowanceDefinitions,
  useGetEmployeeAllowances,
  useListDeductionDefinitions,
  useGetEmployeeDeductions,
  useGetEmployee,
} from "@workspace/api-client-react";
import { calculateSocialInsurance } from "@/lib/tax-tables-reiwa8";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayrollPrintSlip, type PayrollViewModel } from "@/components/payroll-print-slip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AllowanceInputPanel } from "@/components/allowance-input-panel";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { Calculator, Download, AlertCircle, X, CheckCircle2, FileText, ChevronRight, Printer } from "lucide-react";
import { formatMonth } from "@/lib/format";
import "@/payroll-print.css";

// ── 共通ViewModelインターフェース ──
export interface PayrollDisplayViewModel {
  payrollId: number;
  employeeCode: string;
  employeeName: string;
  targetYearMonth: string;
  payDate: string;
  earningItems: { label: string; amount: number; isTaxable?: boolean }[];
  deductionItems: { label: string; amount: number }[];
  totalEarnings: number;
  totalDeductions: number;
  netPayment: number;
  attendance: {
    workDays: number;
    overtimeHours: number;
    lateNightHours: number;
    holidayWorkDays: number;
  };
  notes: string;
}

// ── 共通ViewModel生成関数 (唯一の正) ──
export function buildPayrollDisplayViewModel(
  payroll: any, 
  employee: any, 
  allowances: any[] = [], 
  deductions: any[] = []
): PayrollDisplayViewModel {
  const earningItems = [
    { label: "基本給", amount: payroll.baseSalary, isTaxable: true },
    { label: "早出残業手当", amount: payroll.earlyOvertimeAllowance, isTaxable: true },
    { label: "残業手当", amount: payroll.overtimePay, isTaxable: true },
    { label: "深夜手当", amount: payroll.lateNightPay, isTaxable: true },
    { label: "休日手当", amount: payroll.holidayPay, isTaxable: true },
    { label: "歩合給", amount: payroll.commissionPay, isTaxable: true },
    ...allowances.map(a => ({ label: a.name || a.label || "手当", amount: a.amount, isTaxable: a.isTaxable !== false }))
  ].filter(i => i.amount > 0);

  const gradeBase = (payroll.baseSalary ?? 0) + (payroll.customAllowancesTotal ?? 0);
  const socIns = calculateSocialInsurance(gradeBase, { careInsuranceApplied: employee?.careInsuranceApplied ?? false });

  const deductionItems = [
    { label: "健康保険料", amount: socIns.healthInsurance },
    { label: "厚生年金保険料", amount: socIns.pension },
    { label: "雇用保険料", amount: payroll.employmentInsurance },
    { label: "子ども・子育て支援金", amount: payroll.childcareSupportContribution },
    { label: "所得税", amount: payroll.incomeTax },
    { label: "市町村民税", amount: payroll.residentTax },
    { label: "欠勤控除", amount: payroll.absenceDeduction },
    ...deductions.map(d => ({ label: d.name || d.label || "控除", amount: d.amount }))
  ].filter(i => i.amount > 0);

  const totalEarnings = earningItems.reduce((sum, i) => sum + Math.round(Number(i.amount || 0)), 0);
  const totalDeductions = deductionItems.reduce((sum, i) => sum + Math.round(Number(i.amount || 0)), 0);
  const netPayment = totalEarnings - totalDeductions;

  return {
    payrollId: payroll.id,
    employeeCode: employee?.employeeCode || payroll.employeeCode || "",
    employeeName: employee?.name || payroll.employeeName || "",
    targetYearMonth: `${payroll.year}年${payroll.month}月`,
    payDate: payroll.payDate || "",
    earningItems,
    deductionItems,
    totalEarnings,
    totalDeductions,
    netPayment,
    attendance: {
      workDays: payroll.workDays || 0,
      overtimeHours: payroll.overtimeHours || 0,
      lateNightHours: payroll.lateNightHours || 0,
      holidayWorkDays: payroll.holidayWorkDays || 0,
    },
    notes: payroll.notes || payroll.remarks || "",
  };
}

export default function PayrollList() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: payrolls, isLoading: payrollsLoading } = useListPayrolls({ year, month });
  const { data: employees } = useListEmployees({ active: true });
  const calculatePayroll = useCalculatePayroll();

  const [calculating, setCalculating] = useState(false);
  const [selectedPayrollId, setSelectedPayrollId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("allowance");
  const [isDirty, setIsDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [printMode, setPrintMode] = useState<null | "single" | "bulk">(null);
  const [currentPrintViewModel, setCurrentPrintViewModel] = useState<PayrollViewModel | null>(null);
  const [bulkPrintViewModels, setBulkPrintViewModels] = useState<PayrollViewModel[]>([]);

  useEffect(() => {
    if (!printMode) return;
    
    if (printMode === "single") {
      if (!currentPrintViewModel) return;
      
      const timer = setTimeout(() => {
        window.print();
        window.onafterprint = () => {
          setPrintMode(null);
          setCurrentPrintViewModel(null);
          window.onafterprint = null;
        };
      }, 800);
      return () => clearTimeout(timer);
    }
    
    if (printMode === "bulk") {
      if (bulkPrintViewModels.length === 0) return;
      const timer = setTimeout(() => {
        window.print();
        window.onafterprint = () => {
          setPrintMode(null);
          setBulkPrintViewModels([]);
          window.onafterprint = null;
        };
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [printMode, currentPrintViewModel, bulkPrintViewModels]);

  useEffect(() => {
    setCurrentPrintViewModel(null);
    setPrintMode(null);
  }, [selectedPayrollId]);

  const guardedAction = useCallback((action: () => void) => {
    if (isDirty) {
      setPendingAction(() => action);
    } else {
      action();
    }
  }, [isDirty]);

  const handleBulkCalculate = async () => {
    if (!employees) return;
    setCalculating(true);
    let success = 0;
    try {
      for (const emp of employees) {
        const existing = payrolls?.find(p => p.employeeId === emp.id);
        if (existing?.status === "confirmed") continue;
        try {
          await calculatePayroll.mutateAsync({ data: { employeeId: emp.id, year, month } });
          success++;
        } catch (err) {}
      }
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      if (success > 0) toast({ title: "計算完了", description: `${success}件の給与計算が完了しました。` });
    } finally {
      setCalculating(false);
    }
  };

  const handleExportCsv = async () => {
    const url = `/api/payrolls/export/csv?year=${year}&month=${month}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `給与明細データ_${year}${month}.csv`;
    a.click();
    toast({ title: "CSVエクスポート", description: "ダウンロードを開始しました。" });
  };

  const handleBulkPrint = async () => {
    if (!payrolls || !employees || payrolls.length === 0) return;
    const viewModels = payrolls.map(p => {
      const emp = employees.find(e => e.id === p.employeeId);
      return buildPayrollDisplayViewModel(p, emp, [], []);
    });
    setPrintMode("bulk");
    setBulkPrintViewModels(viewModels);
  };

  const years = Array.from({ length: 3 }, (_, i) => currentDate.getFullYear() - 1 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <>
      <div className="screen-only">
        <AppLayout title="給与明細一覧">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-2xl font-bold tracking-tight">給与明細一覧</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-2">
                  <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                    <SelectTrigger className="w-[100px] bg-card">
                      <SelectValue placeholder="年" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                    <SelectTrigger className="w-[80px] bg-card">
                      <SelectValue placeholder="月" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={handleBulkCalculate} disabled={calculating}>
                    <Calculator className="mr-2 h-4 w-4" />
                    月次実績から一括計算
                  </Button>
                  <Button variant="outline" onClick={handleExportCsv} disabled={!payrolls || payrolls.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    CSV出力
                  </Button>
                  <Button variant="outline" className="bg-primary/5 border-primary/20 hover:bg-primary/10 text-primary" onClick={handleBulkPrint} disabled={!payrolls || payrolls.length === 0}>
                    <Printer className="mr-2 h-4 w-4" />
                    給与明細一括印刷
                  </Button>
                </div>
              </div>
            </div>

            <div className="border rounded-lg bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[100px]">社員番号</TableHead>
                    <TableHead>氏名</TableHead>
                    <TableHead className="text-right">総支給額</TableHead>
                    <TableHead className="text-right">控除合計</TableHead>
                    <TableHead className="text-right">差引支給額</TableHead>
                    <TableHead className="text-center">ステータス</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollsLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">読み込み中...</TableCell>
                    </TableRow>
                  ) : !payrolls || payrolls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {formatMonth(year, month)}の給与データはありません。
                      </TableCell>
                    </TableRow>
                  ) : (
                    [...payrolls].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)).map((payroll) => (
                      <TableRow
                        key={payroll.id}
                        className={`cursor-pointer transition-colors ${selectedPayrollId === payroll.id ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"}`}
                        onClick={() => guardedAction(() => { setSelectedPayrollId(payroll.id); setActiveTab("allowance"); setIsDirty(false); })}
                      >
                        <TableCell className="font-medium">{payroll.employeeCode}</TableCell>
                        <TableCell>{payroll.employeeName}</TableCell>
                        <TableCell className="text-right">{formatCurrency(payroll.grossSalary)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(payroll.totalDeductions)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(payroll.netSalary)}</TableCell>
                        <TableCell className="text-center">
                          {payroll.status === "confirmed" ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">確定済</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">計算中</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center text-sm text-muted-foreground gap-0.5">詳細 <ChevronRight className="h-3.5 w-3.5" /></span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <Sheet open={!!selectedPayrollId} onOpenChange={(open) => { if (!open) guardedAction(() => setSelectedPayrollId(null)); }}>
            <SheetContent className="w-full sm:max-w-[800px] p-0 overflow-y-auto" side="right" hideClose={true}>
              {selectedPayrollId && (
                <PayrollDetailContent 
                  id={selectedPayrollId}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  year={year}
                  month={month}
                  employees={employees || []}
                  onClose={() => guardedAction(() => setSelectedPayrollId(null))}
                  onDirtyChange={setIsDirty}
                  setCurrentPrintViewModel={setCurrentPrintViewModel}
                  setPrintMode={setPrintMode}
                  setBulkPrintViewModels={setBulkPrintViewModels}
                />
              )}
            </SheetContent>
          </Sheet>
        </AppLayout>

        <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>変更された箇所があります</AlertDialogTitle></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingAction(null)}>キャンセル</AlertDialogCancel>
              <Button variant="outline" onClick={() => { setPendingAction(null); setIsDirty(false); pendingAction?.(); }}>保存せずに移動</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* 印刷用DOM：通常画面の外側に配置 */}
      <div className="print-only-container">
        {printMode === "single" && currentPrintViewModel && (
          <div id="single-print-root">
            <PayrollPrintSlip viewModel={currentPrintViewModel} />
          </div>
        )}

        {printMode === "bulk" && bulkPrintViewModels.length > 0 && (
          <div className="bulk-print-only">
            {bulkPrintViewModels.map((vm) => (
              <PayrollPrintSlip key={`bulk-${vm.payrollId}`} viewModel={vm} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PayrollDetailContent({
  id, activeTab, setActiveTab, year, month, employees, onClose, onDirtyChange, setCurrentPrintViewModel, setPrintMode, setBulkPrintViewModels
}: {
  id: number; activeTab: string; setActiveTab: (v: string) => void; year: number; month: number; employees: any[]; onClose: () => void; onDirtyChange?: (isDirty: boolean) => void; setCurrentPrintViewModel: (vm: PayrollDisplayViewModel | null) => void; setPrintMode: (mode: "single" | "bulk" | null) => void; setBulkPrintViewModels: (vms: PayrollDisplayViewModel[]) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: payroll, isLoading: payrollLoading } = useGetPayroll(id, { query: { queryKey: getGetPayrollQueryKey(id) } });
  const { data: allowanceDefs } = useListAllowanceDefinitions({ activeOnly: true });
  const { data: employeeAllowances } = useGetEmployeeAllowances(id ? (payroll?.employeeId ?? 0) : 0, { query: { enabled: !!payroll?.employeeId } });
  const { data: deductionDefs } = useListDeductionDefinitions({ activeOnly: true });
  const { data: employeeDeductions } = useGetEmployeeDeductions(id ? (payroll?.employeeId ?? 0) : 0, { query: { enabled: !!payroll?.employeeId } });
  const { data: employee } = useGetEmployee(id ? (payroll?.employeeId ?? 0) : 0, { query: { enabled: !!payroll?.employeeId } });
  const { data: monthlyRecords } = useListMonthlyRecords({ year, month });
  const confirmPayroll = useConfirmPayroll();

  const handleConfirm = async () => {
    try {
      await confirmPayroll.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(id) });
      toast({ title: "確定完了" });
    } catch {
      toast({ title: "エラー", variant: "destructive" });
    }
  };

  const handlePrint = async () => {
    if (!payroll || !employee) return;
    setPrintMode(null);
    setCurrentPrintViewModel(null);
    setBulkPrintViewModels([]); 
    await new Promise(resolve => setTimeout(resolve, 100));

    // 正式なViewModelを構築してセット
    const data = buildPayrollDisplayViewModel(
      payroll, employee, 
      employeeAllowances?.map(ea => ({ name: allowanceDefs?.find(ad => ad.id === ea.allowanceDefinitionId)?.name, amount: ea.amount, isTaxable: allowanceDefs?.find(ad => ad.id === ea.allowanceDefinitionId)?.isTaxable })),
      employeeDeductions?.map(ed => ({ name: deductionDefs?.find(dd => dd.id === ed.deductionDefinitionId)?.name, amount: ed.amount }))
    );

    setPrintMode("single");
    setCurrentPrintViewModel(data);
  };

  if (payrollLoading || !payroll || !employee) return <div className="p-8 text-center">読み込み中...</div>;

  const viewModel = buildPayrollDisplayViewModel(
    payroll, employee, 
    employeeAllowances?.map(ea => ({ name: allowanceDefs?.find(ad => ad.id === ea.allowanceDefinitionId)?.name, amount: ea.amount, isTaxable: allowanceDefs?.find(ad => ad.id === ea.allowanceDefinitionId)?.isTaxable })),
    employeeDeductions?.map(ed => ({ name: deductionDefs?.find(dd => dd.id === ed.deductionDefinitionId)?.name, amount: ed.amount }))
  );

  return (
    <div className="animate-in fade-in duration-300">
      <SheetHeader className="border-b pb-4 px-6 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <SheetTitle className="text-xl font-bold flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              給与明細詳細
            </SheetTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {payroll.employeeCode} {payroll.employeeName} | {payroll.year}年{payroll.month}月
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1.5" />印刷</Button>
            {payroll.status !== "confirmed" && <Button size="sm" onClick={handleConfirm}><CheckCircle2 className="h-4 w-4 mr-1.5" />明細を確定</Button>}
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8"><X className="h-4 w-4" /></Button>
          </div>
        </div>
      </SheetHeader>

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50 p-1">
            <TabsTrigger value="allowance">手当入力</TabsTrigger>
            <TabsTrigger value="preview">明細プレビュー</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="mt-0">
            <div className="bg-white border rounded-lg shadow-sm overflow-hidden p-6 space-y-6">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold tracking-tight">給与明細書</h3>
                  <p className="text-sm text-gray-500 font-medium">{payroll.year}年 {payroll.month}月度</p>
                </div>
                <div className="border-2 border-black p-3 rounded text-right">
                  <p className="text-xs text-gray-500 mb-0.5">差引支給額</p>
                  <div className="text-xl font-bold">{formatCurrency(viewModel.netPayment)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <div className="w-1 h-3 bg-black"></div>支給項目
                  </h4>
                  <table className="w-full text-sm">
                    <tbody>
                      {viewModel.earningItems.map((item, i) => (
                        <tr key={i} className="border-b border-dotted border-gray-300">
                          <td className="py-1.5 text-gray-700">{item.label}{!item.isTaxable && <span className="text-[10px] ml-1.5 text-gray-400">(非)</span>}</td>
                          <td className="py-1.5 text-right font-medium">{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-black font-bold bg-gray-50">
                        <td className="py-2 pl-1">総支給額 (A)</td>
                        <td className="py-2 text-right pr-2">{formatCurrency(viewModel.totalEarnings)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <div className="w-1 h-3 bg-black"></div>控除項目
                  </h4>
                  <table className="w-full text-sm">
                    <tbody>
                      {viewModel.deductionItems.map((item, i) => (
                        <tr key={i} className="border-b border-dotted border-gray-300">
                          <td className="py-1.5 text-gray-700">{item.label}</td>
                          <td className="py-1.5 text-right font-medium">{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-black font-bold bg-gray-50">
                        <td className="py-2 pl-1">控除合計 (B)</td>
                        <td className="py-2 text-right pr-2">{formatCurrency(viewModel.totalDeductions)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="mt-4 border-2 border-black p-3 bg-gray-50 flex justify-between items-center rounded">
                    <span className="font-bold text-sm">差引支給額 (A - B)</span>
                    <span className="text-xl font-bold">{formatCurrency(viewModel.netPayment)}</span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="allowance" className="mt-0">
            {employees.find(e => e.id === payroll.employeeId) && (
              <AllowanceInputPanel
                employee={employees.find(e => e.id === payroll.employeeId)!}
                onDirtyChange={onDirtyChange}
                monthlyData={(() => {
                  const rec = monthlyRecords?.find(r => r.employeeId === payroll.employeeId);
                  return {
                    workDays: rec?.workDays ?? payroll.workDays ?? 0,
                    saturdayWorkDays: (rec as any)?.saturdayWorkDays ?? 0,
                    sundayWorkHours: (rec as any)?.sundayWorkHours ?? 0,
                  };
                })()}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}