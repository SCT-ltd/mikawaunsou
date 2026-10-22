import { Fragment, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Scale, Download, Printer, RefreshCw } from "lucide-react";

/**
 * 給与計算と法令の画面（2026-10-24 追加）。API は /api/payroll-law/*（routes/payroll-law.ts）。
 * 社員の法令まわりの情報・住民税の12か月分・有給の管理簿・算定基礎／月額変更・年末調整の準備・賞与・
 * 賃金台帳・労働者名簿・雇用保険料の不足・最低賃金と残業・退職。
 * ここで出す CSV と印刷には個人情報が入る。持ち出しに注意。
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/payroll-law${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `読み書きできませんでした（${res.status}）`);
  return body as T;
}
const put = (path: string, body: unknown) => api(path, { method: "PUT", body: JSON.stringify(body) });
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

async function downloadCsv(path: string, name: string) {
  const res = await fetch(`${BASE}/api/payroll-law${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`CSV を作れませんでした（${res.status}）`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** 別の窓に表を出して印刷する（アプリの画面は印刷時に隠しているため） */
function printTable(title: string, head: string[], rows: Array<Array<string | number>>) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;font-size:10px;margin:8mm}h1{font-size:14px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:2px 4px}td.n{text-align:right}th{background:#eee}
@page{size:A4 landscape;margin:8mm}</style></head><body><h1>${esc(title)}</h1><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="${typeof c === "number" ? "n" : ""}">${esc(typeof c === "number" ? c.toLocaleString("ja-JP") : c)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

const yen = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `¥${Math.round(n).toLocaleString("ja-JP")}`);
const thisYear = new Date().getFullYear();

function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError(null);
    api<T>(path).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

function YearInput({ value, onChange, label = "年" }: { value: number; onChange: (n: number) => void; label?: string }) {
  return (
    <label className="text-sm flex items-center gap-2">{label}
      <Input type="number" className="w-24 text-right" value={value} onChange={(e) => onChange(Number(e.target.value) || thisYear)} />
    </label>
  );
}

const th = "px-2 py-1 text-left text-xs font-medium text-muted-foreground border-b border-border whitespace-nowrap";
const td = "px-2 py-1 text-sm border-b border-border/60 whitespace-nowrap";
const tdn = `${td} text-right tabular-nums`;

// ── 社員の法令まわりの情報 ───────────────────────────────────────────

interface LegalEmp {
  id: number; employeeCode: string; name: string; isActive: boolean; salaryType: string; isOfficeStaff: boolean; dateOfBirth: string | null; hireDate: string;
  healthInsuranceMode: string; socialInsuranceExempt: boolean; employmentInsuranceExempt: boolean; incomeTaxExempt: boolean;
  taxColumn: string; disability: string; widow: boolean; singleParent: boolean; workingStudent: boolean; dependentDisabilityCount: number;
  commuteMethod: string | null; commuteDistanceKm: number | null; weeklyScheduledDays: number | null; weeklyScheduledHours: number | null;
  gender: string | null; address: string | null; jobType: string | null; retirementDate: string | null; retirementReason: string | null;
}

function EmployeesTab() {
  const { toast } = useToast();
  const { data, error, reload } = useLoad<LegalEmp[]>("/employees");
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<LegalEmp>>({});
  const cur = data?.find((e) => e.id === sel) ?? null;
  useEffect(() => { if (cur) setForm(cur); }, [cur]);
  const f = <K extends keyof LegalEmp>(k: K, v: LegalEmp[K]) => setForm((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!cur) return;
    const keys: Array<keyof LegalEmp> = ["healthInsuranceMode", "socialInsuranceExempt", "employmentInsuranceExempt", "incomeTaxExempt", "taxColumn", "disability", "widow", "singleParent", "workingStudent", "dependentDisabilityCount", "commuteMethod", "commuteDistanceKm", "weeklyScheduledDays", "weeklyScheduledHours", "gender", "address", "jobType", "retirementDate", "retirementReason"];
    const body: Record<string, unknown> = {};
    for (const k of keys) body[k] = form[k] ?? null;
    try {
      await put(`/employees/${cur.id}`, body);
      toast({ title: "保存しました", description: "確定前の明細は「再計算」で反映されます。" });
      reload();
    } catch (e) { toast({ title: "保存できませんでした", description: (e as Error).message, variant: "destructive" }); }
  }

  const sel2 = (k: keyof LegalEmp, opts: Array<[string, string]>) => (
    <select className="w-full border border-border rounded px-2 py-1.5 bg-background text-sm" value={String(form[k] ?? "")} onChange={(e) => f(k, e.target.value as never)}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const chk = (k: keyof LegalEmp, label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[k] === true} onChange={(e) => f(k, e.target.checked as never)} />{label}</label>
  );
  const numIn = (k: keyof LegalEmp, step = "1") => (
    <Input type="number" min="0" step={step} value={form[k] === null || form[k] === undefined ? "" : String(form[k])} onChange={(e) => f(k, (e.target.value === "" ? null : Number(e.target.value)) as never)} />
  );
  const txt = (k: keyof LegalEmp, type = "text") => (
    <Input type={type} value={String(form[k] ?? "")} onChange={(e) => f(k, (e.target.value || null) as never)} />
  );

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <Card><CardContent className="p-2 max-h-[70vh] overflow-auto">
        {error && <p className="text-sm text-red-600 p-2">{error}</p>}
        {data?.map((e) => (
          <button key={e.id} type="button" onClick={() => setSel(e.id)} className={`w-full text-left px-2 py-1.5 rounded text-sm ${sel === e.id ? "bg-primary/10 text-primary" : "hover:bg-muted"} ${e.isActive ? "" : "opacity-50"}`}>
            {e.employeeCode} {e.name}{!e.isActive && "（在籍なし）"}
          </button>
        ))}
      </CardContent></Card>
      {cur ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{cur.name}さん</CardTitle>
            <CardDescription>生年月日 {cur.dateOfBirth ?? "未入力"}／入社 {cur.hireDate}</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <section className="space-y-2">
              <p className="text-sm font-semibold">保険・税を引くか</p>
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-sm space-y-1"><span>健康保険（介護・子育て支援金を含む）</span>
                  {sel2("healthInsuranceMode", [["auto", "自動（75歳の誕生日の月から止める）"], ["applied", "適用する（止めない）"], ["not_applied", "適用しない"]])}</label>
                <div className="space-y-1 pt-5">
                  {chk("socialInsuranceExempt", "社会保険（健保・厚年）を引かない")}
                  {chk("employmentInsuranceExempt", "雇用保険料を引かない")}
                  {chk("incomeTaxExempt", "源泉所得税を引かない")}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">以前の「全額非課税」は、この3つが全部入った状態です。どれか1つだけ止めることもできます。</p>
            </section>
            <section className="space-y-2">
              <p className="text-sm font-semibold">源泉所得税（扶養控除等申告書）</p>
              <div className="grid md:grid-cols-3 gap-3">
                <label className="text-sm space-y-1"><span>申告書</span>{sel2("taxColumn", [["kou", "出している（甲欄）"], ["otsu", "出していない（乙欄）"]])}</label>
                <label className="text-sm space-y-1"><span>本人の障害</span>{sel2("disability", [["none", "なし"], ["general", "障害者"], ["special", "特別障害者"]])}</label>
                <label className="text-sm space-y-1"><span>扶養親族のうち障害者の数</span>{numIn("dependentDisabilityCount")}<span className="text-xs text-muted-foreground">同居の特別障害者は2として数える</span></label>
              </div>
              <div className="flex flex-wrap gap-4">{chk("widow", "寡婦")}{chk("singleParent", "ひとり親")}{chk("workingStudent", "勤労学生")}</div>
              <p className="text-xs text-muted-foreground">本人が障害者・寡婦・ひとり親・勤労学生のときは、月額表の「扶養親族等の数」にそれぞれ1人足します。乙欄の税額表はこのシステムに入っていないため、乙欄の人（社保控除後 88,000円以上）は計算を止めて知らせます。</p>
            </section>
            <section className="space-y-2">
              <p className="text-sm font-semibold">通勤（非課税の上限）</p>
              <div className="grid md:grid-cols-3 gap-3">
                <label className="text-sm space-y-1"><span>通勤の手段</span>{sel2("commuteMethod", [["", "未設定（全額を非課税のまま）"], ["public", "電車・バス（月15万円まで非課税）"], ["car", "マイカー・自転車など（距離で上限）"]])}</label>
                <label className="text-sm space-y-1"><span>片道の距離（km）</span>{numIn("commuteDistanceKm", "0.1")}</label>
              </div>
            </section>
            <section className="space-y-2">
              <p className="text-sm font-semibold">有給の付与（週の所定）</p>
              <div className="grid md:grid-cols-3 gap-3">
                <label className="text-sm space-y-1"><span>週の所定労働日数</span>{numIn("weeklyScheduledDays", "0.5")}<span className="text-xs text-muted-foreground">空欄＝5日（通常の付与）</span></label>
                <label className="text-sm space-y-1"><span>週の所定労働時間</span>{numIn("weeklyScheduledHours", "0.5")}<span className="text-xs text-muted-foreground">4日以下かつ30時間未満で比例付与</span></label>
              </div>
            </section>
            <section className="space-y-2">
              <p className="text-sm font-semibold">労働者名簿・退職</p>
              <div className="grid md:grid-cols-3 gap-3">
                <label className="text-sm space-y-1"><span>性別</span>{sel2("gender", [["", "未入力"], ["male", "男"], ["female", "女"], ["other", "その他"]])}</label>
                <label className="text-sm space-y-1 md:col-span-2"><span>住所</span>{txt("address")}</label>
                <label className="text-sm space-y-1"><span>業務の種類</span>{txt("jobType")}<span className="text-xs text-muted-foreground">空欄なら「貨物自動車の運転」または「事務」</span></label>
                <label className="text-sm space-y-1"><span>退職日</span>{txt("retirementDate", "date")}</label>
                <label className="text-sm space-y-1"><span>退職の理由（解雇はその理由）</span>{txt("retirementReason")}</label>
              </div>
            </section>
            <div className="flex justify-end"><Button onClick={save}>保存する</Button></div>
            {cur.retirementDate && <RetirementInfo id={cur.id} />}
          </CardContent>
        </Card>
      ) : <Card><CardContent className="p-6 text-sm text-muted-foreground">左から社員を選んでください。</CardContent></Card>}
    </div>
  );
}

