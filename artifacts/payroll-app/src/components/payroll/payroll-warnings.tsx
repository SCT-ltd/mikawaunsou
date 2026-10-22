import { AlertTriangle } from "lucide-react";

/**
 * 計算のときに見つかった注意（最低賃金を下回る・退職の月・ブルーウィングを手入力固定で計算・乙欄 など）。
 * サーバーが明細に calcWarnings（JSON の配列）として残したものを、そのまま出す。
 */
export function PayrollWarnings({ payroll }: { payroll: unknown }) {
  const raw = (payroll as { calcWarnings?: string | null } | undefined)?.calcWarnings;
  let list: string[] = [];
  try { list = raw ? (JSON.parse(raw) as string[]) : []; } catch { list = []; }
  if (list.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100 space-y-1 print:hidden">
      {list.map((w, i) => (
        <p key={i} className="flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}</p>
      ))}
    </div>
  );
}
