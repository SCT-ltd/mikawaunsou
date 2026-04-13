import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetDashboardSummary, useGetMonthlyTrend, useGetPendingEmployees } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary({ year, month });
  const { data: trends } = useGetMonthlyTrend({ year, month });
  const { data: pendingEmployees } = useGetPendingEmployees({ year, month });

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">ダッシュボード</h2>
          <div className="flex gap-2">
            <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-[120px] bg-card">
                <SelectValue placeholder="年" />
              </SelectTrigger>
              <SelectContent>
                {years.map(y => (
                  <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
              <SelectTrigger className="w-[100px] bg-card">
                <SelectValue placeholder="月" />
              </SelectTrigger>
              <SelectContent>
                {months.map(m => (
                  <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">支給総額</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary?.totalGrossSalary || 0)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                差引支給額: {formatCurrency(summary?.totalNetSalary || 0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">給与確定状況</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary?.confirmedCount || 0} / {summary?.totalEmployees || 0} 人
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                未確定: {summary?.pendingCount || 0}人
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">平均支給額</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary?.averageNetSalary || 0)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">社会保険料・税金等</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency((summary?.totalSocialInsurance || 0) + (summary?.totalIncomeTax || 0) + (summary?.totalResidentTax || 0))}
              </div>
              <p className="text-xs text-muted-foreground mt-1 flex gap-2">
                <span>社保: {formatCurrency(summary?.totalSocialInsurance || 0)}</span>
                <span>所得税: {formatCurrency(summary?.totalIncomeTax || 0)}</span>
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>支給額推移（過去12ヶ月）</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trends || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false}
                      tickFormatter={(value) => `¥${(value / 10000).toLocaleString()}万`}
                    />
                    <Tooltip 
                      formatter={(value: number) => formatCurrency(value)}
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    />
                    <Legend />
                    <Bar dataKey="totalGrossSalary" name="総支給額" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="totalNetSalary" name="差引支給額" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>要対応アラート（{month}月）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>社員名</TableHead>
                      <TableHead>実績入力</TableHead>
                      <TableHead>給与確定</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!pendingEmployees || pendingEmployees.length === 0) ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                          未対応の項目はありません
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingEmployees.map(emp => (
                        <TableRow key={emp.id}>
                          <TableCell className="font-medium">
                            <Link href={`/employees/${emp.id}`} className="hover:underline">
                              {emp.name}
                            </Link>
                          </TableCell>
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
                              <Badge variant="secondary">未確定</Badge>
                            )}
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