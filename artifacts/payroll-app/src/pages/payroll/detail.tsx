import { useLocation, useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useGetPayroll, 
  getGetPayrollQueryKey,
  useConfirmPayroll,
  useUpdatePayroll
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatMonth } from "@/lib/format";
import { ChevronLeft, CheckCircle2, FileText } from "lucide-react";

export default function PayrollDetail() {
  const { id } = useParams();
  const payrollId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: payroll, isLoading } = useGetPayroll(payrollId, {
    query: { enabled: !!payrollId, queryKey: getGetPayrollQueryKey(payrollId) }
  });

  const confirmPayroll = useConfirmPayroll();

  const handleConfirm = async () => {
    try {
      await confirmPayroll.mutateAsync({ id: payrollId });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(payrollId) });
      toast({
        title: "給与確定",
        description: "給与明細を確定済みに変更しました。以後の再計算はできません。",
      });
    } catch (error) {
      toast({
        title: "エラー",
        description: "給与の確定に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return <AppLayout><div className="flex h-full items-center justify-center">読み込み中...</div></AppLayout>;
  }

  if (!payroll) {
    return <AppLayout><div className="p-6">給与データが見つかりません。</div></AppLayout>;
  }

  const isConfirmed = payroll.status === "confirmed";

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Print only styles should be added in a real app, here we simulate the button actions */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" asChild>
              <Link href="/payroll">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h2 className="text-2xl font-bold tracking-tight">給与明細詳細</h2>
            {isConfirmed ? (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">確定済</Badge>
            ) : (
              <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">計算中（未確定）</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <FileText className="mr-2 h-4 w-4" />
              印刷
            </Button>
            {!isConfirmed && (
              <Button onClick={handleConfirm} disabled={confirmPayroll.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                明細を確定する
              </Button>
            )}
          </div>
        </div>

        {/* Paper-like container for the slip */}
        <div className="bg-white text-black p-8 rounded-lg shadow-sm border" id="payroll-slip">
          <div className="text-center border-b-2 border-black pb-4 mb-6">
            <h1 className="text-2xl font-bold tracking-[0.3em]">{formatMonth(payroll.year, payroll.month)} 給与明細書</h1>
          </div>

          <div className="flex justify-between mb-8">
            <div className="text-lg">
              <span className="mr-4 text-gray-600">氏名</span>
              <span className="font-bold border-b border-black pb-1 px-4">{payroll.employeeName} 殿</span>
              <span className="text-sm ml-4 text-gray-500">社員番号: {payroll.employeeCode}</span>
            </div>
            <div className="text-lg font-bold border-2 border-black p-2 rounded">
              <span className="text-sm text-gray-600 font-normal mr-4">差引支給額</span>
              {formatCurrency(payroll.netSalary)}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column: Earnings */}
            <div className="space-y-4">
              <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1">支給項目</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">基本給</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.baseSalary)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">時間外手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.overtimePay)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">深夜手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.lateNightPay)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">休日手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.holidayPay)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">歩合給</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.commissionPay)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">通勤手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.transportationAllowance)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">無事故手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.safetyDrivingAllowance)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">長距離手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.longDistanceAllowance)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">役職手当</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.positionAllowance)}</td>
                  </tr>
                  {/* @ts-expect-error customAllowancesTotal might be injected */}
                  {payroll.customAllowancesTotal > 0 && (
                    <tr className="border-b border-dotted border-gray-300">
                      <td className="py-2">その他手当</td>
                      {/* @ts-expect-error */}
                      <td className="py-2 text-right">{formatCurrency(payroll.customAllowancesTotal)}</td>
                    </tr>
                  )}
                  <tr className="border-b-2 border-black font-bold bg-gray-50">
                    <td className="py-2 pl-2">総支給額 (A)</td>
                    <td className="py-2 text-right pr-2">{formatCurrency(payroll.grossSalary)}</td>
                  </tr>
                </tbody>
              </table>

              <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1 mt-6">勤怠実績</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">出勤日数</td>
                    <td className="py-2 text-right">{payroll.workDays} 日</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">時間外労働</td>
                    <td className="py-2 text-right">{payroll.overtimeHours} 時間</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">深夜労働</td>
                    <td className="py-2 text-right">{payroll.lateNightHours} 時間</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">休日労働日数</td>
                    <td className="py-2 text-right">{payroll.holidayWorkDays} 日</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right Column: Deductions */}
            <div className="space-y-4">
              <h3 className="font-bold border-l-4 border-black pl-2 bg-gray-100 py-1">控除項目</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">健康保険料・厚生年金</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.socialInsurance)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">雇用保険料</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.employmentInsurance)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">源泉所得税</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.incomeTax)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300">
                    <td className="py-2">住民税</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.residentTax)}</td>
                  </tr>
                  <tr className="border-b border-dotted border-gray-300 text-red-600">
                    <td className="py-2">欠勤控除</td>
                    <td className="py-2 text-right">{formatCurrency(payroll.absenceDeduction)}</td>
                  </tr>
                  <tr className="border-b-2 border-black font-bold bg-gray-50">
                    <td className="py-2 pl-2">控除合計額 (B)</td>
                    <td className="py-2 text-right pr-2">{formatCurrency(payroll.totalDeductions)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-8 border-2 border-black p-4 bg-gray-50 flex justify-between items-center">
                <span className="font-bold">差引支給額 (A - B)</span>
                <span className="text-xl font-bold">{formatCurrency(payroll.netSalary)}</span>
              </div>
              
              {!isConfirmed && (
                <div className="mt-8 text-sm text-amber-600 bg-amber-50 p-4 rounded border border-amber-200 print:hidden">
                  <strong>注意:</strong> この明細は現在仮計算の状態です。金額を確認し、問題なければ上部の「明細を確定する」ボタンを押してください。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}