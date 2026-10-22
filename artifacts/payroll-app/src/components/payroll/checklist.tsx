import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import type { MonthStatusRow } from "@/lib/office-tools";
import { BIG_DIFF_PCT } from "./payroll-list-pane";

/**
 * 確定前チェックリスト（給与明細画面の上）。
 * 毎月の確定の前に、事務所が目で探していた「抜け」を一覧にする。
 *   要対応（直さないと確定できない）… 明細が無い・計算のあとで勤怠や単価が変わった・右のパネルが未保存 など
 *   確認（確かめたら「確認した」を押す）… 雇用保険を手で入れた・前月より大きく変わった・残業時給が未設定 など
 * 一括確定は、要対応が0件で、確認をすべて押したときだけ押せる。
 */
export type IssueLevel = "must" | "check";
export interface ChecklistIssue {
  key: string;
  level: IssueLevel;
  employeeId: number;
  name: string;
  text: string;
  /** その社員を開く先（給与明細の中で開くときは null）*/
  href: string | null;
  /** 確認の札（「確認した」を押したときの言葉）*/
  ackLabel?: string;
}

export function buildChecklist(
  rows: MonthStatusRow[],
  year: number,
  month: number,
  opts: { dirtyEmployeeId: number | null },
): ChecklistIssue[] {
  const out: ChecklistIssue[] = [];
  const mi = (id: number) => `/monthly-input?y=${year}&m=${month}&emp=${id}`;
  for (const r of rows) {
    if (r.payroll?.status === "confirmed") continue;
    const name = r.name || `社員ID ${r.employeeId}`;
    if (r.isActive && !r.hasRecord) {
      out.push({ key: `norec:${r.employeeId}`, level: "check", employeeId: r.employeeId, name, href: mi(r.employeeId),
        text: "この月の月次実績が未保存です（明細も作れません）",
        ackLabel: "今月は支給なし（休職など）" });
    } else if (r.isActive && !r.payroll) {
      out.push({ key: `nopay:${r.employeeId}`, level: "must", employeeId: r.employeeId, name, href: mi(r.employeeId),
        text: "月次実績はあるのに、給与明細がまだありません（「一括計算」で作れます）" });
    }
    if (r.payroll && r.needsRecalc) {
      out.push({ key: `recalc:${r.employeeId}`, level: "must", employeeId: r.employeeId, name, href: null,
        text: `計算したあとで「${r.recalcReasons.join("・")}」が変わっています。「再計算」を押してください` });
    }
    if (opts.dirtyEmployeeId === r.employeeId) {
      out.push({ key: `dirty:${r.employeeId}`, level: "must", employeeId: r.employeeId, name, href: null,
        text: "右のパネルの手当・控除がまだ保存されていません" });
    }
    if (r.payroll && r.employmentInsuranceOverride != null) {
      out.push({ key: `empins:${r.employeeId}`, level: "check", employeeId: r.employeeId, name, href: null,
        text: `雇用保険料を手入力しています（${Math.round(r.employmentInsuranceOverride).toLocaleString("ja-JP")}円）` });
    }
    if (r.payroll && r.overtimeHours > 0 && (r.overtimeHourlyRate ?? 0) <= 0) {
      out.push({ key: `otrate:${r.employeeId}`, level: "check", employeeId: r.employeeId, name, href: `/allowances?emp=${r.employeeId}`,
        text: `残業時給が未設定なのに、残業が${r.overtimeHours}時間あります（早出残業手当が自動で入りません）` });
    }
    if (r.payroll && r.prev && r.prev.netSalary > 0) {
      const pct = ((r.payroll.netSalary - r.prev.netSalary) / r.prev.netSalary) * 100;
      if (Math.abs(pct) >= BIG_DIFF_PCT) {
        out.push({ key: `diff:${r.employeeId}`, level: "check", employeeId: r.employeeId, name, href: null,
          text: `差引支給額が前月より${pct > 0 ? "+" : ""}${pct.toFixed(0)}%変わっています（${Math.round(r.prev.netSalary).toLocaleString("ja-JP")}円 → ${Math.round(r.payroll.netSalary).toLocaleString("ja-JP")}円）` });
      }
    }
  }
  return out;
}

export function useChecklistAck(year: number, month: number) {
  const [acks, setAcks] = useState<Record<string, Set<string>>>({});
  const mk = `${year}-${month}`;
  const set = acks[mk] ?? new Set<string>();
  const toggle = (key: string) =>
    setAcks((prev) => {
      const cur = new Set(prev[mk] ?? []);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      return { ...prev, [mk]: cur };
    });
  return { acked: set, toggle };
}

export function ChecklistCard({
  issues,
  acked,
  onToggleAck,
  onOpen,
  loading,
}: {
  issues: ChecklistIssue[];
  acked: Set<string>;
  onToggleAck: (key: string) => void;
  onOpen: (issue: ChecklistIssue) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const must = issues.filter((i) => i.level === "must");
  const checks = issues.filter((i) => i.level === "check");
  const unacked = checks.filter((i) => !acked.has(i.key));
  const allClear = must.length === 0 && unacked.length === 0;
  const sorted = useMemo(() => [...must, ...checks], [must, checks]);

  return (
    <div
      data-testid="checklist"
      className={`rounded-lg border ${allClear ? "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-500/10 dark:border-emerald-500/30" : "border-amber-300 bg-amber-50/70 dark:bg-amber-500/10 dark:border-amber-500/40"}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <ListChecks className={`h-4 w-4 shrink-0 ${allClear ? "text-emerald-600" : "text-amber-600"}`} />
        <span className="font-semibold">確定前チェック</span>
        {loading ? (
          <span className="text-xs text-muted-foreground">確かめています…</span>
        ) : allClear ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />確定の前に直すところはありません</span>
        ) : (
          <span className="text-xs text-amber-900 dark:text-amber-100">
            {must.length > 0 && <strong className="text-red-700 dark:text-red-300">要対応 {must.length}件</strong>}
            {must.length > 0 && unacked.length > 0 && "・"}
            {unacked.length > 0 && <span>確認 {unacked.length}件</span>}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground flex items-center gap-0.5">
          {open ? "閉じる" : "開く"}{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-inherit max-h-56 overflow-y-auto px-2 py-1.5">
          {sorted.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">この月の未確定の明細に、気をつけるところは見つかりませんでした。</p>
          ) : (
            <ul className="space-y-0.5">
              {sorted.map((i) => {
                const done = i.level === "check" && acked.has(i.key);
                return (
                  <li key={i.key} className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${done ? "opacity-60" : ""}`}>
                    {i.level === "must"
                      ? <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" aria-label="要対応" />
                      : <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-amber-500" aria-label="確認" />}
                    <span className="min-w-0 flex-1">
                      <button type="button" className="font-semibold underline underline-offset-2 hover:text-primary" onClick={() => onOpen(i)}>
                        {i.name}
                      </button>
                      <span className="ml-1.5">{i.text}</span>
                    </span>
                    {i.level === "check" && (
                      <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-600" checked={done} onChange={() => onToggleAck(i.key)} />
                        {i.ackLabel ?? "確認した"}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