function RetirementInfo({ id }: { id: number }) {
  const { data } = useLoad<{ retirementDate: string; lossDate: string; note: string; proration: null | { base: number; calendar: number; scheduled: number; calendarDays: number; workedCalendar: number; scheduledDays: number; workedScheduled: number }; withholdingSlip: null | { paidAmount: number; socialInsurance: number; incomeTax: number } }>(`/retirement/${id}`);
  if (!data?.retirementDate) return null;
  return (
    <div className="rounded-md border border-border p-3 text-sm space-y-2">
      <p className="font-semibold">退職の判断材料</p>
      <p>{data.note}</p>
      {data.proration && (
        <p>最終月の日割り（月給 {yen(data.proration.base)}・明細には入れていません。就業規則で決まった式を手で入れてください）：
          暦日で {data.proration.workedCalendar}/{data.proration.calendarDays}日 → {yen(data.proration.calendar)}／
          平日で {data.proration.workedScheduled}/{data.proration.scheduledDays}日 → {yen(data.proration.scheduled)}</p>
      )}
      {data.withholdingSlip && (
        <p>源泉徴収票（退職者）の数字：支払金額 {yen(data.withholdingSlip.paidAmount)}／社会保険料等 {yen(data.withholdingSlip.socialInsurance)}／源泉徴収税額 {yen(data.withholdingSlip.incomeTax)}（退職後1か月以内に本人へ）</p>
      )}
    </div>
  );
}

