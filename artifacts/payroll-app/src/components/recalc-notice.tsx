import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDraftPayrolls, recalcPayrolls, DRAFT_PAYROLLS_KEY, MONTH_STATUS_KEY } from "@/lib/office-tools";
import { useCanWrite } from "@/lib/use-can-write";

/**
 * 単価・日給・保険料率などを変えたあとに出す案内。
 * 作ってある明細は、計算し直すまで前の単価のまま。気付かずに確定すると古い金額で支払うことになるため、
 * 保存した直後に「未確定の明細◯件に反映するには再計算が必要です」と知らせ、その場で計算し直せるようにする。
 * 確定済みの明細は計算し直さない（変えるときは先に確定解除）。
 */
export function RecalcNotice({ show, onClose, what = "設定" }: { show: boolean; onClose?: () => void; what?: string }) {
  const { data: drafts } = useDraftPayrolls(show);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);

  if (!show || !drafts || drafts.length === 0) return null;

  const months = [...new Set(drafts.map((d) => `${d.year}年${d.month}月`))];

  const run = async () => {
    if (running) return;
    setRunning({ done: 0, total: drafts.length });
    const r = await recalcPayrolls(drafts, (done, total) => setRunning({ done, total }));
    setRunning(null);
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/payroll") });
    qc.invalidateQueries({ queryKey: [MONTH_STATUS_KEY] });
    qc.invalidateQueries({ queryKey: [DRAFT_PAYROLLS_KEY] });
    qc.invalidateQueries({ queryKey: ["month-items"] });
    toast({
      title: r.failed.length ? `${r.ok}件を計算し直しました（${r.failed.length}件はできませんでした）` : `${r.ok}件の明細を計算し直しました`,
      description: r.failed.length
        ? `計算できなかった明細：${r.failed.slice(0, 5).map((f) => `${f.year}年${f.month}月（${f.message}）`).join("、")}${r.failed.length > 5 ? " ほか" : ""}`
        : "新しい単価・料率が明細に入りました。給与明細画面で金額を確かめてください。",
      variant: r.failed.length ? "destructive" : undefined,
    });
    onClose?.();
  };

  return (
    <div role="status" data-testid="recalc-notice" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
      <RefreshCw className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">未確定の明細{drafts.length}件に反映するには、再計算が必要です</p>
        <p className="text-xs mt-0.5">
          {what}を変えても、作ってある明細は計算し直すまで前の金額のままです（対象：{months.join("・")}）。
          確定済みの明細は変わりません。
        </p>
        {running && <p className="text-xs mt-1">計算しています… {running.done} / {running.total}</p>}
      </div>
      {canWrite && (
        <Button size="sm" className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white" onClick={run} disabled={!!running}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${running ? "animate-spin" : ""}`} />
          {running ? "計算中…" : "一括再計算"}
        </Button>
      )}
      {onClose && !running && (
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-500/20 shrink-0" aria-label="この案内を閉じる">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
