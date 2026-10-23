import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileSpreadsheet, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Line { account: string; summary: string; amount: number; people?: number; detail?: { label: string; amount: number }[] }
interface Slip { year: number; month: number; people: number; confirmed: number; debit: Line[]; credit: Line[]; debitTotal: number; creditTotal: number }

/**
 * ダッシュボードの「振替伝票」。その月の給与を、事務所の手書きの振替伝票と同じ並び
 * （左＝借方：給料手当・雑給・交通費…／右＝貸方：未払費用・法定福利費・預り金…）で科目ごとの合計にする。
 * 中身はサーバーの /dashboard/transfer-slip。振込手数料・立替金など、給与明細に無いものは入らない。
 */
export function TransferSlipCard({ year, month }: { year: number; month: number }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<Slip>({
    queryKey: ["transfer-slip", year, month],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/dashboard/transfer-slip?year=${year}&month=${month}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });

  const rows = Math.max(data?.debit.length ?? 0, data?.credit.length ?? 0, 4);
  const unconfirmed = data ? data.people - data.confirmed : 0;

  return (
    <section className="rounded-xl border bg-card overflow-hidden" data-transfer-slip="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b bg-violet-50/50 dark:bg-violet-500/10">
        <FileSpreadsheet className="h-4 w-4 text-violet-600 dark:text-violet-300" />
        <h3 className="font-bold text-[15px] tracking-[0.2em] text-violet-800 dark:text-violet-200">振替伝票</h3>
        <span className="text-sm text-muted-foreground">{year}年{month}月分の給与</span>
        {data && data.people > 0 && (
          <span className={cn("text-xs px-2 py-0.5 rounded-full border", unconfirmed ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40" : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40")}>
            {unconfirmed ? `未確定 ${unconfirmed}人を含む（確定で変わります）` : `全員確定（${data.people}人）`}
          </span>
        )}
        <button type="button" onClick={() => setLocation("/journal")} className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">
          会計ソフト用の仕訳へ<ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-48 m-4 rounded-lg bg-muted animate-pulse" aria-label="読み込み中" />
      ) : !data || data.people === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">この月の給与明細はまだありません（月次実績入力で「保存して計算」すると出ます）</p>
      ) : (
        <>
          {/* PC：伝票と同じ左右の並び */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-violet-800 dark:text-violet-200 bg-violet-50/30 dark:bg-violet-500/5">
                  <th className="px-3 py-2 text-right font-semibold w-[15%] border-b border-r">金額</th>
                  <th className="px-3 py-2 text-left font-semibold w-[13%] border-b border-r">借方科目</th>
                  <th className="px-3 py-2 text-left font-semibold w-[22%] border-b border-r-2 border-r-violet-200 dark:border-r-violet-500/40">摘要</th>
                  <th className="px-3 py-2 text-left font-semibold w-[22%] border-b border-r">摘要</th>
                  <th className="px-3 py-2 text-left font-semibold w-[13%] border-b border-r">貸方科目</th>
                  <th className="px-3 py-2 text-right font-semibold w-[15%] border-b">金額</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, i) => {
                  const d = data.debit[i], c = data.credit[i];
                  return (
                    <tr key={i} className="align-top border-b border-dashed last:border-solid">
                      <td className="px-3 py-2 text-right amount font-semibold border-r tabular-nums">{d ? formatCurrency(d.amount) : ""}</td>
                      <td className="px-3 py-2 border-r font-medium">{d?.account}</td>
                      <td className="px-3 py-2 border-r-2 border-r-violet-200 dark:border-r-violet-500/40"><Summary line={d} /></td>
                      <td className="px-3 py-2 border-r"><Summary line={c} /></td>
                      <td className="px-3 py-2 border-r font-medium">{c?.account}</td>
                      <td className="px-3 py-2 text-right amount font-semibold tabular-nums">{c ? formatCurrency(c.amount) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-violet-300 dark:border-violet-500/50 bg-violet-50/40 dark:bg-violet-500/10">
                  <td className="px-3 py-2.5 text-right amount font-bold text-base border-r tabular-nums" data-slip-debit-total="">{formatCurrency(data.debitTotal)}</td>
                  <td colSpan={4} className="px-3 py-2.5 text-center font-bold tracking-[1.5em] text-violet-800 dark:text-violet-200">合計</td>
                  <td className="px-3 py-2.5 text-right amount font-bold text-base tabular-nums" data-slip-credit-total="">{formatCurrency(data.creditTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* スマホ：借方と貸方を上下に */}
          <div className="md:hidden divide-y">
            {([["借方（支払うもの）", data.debit, data.debitTotal], ["貸方（差し引いたもの・手取り）", data.credit, data.creditTotal]] as const).map(([label, lines, total]) => (
              <div key={label} className="px-4 py-3">
                <p className="text-xs font-semibold text-violet-800 dark:text-violet-200 mb-1.5">{label}</p>
                {lines.map((l, i) => (
                  <div key={i} className="flex items-start gap-3 py-1.5">
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium">{l.account}</p><Summary line={l} /></div>
                    <p className="amount font-semibold tabular-nums text-sm">{formatCurrency(l.amount)}</p>
                  </div>
                ))}
                <div className="flex justify-between border-t mt-1 pt-2 font-bold"><span className="text-sm">合計</span><span className="amount tabular-nums">{formatCurrency(total)}</span></div>
              </div>
            ))}
          </div>

          <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t leading-relaxed">
            給与明細から作っています。左右の合計はどちらも総支給額です。時給の人は「雑給」、交通費は「旅費交通費」、携帯代は「通信費」に分けています。
            振込手数料・立替金など、給与明細に入っていないものは含みません。
          </p>
        </>
      )}
    </section>
  );
}

function Summary({ line }: { line?: Line }) {
  if (!line) return null;
  return (
    <div className="min-w-0">
      <p className="text-sm">{line.summary}{line.people ? <span className="text-muted-foreground text-xs ml-1">{line.people}人</span> : null}</p>
      {line.detail && line.detail.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {line.detail.map((d) => (
            <li key={d.label} className="flex justify-between gap-2 text-[11px] text-muted-foreground"><span>{d.label}</span><span className="amount tabular-nums">{formatCurrency(d.amount)}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
