import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmployees,
  useListEffectiveStandardRemuneration,
  getListEffectiveStandardRemunerationQueryKey,
  useBulkCreateStandardRemunerationHistory,
  getListStandardRemunerationHistoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  apiErrorMessage,
  formatYearMonth,
  REMUNERATION_REASON_LABELS,
  STANDARD_REMUNERATION_EFFECTIVE_KEY,
} from "@/lib/insurance-rates";
import { isStandardGradeAmount } from "./standard-remuneration-history";

/**
 * 標準報酬月額の一括入力（毎年の定時決定の通知書を1画面で入れる）。
 * 空欄の社員は変更なし。入力した社員だけ、同じ適用開始・理由で履歴を追加する（同じ年月は上書き）。
 */
export function StandardRemunerationBulkTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [year, setYear] = useState(next.getFullYear());
  const [month, setMonth] = useState(next.getMonth() + 1);
  const [reason, setReason] = useState<"teiji" | "zuiji" | "shikaku" | "other">("teiji");
  const [note, setNote] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const validYm = Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12;
  const prev = new Date(year, month - 2, 1);
  const prevParams = { year: prev.getFullYear(), month: prev.getMonth() + 1 };
  const targetParams = { year, month };

  const { data: employees } = useListEmployees({});
  // 「現在」= 適用開始の前月の明細で使われる値
  const { data: before } = useListEffectiveStandardRemuneration(prevParams, {
    query: { enabled: validYm, queryKey: getListEffectiveStandardRemunerationQueryKey(prevParams) },
  });
  // 適用開始の月にすでに登録済みの行（あれば入力欄に出して、直せるようにする）
  const { data: atTarget } = useListEffectiveStandardRemuneration(targetParams, {
    query: { enabled: validYm, queryKey: getListEffectiveStandardRemunerationQueryKey(targetParams) },
  });
  const bulkCreate = useBulkCreateStandardRemunerationHistory();

  const registeredAtTarget = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of atTarget ?? []) {
      if (r.historyId != null && r.effectiveYear === year && r.effectiveMonth === month) map.set(r.employeeId, r.standardRemuneration);
    }
    return map;
  }, [atTarget, year, month]);

  // 適用開始を変えたら、その月に登録済みの値で入力欄を作り直す
  useEffect(() => {
    const init: Record<number, string> = {};
    registeredAtTarget.forEach((amount, id) => { init[id] = String(amount); });
    setInputs(init);
  }, [registeredAtTarget]);

  const list = (employees ?? []).filter((e) => showInactive || e.isActive);
  const beforeOf = (id: number, fallback: number | undefined) =>
    before?.find((r) => r.employeeId === id)?.standardRemuneration ?? fallback ?? 0;

  const entries = list
    .map((e) => ({ employeeId: e.id, raw: (inputs[e.id] ?? "").trim() }))
    .filter((x) => x.raw !== "")
    .map((x) => ({ employeeId: x.employeeId, amount: Number(x.raw) }));
  const invalid = entries.filter((x) => !(x.amount > 0));
  // 登録済みの値と同じまま・現在と同じ値は、送っても結果が変わらないので件数から除く
  const changed = entries.filter((x) => x.amount > 0 && registeredAtTarget.get(x.employeeId) !== x.amount);

  const handleSave = async () => {
    if (!validYm) {
      toast({ title: "入力エラー", description: "適用開始の年月を正しく入力してください。", variant: "destructive" });
      return;
    }
    if (invalid.length > 0) {
      toast({ title: "入力エラー", description: "金額が正しくない社員があります。", variant: "destructive" });
      return;
    }
    if (changed.length === 0) return;
    setSaving(true);
    try {
      await bulkCreate.mutateAsync({
        data: { effectiveYear: year, effectiveMonth: month, reason, note: note.trim() || null, entries: changed },
      });
      toast({ title: "登録しました", description: `${changed.length}名分の標準報酬月額を、${formatYearMonth(year, month)}の明細から適用します。` });
      queryClient.invalidateQueries({ queryKey: [STANDARD_REMUNERATION_EFFECTIVE_KEY] });
      for (const x of changed) queryClient.invalidateQueries({ queryKey: getListStandardRemunerationHistoryQueryKey(x.employeeId) });
    } catch (e) {
      toast({ title: "エラー", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">標準報酬月額の一括入力</h3>
        <p className="text-sm text-muted-foreground">
          定時決定（算定基礎）・随時改定の通知書が届いたら、ここで全員分をまとめて入力します。変わる社員だけ入力し、空欄の社員は変更しません。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">適用開始と理由</CardTitle>
          <CardDescription>
            適用開始は<span className="font-medium">給与明細の年月</span>です。通知書の「9月分」の保険料を10月に支給する給与から引く会社は、10月を選びます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label className="text-sm">適用開始（給与明細の年月）</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Input type="number" className="w-24 text-right" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="適用開始の年" />
                <span className="text-sm">年</span>
                <Input type="number" min={1} max={12} className="w-20 text-right" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="適用開始の月" />
                <span className="text-sm">月の明細から</span>
              </div>
            </div>
            <div>
              <Label className="text-sm">理由</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
                <SelectTrigger className="w-32 mt-1.5" aria-label="理由"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(REMUNERATION_REASON_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[12rem]">
              <Label className="text-sm">備考</Label>
              <Input className="mt-1.5" placeholder="例: R8 算定基礎（令和8年9月分〜）" value={note} onChange={(e) => setNote(e.target.value)} aria-label="備考" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">社員ごとの金額</CardTitle>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} />退職者も表示
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">社員番号</TableHead>
                  <TableHead className="whitespace-nowrap">氏名</TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    現在（{validYm ? formatYearMonth(prevParams.year, prevParams.month) : "—"}の明細）
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap">新しい金額</TableHead>
                  <TableHead className="text-right whitespace-nowrap">差</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((e) => {
                  const cur = beforeOf(e.id, e.standardRemuneration);
                  const raw = inputs[e.id] ?? "";
                  const val = Number(raw);
                  const has = raw.trim() !== "" && val > 0;
                  const diff = has ? val - cur : 0;
                  const registered = registeredAtTarget.has(e.id);
                  return (
                    <TableRow key={e.id} data-testid="bulk-std-row" data-employee-name={e.name}>
                      <TableCell className="font-mono text-xs">{e.employeeCode}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {e.name}
                        {!e.isActive && <Badge variant="outline" className="ml-2 text-[10px]">退職</Badge>}
                        {registered && <Badge variant="outline" className="ml-2 text-[10px] bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:border-sky-500/30">登録済み</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{cur > 0 ? `${cur.toLocaleString()}円` : "未設定"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number" step={10000} min={0} placeholder="変更なし"
                            className="w-32 text-right h-8"
                            value={raw}
                            onChange={(ev) => setInputs((m) => ({ ...m, [e.id]: ev.target.value }))}
                            aria-label={`${e.name}の新しい標準報酬月額`}
                          />
                          <span className="text-xs text-muted-foreground">円</span>
                        </div>
                        {has && !isStandardGradeAmount(val) && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">等級表にない金額です</p>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums ${diff > 0 ? "text-rose-600 dark:text-rose-300" : diff < 0 ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"}`}>
                        {has ? `${diff > 0 ? "+" : ""}${diff.toLocaleString()}` : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              登録すると、{validYm ? formatYearMonth(year, month) : "適用開始"}以降の明細の健康保険・厚生年金・子育て支援金がこの金額で計算されます。確定済みの明細は変わりません。
            </p>
            <Button type="button" onClick={handleSave} disabled={saving || changed.length === 0 || !validYm}>
              {saving ? "登録中..." : changed.length > 0 ? `${changed.length}名分を登録` : "変更なし"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
