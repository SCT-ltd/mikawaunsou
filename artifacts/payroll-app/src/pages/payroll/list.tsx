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
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
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

  const { data: selectedPayroll, isLoading: detailLoading } = useGetPayroll(
    selectedPayrollId ?? 0,
    { query: { enabled: !!selectedPayrollId, queryKey: getGetPayrollQueryKey(selectedPayrollId ?? 0) } }
  );
  const confirmPayroll = useConfirmPayroll();

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

  const handlePrint = () => window.print();

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
              {calculating ? "計算中..." : "一括計算"}
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
                <TableHead className="w-[100px]"></TableHead>
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
                payrolls.map((payroll) => (
                  <TableRow
                    key={payroll.id}
                    className={`cursor-pointer transition-colors ${selectedPayrollId === payroll.id ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"}`}
                    onClick={() => setSelectedPayrollId(payroll.id)}
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
                      <span className="inline-flex items-center text-sm text-muted-foreground gap-0.5">
                        詳細 <ChevronRight className="h-3.5 w-3.5" />
                      </span>
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
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto print:fixed print:inset-0 print:max-w-none">
          <SheetHeader className="print:hidden">
            <div className="flex items-center justify-between">
              <SheetTitle>給与明細詳細</SheetTitle>
              <div className="flex items-center gap-2">
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

          {detailLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">読み込み中...</div>
          ) : !selectedPayroll ? (
            <div className="py-12 text-center text-muted-foreground">データが見つかりません</div>
          ) : (
            <div className="mt-4 bg-white text-black rounded-lg border p-6 space-y-6" id="payroll-slip">
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
                      {[
                        ["基本給", selectedPayroll.baseSalary],
                        ["時間外手当", selectedPayroll.overtimePay],
                        ["深夜手当", selectedPayroll.lateNightPay],
                        ["休日手当", selectedPayroll.holidayPay],
                        ["歩合給", selectedPayroll.commissionPay],
                        ["通勤手当", selectedPayroll.transportationAllowance],
                        ["無事故手当", selectedPayroll.safetyDrivingAllowance],
                        ["長距離手当", selectedPayroll.longDistanceAllowance],
                        ["役職手当", selectedPayroll.positionAllowance],
                      ].map(([label, val]) => (
                        <tr key={String(label)} className="border-b border-dotted border-gray-300">
                          <td className="py-1.5 text-gray-700">{label}</td>
                          <td className="py-1.5 text-right">{formatCurrency(Number(val))}</td>
                        </tr>
                      ))}
                      {/* @ts-expect-error */}
                      {(selectedPayroll.customAllowancesTotal ?? 0) > 0 && (
                        <tr className="border-b border-dotted border-gray-300">
                          <td className="py-1.5 text-gray-700">その他手当</td>
                          {/* @ts-expect-error */}
                          <td className="py-1.5 text-right">{formatCurrency(selectedPayroll.customAllowancesTotal)}</td>
                        </tr>
                      )}
                      <tr className="border-t-2 border-black font-bold bg-gray-50">
                        <td className="py-1.5 pl-1">総支給額 (A)</td>
                        <td className="py-1.5 text-right">{formatCurrency(selectedPayroll.grossSalary)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 text-sm mt-4 mb-2">勤怠実績</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {[
                        ["出勤日数", `${selectedPayroll.workDays} 日`],
                        ["時間外労働", `${selectedPayroll.overtimeHours} 時間`],
                        ["深夜労働", `${selectedPayroll.lateNightHours} 時間`],
                        ["休日労働日数", `${selectedPayroll.holidayWorkDays} 日`],
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
                      {[
                        ["健康保険・厚生年金", selectedPayroll.socialInsurance],
                        ["雇用保険料", selectedPayroll.employmentInsurance],
                        ["源泉所得税", selectedPayroll.incomeTax],
                        ["住民税", selectedPayroll.residentTax],
                        ["欠勤控除", selectedPayroll.absenceDeduction],
                      ].map(([label, val]) => (
                        <tr key={String(label)} className="border-b border-dotted border-gray-300">
                          <td className="py-1.5 text-gray-700">{label}</td>
                          <td className="py-1.5 text-right">{formatCurrency(Number(val))}</td>
                        </tr>
                      ))}
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
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}