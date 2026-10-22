import { AlertCircle, Check, Loader2, Lock, Pencil } from "lucide-react";

/**
 * 保存の状態を、どの画面でも同じ形で出す札。
 * 月次実績入力（勤怠は「保存して計算」・手当は自動保存）と給与明細（保存ボタン）で
 * 保存のしかたが違っても、「いま保存されているか」は同じ見た目で分かるようにする。
 *
 *   未保存 ◯件 … まだ保存していない変更がある
 *   保存中…     … 送っている途中
 *   保存済 10:42 … 最後に保存できた時刻
 *   保存できませんでした（理由）… 失敗。理由を添える
 *   確定済み（表示のみ）
 */
export type SaveState =
  | { kind: "idle" }
  | { kind: "dirty"; count?: number; label?: string }
  | { kind: "saving" }
  | { kind: "saved"; at: Date | null }
  | { kind: "error"; reason?: string }
  | { kind: "locked" };

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SaveStatus({ state, title, className = "" }: { state: SaveState; title?: string; className?: string }) {
  const base = `inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${className}`;
  const head = title ? <span className="text-muted-foreground font-normal">{title}</span> : null;
  switch (state.kind) {
    case "dirty":
      return (
        <span role="status" className={`${base} border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40`}>
          {head}<Pencil className="h-3 w-3" />{state.label ?? `未保存${state.count != null ? ` ${state.count}件` : ""}`}
        </span>
      );
    case "saving":
      return (
        <span role="status" className={`${base} border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/40`}>
          {head}<Loader2 className="h-3 w-3 animate-spin" />保存中…
        </span>
      );
    case "saved":
      return (
        <span role="status" className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40`}>
          {head}<Check className="h-3 w-3" />保存済{state.at ? ` ${hhmm(state.at)}` : ""}
        </span>
      );
    case "error":
      return (
        <span role="alert" title={state.reason} className={`${base} border-red-300 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40`}>
          {head}<AlertCircle className="h-3 w-3" />保存できませんでした{state.reason ? `（${state.reason}）` : ""}
        </span>
      );
    case "locked":
      return (
        <span role="status" className={`${base} border-border bg-muted text-muted-foreground`}>
          {head}<Lock className="h-3 w-3" />確定済み（表示のみ）
        </span>
      );
    default:
      return (
        <span role="status" className={`${base} border-border bg-muted/50 text-muted-foreground`}>
          {head}<Check className="h-3 w-3" />変更なし
        </span>
      );
  }
}
