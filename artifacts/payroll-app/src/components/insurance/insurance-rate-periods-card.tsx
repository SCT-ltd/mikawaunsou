import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInsuranceRatePeriods,
  getListInsuranceRatePeriodsQueryKey,
  useCreateInsuranceRatePeriod,
  useUpdateInsuranceRatePeriod,
  useDeleteInsuranceRatePeriod,
  type InsuranceRatePeriod,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Edit2, Plus, Trash2 } from "lucide-react";
import {
  apiErrorMessage,
  formatRatePercent,
  formatYearMonth,
  INSURANCE_RATES_EFFECTIVE_KEY,
  percentInputToRate,
  rateToPercentInput,
} from "@/lib/insurance-rates";

/**
 * 保険料率マスター（年度ごとの料率の履歴）。
 * 給与明細の年月に対して「適用開始がその月以前で、いちばん新しい行」の料率で計算される。
 */

type FormState = {
  effectiveYear: string;
  effectiveMonth: string;
  health: string;
  care: string;
  childcare: string;
  pension: string;
  employment: string;
  pensionMaxStandard: string;
  note: string;
};

const RATE_INPUTS: Array<{ key: keyof FormState; label: string; hint: string }> = [
  { key: "health", label: "健康保険料率", hint: "保険料額表の「健康保険料」の率（会社＋本人の合計）。例 9.85" },
  { key: "care", label: "介護保険料率", hint: "40〜64歳の社員に上乗せする率（合計）。例 1.62" },
  { key: "childcare", label: "子ども・子育て支援金率", hint: "合計の率。例 0.23（開始前は 0）" },
  { key: "pension", label: "厚生年金保険料率", hint: "合計の率。例 18.3" },
  { key: "employment", label: "雇用保険料率（本人負担）", hint: "本人負担分の率。例 0.5（一般の事業・令和8年度）" },
];

const ymKey = (y: number, m: number) => y * 100 + m;

function toForm(row: InsuranceRatePeriod | undefined, effectiveYear: number, effectiveMonth: number): FormState {
  return {
    effectiveYear: String(effectiveYear),
    effectiveMonth: String(effectiveMonth),
    health: row ? rateToPercentInput(row.healthInsuranceRate) : "9.85",
    care: row ? rateToPercentInput(row.careInsuranceRate) : "1.62",
    childcare: row ? rateToPercentInput(row.childcareSupportRate) : "0.23",
    pension: row ? rateToPercentInput(row.pensionRate) : "18.3",
    employment: row ? rateToPercentInput(row.employmentInsuranceRate) : "0.5",
    pensionMaxStandard: String(row?.pensionMaxStandard ?? 650000),
    note: "",
  };
}

