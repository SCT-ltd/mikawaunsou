import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, Search } from "lucide-react";

/**
 * 操作の記録（だれが・いつ・何をしたか）。給与の確定・確定解除、社員情報・暗証番号・ユーザー・
 * 会社設定・保険料率・カレンダー・打刻の修正など、管理画面からの書き込みが残る。消したり直したりはできない。
 * 見られるのは管理者だけ（スタッフ・閲覧のみは 403）。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

// よく出る操作を日本語にする（ほかはそのまま出す）
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "ログイン",
  "payroll.confirm": "給与明細を確定",
  "payroll.unconfirm": "給与明細の確定を解除",
  "user.create": "ユーザーを追加",
  "user.update": "ユーザーを変更",
  "user.delete": "ユーザーを削除",
  "pin.set": "暗証番号を設定",
  "pin.clear": "暗証番号を消去",
  "qrkey.rotate": "QRコードを作り直し",
  "employee.delete": "社員を削除",
  "POST /payroll/calculate": "給与を計算",
  "PUT /employees/:id": "社員情報を変更",
  "POST /employees": "社員を追加",
  "PUT /employees/:id/month-items": "その月の手当・控除を保存",
  "PUT /company": "会社設定を変更",
  "POST /calendar/overrides/:id-:id-:id": "カレンダーの休日を変更",
  "DELETE /calendar/overrides": "カレンダーの休日を消去",
  "PATCH /attendance/records/:id": "打刻を修正",
  "DELETE /attendance/records/:id": "打刻を削除",
  "POST /attendance/record": "打刻を追加",
  "POST /monthly-records": "月次実績を保存",
  "PUT /monthly-records/:id": "月次実績を保存",
  "bank.update": "振込口座を変更",
  "transfer-settings.update": "振込元を変更",
  "transfer.export": "振込データ（全銀）を書き出し",
  "PUT /office-tools/bank-accounts/:id": "振込口座を変更",
};

/**
 * 記録から、対象の明細・社員を開くリンクを作る。
 *   payroll:12 → その明細の詳細／employee:5 → 社員マスターでその社員を開く
 *   本文に社員・年月があれば（給与の計算・月次実績の保存など）その月の画面を開く
 */
function linksOf(r: AuditRow): Array<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = [];
  const t = r.target ?? "";
  let m = /^payroll:(\d+)$/.exec(t);
  if (m) out.push({ href: `/payroll/${m[1]}`, label: "明細を開く" });
  m = /^employee:(\d+)$/.exec(t) ?? /^\/employees\/(\d+)/.exec(t) ?? /^\/office-tools\/bank-accounts\/(\d+)/.exec(t);
  const empFromTarget = m ? Number(m[1]) : null;
  let body: { employeeId?: unknown; year?: unknown; month?: unknown } = {};
  let query: { year?: unknown; month?: unknown } = {};
  try {
    const d = JSON.parse(r.detail ?? "{}") as { body?: typeof body; query?: typeof query };
    body = d.body ?? {};
    query = d.query ?? {};
  } catch { /* 中身が読めなければリンクは作らない */ }
  const empId = empFromTarget ?? (typeof body.employeeId === "number" ? body.employeeId : null);
  const y = Number(body.year ?? query.year);
  const mo = Number(body.month ?? query.month);
  if (empId && y && mo) {
    if (/monthly-records/.test(r.action)) out.push({ href: `/monthly-input?y=${y}&m=${mo}&emp=${empId}`, label: "月次実績を開く" });
    else out.push({ href: `/payroll?y=${y}&m=${mo}&emp=${empId}`, label: "その月の明細を開く" });
  }
  if (empId) out.push({ href: `/allowances?emp=${empId}`, label: "社員を開く" });
  return out;
}

function fmtDetail(detail: string | null): string {
  if (!detail) return "";
  try {
    const v = JSON.parse(detail) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, x] of Object.entries(v)) {
      if (k === "query" && x && typeof x === "object" && Object.keys(x).length === 0) continue;
      parts.push(`${k}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
    }
    const s = parts.join(" ／ ");
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return detail.slice(0, 400);
  }
}

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const list = useInfiniteQuery<AuditRow[], Error>({
    queryKey: ["audit-logs", query],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("before", String(pageParam));
      if (query) params.set("q", query);
      const res = await fetch(`${BASE}/api/audit-logs?${params}`, { credentials: "include" });
      if (res.status === 403) throw new Error("操作の記録を見られるのは管理者だけです。");
      if (!res.ok) throw new Error("読み込めませんでした。");
      return res.json();
    },
    getNextPageParam: (last) => (last.length === 200 ? last[last.length - 1]!.id : undefined),
  });
  const rows = list.data?.pages.flat() ?? [];

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow-md shrink-0">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold leading-tight">操作の記録</h2>
              <p className="text-[11px] text-muted-foreground leading-tight">だれが・いつ・何をしたか。消したり直したりはできません。</p>
            </div>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="中身で絞り込む（氏名・金額など）" className="w-64" />
            <Button type="submit" variant="outline" size="sm" className="gap-1"><Search className="h-4 w-4" />絞り込む</Button>
          </form>
        </div>

        {list.isError && <p className="text-sm text-red-600">{list.error.message}</p>}
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 whitespace-nowrap">日時</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">だれが</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">何をしたか</th>
                <th className="text-left px-3 py-2">中身</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">開く</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs">{new Date(r.at).toLocaleString("ja-JP")}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{r.actor}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs font-medium">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground break-all">{fmtDetail(r.detail)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {linksOf(r).map((l) => (
                      <Link key={l.href} href={l.href} className="block text-primary hover:underline">{l.label}</Link>
                    ))}
                  </td>
                </tr>
              ))}
              {!list.isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">記録はまだありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {list.hasNextPage && (
          <div className="text-center">
            <Button variant="outline" size="sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? "読み込み中…" : "さらに古い記録を読む"}
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
