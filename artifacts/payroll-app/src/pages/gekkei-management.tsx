import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Clock, ChevronRight, User, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// 簡易的な理由コードのマッピング
const REASON_LABELS: Record<string, string> = {
  base_salary_changed: "基本給変更",
  fixed_overtime_changed: "固定残業代変更",
  commute_allowance_changed: "通勤手当変更",
  commission_rate_changed: "歩合率/単価変更",
  fixed_allowance_changed: "固定手当変更",
  work_schedule_changed: "勤務体系変更",
};

export default function GekkeiManagementPage() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchCandidates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payroll/gekkei/candidates");
      const data = await res.json();
      setCandidates(data);
    } catch (err) {
      console.error(err);
      toast({
        title: "エラー",
        description: "候補データの取得に失敗しました。",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, []);

  const handleApprove = async (cand: any) => {
    if (!confirm(`${cand.employee.name}さんの標準報酬月額を ¥${cand.avgSalary.toLocaleString()} に更新し、随時改定を承認しますか？`)) return;

    try {
      const effectiveDate = `${cand.revisionEffectiveMonth}-01`;
      
      const res = await fetch("/api/payroll/gekkei/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: cand.employee.id,
          nextStandardRemuneration: cand.avgSalary,
          revisionEffectiveDate: effectiveDate
        })
      });

      if (res.ok) {
        toast({
          title: "承認完了",
          description: "社員マスタの標準報酬月額を更新しました。",
        });
        fetchCandidates();
      } else {
        throw new Error("Failed to approve");
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "エラー",
        description: "承認処理に失敗しました。",
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight">随時改定（月変）管理</h2>
          <p className="text-muted-foreground italic text-sm">
            ※判定には「確定済み」の給与明細データのみを使用します。下書き状態のデータは集計されません。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-blue-50/50 border-blue-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-800">判定対象者</CardTitle>
              <User className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900">{candidates.length}名</div>
              <p className="text-xs text-blue-600/80">固定的賃金変動フラグあり</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50/50 border-amber-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-amber-800">要確認 / モニタリング</CardTitle>
              <Clock className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-900">
                {candidates.filter(c => c.status === 'monitoring').length}名
              </div>
              <p className="text-xs text-amber-600/80">実績データ蓄積中（3ヶ月未満）</p>
            </CardContent>
          </Card>
          <Card className="bg-emerald-50/50 border-emerald-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-emerald-800">改定対象（2等級差あり）</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-900">
                {candidates.filter(c => c.status === 'eligible').length}名
              </div>
              <p className="text-xs text-emerald-600/80">3ヶ月平均確定済み</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>改定候補一覧</CardTitle>
            <div className="flex gap-2">
              <Select defaultValue="all">
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="ステータス" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全てのステータス</SelectItem>
                  <SelectItem value="eligible">改定対象のみ</SelectItem>
                  <SelectItem value="monitoring">蓄積中のみ</SelectItem>
                  <SelectItem value="excluded">対象外（日数不足等）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-[160px]">社員情報</TableHead>
                  <TableHead className="w-[140px]">変動理由 / 起算月</TableHead>
                  <TableHead className="text-center">現行 / 改定月</TableHead>
                  <TableHead className="text-right">3ヶ月平均実績</TableHead>
                  <TableHead className="text-center w-[120px]">等級差判定</TableHead>
                  <TableHead className="w-[140px] text-center">ステータス / 理由</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground italic">
                      データを読み込み中...
                    </TableCell>
                  </TableRow>
                ) : candidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground italic">
                      現在、随時改定の対象候補はいません。
                    </TableCell>
                  </TableRow>
                ) : (
                  candidates.map((c) => (
                    <TableRow key={c.employee.id} className="group transition-colors hover:bg-muted/5">
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wider">{c.employee.employeeCode}</span>
                          <span className="font-bold text-[14px] leading-tight">{c.employee.name}</span>
                          <span className="text-[10px] text-muted-foreground">{c.employee.department}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="w-fit text-[9px] font-medium bg-blue-50 text-blue-700 border-blue-200 py-0 h-4">
                            {REASON_LABELS[c.employee.fixedPayChangeReasonCode] || "その他"}
                          </Badge>
                          <div className="text-[12px] font-medium mt-0.5">
                            {c.employee.fixedPayChangeEffectiveMonth}〜
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col gap-0.5">
                          <div className="text-[12px] text-muted-foreground">
                            ¥{(c.employee.standardRemuneration || 0).toLocaleString()}
                          </div>
                          {c.revisionEffectiveMonth && (
                            <div className="text-[10px] font-bold text-primary flex items-center justify-center gap-1">
                              <ChevronRight className="h-3 w-3" />
                              {c.revisionEffectiveMonth}改定
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {c.avgSalary ? (
                          <div className="flex flex-col">
                            <span className="text-[14px] font-bold tabular-nums">¥{c.avgSalary.toLocaleString()}</span>
                            <span className="text-[9px] text-muted-foreground italic uppercase">Avg (3 months)</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="text-muted-foreground/30 italic text-[11px]">—</span>
                            <span className="text-[9px] text-muted-foreground">実績: {c.currentPayrolls?.length || 0}/3ヶ月</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {c.status === 'eligible' ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200 text-[10px] h-5 px-1.5">
                              +2等級以上
                            </Badge>
                            <span className="text-[9px] text-muted-foreground italic">条件合致</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/30 italic text-[12px]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {c.status === 'eligible' ? (
                          <Badge className="bg-emerald-500 text-white border-0 shadow-sm text-[11px]">改定対象</Badge>
                        ) : c.status === 'monitoring' ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 text-[10px]">モニタリング中</Badge>
                            <span className="text-[9px] text-muted-foreground leading-tight">{c.reason || "実績収集中"}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">対象外</Badge>
                            <span className="text-[9px] text-red-500 font-medium leading-tight">{c.reason}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" className="h-8 text-[11px] px-3">履歴</Button>
                          {c.status === 'eligible' && (
                            <Button 
                              size="sm" 
                              className="h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700 px-4 shadow-sm"
                              onClick={() => handleApprove(c)}
                            >
                              承認・反映
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border/50 text-[12px] text-muted-foreground leading-relaxed">
          <Info className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-bold text-foreground/80">随時改定のルールについて</p>
            <p>1. 固定的賃金（基本給・固定手当等）に変動があること。単なる売上歩合や残業代の変動のみでは対象になりません。</p>
            <p>2. 変動月から連続する3ヶ月間の支払基礎日数が全て17日以上（特定適用事業所等は11日以上）であること。</p>
            <p>3. 3ヶ月の報酬平均による等級が、従前の等級と比べて2等級以上の差が生じていること。</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
