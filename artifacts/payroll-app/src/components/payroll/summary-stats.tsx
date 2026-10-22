import { Payroll } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";

/**
 * 給与明細一覧の集計サマリータイル（フラット）。
 * 対象人数・総支給合計・控除合計・差引合計・確定件数を表示。
 */
export function PayrollSummaryStats({ payrolls }: { payrolls: Payroll[] }) {
  const totalGross = payrolls.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
  const totalDeductions = payrolls.reduce((s, p) => s + (p.totalDeductions ?? 0), 0);
  const totalNet = payrolls.reduce((s, p) => s + (p.netSalary ?? 0), 0);
  const confirmed = payrolls.filter((p) => p.status === "confirmed").length;

  const tiles = [
    { label: "対象人数", value: `${payrolls.length}名`, sub: `確定 ${confirmed}/${payrolls.length}件`, num: "text-slate-700 dark:text-slate-200", bg: "bg-slate-50 border-slate-200 dark:bg-slate-500/10 dark:border-slate-500/30" },
    { label: "総支給合計", value: formatCurrency(totalGross), num: "text-blue-700 dark:text-blue-300", bg: "bg-blue-50/60 border-blue-100 dark:bg-blue-500/10 dark:border-blue-500/30" },
    { label: "控除合計", value: formatCurrency(totalDeductions), num: "text-red-700 dark:text-red-300", bg: "bg-red-50/60 border-red-100 dark:bg-red-500/10 dark:border-red-500/30" },
    { label: "差引支給合計", value: formatCurrency(totalNet), num: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50/60 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-xl border ${t.bg} px-4 py-3`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 jp-tight">{t.label}</span>
            {t.sub && <span className="text-[10px] text-muted-foreground">{t.sub}</span>}
          </div>
          <div className={`text-xl font-bold amount mt-1 ${t.num}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}