export function InsuranceRatePeriodsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: periods, isLoading } = useListInsuranceRatePeriods();
  const createPeriod = useCreateInsuranceRatePeriod();
  const updatePeriod = useUpdateInsuranceRatePeriod();
  const deletePeriod = useDeleteInsuranceRatePeriod();

  const [editing, setEditing] = useState<InsuranceRatePeriod | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm(undefined, new Date().getFullYear(), new Date().getMonth() + 1));
  const [deleteTarget, setDeleteTarget] = useState<InsuranceRatePeriod | null>(null);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const nowKey = ymKey(now.getFullYear(), now.getMonth() + 1);

  // 新しい順に並べ、今月の明細に効く行に印を付ける
  const sorted = useMemo(
    () => [...(periods ?? [])].sort((a, b) => ymKey(b.effectiveYear, b.effectiveMonth) - ymKey(a.effectiveYear, a.effectiveMonth)),
    [periods],
  );
  const currentId = sorted.find((p) => ymKey(p.effectiveYear, p.effectiveMonth) <= nowKey)?.id;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListInsuranceRatePeriodsQueryKey() });
    queryClient.invalidateQueries({ queryKey: [INSURANCE_RATES_EFFECTIVE_KEY] });
  };

  const openCreate = () => {
    // いちばん新しい行をコピーし、適用開始は来月にしておく（変わった項目だけ直せばよい）
    const latest = sorted[0];
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    setEditing(null);
    setForm(toForm(latest, next.getFullYear(), next.getMonth() + 1));
    setDialogOpen(true);
  };

  const openEdit = (row: InsuranceRatePeriod) => {
    setEditing(row);
    setForm({ ...toForm(row, row.effectiveYear, row.effectiveMonth), note: row.note ?? "" });
    setDialogOpen(true);
  };

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    const y = Number(form.effectiveYear);
    const m = Number(form.effectiveMonth);
    if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
      toast({ title: "入力エラー", description: "適用開始の年月を正しく入力してください。", variant: "destructive" });
      return;
    }
    const rates = {
      healthInsuranceRate: percentInputToRate(form.health),
      careInsuranceRate: percentInputToRate(form.care),
      childcareSupportRate: percentInputToRate(form.childcare),
      pensionRate: percentInputToRate(form.pension),
      employmentInsuranceRate: percentInputToRate(form.employment),
    };
    const bad = Object.values(rates).some((v) => !Number.isFinite(v) || v < 0 || v > 0.5);
    if (bad || [form.health, form.care, form.childcare, form.pension, form.employment].some((v) => v.trim() === "")) {
      toast({ title: "入力エラー", description: "料率は 0〜50 の % の数字で入力してください（例: 9.85）。", variant: "destructive" });
      return;
    }
    const cap = Number(form.pensionMaxStandard);
    if (!Number.isInteger(cap) || cap <= 0) {
      toast({ title: "入力エラー", description: "厚生年金の上限額を正しく入力してください。", variant: "destructive" });
      return;
    }
    const data = { effectiveYear: y, effectiveMonth: m, ...rates, pensionMaxStandard: cap, note: form.note.trim() || null };
    setSaving(true);
    try {
      if (editing) {
        await updatePeriod.mutateAsync({ id: editing.id, data });
      } else {
        await createPeriod.mutateAsync({ data });
      }
      toast({ title: "保存しました", description: `${formatYearMonth(y, m)}の明細から適用する料率を保存しました。` });
      refresh();
      setDialogOpen(false);
    } catch (e) {
      toast({ title: "エラー", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePeriod.mutateAsync({ id: deleteTarget.id });
      toast({ title: "削除しました" });
      refresh();
    } catch (e) {
      toast({ title: "エラー", description: apiErrorMessage(e, "削除に失敗しました。"), variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">① 社会保険・雇用保険の料率（年度ごとの履歴）</CardTitle>
            <CardDescription className="mt-1">
              料率が変わったら、<span className="font-medium">「適用開始（給与明細の年月）」を付けて行を追加</span>します。
              各月の明細は、その月以前でいちばん新しい行の料率で計算されます（過去の月の計算は変わりません）。
            </CardDescription>
          </div>
          <Button type="button" size="sm" onClick={openCreate} disabled={isLoading}>
            <Plus className="h-4 w-4 mr-1" />料率の行を追加
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">適用開始（明細の年月）</TableHead>
                <TableHead className="text-right whitespace-nowrap">健康保険</TableHead>
                <TableHead className="text-right whitespace-nowrap">介護保険</TableHead>
                <TableHead className="text-right whitespace-nowrap">子育て支援金</TableHead>
                <TableHead className="text-right whitespace-nowrap">厚生年金</TableHead>
                <TableHead className="text-right whitespace-nowrap">雇用保険（本人）</TableHead>
                <TableHead className="text-right whitespace-nowrap">厚年の上限</TableHead>
                <TableHead>備考</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">読み込み中...</TableCell></TableRow>
              ) : sorted.map((p) => (
                <TableRow key={p.id} data-testid="rate-period-row" className={p.id === currentId ? "bg-emerald-50/60 dark:bg-emerald-500/10" : ""}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatYearMonth(p.effectiveYear, p.effectiveMonth)}〜
                    {p.id === currentId && (
                      <Badge variant="outline" className="ml-2 text-[10px] bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/40">今月適用中</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatRatePercent(p.healthInsuranceRate)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatRatePercent(p.careInsuranceRate)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatRatePercent(p.childcareSupportRate)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatRatePercent(p.pensionRate)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatRatePercent(p.employmentInsuranceRate)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{p.pensionMaxStandard.toLocaleString()}円</TableCell>
                  <TableCell className="text-xs text-muted-foreground min-w-[10rem]">{p.note}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="編集" onClick={() => openEdit(p)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="削除"
                        disabled={sorted.length <= 1} onClick={() => setDeleteTarget(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside border-t pt-3">
          <li>健康保険・介護保険・子育て支援金・厚生年金は、保険料額表の<span className="font-medium">会社と本人の合計の率</span>を入れます（本人負担はシステムが半分にします）。雇用保険だけは<span className="font-medium">本人負担の率</span>です。</li>
          <li>保険料 = 標準報酬月額（社員ごと）× 率 ÷ 2。介護保険は「介護保険適用」の社員だけ健康保険に上乗せします。</li>
          <li>適用開始は<span className="font-medium">給与明細の年月</span>です。「9月分の保険料を10月に支給する給与から引く」会社は、10月を適用開始にします。</li>
          <li>確定済みの明細は変わりません。下書きの明細は、再計算するとその月の料率で計算し直されます。</li>
        </ul>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "料率の行を編集" : "料率の行を追加"}</DialogTitle>
            <DialogDescription>
              {editing ? "この行の内容を直します。" : "いちばん新しい行の値をコピーしています。変わった項目だけ直してください。"}
              料率は % の数字で入力します（例: 9.85% → 9.85）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">適用開始（給与明細の年月）</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Input type="number" className="w-24 text-right" value={form.effectiveYear} onChange={set("effectiveYear")} aria-label="適用開始の年" />
                <span className="text-sm">年</span>
                <Input type="number" min={1} max={12} className="w-20 text-right" value={form.effectiveMonth} onChange={set("effectiveMonth")} aria-label="適用開始の月" />
                <span className="text-sm">月の明細から</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {RATE_INPUTS.map(({ key, label, hint }) => (
                <div key={key}>
                  <Label className="text-sm">{label}</Label>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Input type="number" step="0.001" min={0} className="text-right" value={form[key]} onChange={set(key)} aria-label={label} />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
                </div>
              ))}
              <div>
                <Label className="text-sm">厚生年金の上限（標準報酬月額）</Label>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Input type="number" step={10000} min={0} className="text-right" value={form.pensionMaxStandard} onChange={set("pensionMaxStandard")} aria-label="厚生年金の上限" />
                  <span className="text-sm text-muted-foreground">円</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">これを超える標準報酬月額は、厚生年金だけこの額で計算。例 650,000</p>
              </div>
            </div>
            <div>
              <Label className="text-sm">備考</Label>
              <Input className="mt-1.5" placeholder="例: 令和9年度 料率改定" value={form.note} onChange={set("note")} aria-label="備考" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存する"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>料率の行を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && `${formatYearMonth(deleteTarget.effectiveYear, deleteTarget.effectiveMonth)}〜 の行を削除します。`}
              その期間の明細は、ひとつ前の行の料率で計算されるようになります（確定済みの明細は変わりません）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
