import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * 印刷の選び方。
 *   だれを … 全員／確定済みだけ／チェックした人だけ
 *   どう刷る … 1人1ページ（A4横）／2人/A4（縦・切り取り線つき）／1人ずつPDFに保存
 * 「1人ずつPDFに保存」は、1人分ずつ印刷の画面を出す。そこで「PDFに保存」を選ぶと、
 * 1人1つのファイルになる（ファイル名の候補は「社員名_◯年◯月」）。
 */
export type PrintTarget = "all" | "confirmed" | "checked";
export type PrintFormat = "1up" | "2up" | "each";

export function PrintDialog({
  open,
  onOpenChange,
  counts,
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  counts: { all: number; confirmed: number; checked: number; draftIn: (t: PrintTarget) => number };
  onStart: (target: PrintTarget, format: PrintFormat) => void;
}) {
  const [target, setTarget] = useState<PrintTarget>("all");
  const [format, setFormat] = useState<PrintFormat>("2up");
  useEffect(() => {
    if (open && counts.checked > 0) setTarget("checked");
  }, [open, counts.checked]);

  const n = target === "all" ? counts.all : target === "confirmed" ? counts.confirmed : counts.checked;
  const drafts = counts.draftIn(target);

  const opt = (checked: boolean) =>
    `flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer text-sm ${checked ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15" : "hover:bg-muted/50"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Printer className="h-5 w-5" />給与明細を印刷する</DialogTitle>
          <DialogDescription>だれの明細を、どの形で印刷するかを選んでください。</DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-muted-foreground mb-1">だれを印刷するか</legend>
          {([
            ["all", `全員（${counts.all}人）`, "この月の明細がある人すべて"],
            ["confirmed", `確定済みだけ（${counts.confirmed}人）`, "確定した明細だけを刷ります（ふだんはこちら）"],
            ["checked", `チェックした人だけ（${counts.checked}人）`, "左の一覧でチェックを付けた人"],
          ] as const).map(([v, label, hint]) => (
            <label key={v} className={opt(target === v)}>
              <input type="radio" name="print-target" className="mt-1 accent-indigo-600" checked={target === v} onChange={() => setTarget(v)} disabled={v === "checked" && counts.checked === 0} />
              <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-muted-foreground mb-1">どう印刷するか</legend>
          {([
            ["2up", "2人/A4（縦）", "A4縦1枚に2人ずつ。まん中に切り取り線が入ります（ふだんはこちら）"],
            ["1up", "1人1ページ（A4横）", "文字がいちばん大きい刷り方です"],
            ["each", "1人ずつPDFに保存", "1人分ずつ印刷の画面が出ます。送り先で「PDFに保存」を選ぶと、1人1つのファイル（社員名_年月）になります"],
          ] as const).map(([v, label, hint]) => (
            <label key={v} className={opt(format === v)}>
              <input type="radio" name="print-format" className="mt-1 accent-indigo-600" checked={format === v} onChange={() => setFormat(v)} />
              <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </fieldset>

        {drafts > 0 && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            この中に<strong>未確定の明細が{drafts}人分</strong>入っています。金額がまだ変わるかもしれません。
            本人に渡すときは、確定してから印刷してください。
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>やめる</Button>
          <Button onClick={() => onStart(target, format)} disabled={n === 0}>
            <Printer className="h-4 w-4 mr-1" />
            {drafts > 0 ? `未確定を含めて${n}人分を印刷` : `${n}人分を印刷`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
