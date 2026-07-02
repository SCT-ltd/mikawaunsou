import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetDashboardSummary, useGetMonthlyTrend, useGetPendingEmployees } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, Wallet, ClipboardCheck, TrendingUp, Landmark, AlertTriangle, ChevronRight } from "lucide-react";

// グラフ2系列（カテゴリ=識別可能な別色相。dataviz validator 検証済み:
// 総支給=indigo / 差引=emerald、CVD ΔE 93.1・両色 3:1 コントラスト PASS）
const COLOR_GROSS = "#4f46e5"; // indigo-600
const COLOR_NET = "#059669";   // emerald-600

// ── KPI スタットタイル ──────────────────────────────────────────────
function StatTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone: { bg: string; num: string; iconBg: string };
}) {
  return (
    <div className={`rounded-xl border ${tone.bg} p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 jp-tight">{label}</span>
        <span className={`p-1.5 rounded-lg ${tone.iconBg}`}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold amount mt-2 ${tone.num}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [, setLocation] = useLocation();

  const { data: summary } = useGetDashboardSummary({ year, month });
  // 推移は「過去12ヶ月」固定で year/month パラメータを取らない（生成型どおり）。
  // 旧コードは {year,month} を渡していたが options として無視されていたため実行時挙動は同一。
  const { data: trends } = useGetMonthlyTrend();
  const { data: pendingEmployees } = useGetPendingEmployees({ year, month });

  const taxTotal =
    (summary?.totalSocialInsurance || 0) + (summary?.totalIncomeTax || 0) + (summary?.totalResidentTax || 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* ── ヘッダー ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shrink-0">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold jp-tight leading-tight">ダッシュボード</h2>
              <p className="hidden sm:block text-[11px] text-muted-foreground leading-tight">給与・実績の概況をひと目で確認できます</p>
            </div>
          </div>
          <RichMonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
        </div>

        {/* ── KPI タイル ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={<Wallet className="h-4 w-4 text-blue-600" />}
            label="支給総額"
            value={formatCurrency(summary?.totalGrossSalary || 0)}
            sub={<>差引支給額 <span className="amount font-medium text-foreground/70">{formatCurrency(summary?.totalNetSalary || 0)}</span></>}
            tone={{ bg: "bg-blue-50/60 border-blue-100", num: "text-blue-700", iconBg: "bg-blue-100" }}
          />
          <StatTile
            icon={<ClipboardCheck className="h-4 w-4 text-emerald-600" />}
            label="給与確定状況"
            value={`${summary?.confirmedCount || 0} / ${summary?.totalEmployees || 0} 人`}
            sub={<>未確定 <span className="amount font-medium text-amber-600">{summary?.pendingCount || 0}人</span></>}
            tone={{ bg: "bg-emerald-50/60 border-emerald-100", num: "text-emerald-700", iconBg: "bg-emerald-100" }}
          />
          <StatTile
            icon={<TrendingUp className="h-4 w-4 text-violet-600" />}
            label="平均支給額"
            value={formatCurrency(summary?.averageNetSalary || 0)}
            sub="差引支給額の平均"
            tone={{ bg: "bg-violet-50/60 border-violet-100", num: "text-violet-700", iconBg: "bg-violet-100" }}
          />
          <StatTile
            icon={<Landmark className="h-4 w-4 text-amber-600" />}
            label="社会保険料・税金等"
            value={formatCurrency(taxTotal)}
            sub={
              <span className="flex gap-2 flex-wrap">
                <span>社保 <span className="amount">{formatCurrency(summary?.totalSocialInsurance || 0)}</span></span>
                <span>所得税 <span className="amount">{formatCurrency(summary?.totalIncomeTax || 0)}</span></span>
              </span>
            }
            tone={{ bg: "bg-amber-50/60 border-amber-100", num: "text-amber-700", iconBg: "bg-amber-100" }}
          />
        </div>

        {/* ── グラフ + アラート ── */}
        <div className="grid gap-4 lg:grid-cols-7">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base jp-tight">支給額推移（過去12ヶ月）</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trends || []} barGap={2} barCategoryGap="18%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(value) => `¥${(value / 10000).toLocaleString()}万`}
                    />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      cursor={{ fill: "hsl(var(--muted))" }}
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem", fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="totalGrossSalary" name="総支給額" fill={COLOR_GROSS} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="totalNetSalary" name="差引支給額" fill={COLOR_NET} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base jp-tight flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                要対応アラート（{month}月）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>社員名</TableHead>
                      <TableHead>実績入力</TableHead>
                      <TableHead>給与確定</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!pendingEmployees || pendingEmployees.length === 0) ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          <div className="flex flex-col items-center gap-1.5">
                            <ClipboardCheck className="h-7 w-7 text-emerald-300" />
                            未対応の項目はありません
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingEmployees.map(emp => (
                        <TableRow
                          key={emp.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors group"
                          onClick={() => setLocation(emp.hasMonthlyRecord ? "/payroll" : "/monthly-input")}
                          title={emp.hasMonthlyRecord ? "給与明細へ" : "月次実績入力へ"}
                        >
                          <TableCell className="font-medium jp-tight">{emp.name}</TableCell>
                          <TableCell>
                            {!emp.hasMonthlyRecord ? (
                              <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">未入力</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">入力済</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {emp.payrollStatus === "confirmed" ? (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">確定済</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">未確定</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-3">
                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
