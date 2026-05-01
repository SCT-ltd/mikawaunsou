import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
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
  useGetCompany,
  useGetEmployeeAllowances,
  useGetEmployeeDeductions,
} from "@workspace/api-client-react";
import { PayslipPrintClassic } from "@/components/payslip-print-classic";
import { PayslipBulkPrint } from "@/components/payslip-bulk-print";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllowanceInputPanel } from "@/components/allowance-input-panel";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { Calculator, Download, AlertCircle, X, CheckCircle2, FileText, ChevronRight, Printer } from "lucide-react";
import { formatMonth } from "@/lib/format";

interface CalcError {
  employeeCode: string;
  name: string;
  message: string;
}

export default function PayrollList() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: payrolls, isLoading: payrollsLoading } = useListPayrolls({ year, month }, { query: { staleTime: 0, refetchOnMount: "always" } });
  const { data: employees } = useListEmployees({ active: true }, { query: { staleTime: 0, refetchOnMount: "always" } });
  const { data: company } = useGetCompany();
  const calculatePayroll = useCalculatePayroll();

  const [calculating, setCalculating] = useState(false);
  const [printPayroll, setPrintPayroll] = useState<NonNullable<ReturnType<typeof useGetPayroll>["data"]> | null>(null);
  const [bulkPrintActive, setBulkPrintActive] = useState(false);
  const [calcErrors, setCalcErrors] = useState<CalcError[]>([]);
  const [selectedPayrollId, setSelectedPayrollId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("allowance");

  // 未保存変更ガード
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const requestAction = useCallback((action: () => void) => {
    if (isDirty) {
      pendingActionRef.current = action;
      setShowUnsavedDialog(true);
    } else {
      action();
    }
  }, [isDirty]);

  const tryCloseSheet = useCallback(() => {
    requestAction(() => {
      setSelectedPayrollId(null);
      setIsDirty(false);
    });
  }, [requestAction]);

  const trySelectPayroll = useCallback((id: number) => {
    if (selectedPayrollId === id) return;
    requestAction(() => {
      setSelectedPayrollId(id);
      setActiveTab("allowance");
      setIsDirty(false);
    });
  }, [requestAction, selectedPayrollId]);

  const { data: monthlyRecords } = useListMonthlyRecords({ year, month });

  const { data: selectedPayroll, isLoading: detailLoading } = useGetPayroll(
    selectedPayrollId ?? 0,
    { query: { enabled: !!selectedPayrollId, queryKey: getGetPayrollQueryKey(selectedPayrollId ?? 0), staleTime: 0, refetchOnMount: "always" } }
  );
  const confirmPayroll = useConfirmPayroll();

  const selectedEmployeeId = selectedPayroll?.employeeId ?? 0;
  const { data: printEmployeeAllowances, isLoading: allowancesLoading } = useGetEmployeeAllowances(selectedEmployeeId, {
    query: { enabled: !!selectedPayroll?.employeeId },
  });
  const { data: printEmployeeDeductions, isLoading: deductionsLoading } = useGetEmployeeDeductions(selectedEmployeeId, {
    query: { enabled: !!selectedPayroll?.employeeId },
  });
  const selectedEmployee = employees?.find(e => e.id === selectedEmployeeId);
  const isTaxExempt = selectedEmployee?.taxExempt === true;

  const handleConfirm = async () => {
    if (!selectedPayrollId) return;
    try {
      await confirmPayroll.mutateAsync({ id: selectedPayrollId });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(selectedPayrollId) });
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      toast({ title: "給与確定", description: "給与明細を確定済みに変更しました。" });
    } catch {
      toast({ title: "エラー", description: "確定に失敗しました。", variant: "destructive" });
    }
  };

  useEffect(() => {
    const cleanup = () => {
      console.log("[handlePrint] afterprint: cleaning up print portal.");
      setPrintPayroll(null);
    };
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);

  const handlePrint = useCallback(() => {
    if (!selectedPayroll) {
      console.warn("[handlePrint] No payroll selected.");
      return;
    }
    console.log("[handlePrint] Setting print payroll...");
    setPrintPayroll(selectedPayroll);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const printTargets = document.querySelectorAll("[data-print-target='payslip-classic']");
        console.log("[handlePrint] data-print-target='payslip-classic' count:", printTargets.length);
        if (printTargets.length !== 1) {
          console.error("印刷対象DOMが1つではありません", printTargets.length);
          alert("印刷対象の生成に問題があります。ページをリロードして再度お試しください。");
          setPrintPayroll(null);
          return;
        }
        window.print();
      });
    });
  }, [selectedPayroll]);

  const handleCalculateAll = async () => {
    if (!employees) return;
    setCalculating(true);
    setCalcErrors([]);
    let success = 0;
    const errorList: CalcError[] = [];

    try {
      for (const emp of employees) {
        const existing = payrolls?.find(p => p.employeeId === emp.id);
        if (existing?.status === "confirmed") continue;

        try {
          await calculatePayroll.mutateAsync({
            data: { employeeId: emp.id, year, month }
          });
          success++;
        } catch (err: unknown) {
          let msg = "不明なエラー";
          if (err && typeof err === "object") {
            const e = err as { data?: { error?: string }; message?: string };
            const apiMsg = (e.data as { error?: string } | null)?.error ?? e.message ?? "";
            if (apiMsg.toLowerCase().includes("monthly record not found")) {
              msg = `${formatMonth(year, month)}の月次実績が未入力です`;
            } else if (apiMsg) {
              msg = apiMsg;
            }
          }
          errorList.push({ employeeCode: emp.employeeCode, name: emp.name, message: msg });
        }
      }
      
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      
      if (errorList.length > 0) {
        setCalcErrors(errorList);
        toast({
          title: success > 0 ? `${success}件の計算が完了しました` : "計算エラー",
          description: `${errorList.length}件はエラーのため未計算です。下の詳細を確認してください。`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "計算完了",
          description: `${success}件の給与計算が完了しました。`,
        });
      }
    } finally {
      setCalculating(false);
    }
  };

  const handleExportCsv = async () => {
    // We construct the URL and create a temporary link to download it
    const url = `/api/payrolls/export/csv?year=${year}&month=${month}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `給与明細データ_${year}${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    toast({
      title: "CSVエクスポート",
      description: "ダウンロードを開始しました。",
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">給与明細一覧</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2">
              <RichMonthPicker
                year={year}
                month={month}
                onChange={(y, m) => { setYear(y); setMonth(m); }}
              />
            </div>
            <Button variant="secondary" onClick={handleCalculateAll} disabled={calculating || !employees?.length}>
              <Calculator className="mr-2 h-4 w-4" />
              {calculating ? "計算中..." : "月次実績から一括計算"}
            </Button>
            <Button variant="outline" onClick={handleExportCsv} disabled={!payrolls || payrolls.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              CSV出力
            </Button>
            <Button variant="outline" onClick={() => setBulkPrintActive(true)} disabled={!payrolls || payrolls.length === 0 || bulkPrintActive}>
              <Printer className="mr-2 h-4 w-4" />
              {bulkPrintActive ? "印刷準備中..." : "給与明細一括印刷"}
            </Button>
          </div>
        </div>

        {calcErrors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-red-700 text-sm mb-2">
                    以下の社員の給与計算でエラーが発生しました
                  </p>
                  <ul className="space-y-1.5">
                    {calcErrors.map((e) => (
                      <li key={e.employeeCode} className="text-sm text-red-700">
                        <span className="font-semibold">{e.employeeCode} {e.name}</span>
                        <span className="text-red-500 mx-1">—</span>
                        <span>{e.message}</span>
                        {e.message.includes("月次実績") && (
                          <Link
                            href={`/monthly-input`}
                            className="ml-2 inline-flex items-center text-xs font-semibold text-red-600 underline underline-offset-2 hover:text-red-800"
                          >
                            月次実績入力へ →
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                onClick={() => setCalcErrors([])}
                className="shrink-0 text-red-400 hover:text-red-600 transition-colors"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">社員番号</TableHead>
                <TableHead>氏名</TableHead>
                <TableHead className="text-right">総支給額</TableHead>
                <TableHead className="text-right">控除合計</TableHead>
                <TableHead className="text-right">差引支給額</TableHead>
                <TableHead className="text-center">ステータス</TableHead>
                <TableHead className="w-[200px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollsLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    読み込み中...
                  </TableCell>
                </TableRow>
              ) : !payrolls || payrolls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {formatMonth(year, month)}の給与データはありません。「一括計算」を実行するか、実績データを入力してください。
                  </TableCell>
                </TableRow>
              ) : (
                [...payrolls].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)).map((payroll) => (
                  <TableRow
                    key={payroll.id}
                    className={`cursor-pointer transition-colors ${selectedPayrollId === payroll.id ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"}`}
                    onClick={() => trySelectPayroll(payroll.id)}
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
                        <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">計算中（未確定）</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-primary hover:text-primary/80"
                          disabled={calculating}
                          onClick={(e) => {
                            e.stopPropagation();
                            (async () => {
                              try {
                                await calculatePayroll.mutateAsync({ data: { employeeId: payroll.employeeId, year, month } });
                                queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
                                toast({ title: "計算完了", description: `${payroll.employeeName}の給与計算が完了しました。` });
                              } catch {
                                toast({ title: "エラー", description: "計算に失敗しました。月次実績を確認してください。", variant: "destructive" });
                              }
                            })();
                          }}
                        >
                          <Calculator className="h-3 w-3 mr-1" />
                          月次実績から計算
                        </Button>
                        <span className="inline-flex items-center text-sm text-muted-foreground gap-0.5">
                          詳細 <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 給与明細詳細シート */}
      <Sheet open={!!selectedPayrollId} onOpenChange={(open) => { if (!open) tryCloseSheet(); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto print:fixed print:inset-0 print:max-w-none">
          <SheetHeader className="print:hidden">
            <div className="flex items-center justify-between">
              <SheetTitle>
                給与明細詳細
                {selectedPayroll && (
                  <span className="ml-2 text-base font-normal text-muted-foreground">{selectedPayroll.employeeName}</span>
                )}
              </SheetTitle>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {selectedPayroll && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                    onClick={async () => {
                      try {
                        await calculatePayroll.mutateAsync({ data: { employeeId: selectedPayroll.employeeId, year, month, calculationMode: "manual" } });
                        queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(selectedPayroll.id) });
                        queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
                        toast({ title: "手入力固定で計算完了", description: "マスター基本給と手当設定で給与を再計算しました。" });
                      } catch {
                        toast({ title: "エラー", description: "計算に失敗しました。", variant: "destructive" });
                      }
                    }}
                  >
                    <Calculator className="h-3 w-3 mr-1" />
                    手入力固定で計算
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  印刷
                </Button>
                {selectedPayroll && selectedPayroll.status !== "confirmed" && (
                  <Button
                    size="sm"
                    onClick={handleConfirm}
                    disabled={confirmPayroll.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    明細を確定
                  </Button>
                )}
              </div>
            </div>
          </SheetHeader>

          {(detailLoading || (!!selectedPayroll?.employeeId && (allowancesLoading || deductionsLoading))) ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">読み込み中...</div>
          ) : !selectedPayroll ? (
            <div className="py-12 text-center text-muted-foreground">データが見つかりません</div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
              <TabsList className="w-full print:hidden">
                <TabsTrigger value="allowance" className="flex-1">明細入力</TabsTrigger>
                <TabsTrigger value="slip" className="flex-1">給与明細</TabsTrigger>
              </TabsList>

              {/* ── 給与明細タブ ── */}
              <TabsContent value="slip">
                <div className="bg-white text-black rounded-lg border p-6 space-y-6 mt-2" id="payroll-slip">
                  <div className="text-center border-b-2 border-black pb-3">
                    <h2 className="text-xl font-bold tracking-widest">{formatMonth(selectedPayroll.year, selectedPayroll.month)} 給与明細書</h2>
                  </div>

                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-base font-bold">{selectedPayroll.employeeName} 殿</p>
                      <p className="text-xs text-gray-500 mt-0.5">社員番号: {selectedPayroll.employeeCode}</p>
                      <div className="mt-1">
                        {selectedPayroll.status === "confirmed" ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">確定済</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">計算中（未確定）</Badge>
                        )}
                      </div>
                    </div>
                    <div className="border-2 border-black p-3 rounded text-right">
                      <p className="text-xs text-gray-500 mb-0.5">差引支給額</p>
                      <p className="text-xl font-bold">{formatCurrency(selectedPayroll.netSalary)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* 支給項目 */}
                    <div>
                      <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mb-2">支給項目</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          {/* 基本給 */}
                          {Number(selectedPayroll.baseSalary) !== 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">基本給</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.baseSalary))}</td>
                            </tr>
                          )}
                          {/* 残業・深夜・休日手当 */}
                          {Number(selectedPayroll.overtimePay) !== 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">{(selectedPayroll as any).useBluewingLogic ? "時間外手当（超過分）" : "時間外手当"}</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.overtimePay))}</td>
                            </tr>
                          )}
                          {Number(selectedPayroll.lateNightPay) !== 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">深夜手当</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.lateNightPay))}</td>
                            </tr>
                          )}
                          {Number(selectedPayroll.holidayPay) !== 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">祝日/休日手当</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.holidayPay))}</td>
                            </tr>
                          )}
                          {Number(selectedPayroll.commissionPay) !== 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">歩合給</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.commissionPay))}</td>
                            </tr>
                          )}
                          {/* 固定手当（マスター） */}
                          {Number(selectedPayroll.earlyOvertimeAllowance) !== 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">{(selectedPayroll as any).useBluewingLogic ? "固定残業代（職務手当）" : "早出残業手当"}</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.earlyOvertimeAllowance))}</td>
                            </tr>
                          )}
                          {/* カスタム手当（個別表示） */}
                          {printEmployeeAllowances && printEmployeeAllowances.length > 0
                            ? printEmployeeAllowances.map((a) => (
                                <tr key={a.id} className="border-b border-dotted border-gray-300">
                                  <td className="py-1.5 text-gray-700">{a.allowanceName}</td>
                                  <td className="py-1.5 text-right">{formatCurrency(a.amount)}</td>
                                </tr>
                              ))
                            : (
                              <>
                                {Number(selectedPayroll.transportationAllowance) !== 0 && (
                                  <tr className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 text-gray-700">通勤手当</td>
                                    <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.transportationAllowance))}</td>
                                  </tr>
                                )}
                                {Number(selectedPayroll.safetyDrivingAllowance) !== 0 && (
                                  <tr className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 text-gray-700">無事故手当</td>
                                    <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.safetyDrivingAllowance))}</td>
                                  </tr>
                                )}
                                {Number(selectedPayroll.longDistanceAllowance) !== 0 && (
                                  <tr className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 text-gray-700">長距離手当</td>
                                    <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.longDistanceAllowance))}</td>
                                  </tr>
                                )}
                                {Number(selectedPayroll.positionAllowance) !== 0 && (
                                  <tr className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 text-gray-700">役職手当</td>
                                    <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.positionAllowance))}</td>
                                  </tr>
                                )}
                                {(selectedPayroll.customAllowancesTotal ?? 0) > 0 && (
                                  <tr className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 text-gray-700">その他手当</td>
                                    <td className="py-1.5 text-right">{formatCurrency(selectedPayroll.customAllowancesTotal ?? 0)}</td>
                                  </tr>
                                )}
                              </>
                            )
                          }
                          {/* BW業績手当（bluewing_autoモードのみ表示） */}
                          {(selectedPayroll as any).calculationMode === "bluewing_auto" && ((selectedPayroll as any).bluewingPerformanceAllowance ?? 0) > 0 && (
                            <tr className="border-b border-dotted border-blue-300 bg-blue-50">
                              <td className="py-1.5 text-blue-800 font-medium">業績手当（BW自動）</td>
                              <td className="py-1.5 text-right font-medium text-blue-800">{formatCurrency((selectedPayroll as any).bluewingPerformanceAllowance)}</td>
                            </tr>
                          )}
                          <tr className="border-t-2 border-black font-bold bg-gray-50">
                            <td className="py-1.5 pl-1">総支給額 (A)</td>
                            <td className="py-1.5 text-right">{formatCurrency(selectedPayroll.grossSalary)}</td>
                          </tr>
                        </tbody>
                      </table>

                      {/* ブルーウィング計算内訳 */}
                      {/* @ts-expect-error */}
                      {(selectedPayroll as any).useBluewingLogic && (
                        <>
                          <h3 className="font-bold border-l-4 border-blue-600 pl-2 bg-blue-50 py-1 text-sm mt-4 mb-2 text-blue-900">BW業績手当 計算内訳</h3>
                          <table className="w-full text-xs text-gray-600 bg-blue-50/40 rounded">
                            <tbody>
                              <tr className="border-b border-dotted border-blue-200">
                                <td className="py-1 pl-2">売上（BW）</td>
                                {/* @ts-expect-error */}
                                <td className="py-1 text-right pr-2">{formatCurrency((selectedPayroll as any).bluewingSalesAmount ?? 0)}</td>
                              </tr>
                              <tr className="border-b border-dotted border-blue-200">
                                <td className="py-1 pl-2 text-blue-700 font-medium">業績手当</td>
                                {/* @ts-expect-error */}
                                <td className="py-1 text-right pr-2 text-blue-700 font-medium">{formatCurrency((selectedPayroll as any).bluewingPerformanceAllowance ?? 0)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </>
                      )}

                      <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mt-4 mb-2">勤怠実績</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            ["出勤日数", `${selectedPayroll.workDays} 日`],
                            ["時間外労働", `${selectedPayroll.overtimeHours} 時間`],
                            ["深夜労働", `${selectedPayroll.lateNightHours} 時間`],
                            ["日曜/祝日出勤日数", `${selectedPayroll.sundayWorkDays} 日`],
                          ].map(([label, val]) => (
                            <tr key={String(label)} className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">{label}</td>
                              <td className="py-1.5 text-right">{val}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* 控除項目 */}
                    <div>
                      <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mb-2">控除項目</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          {/* 社会保険料 */}
                          <tr className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">社会保険料（健保・子育て支援金・厚年）</td>
                            <td className="py-1.5 text-right">
                              {isTaxExempt ? <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">非課税</span> : formatCurrency(Number(selectedPayroll.socialInsurance))}
                            </td>
                          </tr>
                          {/* うち子育て支援金 */}
                          {(selectedPayroll.childcareSupportContribution ?? 0) > 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">　うち 子ども・子育て支援金</td>
                              <td className="py-1.5 text-right">
                                {isTaxExempt ? <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">非課税</span> : formatCurrency(Number(selectedPayroll.childcareSupportContribution))}
                              </td>
                            </tr>
                          )}
                          {/* 雇用保険料 */}
                          <tr className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">雇用保険料</td>
                            <td className="py-1.5 text-right">
                              {isTaxExempt ? <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">非課税</span> : formatCurrency(Number(selectedPayroll.employmentInsurance))}
                            </td>
                          </tr>
                          {/* 源泉所得税 */}
                          <tr className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">源泉所得税</td>
                            <td className="py-1.5 text-right">
                              {isTaxExempt ? <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">非課税</span> : formatCurrency(Number(selectedPayroll.incomeTax))}
                            </td>
                          </tr>
                          {/* 市県民税（住民税）は非課税でも金額表示 */}
                          <tr className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">市県民税</td>
                            <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.residentTax))}</td>
                          </tr>
                          {/* 欠勤控除 */}
                          {Number(selectedPayroll.absenceDeduction) > 0 && (
                            <tr className="border-b border-dotted border-gray-300">
                              <td className="py-1.5 text-gray-700">欠勤控除</td>
                              <td className="py-1.5 text-right">{formatCurrency(Number(selectedPayroll.absenceDeduction))}</td>
                            </tr>
                          )}
                          {/* 積立金・カスタム控除（個別表示） */}
                          {printEmployeeDeductions && printEmployeeDeductions.length > 0
                            ? printEmployeeDeductions.map((d) => (
                                <tr key={d.id} className="border-b border-dotted border-gray-300">
                                  <td className="py-1.5 text-gray-700">{d.deductionName}</td>
                                  <td className="py-1.5 text-right">{formatCurrency(d.amount)}</td>
                                </tr>
                              ))
                            : (() => {
                                const customDed = (selectedPayroll as any).customDeductionsTotal ?? 0;
                                return customDed > 0 ? (
                                  <tr className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 text-gray-700">積立金・その他</td>
                                    <td className="py-1.5 text-right">{formatCurrency(customDed)}</td>
                                  </tr>
                                ) : null;
                              })()
                          }
                          <tr className="border-t-2 border-black font-bold bg-gray-50">
                            <td className="py-1.5 pl-1">控除合計 (B)</td>
                            <td className="py-1.5 text-right">{formatCurrency(selectedPayroll.totalDeductions)}</td>
                          </tr>
                        </tbody>
                      </table>

                      <div className="mt-4 border-2 border-black p-3 bg-gray-50 flex justify-between items-center rounded">
                        <span className="font-bold text-sm">差引支給額 (A - B)</span>
                        <span className="text-lg font-bold">{formatCurrency(selectedPayroll.netSalary)}</span>
                      </div>

                      {selectedPayroll.status !== "confirmed" && (
                        <div className="mt-4 text-xs text-amber-700 bg-amber-50 p-3 rounded border border-amber-200 print:hidden">
                          <strong>注意:</strong> 仮計算の状態です。確認後「明細を確定」ボタンを押してください。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── 手当入力タブ ── */}
              <TabsContent value="allowance" className="mt-2">
                {employees?.find(e => e.id === selectedPayroll.employeeId) ? (
                  <AllowanceInputPanel
                    employee={employees.find(e => e.id === selectedPayroll.employeeId)!}
                    monthlyData={(() => {
                      const rec = monthlyRecords?.find(r => r.employeeId === selectedPayroll.employeeId);
                      return {
                        workDays: rec?.workDays ?? selectedPayroll.workDays ?? 0,
                        saturdayWorkDays: (rec as { saturdayWorkDays?: number } | undefined)?.saturdayWorkDays ?? 0,
                        sundayWorkDays: (rec as { sundayWorkDays?: number } | undefined)?.sundayWorkDays ?? 0,
                      };
                    })()}
                    onDirtyChange={setIsDirty}
                    year={year}
                    month={month}
                  />
                ) : (
                  <div className="py-12 text-center text-muted-foreground">社員データが見つかりません</div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      {/* 未保存変更確認ダイアログ */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存していません</AlertDialogTitle>
            <AlertDialogDescription>
              変更が保存されていません。このまま移動すると変更内容が失われます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                const action = pendingActionRef.current;
                pendingActionRef.current = null;
                setShowUnsavedDialog(false);
                action?.();
              }}
            >
              保存せずに移動
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 一括印刷ポータル ── */}
      {bulkPrintActive && payrolls && payrolls.length > 0 && (
        <PayslipBulkPrint
          payrolls={[...payrolls].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)) as Parameters<typeof PayslipBulkPrint>[0]["payrolls"]}
          companyName={company?.name ?? "三川運送株式会社"}
          employees={(employees ?? []) as Parameters<typeof PayslipBulkPrint>[0]["employees"]}
          company={company as Parameters<typeof PayslipBulkPrint>[0]["company"]}
          onDone={() => setBulkPrintActive(false)}
        />
      )}

      {/* ── 印刷専用ポータル（@media print で表示、通常時は非表示） ── */}
      {printPayroll && (
        <PayslipPrintClassic
          payroll={printPayroll as Parameters<typeof PayslipPrintClassic>[0]["payroll"]}
          companyName={company?.name ?? "三川運送株式会社"}
          employeeAllowances={printEmployeeAllowances as Parameters<typeof PayslipPrintClassic>[0]["employeeAllowances"]}
          employeeDeductions={printEmployeeDeductions as Parameters<typeof PayslipPrintClassic>[0]["employeeDeductions"]}
          employee={employees?.find(e => e.id === printPayroll.employeeId) as Parameters<typeof PayslipPrintClassic>[0]["employee"]}
          company={company as Parameters<typeof PayslipPrintClassic>[0]["company"]}
        />
      )}
    </AppLayout>
  );
}