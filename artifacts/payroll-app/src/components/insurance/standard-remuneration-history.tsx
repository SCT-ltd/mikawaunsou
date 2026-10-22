import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStandardRemunerationHistory,
  getListStandardRemunerationHistoryQueryKey,
  useCreateStandardRemunerationHistory,
  useDeleteStandardRemunerationHistory,
  type StandardRemunerationHistory,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Plus, Trash2 } from "lucide-react";
import { getInsuranceGrade } from "@/lib/tax-tables-reiwa8";
import {
  apiErrorMessage,
  formatYearMonth,
  REMUNERATION_REASON_LABELS,
  STANDARD_REMUNERATION_EFFECTIVE_KEY,
} from "@/lib/insurance-rates";

const ymKey = (y: number, m: number) => y * 100 + m;

/** 標準報酬月額の等級表に載っている金額か（載っていなければ入力ミスの可能性）*/
export const isStandardGradeAmount = (amount: number) => getInsuranceGrade(amount).stdMonthly === amount;

/**
 * 社員編集ダイアログ「保険・扶養」タブの、標準報酬月額の履歴。
 * 行を追加すると、その適用開始（給与明細の年月）以降の明細で使われる。
 */
export function StandardRemunerationHistorySection({
  employeeId,
  initialAmount,
}: {
  employeeId: number;
  /** 社員マスタの標準報酬月額（履歴より前の月に使う初期値）*/
  initialAmount: number;
}) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const { data: history, isLoading } = useListStandardRemunerationHistory(employeeId, {
    query: { enabled: employeeId > 0, queryKey: getListStandardRemunerationHistoryQueryKey(employeeId) },
  });
  const createHistory = useCreateStandardRemunerationHistory();
  const deleteHistory = useDeleteStandardRemunerationHistory();

  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [year, setYear] = useState(String(next.getFullYear()));
  const [month, setMonth] = useState(String(next.getMonth() + 1));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("teiji");
  const [saving, setSaving] = useState(false);

  const rows = history ?? [];
  const nowKey = ymKey(now.getFullYear(), now.getMonth() + 1);
  const current = rows.find((r) => ymKey(r.effectiveYear, r.effectiveMonth) <= nowKey);
  const currentAmount = current ? current.amount : initialAmount;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListStandardRemunerationHistoryQueryKey(employeeId) });
    queryClient.invalidateQueries({ queryKey: [STANDARD_REMUNERATION_EFFECTIVE_KEY] });
  };

  const amountNum = Number(amount);
  const offGrade = amount !== "" && amountNum > 0 && !isStandardGradeAmount(amountNum);

  const handleAdd = async () => {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
      toast({ title: "入力エラー", description: "適用開始の年月を正しく入力してください。", variant: "destructive" });
      return;
    }
    if (!(amountNum > 0)) {
      toast({ title: "入力エラー", description: "標準報酬月額を入力してください。", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createHistory.mutateAsync({
        id: employeeId,
        data: { effectiveYear: y, effectiveMonth: m, amount: amountNum, reason: reason as "teiji" | "zuiji" | "shikaku" | "other" },
      });
      toast({ title: "登録しました", description: `${formatYearMonth(y, m)}の明細から ${amountNum.toLocaleString()}円 で計算します。` });
      setAmount("");
      refresh();
    } catch (e) {
      toast({ title: "エラー", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: StandardRemunerationHistory) => {
    const ok = await confirm({
      title: "標準報酬月額の履歴を削除しますか？",
      description: `${formatYearMonth(row.effectiveYear, row.effectiveMonth)}〜 ${row.amount.toLocaleString()}円 の履歴を削除します。\nこの月からの社会保険料の計算に使う金額が変わります。`,
      okLabel: "削除する",
      cancelLabel: "やめる",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteHistory.mutateAsync({ id: employeeId, historyId: row.id });
      toast({ title: "削除しました" });
      refresh();
    } catch (e) {
      toast({ title: "エラー", description: apiErrorMessage(e, "削除に失敗しました。"), variant: "destructive" });
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3" data-testid="std-rem-history">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">標準報酬月額の履歴</p>
        <p className="text-xs text-muted-foreground">
          今月の明細に使う値: <span className="font-mono font-semibold text-foreground">{currentAmount > 0 ? `${currentAmount.toLocaleString()}円` : "未設定（総支給で計算）"}</span>
        </p>
      </div>

      <div className="text-sm divide-y rounded-md border">
        {isLoading ? (
          <p className="px-3 py-2 text-muted-foreground text-xs">読み込み中...</p>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-1.5" data-testid="std-rem-history-row">
                <span className="w-32 shrink-0">{formatYearMonth(r.effectiveYear, r.effectiveMonth)}〜</span>
                <span className="font-mono tabular-nums w-28 text-right shrink-0">{r.amount.toLocaleString()}円</span>
                <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                  {REMUNERATION_REASON_LABELS[r.reason] ?? r.reason}{r.note ? `・${r.note}` : ""}
                </span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" aria-label="履歴を削除" onClick={() => handleDelete(r)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-3 px-3 py-1.5 text-muted-foreground">
              <span className="w-32 shrink-0">それより前</span>
              <span className="font-mono tabular-nums w-28 text-right shrink-0">{initialAmount > 0 ? `${initialAmount.toLocaleString()}円` : "未設定"}</span>
              <span className="text-xs flex-1">上の「標準報酬月額（初期値）」</span>
            </div>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">変わったときは、適用開始（給与明細の年月）を付けて追加してください。</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="number" className="w-20 text-right h-9" value={year} onChange={(e) => setYear(e.target.value)} aria-label="適用開始の年" />
          <span className="text-sm">年</span>
          <Input type="number" min={1} max={12} className="w-16 text-right h-9" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="適用開始の月" />
          <span className="text-sm">月〜</span>
          <Input type="number" step={10000} min={0} placeholder="440000" className="w-28 text-right h-9" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="新しい標準報酬月額" />
          <span className="text-sm">円</span>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-28 h-9" aria-label="理由"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(REMUNERATION_REASON_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" onClick={handleAdd} disabled={saving}>
            <Plus className="h-4 w-4 mr-1" />追加
          </Button>
        </div>
        {offGrade && <p className="text-xs text-amber-700 dark:text-amber-300">※ 標準報酬月額の等級表にない金額です。通知書の金額を確認してください。</p>}
      </div>
      {confirmDialog}
    </div>
  );
}
