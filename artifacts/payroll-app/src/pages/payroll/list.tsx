import { useState } from "react";
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
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllowanceInputPanel } from "@/components/allowance-input-panel";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { Calculator, Download, AlertCircle, X, CheckCircle2, FileText, ChevronRight } from "lucide-react";
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

  const { data: payrolls, isLoading: payrollsLoading } = useListPayrolls({ year, month });
  const { data: employees } = useListEmployees({ active: true });
  const calculatePayroll = useCalculatePayroll();

  const [calculating, setCalculating] = useState(false);
  const [calcErrors, setCalcErrors] = useState<CalcError[]>([]);
  const [selectedPayrollId, setSelectedPayrollId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("allowance");

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

  const years = Array.from({ length: 3 }, (_, i) => currentDate.getFullYear() - 1 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <AppLayout>
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
                  {years.map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                <SelectTrigger className="w-[80px] bg-card">
                  <SelectValue placeholder="月" />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => (
                    <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={handleCalculateAll} disabled={calculating || !employees?.length}>
              <Calculator className="mr-2 h-4 w-4" />
              {calculating ? "計算中..." : "月次実績から一括計算"}
            </Button>
            <Button variant="outline" onClick={handleExportCsv} disabled={!payrolls || payrolls.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              CSV出力
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
                    onClick={() => { setSelectedPayrollId(payroll.id); setActiveTab("allowance"); }}
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
                          disabled={calculating || payroll.status === "confirmed"}
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
      <Sheet open={!!selectedPayrollId} onOpenChange={(open) => { if (!open) setSelectedPayrollId(null); }}>
        <SheetContent key={selectedPayrollId} className="w-full sm:max-w-2xl overflow-y-auto print:fixed print:inset-0 print:max-w-none">
          {selectedPayrollId && (
            <PayrollDetailContent 
              id={selectedPayrollId} 
              activeTab={activeTab} 
              setActiveTab={setActiveTab}
              year={year}
              month={month}
              employees={employees || []}
              onClose={() => setSelectedPayrollId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}

// ── 詳細画面用コンポーネント (独立させることでキャッシュ汚染を防止) ──
function PayrollDetailContent({ 
  id, 
  activeTab, 
  setActiveTab, 
  year, 
  month, 
  employees,
  onClose 
}: { 
  id: number; 
  activeTab: string; 
  setActiveTab: (v: string) => void;
  year: number;
  month: number;
  employees: any[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // isLoading: 初回ロード時のみtrue, isFetching: 再取得中もtrue
  const { data: payroll, isFetching, isLoading } = useGetPayroll(id, {
    query: { 
      queryKey: getGetPayrollQueryKey(id),
      // キャッシュがあってもIDが違う可能性を考慮し、データの整合性を厳格にチェック
    }
  });
  
  const { data: monthlyRecords } = useListMonthlyRecords({ year, month });
  const confirmPayroll = useConfirmPayroll();

  const handleConfirm = async () => {
    try {
      await confirmPayroll.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      toast({ title: "給与確定", description: "給与明細を確定済みに変更しました。" });
    } catch {
      toast({ title: "エラー", description: "確定に失敗しました。", variant: "destructive" });
    }
  };

  const handlePrint = () => window.print();

  // 取得中、またはデータが選択したIDと不一致の場合はローディングを表示
  // これにより「一瞬前の人のデータが見える」ことを100%防ぎます
  if (isLoading || isFetching || !payroll || payroll.id !== id) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-3 text-muted-foreground bg-white">
        <Calculator className="h-8 w-8 animate-spin opacity-20" />
        <p className="text-sm font-medium">データを取得中...</p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <SheetHeader className="print:hidden border-b pb-4">
        <div className="flex items-center justify-between">
          <SheetTitle>給与明細詳細</SheetTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              印刷
            </Button>
            {payroll.status !== "confirmed" && (
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList className="w-full print:hidden">
          <TabsTrigger value="allowance" className="flex-1">明細入力</TabsTrigger>
          <TabsTrigger value="slip" className="flex-1">給与明細</TabsTrigger>
        </TabsList>

        <TabsContent value="slip">
          <div className="bg-white text-black rounded-lg border p-6 space-y-6 mt-2" id="payroll-slip">
            <div className="text-center border-b-2 border-black pb-3">
              <h2 className="text-xl font-bold tracking-widest">{formatMonth(payroll.year, payroll.month)} 給与明細書</h2>
            </div>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-base font-bold">{payroll.employeeName} 殿</p>
                <p className="text-xs text-gray-500 mt-0.5">社員番号: {payroll.employeeCode}</p>
                <div className="mt-1">
                  {payroll.status === "confirmed" ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">確定済</Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">計算中（未確定）</Badge>
                  )}
                </div>
              </div>
              <div className="border-2 border-black p-3 rounded text-right">
                <p className="text-xs text-gray-500 mb-0.5">差引支給額</p>
                <p className="text-xl font-bold">{formatCurrency(payroll.netSalary)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mb-2">支給項目</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {(payroll as any).useBluewingLogic ? (
                      <>
                        {[
                          ["基本給", payroll.baseSalary],
                          ["時間外手当（超過分）", payroll.overtimePay],
                          ["固定残業代（職務手当）", payroll.earlyOvertimeAllowance],
                          ["休日手当", payroll.holidayPay],
                        ].map(([label, val]) => Number(val) !== 0 && (
                          <tr key={String(label)} className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">{label}</td>
                            <td className="py-1.5 text-right">{formatCurrency(Number(val))}</td>
                          </tr>
                        ))}
                        {(payroll.customAllowancesTotal ?? 0) > 0 && (
                          <tr className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">その他手当</td>
                            <td className="py-1.5 text-right">{formatCurrency(payroll.customAllowancesTotal)}</td>
                          </tr>
                        )}
                        {(payroll as any).bluewingPerformanceAllowance > 0 && (
                          <tr className="border-b border-dotted border-blue-300 bg-blue-50">
                            <td className="py-1.5 text-blue-800 font-medium">業績手当（BW）</td>
                            <td className="py-1.5 text-right font-medium text-blue-800">{formatCurrency((payroll as any).bluewingPerformanceAllowance)}</td>
                          </tr>
                        )}
                      </>
                    ) : (
                      <>
                        {[
                          ["基本給", payroll.baseSalary],
                          ["時間外手当", payroll.overtimePay],
                          ["深夜手当", payroll.lateNightPay],
                          ["休日手当", payroll.holidayPay],
                          ["歩合給", payroll.commissionPay],
                        ].map(([label, val]) => (
                          <tr key={String(label)} className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">{label}</td>
                            <td className="py-1.5 text-right">{formatCurrency(Number(val))}</td>
                          </tr>
                        ))}
                        {(payroll.customAllowancesTotal ?? 0) > 0 && (
                          <tr className="border-b border-dotted border-gray-300">
                            <td className="py-1.5 text-gray-700">その他手当</td>
                            <td className="py-1.5 text-right">{formatCurrency(payroll.customAllowancesTotal)}</td>
                          </tr>
                        )}
                      </>
                    )}
                    <tr className="border-t-2 border-black font-bold bg-gray-50">
                      <td className="py-1.5 pl-1">総支給額 (A)</td>
                      <td className="py-1.5 text-right">{formatCurrency(payroll.grossSalary)}</td>
                    </tr>
                  </tbody>
                </table>

                {(payroll as any).useBluewingLogic && (
                  <>
                    <h3 className="font-bold border-l-4 border-blue-600 pl-2 bg-blue-50 py-1 text-sm mt-4 mb-2 text-blue-900">BW業績手当 計算内訳</h3>
                    <table className="w-full text-xs text-gray-600 bg-blue-50/40 rounded">
                      <tbody>
                        <tr className="border-b border-dotted border-blue-200">
                          <td className="py-1 pl-2">売上（BW）</td>
                          <td className="py-1 text-right pr-2">{formatCurrency((payroll as any).bluewingSalesAmount ?? 0)}</td>
                        </tr>
                        <tr className="border-b border-dotted border-blue-200">
                          <td className="py-1 pl-2 text-blue-700 font-medium">業績手当</td>
                          <td className="py-1 text-right pr-2 text-blue-700 font-medium">{formatCurrency((payroll as any).bluewingPerformanceAllowance ?? 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}

                <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mt-4 mb-2">勤怠実績</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["出勤日数", `${payroll.workDays} 日`],
                      ["時間外労働", `${payroll.overtimeHours} 時間`],
                      ["深夜労働", `${payroll.lateNightHours} 時間`],
                      ["休日労働日数", `${payroll.holidayWorkDays} 日`],
                    ].map(([label, val]) => (
                      <tr key={String(label)} className="border-b border-dotted border-gray-300">
                        <td className="py-1.5 text-gray-700">{label}</td>
                        <td className="py-1.5 text-right">{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mb-2">控除項目</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["健康保険・厚生年金", payroll.socialInsurance],
                      ["雇用保険料", payroll.employmentInsurance],
                      ["源泉所得税", payroll.incomeTax],
                      ["市県民税", payroll.residentTax],
                      ["欠勤控除", payroll.absenceDeduction],
                      ...((() => {
                        const misc = payroll.totalDeductions - (payroll.socialInsurance ?? 0) - (payroll.employmentInsurance ?? 0) - (payroll.incomeTax ?? 0) - (payroll.residentTax ?? 0) - (payroll.absenceDeduction ?? 0);
                        return misc > 0 ? [["積立金・その他", misc]] : [];
                      })()),
                    ].map(([label, val]) => (
                      <tr key={String(label)} className="border-b border-dotted border-gray-300">
                        <td className="py-1.5 text-gray-700">{label}</td>
                        <td className="py-1.5 text-right">{formatCurrency(Number(val))}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-black font-bold bg-gray-50">
                      <td className="py-1.5 pl-1">控除合計 (B)</td>
                      <td className="py-1.5 text-right">{formatCurrency(payroll.totalDeductions)}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="mt-4 border-2 border-black p-3 bg-gray-50 flex justify-between items-center rounded">
                  <span className="font-bold text-sm">差引支給額 (A - B)</span>
                  <span className="text-lg font-bold">{formatCurrency(payroll.netSalary)}</span>
                </div>

                {payroll.status !== "confirmed" && (
                  <div className="mt-4 text-xs text-amber-700 bg-amber-50 p-3 rounded border border-amber-200 print:hidden">
                    <strong>注意:</strong> 仮計算の状態です。確認後「明細を確定」ボタンを押してください。
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="allowance" className="mt-2">
          {employees.find(e => e.id === payroll.employeeId) ? (
            <AllowanceInputPanel
              employee={employees.find(e => e.id === payroll.employeeId)!}
              monthlyData={(() => {
                const rec = monthlyRecords?.find(r => r.employeeId === payroll.employeeId);
                return {
                  workDays: rec?.workDays ?? payroll.workDays ?? 0,
                  saturdayWorkDays: (rec as { saturdayWorkDays?: number } | undefined)?.saturdayWorkDays ?? 0,
                  sundayWorkHours: (rec as { sundayWorkHours?: number } | undefined)?.sundayWorkHours ?? 0,
                };
              })()}
            />
          ) : (
            <div className="py-12 text-center text-muted-foreground">社員データが見つかりません</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}