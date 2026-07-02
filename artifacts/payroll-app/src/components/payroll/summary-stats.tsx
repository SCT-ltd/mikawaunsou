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
    { label: "対象人数", value: `${payrolls.length}名`, sub: `確定 ${confirmed}/${payrolls.length}件`, num: "text-slate-700", bg: "bg-slate-50 border-slate-200" },
    { label: "総支給合計", value: formatCurrency(totalGross), num: "text-blue-700", bg: "bg-blue-50/60 border-blue-100" },
    { label: "控除合計", value: formatCurrency(totalDeductions), num: "text-red-700", bg: "bg-red-50/60 border-red-100" },
    { label: "差引支給合計", value: formatCurrency(totalNet), num: "text-emerald-700", bg: "bg-emerald-50/60 border-emerald-100" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-xl border ${t.bg} px-4 py-3`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 jp-tight">{t.label}</span>
            {t.sub && <span className="text-[10px] text-muted-foreground">{t.sub}</span>}
          </div>
          <div className={`text-xl font-bold amount mt-1 ${t.num}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}
