import { useState } from "react";
import { useLocation, Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useListPayrolls, 
  useCalculatePayroll,
  useListEmployees,
  getListPayrollsQueryKey
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { Calculator, Download } from "lucide-react";
import { formatMonth } from "@/lib/format";

export default function PayrollList() {
  const [, setLocation] = useLocation();
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: payrolls, isLoading: payrollsLoading } = useListPayrolls({ year, month });
  const { data: employees } = useListEmployees({ active: true });
  const calculatePayroll = useCalculatePayroll();

  const [calculating, setCalculating] = useState(false);

  const handleCalculateAll = async () => {
    if (!employees) return;
    setCalculating(true);
    let success = 0;
    let errors = 0;

    try {
      for (const emp of employees) {
        // Skip confirmed payrolls
        const existing = payrolls?.find(p => p.employeeId === emp.id);
        if (existing?.status === "confirmed") continue;

        try {
          await calculatePayroll.mutateAsync({
            data: { employeeId: emp.id, year, month }
          });
          success++;
        } catch (err) {
          errors++;
        }
      }
      
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      
      if (errors > 0) {
        toast({
          title: "一部計算エラー",
          description: `${success}件の給与を計算しましたが、${errors}件でエラーが発生しました。実績データが入力されているか確認してください。`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "計算完了",
          description: "給与計算が完了しました。",
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
                  <TableRow key={payroll.id}>
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
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/payroll/${payroll.id}`}>
                          詳細確認
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}