import { useLocation } from "wouter";
import { useWorkMonth } from "@/lib/work-month";
import { useNavigationGuard } from "@/context/navigation-guard-context";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetDashboardSummary, useGetMonthlyTrend, useGetPendingEmployees } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { AlertsCard } from "@/components/alerts/alert-bell";
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
  /** null のときは読み込み中 */
  value: string | null;
  sub?: React.ReactNode;
  tone: { bg: string; num: string; iconBg: string };
}) {
  return (
    <div className={`rounded-xl border ${tone.bg} p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 jp-tight">{label}</span>
        <span className={`p-1.5 rounded-lg ${tone.iconBg}`}>{icon}</span>
      </div>
      {/* 読み込み中は「¥0」と出さず、骨組みだけを出す（0円と見間違えないように）*/}
      {value === null
        ? <div className="h-8 w-32 mt-2 rounded bg-muted animate-pulse" aria-label="読み込み中" />
        : <div className={`text-2xl font-bold amount mt-2 ${tone.num}`}>{value}</div>}
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

/** 給与明細の状態（明細が無い＝未計算・計算済みで未確定・確定済）*/
function PayrollStateBadge({ hasPayroll, status }: { hasPayroll: boolean; status: string | null | undefined }) {
  if (!hasPayroll) return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40">未計算</Badge>;
  if (status === "confirmed") return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40">確定済</Badge>;
  return <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40">未確定</Badge>;
}

export default function Dashboard() {
  // 月は画面どうしで共有する（ダッシュボードで選んだ月のまま、月次実績入力・給与明細を開ける）
  const { year, month, ready, setWorkMonth } = useWorkMonth();
  const [, setLocation] = useLocation();
  const { requestNavigate } = useNavigationGuard();

  const { data: summaryRaw, isLoading: summaryLoading } = useGetDashboardSummary({ year, month });
  const summary = ready && !summaryLoading ? summaryRaw : undefined;
  const loading = !summary;
  // 推移は「過去12ヶ月」固定で year/month パラメータを取らない（生成型どおり）。
  // 旧コードは {year,month} を渡していたが options として無視されていたため実行時挙動は同一。
  const { data: trends } = useGetMonthlyTrend();
  const { data: pendingEmployees, isLoading: pendingLoading } = useGetPendingEmployees({ year, month });
  const openRow = (emp: { id: number; hasMonthlyRecord: boolean }) =>
    requestNavigate(
      emp.hasMonthlyRecord ? `/payroll?y=${year}&m=${month}&emp=${emp.id}` : `/monthly-input?y=${year}&m=${month}&emp=${emp.id}`,
      setLocation,
    );

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
          <RichMonthPicker year={year} month={month} onChange={(y, m) => setWorkMonth(y, m)} />
        </div>

        {/* ── 従業員のお知らせ（年齢の節目・設定の確認など）── */}
        <AlertsCard />

        {/* ── KPI タイル ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={<Wallet className="h-4 w-4 text-blue-600" />}
            label="支給総額"
            value={loading ? null : formatCurrency(summary?.totalGrossSalary || 0)}
            sub={loading ? undefined : <>差引支給額 <span className="amount font-medium text-foreground/70">{formatCurrency(summary?.totalNetSalary || 0)}</span></>}
            tone={{ bg: "bg-blue-50/60 border-blue-100 dark:bg-blue-500/10 dark:border-blue-500/30", num: "text-blue-700 dark:text-blue-300", iconBg: "bg-blue-100 dark:bg-blue-500/20" }}
          />
          <StatTile
            icon={<ClipboardCheck className="h-4 w-4 text-emerald-600" />}
            label="給与確定状況"
            value={loading ? null : `${summary?.confirmedCount || 0} / ${summary?.totalEmployees || 0} 人`}
            sub={loading ? undefined : (() => {
              // 「未確定」に、まだ明細が無い人（未計算）まで入っていたので分ける
              const rows = pendingEmployees ?? [];
              const uncalculated = rows.filter((e) => !e.hasPayroll).length;
              const drafts = rows.filter((e) => e.hasPayroll && e.payrollStatus !== "confirmed").length;
              return <>未確定 <span className="amount font-medium text-amber-600 dark:text-amber-300">{drafts}人</span>・未計算 <span className="amount font-medium text-slate-600 dark:text-slate-300">{uncalculated}人</span></>;
            })()}
            tone={{ bg: "bg-emerald-50/60 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30", num: "text-emerald-700 dark:text-emerald-300", iconBg: "bg-emerald-100 dark:bg-emerald-500/20" }}
          />
          <StatTile
            icon={<TrendingUp className="h-4 w-4 text-violet-600" />}
            label="平均の差引支給額（手取り）"
            value={loading ? null : formatCurrency(Math.round(summary?.averageNetSalary || 0))}
            sub="明細がある人の差引支給額の平均（総支給の平均ではありません）"
            tone={{ bg: "bg-violet-50/60 border-violet-100 dark:bg-violet-500/10 dark:border-violet-500/30", num: "text-violet-700 dark:text-violet-300", iconBg: "bg-violet-100 dark:bg-violet-500/20" }}
          />
          <StatTile
            icon={<Landmark className="h-4 w-4 text-amber-600" />}
            label="社会保険料・税金等"
            value={loading ? null : formatCurrency(taxTotal)}
            sub={loading ? undefined : 
              <span className="flex gap-2 flex-wrap">
                <span>社保 <span className="amount">{formatCurrency(summary?.totalSocialInsurance || 0)}</span></span>
                <span>所得税 <span className="amount">{formatCurrency(summary?.totalIncomeTax || 0)}</span></span>
              </span>
            }
            tone={{ bg: "bg-amber-50/60 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/30", num: "text-amber-700 dark:text-amber-300", iconBg: "bg-amber-100 dark:bg-amber-500/20" }}
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
                    {pendingLoading || !ready ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={4}><div className="h-4 rounded bg-muted animate-pulse" /></TableCell>
                        </TableRow>
                      ))
                    ) : (!pendingEmployees || pendingEmployees.length === 0) ? (
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
                          // キーボードでも開けるようにする（Tab で選んで Enter / Space）
                          tabIndex={0}
                          role="link"
                          aria-label={`${emp.name}さん（${emp.hasMonthlyRecord ? "給与明細を開く" : "月次実績入力を開く"}）`}
                          className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary transition-colors group"
                          onClick={() => openRow(emp)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(emp); } }}
                          title={emp.hasMonthlyRecord ? "給与明細へ" : "月次実績入力へ"}
                        >
                          <TableCell className="font-medium jp-tight">{emp.name}</TableCell>
                          <TableCell>
                            {!emp.hasMonthlyRecord ? (
                              <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40">未入力</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40">入力済</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <PayrollStateBadge hasPayroll={emp.hasPayroll} status={emp.payrollStatus} />
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