// ── 住民税 ─────────────────────────────────────────────────────────

function ResidentTaxTab() {
  const { toast } = useToast();
  const [fy, setFy] = useState(new Date().getMonth() + 1 >= 6 ? thisYear : thisYear - 1);
  const { data, reload } = useLoad<{ fiscalYear: number; months: Array<{ year: number; month: number }>; employees: Array<{ employeeId: number; name: string; masterMonthly: number; amounts: Array<number | null> }> }>(`/resident-tax?fiscalYear=${fy}`);
  const [edits, setEdits] = useState<Record<number, string[]>>({});
  useEffect(() => { if (data) setEdits(Object.fromEntries(data.employees.map((e) => [e.employeeId, e.amounts.map((a) => (a === null ? "" : String(a)))]))); }, [data]);
  async function save(id: number) {
    try {
      const r = await put(`/resident-tax/${id}`, { fiscalYear: fy, amounts: (edits[id] ?? []).map((v) => (v === "" ? null : Number(v))) }) as { skipped: string[] };
      toast({ title: "保存しました", description: r.skipped.length ? `確定済みの明細の月は変えていません：${r.skipped.join("・")}` : "次の再計算から使います。" });
      reload();
    } catch (e) { toast({ title: "保存できませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">住民税（特別徴収）の12か月分</CardTitle>
        <CardDescription>決定通知書の6月〜翌5月の額を入れます。6月分は「6月に払う給与」＝5月分の明細から引きます。6月だけ額が違う人はそのまま入れてください。
          退職で残りを一括で引くときは、最後の月にまとめた額を入れます。空欄の月は社員マスターの月額を引きます。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <YearInput value={fy} onChange={setFy} label="年度（6月始まり）" />
        <div className="overflow-auto">
          <table className="min-w-full">
            <thead><tr><th className={th}>氏名</th><th className={th}>マスター月額</th>{data?.months.map((m) => <th key={`${m.year}-${m.month}`} className={th}>{m.month}月分</th>)}<th className={th}></th></tr></thead>
            <tbody>{data?.employees.map((e) => (
              <tr key={e.employeeId}><td className={td}>{e.name}</td><td className={tdn}>{yen(e.masterMonthly)}</td>
                {(edits[e.employeeId] ?? []).map((v, i) => (
                  <td key={i} className={td}><Input className="w-24 text-right h-8" value={v} onChange={(ev) => setEdits((p) => ({ ...p, [e.employeeId]: (p[e.employeeId] ?? []).map((x, j) => (j === i ? ev.target.value.replace(/[^\d]/g, "") : x)) }))} /></td>
                ))}
                <td className={td}><Button size="sm" variant="outline" onClick={() => save(e.employeeId)}>保存</Button></td></tr>
            ))}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 有給 ───────────────────────────────────────────────────────────

interface LeaveEmp { employeeId: number; employeeName: string; hireDate: string; taken: Array<{ date: string; days: number }>;
  ledger: { remaining: number; overdrawn: number; grants: Array<{ date: string; days: number; expires: string; used: number; remaining: number; expired: boolean }>; obligations: Array<{ grantDate: string; deadline: string; taken: number; shortage: number }> };
  adjustments: Array<{ id: number; date: string; days: number; note: string | null }> }

function PaidLeaveTab() {
  const { toast } = useToast();
  const { data, reload } = useLoad<{ today: string; employees: LeaveEmp[] }>("/paid-leave");
  const [adj, setAdj] = useState({ employeeId: 0, date: new Date().toISOString().slice(0, 10), days: "", note: "" });
  async function addAdj() {
    try { await post("/paid-leave/adjustments", { ...adj, days: Number(adj.days) }); reload(); setAdj((p) => ({ ...p, days: "", note: "" })); }
    catch (e) { toast({ title: "入れられませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">有給休暇の管理簿</CardTitle>
        <CardDescription>入社日から付与日数を出し（労基法39条・週の所定日数で比例付与）、月次実績の有給の日数（欠勤の記録に日付があればその日）で古い付与から使います。2年で消えます。
          出勤率8割の判定はしていません。システムを使う前の残日数は「調整」で入れてください。年5日（10日以上付与した人）の不足はお知らせに出ます。</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCsv("/paid-leave.csv", `有給休暇管理簿_${data?.today ?? ""}.csv`)}><Download className="mr-1 h-4 w-4" />管理簿の CSV</Button>
          <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="mr-1 h-4 w-4" />取り直す</Button>
        </div>
        <div className="overflow-auto"><table className="min-w-full">
          <thead><tr><th className={th}>氏名</th><th className={th}>入社日</th><th className={th}>残日数</th><th className={th}>直近の付与</th><th className={th}>年5日の期限</th><th className={th}>期限までの取得</th><th className={th}>調整</th></tr></thead>
          <tbody>{data?.employees.map((x) => {
            const last = [...x.ledger.grants].reverse().find((g) => g.date <= data.today);
            const ob = [...x.ledger.obligations].reverse().find((o) => o.grantDate <= data.today);
            return (
              <tr key={x.employeeId}>
                <td className={td}>{x.employeeName}</td><td className={td}>{x.hireDate}</td>
                <td className={tdn}>{x.ledger.remaining}日{x.ledger.overdrawn > 0 && <span className="text-red-600">（付与を{x.ledger.overdrawn}日超えて取得）</span>}</td>
                <td className={td}>{last ? `${last.date}に${last.days}日` : "—"}</td>
                <td className={td}>{ob?.deadline ?? "—"}</td>
                <td className={td}>{ob ? <span className={ob.shortage > 0 ? "text-red-600" : ""}>{ob.taken}日{ob.shortage > 0 && `（あと${ob.shortage}日）`}</span> : "—"}</td>
                <td className={td}>{x.adjustments.map((a) => `${a.date} ${a.days > 0 ? "+" : ""}${a.days}`).join("、") || "—"}</td>
              </tr>);
          })}</tbody></table></div>
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="text-sm space-y-1"><span>社員</span>
            <select className="border border-border rounded px-2 py-1.5 bg-background text-sm block" value={adj.employeeId} onChange={(e) => setAdj((p) => ({ ...p, employeeId: Number(e.target.value) }))}>
              <option value={0}>選ぶ</option>{data?.employees.map((x) => <option key={x.employeeId} value={x.employeeId}>{x.employeeName}</option>)}
            </select></label>
          <label className="text-sm space-y-1"><span>日付</span><Input type="date" value={adj.date} onChange={(e) => setAdj((p) => ({ ...p, date: e.target.value }))} /></label>
          <label className="text-sm space-y-1"><span>日数（＋付与・−取得済み）</span><Input className="w-28" value={adj.days} onChange={(e) => setAdj((p) => ({ ...p, days: e.target.value }))} placeholder="例 -3.5" /></label>
          <label className="text-sm space-y-1"><span>メモ</span><Input value={adj.note} onChange={(e) => setAdj((p) => ({ ...p, note: e.target.value }))} /></label>
          <Button onClick={addAdj} disabled={!adj.employeeId || !adj.days}>調整を入れる</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 算定基礎・月額変更 ───────────────────────────────────────────────

interface ReviewC { employeeId: number; employeeName: string; kind: "teiji" | "zuiji"; effectiveYear: number; effectiveMonth: number; average: number; standard: number; current: number; gradeDiff?: number; alreadyRegistered: boolean; months: Array<{ year: number; month: number; payMonth: number; amount: number; baseDays: number }> }

function ReviewTab() {
  const { toast } = useToast();
  const [year, setYear] = useState(thisYear);
  const { data, reload } = useLoad<ReviewC[]>(`/remuneration-review?year=${year}`);
  async function apply(c: ReviewC) {
    if (!confirm(`${c.employeeName}さんの標準報酬月額を ${c.effectiveYear}年${c.effectiveMonth}月分から ${c.standard.toLocaleString("ja-JP")}円 として履歴に入れます。年金事務所の決定通知と同じ額か確かめましたか？`)) return;
    try { await post("/remuneration-review/apply", { employeeId: c.employeeId, effectiveYear: c.effectiveYear, effectiveMonth: c.effectiveMonth, amount: c.standard, reason: c.kind }); toast({ title: "履歴に入れました" }); reload(); }
    catch (e) { toast({ title: "入れられませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">算定基礎（定時決定）・月額変更（随時改定）の候補</CardTitle>
        <CardDescription>定時決定＝4〜6月に払った給与（3〜5月分の明細）のうち支払基礎日数17日以上の月の平均。随時改定＝固定的賃金（日当・基本給・毎月決まった手当）が変わった月から3か月の平均で2等級以上の差。
          決めるのは年金事務所です。ここは候補を出すだけで、ボタンを押すと標準報酬月額の履歴（明細の年月）に入ります。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <YearInput value={year} onChange={setYear} />
        <div className="overflow-auto"><table className="min-w-full">
          <thead><tr><th className={th}>氏名</th><th className={th}>種類</th><th className={th}>使った月（支払月・日数・報酬）</th><th className={th}>平均</th><th className={th}>候補</th><th className={th}>いま</th><th className={th}>適用（明細の年月）</th><th className={th}></th></tr></thead>
          <tbody>{data?.length === 0 && <tr><td className={td} colSpan={8}>候補はありません。</td></tr>}
            {data?.map((c, i) => (
              <tr key={i}><td className={td}>{c.employeeName}</td><td className={td}>{c.kind === "teiji" ? "定時決定" : `随時改定（${c.gradeDiff! > 0 ? "+" : ""}${c.gradeDiff}等級）`}</td>
                <td className={td}>{c.months.map((m) => `${m.payMonth}月払 ${m.baseDays}日 ${m.amount.toLocaleString("ja-JP")}`).join(" ／ ")}</td>
                <td className={tdn}>{yen(c.average)}</td><td className={tdn}>{yen(c.standard)}</td><td className={tdn}>{yen(c.current)}</td>
                <td className={td}>{c.effectiveYear}年{c.effectiveMonth}月分</td>
                <td className={td}>{c.alreadyRegistered ? <span className="text-xs text-muted-foreground">登録済み</span> : <Button size="sm" variant="outline" onClick={() => apply(c)}>履歴に入れる</Button>}</td></tr>
            ))}</tbody></table></div>
      </CardContent>
    </Card>
  );
}

// ── 年末調整の準備 ───────────────────────────────────────────────────

function YearendTab() {
  const { toast } = useToast();
  const [year, setYear] = useState(thisYear);
  const { data, reload } = useLoad<{ year: number; employees: Array<{ employeeId: number; name: string; retirementDate: string | null; paidAmount: number; socialInsurance: number; incomeTax: number; draftMonths: number; months: Array<{ year: number; month: number; paymentDate: string }>; bonuses: unknown[]; declaration: Record<string, unknown> }> }>(`/yearend?year=${year}`);
  const [open, setOpen] = useState<number | null>(null);
  const [decl, setDecl] = useState<Record<string, string>>({});
  const FIELDS: Array<[string, string]> = [
    ["spouse", "源泉控除対象配偶者・配偶者の合計所得の見積額（円）"], ["dependentsGeneral", "控除対象扶養親族（一般・16〜18歳/23〜69歳）の人数"],
    ["dependentsSpecific", "特定扶養親族（19〜22歳）の人数"], ["dependentsElderly", "老人扶養親族（70歳以上）の人数（同居老親等は内数で）"],
    ["specificRelative", "特定親族特別控除の対象の親族（19〜22歳・所得58万円超）"], ["lifeInsurance", "生命保険料（一般・介護医療・個人年金の支払額、それぞれ）"],
    ["earthquake", "地震保険料の支払額"], ["socialInsuranceOther", "本人が直接払った国民年金・国民健康保険料など"], ["smallBusiness", "小規模企業共済等掛金・iDeCo"],
    ["housingLoan", "住宅借入金等特別控除の額（申告書の金額）"], ["previousJob", "前の勤め先の支払金額・社会保険料・源泉徴収税額（年の途中で入った人）"],
  ];
  async function saveDecl(id: number) {
    try { await put(`/yearend/declarations/${id}`, { year, data: decl }); toast({ title: "保存しました" }); reload(); }
    catch (e) { toast({ title: "保存できませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">年末調整の準備（年間の集計）</CardTitle>
        <CardDescription>その年に<strong>支払った</strong>給与（翌月25日払いなので前年12月分〜その年の11月分の明細）と賞与を1人ずつ集計します。源泉徴収票・給与支払報告書の「支払金額」「社会保険料等の金額」「源泉徴収税額（年末調整の前）」の元の数字です。
          年税額の計算（年末調整そのもの）はこの画面ではしていません：令和8年分の給与所得控除後の給与等の金額の表・基礎控除の段階などを、確かな値で入れられていないためです。国税庁の年調ソフトなどで計算し、申告書の中身はここに控えておけます。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center"><YearInput value={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={() => downloadCsv(`/yearend.csv?year=${year}`, `年末調整の準備_${year}年.csv`)}><Download className="mr-1 h-4 w-4" />CSV</Button>
          <Button variant="outline" size="sm" onClick={() => printTable(`年末調整の準備 ${year}年`, ["氏名", "退職日", "支払金額", "社会保険料等", "源泉徴収税額", "未確定の月"], (data?.employees ?? []).map((e) => [e.name, e.retirementDate ?? "", e.paidAmount, e.socialInsurance, e.incomeTax, e.draftMonths]))}><Printer className="mr-1 h-4 w-4" />印刷</Button></div>
        <div className="overflow-auto"><table className="min-w-full">
          <thead><tr><th className={th}>氏名</th><th className={th}>支払金額</th><th className={th}>社会保険料等</th><th className={th}>源泉徴収税額</th><th className={th}>対象の明細</th><th className={th}>申告書の中身</th></tr></thead>
          <tbody>{data?.employees.map((e) => (
            <Fragment key={e.employeeId}>
              <tr><td className={td}>{e.name}{e.retirementDate && `（${e.retirementDate} 退職）`}</td><td className={tdn}>{yen(e.paidAmount)}</td><td className={tdn}>{yen(e.socialInsurance)}</td><td className={tdn}>{yen(e.incomeTax)}</td>
                <td className={td}>{e.months.length}か月{e.draftMonths > 0 && <span className="text-amber-700">（未確定{e.draftMonths}）</span>}・賞与{e.bonuses.length}回</td>
                <td className={td}><Button size="sm" variant="outline" onClick={() => { setOpen(open === e.employeeId ? null : e.employeeId); setDecl(e.declaration as Record<string, string>); }}>{open === e.employeeId ? "閉じる" : "入れる"}</Button></td></tr>
              {open === e.employeeId && (
                <tr><td colSpan={6} className="p-3 bg-muted/30">
                  <div className="grid md:grid-cols-2 gap-2">{FIELDS.map(([k, l]) => (
                    <label key={k} className="text-xs space-y-1"><span>{l}</span><Input value={decl[k] ?? ""} onChange={(ev) => setDecl((p) => ({ ...p, [k]: ev.target.value }))} /></label>
                  ))}</div>
                  <div className="flex justify-end mt-2"><Button size="sm" onClick={() => saveDecl(e.employeeId)}>申告書の中身を保存</Button></div>
                </td></tr>
              )}
            </Fragment>
          ))}</tbody></table></div>
      </CardContent>
    </Card>
  );
}

// ── 賞与 ───────────────────────────────────────────────────────────

interface BonusRow { id: number; employeeId: number; employeeName: string; payDate: string; amount: number; periodMonths: number; standardBonus: number; healthStandard: number; pensionStandard: number; healthInsurance: number; childcareSupportContribution: number; pension: number; employmentInsurance: number; incomeTax: number | null; netAmount: number | null; incomeTaxMethod: string | null; status: string }

function BonusTab() {
  const { toast } = useToast();
  const [year, setYear] = useState(thisYear);
  const { data, reload } = useLoad<{ hasRateTable: boolean; bonuses: BonusRow[] }>(`/bonuses?year=${year}`);
  const emps = useLoad<LegalEmp[]>("/employees").data?.filter((e) => e.isActive) ?? [];
  const [inp, setInp] = useState({ employeeId: 0, payDate: `${thisYear}-12-10`, amount: "", periodMonths: "6" });
  async function add() {
    try {
      const r = await post<BonusRow & { incomeTaxError?: string }>("/bonuses", { ...inp, amount: Number(inp.amount), periodMonths: Number(inp.periodMonths) });
      toast({ title: "賞与の明細を作りました", description: r.incomeTaxError ?? "確かめてから「確定」してください。" });
      reload();
    } catch (e) { toast({ title: "作れませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  async function act(id: number, what: "confirm" | "unconfirm" | "recalc" | "delete") {
    try {
      if (what === "delete") { if (!confirm("この賞与の明細を消します。")) return; await api(`/bonuses/${id}`, { method: "DELETE" }); }
      else if (what === "recalc") await put(`/bonuses/${id}`, {});
      else await post(`/bonuses/${id}/${what}`, {});
      reload();
    } catch (e) { toast({ title: "できませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">賞与</CardTitle>
        <CardDescription>標準賞与額＝1,000円未満切り捨て。上限は健康保険＝年度（4月〜翌3月）の累計573万円、厚生年金＝1回150万円。雇用保険は賞与の額×料率。
          源泉税は「賞与に対する源泉徴収税額の算出率の表」（会社設定に入れる）× 社会保険料控除後の賞与。前月に給与が無い・賞与が前月の給与の10倍を超えるときは月額表で計算します（所得税法186条）。
          {data && !data.hasRateTable && <strong className="text-red-600">　算出率の表が会社設定に入っていません。</strong>}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center"><YearInput value={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={() => downloadCsv(`/bonuses/report.csv?year=${year}`, `賞与支払届の数字_${year}年.csv`)}><Download className="mr-1 h-4 w-4" />賞与支払届の数字（CSV）</Button></div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm space-y-1"><span>社員</span>
            <select className="border border-border rounded px-2 py-1.5 bg-background text-sm block" value={inp.employeeId} onChange={(e) => setInp((p) => ({ ...p, employeeId: Number(e.target.value) }))}>
              <option value={0}>選ぶ</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <label className="text-sm space-y-1"><span>支給日</span><Input type="date" value={inp.payDate} onChange={(e) => setInp((p) => ({ ...p, payDate: e.target.value }))} /></label>
          <label className="text-sm space-y-1"><span>賞与の額（円）</span><Input className="w-32 text-right" value={inp.amount} onChange={(e) => setInp((p) => ({ ...p, amount: e.target.value.replace(/[^\d]/g, "") }))} /></label>
          <label className="text-sm space-y-1"><span>計算の対象の月数</span><Input className="w-20 text-right" value={inp.periodMonths} onChange={(e) => setInp((p) => ({ ...p, periodMonths: e.target.value.replace(/[^\d]/g, "") }))} /></label>
          <Button onClick={add} disabled={!inp.employeeId || !inp.amount}>計算して作る</Button>
        </div>
        <div className="overflow-auto"><table className="min-w-full">
          <thead><tr>{["氏名", "支給日", "賞与", "標準賞与額（健保/厚年）", "健保", "子育て支援金", "厚年", "雇用保険", "源泉税", "差引", "状態", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{data?.bonuses.map((b) => (
            <tr key={b.id}><td className={td}>{b.employeeName}</td><td className={td}>{b.payDate}</td><td className={tdn}>{yen(b.amount)}</td>
              <td className={tdn}>{yen(b.healthStandard)} / {yen(b.pensionStandard)}</td><td className={tdn}>{yen(b.healthInsurance)}</td><td className={tdn}>{yen(b.childcareSupportContribution)}</td>
              <td className={tdn}>{yen(b.pension)}</td><td className={tdn}>{yen(b.employmentInsurance)}</td>
              <td className={tdn}>{b.incomeTax === null ? <span className="text-red-600">未計算</span> : yen(b.incomeTax)}{b.incomeTaxMethod === "monthly" && "（月額表）"}</td>
              <td className={tdn}>{yen(b.netAmount)}</td><td className={td}>{b.status === "confirmed" ? "確定" : "未確定"}</td>
              <td className={td}>{b.status === "confirmed"
                ? <Button size="sm" variant="outline" onClick={() => act(b.id, "unconfirm")}>確定を解除</Button>
                : <span className="flex gap-1"><Button size="sm" variant="outline" onClick={() => act(b.id, "recalc")}>再計算</Button><Button size="sm" onClick={() => act(b.id, "confirm")}>確定</Button><Button size="sm" variant="ghost" onClick={() => act(b.id, "delete")}>消す</Button></span>}</td></tr>
          ))}</tbody></table></div>
      </CardContent>
    </Card>
  );
}

// ── 賃金台帳・労働者名簿 ─────────────────────────────────────────────

interface LedgerRow { employeeCode: string; name: string; year: number; month: number; periodEnd: string; paymentDate: string; workDays: number; workHours: number; overtimeHours: number; holidayWorkDays: number; sundayWorkHours: number; lateNightHours: number; paidLeaveDays: number; baseSalary: number; pays: Array<[string, number]>; absenceDeduction: number; grossSalary: number; deductions: Array<[string, number]>; totalDeductions: number; netSalary: number; status: string }

function LedgerTab() {
  const { toast } = useToast();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState<number | "">(new Date().getMonth() || 12);
  const q = `year=${year}${month ? `&month=${month}` : ""}`;
  const { data } = useLoad<LedgerRow[]>(`/wage-ledger?${q}`);
  const roster = useLoad<Array<{ employeeCode: string; name: string; nameKana: string; dateOfBirth: string | null; gender: string | null; address: string | null; jobType: string; hireDate: string; retirementDate: string | null; retirementReason: string | null; missing: string[] }>>("/worker-roster").data;
  const g = (v: string | null) => (v === "male" ? "男" : v === "female" ? "女" : v === "other" ? "その他" : "");
  const payNames = useMemo(() => [...new Set((data ?? []).flatMap((r) => r.pays.map((p) => p[0])))], [data]);
  const dedNames = useMemo(() => [...new Set((data ?? []).flatMap((r) => r.deductions.map((p) => p[0])))], [data]);
  const sumOf = (list: Array<[string, number]>, n: string) => list.filter((x) => x[0] === n).reduce((s, x) => s + x[1], 0);
  const head = ["氏名", "年月", "労働日数", "労働時間", "時間外", "休日(土・祝)日数", "日曜時間", "深夜", "基本給", ...payNames, "欠勤控除", "総支給", ...dedNames, "控除合計", "差引"];
  const rows = (data ?? []).map((r) => [r.name, `${r.year}/${r.month}`, r.workDays, r.workHours, r.overtimeHours, r.holidayWorkDays, r.sundayWorkHours, r.lateNightHours, r.baseSalary, ...payNames.map((n) => sumOf(r.pays, n)), r.absenceDeduction, r.grossSalary, ...dedNames.map((n) => sumOf(r.deductions, n)), r.totalDeductions, r.netSalary]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">賃金台帳（労基法108条）</CardTitle>
          <CardDescription>氏名・性別・賃金計算期間・労働日数・労働時間数・時間外/休日/深夜の時間数・基本給と手当・控除の額。月を空にすると1年分。保存は最後の記入から5年（当分3年）。</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap"><YearInput value={year} onChange={setYear} />
            <label className="text-sm flex items-center gap-2">月<Input className="w-20 text-right" value={month} onChange={(e) => setMonth(e.target.value === "" ? "" : Number(e.target.value))} /></label>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`/wage-ledger.csv?${q}`, `賃金台帳_${year}年${month ? `${month}月` : ""}.csv`).catch((e) => toast({ title: (e as Error).message, variant: "destructive" }))}><Download className="mr-1 h-4 w-4" />CSV</Button>
            <Button variant="outline" size="sm" onClick={() => printTable(`賃金台帳 ${year}年${month ? `${month}月` : ""}`, head, rows)}><Printer className="mr-1 h-4 w-4" />印刷</Button></div>
          <div className="overflow-auto max-h-[60vh]"><table className="min-w-full">
            <thead><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? tdn : td}>{typeof c === "number" ? c.toLocaleString("ja-JP") : c}</td>)}</tr>)}</tbody></table></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">労働者名簿（労基法107条）</CardTitle>
          <CardDescription>氏名・生年月日・性別・住所・業務の種類・雇入れの年月日・退職の年月日と理由。足りない項目は「社員の法令の情報」で入れてください。</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadCsv("/worker-roster.csv", "労働者名簿.csv")}><Download className="mr-1 h-4 w-4" />CSV</Button>
            <Button variant="outline" size="sm" onClick={() => printTable("労働者名簿", ["氏名", "ふりがな", "生年月日", "性別", "住所", "業務の種類", "雇入れ", "退職", "退職の理由"], (roster ?? []).map((r) => [r.name, r.nameKana, r.dateOfBirth ?? "", g(r.gender), r.address ?? "", r.jobType, r.hireDate, r.retirementDate ?? "", r.retirementReason ?? ""]))}><Printer className="mr-1 h-4 w-4" />印刷</Button></div>
          <div className="overflow-auto"><table className="min-w-full">
            <thead><tr>{["氏名", "生年月日", "性別", "業務の種類", "雇入れ", "退職", "足りない項目"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{roster?.map((r) => <tr key={r.employeeCode}><td className={td}>{r.name}</td><td className={td}>{r.dateOfBirth ?? ""}</td><td className={td}>{g(r.gender)}</td><td className={td}>{r.jobType}</td><td className={td}>{r.hireDate}</td><td className={td}>{r.retirementDate ?? ""}</td><td className={`${td} text-amber-700`}>{r.missing.join("・")}</td></tr>)}</tbody></table></div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 雇用保険料の不足 ─────────────────────────────────────────────────

interface ShortItem { employeeId: number; name: string; year: number; month: number; status: string; base: number; deducted: number; correct: number; shortfall: number; settled: null | { applyYear: number; applyMonth: number } }

function EiShortfallTab() {
  const { toast } = useToast();
  const { data, reload } = useLoad<{ rate: number; items: ShortItem[] }>("/ei-shortfall?rate=0.005&fromYear=2026&fromMonth=4&toYear=2026&toMonth=8");
  const [apply, setApply] = useState({ year: thisYear, month: new Date().getMonth() + 1 });
  const byEmp = useMemo(() => {
    const m = new Map<number, ShortItem[]>();
    for (const i of data?.items ?? []) m.set(i.employeeId, [...(m.get(i.employeeId) ?? []), i]);
    return [...m.values()];
  }, [data]);
  async function settle(items: ShortItem[]) {
    const open = items.filter((i) => !i.settled && i.shortfall > 0);
    if (open.length === 0) return;
    const total = open.reduce((s, i) => s + i.shortfall, 0);
    if (!confirm(`${open[0]!.name}さんの不足 ${total.toLocaleString("ja-JP")}円 を、${apply.year}年${apply.month}月分の明細の「その他の控除」に足します。本人に説明しましたか？`)) return;
    try {
      const r = await post<{ note: string }>("/ei-shortfall/settle", { employeeId: open[0]!.employeeId, applyYear: apply.year, applyMonth: apply.month, items: open.map((i) => ({ fromYear: i.year, fromMonth: i.month, amount: i.shortfall })) });
      toast({ title: "控除に足しました", description: r.note }); reload();
    } catch (e) { toast({ title: "足せませんでした", description: (e as Error).message, variant: "destructive" }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">雇用保険料の不足（2026年4〜8月分）</CardTitle>
        <CardDescription>この間の明細は料率を 0.0005 で計算していました（正しくは 0.005）。社員ごと・月ごとに「正しい額 − 引いた額」を出します（雇用保険の対象外の手当を除いた総支給 × 0.005）。
          確定済みの明細は変えません。取り戻すかは会社が決めます。取り戻すなら、確定前の月を選んで「その他の控除」に1行で足します（その月の源泉税の計算には入りません。年末調整の社会保険料控除には入れて集計します）。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">取り戻す月（明細の年月）：
          <Input className="w-24 text-right" value={apply.year} onChange={(e) => setApply((p) => ({ ...p, year: Number(e.target.value) || thisYear }))} />年
          <Input className="w-16 text-right" value={apply.month} onChange={(e) => setApply((p) => ({ ...p, month: Number(e.target.value) || 1 }))} />月分</div>
        <div className="overflow-auto"><table className="min-w-full">
          <thead><tr>{["氏名", "月ごと（基礎・引いた額→正しい額）", "不足の合計", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{byEmp.map((items) => {
            const total = items.reduce((s, i) => s + i.shortfall, 0);
            const settled = items.every((i) => i.settled);
            return (
              <tr key={items[0]!.employeeId}><td className={td}>{items[0]!.name}</td>
                <td className={td}>{items.map((i) => `${i.month}月 ${i.base.toLocaleString("ja-JP")}円：${i.deducted}→${i.correct}`).join(" ／ ")}</td>
                <td className={tdn}>{yen(total)}</td>
                <td className={td}>{settled ? <span className="text-xs text-muted-foreground">{items[0]!.settled!.applyYear}年{items[0]!.settled!.applyMonth}月分で取り戻し済み</span> : <Button size="sm" variant="outline" onClick={() => settle(items)}>この月の控除に足す</Button>}</td></tr>);
          })}</tbody></table></div>
      </CardContent>
    </Card>
  );
}

// ── 最低賃金・残業 ───────────────────────────────────────────────────

function WageOvertimeTab() {
  const mw = useLoad<{ minimumWage: number; effectiveDate: string | null; companyChecks: Array<{ label: string; amount: number; need: number; ok: boolean }>; employees: Array<{ employeeId: number; name: string; salaryType: string; hourly: number; ok: boolean }> }>("/minimum-wage").data;
  const ot = useLoad<{ fiscalYear: number; months: Array<{ year: number; month: number }>; employees: Array<{ employeeId: number; name: string; isDriver: boolean; hours: Array<number | null>; total: number; annualLimit: number }> }>("/overtime").data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">最低賃金との比較</CardTitle>
          <CardDescription>最低賃金 {mw?.minimumWage?.toLocaleString("ja-JP")}円（{mw?.effectiveDate ?? "発効日未入力"}〜）。1時間あたり＝（基本給＋「割増の基礎・最低賃金に入れる」手当）÷ 所定時間。最低賃金は会社設定で直します。</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm">{mw?.companyChecks.map((c) => <p key={c.label} className={c.ok ? "" : "text-red-600 font-medium"}>{c.label}：{yen(c.amount)}（{yen(c.need)}以上）{c.ok ? "" : " ← 足りません"}</p>)}</div>
          <div className="overflow-auto"><table className="min-w-full"><thead><tr><th className={th}>氏名</th><th className={th}>給与の形</th><th className={th}>1時間あたり</th><th className={th}></th></tr></thead>
            <tbody>{mw?.employees.map((e) => <tr key={e.employeeId}><td className={td}>{e.name}</td><td className={td}>{e.salaryType === "daily" ? "日給" : e.salaryType === "hourly" ? "時給" : "月給"}</td><td className={tdn}>{e.hourly.toLocaleString("ja-JP")}円</td><td className={td}>{e.ok ? "" : <span className="text-red-600">最低賃金を下回っています</span>}</td></tr>)}</tbody></table></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">残業の月ごと・年の累計（{ot?.fiscalYear}年度）</CardTitle>
          <CardDescription>運転者の上限は年960時間（労基法140条・2024年4月から）。「月45時間・年6回」「月100時間未満」「2〜6か月平均80時間」は運転者には当てはまりません（事務職には当てはまります・年720時間）。休日労働は含めていません。</CardDescription></CardHeader>
        <CardContent><div className="overflow-auto"><table className="min-w-full">
          <thead><tr><th className={th}>氏名</th>{ot?.months.map((m) => <th key={`${m.year}-${m.month}`} className={th}>{m.month}月</th>)}<th className={th}>累計</th><th className={th}>上限</th></tr></thead>
          <tbody>{ot?.employees.map((e) => <tr key={e.employeeId}><td className={td}>{e.name}{e.isDriver ? "" : "（事務）"}</td>
            {e.hours.map((h, i) => <td key={i} className={`${tdn} ${(h ?? 0) > 80 ? "text-red-600" : (h ?? 0) > 45 ? "text-amber-700" : ""}`}>{h === null ? "" : h}</td>)}
            <td className={`${tdn} ${e.total > e.annualLimit ? "text-red-600 font-semibold" : e.total > e.annualLimit * 0.8 ? "text-amber-700" : ""}`}>{Math.round(e.total * 10) / 10}</td><td className={tdn}>{e.annualLimit}</td></tr>)}</tbody></table></div></CardContent>
      </Card>
    </div>
  );
}

export default function PayrollLawPage() {
  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3 border-b pb-4">
          <div className="p-2 bg-primary/10 rounded-lg text-primary"><Scale className="h-6 w-6" /></div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">給与と法令</h2>
            <p className="text-sm text-muted-foreground mt-1">有給・住民税・算定基礎・年末調整・賞与・賃金台帳・労働者名簿など。CSV と印刷には個人情報が入ります。</p>
          </div>
        </div>
        <Tabs defaultValue="employees">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="employees">社員の法令の情報</TabsTrigger>
            <TabsTrigger value="resident">住民税</TabsTrigger>
            <TabsTrigger value="leave">有給</TabsTrigger>
            <TabsTrigger value="review">算定・月変</TabsTrigger>
            <TabsTrigger value="yearend">年末調整の準備</TabsTrigger>
            <TabsTrigger value="bonus">賞与</TabsTrigger>
            <TabsTrigger value="ledger">賃金台帳・名簿</TabsTrigger>
            <TabsTrigger value="ei">雇用保険の不足</TabsTrigger>
            <TabsTrigger value="wage">最低賃金・残業</TabsTrigger>
          </TabsList>
          <TabsContent value="employees"><EmployeesTab /></TabsContent>
          <TabsContent value="resident"><ResidentTaxTab /></TabsContent>
          <TabsContent value="leave"><PaidLeaveTab /></TabsContent>
          <TabsContent value="review"><ReviewTab /></TabsContent>
          <TabsContent value="yearend"><YearendTab /></TabsContent>
          <TabsContent value="bonus"><BonusTab /></TabsContent>
          <TabsContent value="ledger"><LedgerTab /></TabsContent>
          <TabsContent value="ei"><EiShortfallTab /></TabsContent>
          <TabsContent value="wage"><WageOvertimeTab /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
