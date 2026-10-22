import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download, Landmark } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/office-tools";

/**
 * 振込一覧（その月の差引支給額と振込先）と、全銀協フォーマットの書き出し。
 * 書き出すのは確定済みの明細だけ（未確定の金額で振り込まないため）。
 * 口座は社員マスターの「振込口座」タブ、振込元は会社設定の「振込元」で入れる。
 */
interface TransferRow {
  payrollId: number;
  employeeId: number;
  employeeCode: string;
  name: string;
  status: string;
  netSalary: number;
  bank: {
    bankCode: string; bankName: string; branchCode: string; branchName: string;
    accountType: number; accountNumber: string; holderKana: string;
  } | null;
  problems: string[];
}

const ACCOUNT_TYPE: Record<number, string> = { 1: "普通", 2: "当座", 4: "貯蓄", 9: "その他" };

export function TransferDialog({
  open,
  onOpenChange,
  year,
  month,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  year: number;
  month: number;
  /** 振込日の初期値（MMDD）。会社設定の支払日から出す */
  defaultDate: string;
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDate(defaultDate); }, [open, defaultDate]);

  const { data, isLoading, error } = useQuery<{ rows: TransferRow[]; total: number; settingsReady: boolean }>({
    queryKey: ["office-transfer", year, month],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/office-tools/transfer?year=${year}&month=${month}`, { credentials: "include" });
      if (!res.ok) throw new Error("振込一覧を読み込めませんでした");
      return res.json();
    },
    enabled: open,
    staleTime: 0,
  });
  const rows = data?.rows ?? [];
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const ready = confirmed.filter((r) => r.problems.length === 0);
  const notConfirmed = rows.length - confirmed.length;

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/office-tools/transfer/zengin?year=${year}&month=${month}&date=${date}`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: "書き出せませんでした", description: body?.error ?? `もう一度お試しください（${res.status}）`, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `振込データ_${year}${String(month).padStart(2, "0")}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast({ title: "振込データを保存しました", description: `${confirmed.length}名分。銀行のサービスに取り込む前に、件数と合計金額を確かめてください。` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" />{year}年{month}月 振込一覧</DialogTitle>
          <DialogDescription>
            差引支給額と振込先の一覧です。全銀協フォーマット（銀行のインターネットバンキングに取り込む形式）で書き出せます。
            書き出すのは<strong>確定済みの明細だけ</strong>です。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-600">{(error as Error).message}</p>
        ) : (
          <>
            {!data?.settingsReady && (
              <p className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                振込元（委託者コード・委託者名・会社の口座）がまだ入っていないため、書き出せません。
                <Link href="/settings" className="ml-1 font-semibold underline">会社設定の「振込元」で入れる →</Link>
              </p>
            )}
            {notConfirmed > 0 && (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                未確定の明細が{notConfirmed}件あります。未確定の人は書き出しに入りません（確定してから書き出してください）。
              </p>
            )}
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5">社員</th>
                    <th className="text-left px-2 py-1.5">銀行・支店</th>
                    <th className="text-left px-2 py-1.5">口座</th>
                    <th className="text-left px-2 py-1.5">名義（カナ）</th>
                    <th className="text-right px-2 py-1.5">差引支給額</th>
                    <th className="text-left px-2 py-1.5">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.payrollId} className="border-t align-top">
                      <td className="px-2 py-1.5 whitespace-nowrap"><span className="font-medium">{r.name}</span><span className="ml-1 text-muted-foreground font-mono">{r.employeeCode}</span></td>
                      <td className="px-2 py-1.5">{r.bank ? <>{r.bank.bankName || "—"}（{r.bank.bankCode}）<br />{r.bank.branchName || "—"}（{r.bank.branchCode}）</> : "—"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.bank ? `${ACCOUNT_TYPE[r.bank.accountType] ?? "?"} ${r.bank.accountNumber}` : "—"}</td>
                      <td className="px-2 py-1.5">{r.bank?.holderKana || "—"}</td>
                      <td className="px-2 py-1.5 text-right amount font-semibold">{r.netSalary.toLocaleString("ja-JP")}</td>
                      <td className="px-2 py-1.5">
                        {r.status !== "confirmed" && <span className="text-amber-700 dark:text-amber-300 font-semibold">未確定</span>}
                        {r.problems.length > 0 && (
                          <span className="block text-red-600 dark:text-red-400">
                            {r.problems.join("・")}
                            <Link href={`/allowances?emp=${r.employeeId}`} className="ml-1 underline">口座を入れる</Link>
                          </span>
                        )}
                        {r.status === "confirmed" && r.problems.length === 0 && <span className="text-emerald-700 dark:text-emerald-300">書き出せます</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">この月の給与明細はありません</td></tr>
                  )}
                </tbody>
                <tfoot className="border-t bg-muted/30">
                  <tr>
                    <td colSpan={4} className="px-2 py-1.5 font-semibold">合計（{rows.length}名）／うち書き出せる確定済み {ready.length}名</td>
                    <td className="px-2 py-1.5 text-right amount font-bold">{(data?.total ?? 0).toLocaleString("ja-JP")}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:items-end">
          <label className="text-xs text-muted-foreground mr-auto">
            振込日（月日4桁）
            <Input value={date} onChange={(e) => setDate(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className="h-8 w-28 mt-1" aria-label="振込日（月日4桁）" placeholder="例 1110" />
          </label>
          <Button variant="outline" onClick={() => onOpenChange(false)}>閉じる</Button>
          <Button
            onClick={download}
            disabled={busy || !data?.settingsReady || ready.length === 0 || date.length !== 4 || ready.length !== confirmed.length}
            title={ready.length !== confirmed.length ? "口座が入っていない人がいます。先に社員マスターで口座を入れてください。" : undefined}
          >
            <Download className="h-4 w-4 mr-1" />{busy ? "書き出し中…" : "全銀ファイルを書き出す"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
