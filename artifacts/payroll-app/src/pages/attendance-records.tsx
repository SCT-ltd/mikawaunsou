import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { METHOD_LABELS, minToStr, todayJST, addDays, type AlcoholCheck, type DailyReport, type DayCompliance, type ComplianceFlag } from "@/components/attendance/shared";

/**
 * 勤怠の記録（管理画面）。
 *   修正申請        … ドライバーが出した打刻の修正申請を、承認／見送りする
 *   アルコールチェック … 乗る前・乗った後の記録（1年間保存）。CSV で出せる
 *   日報            … 退勤のときに残した発着地・メーター・荷主・待機時間
 *   改善基準（月）  … 拘束時間・休息・連続の目安を、月と日で赤く出す
 *   勤怠の設定      … 点検・アルコールチェックを必須にするか、車両の一覧、事務員の30分切り上げ
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const EV: Record<string, string> = { clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了" };
const KIND: Record<string, string> = { add: "打ち忘れを足す", change: "時刻を直す", cancel: "取り消す" };
const fmtDT = (s: string | null) => (s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }) : "—");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error((body as { error?: string }).error ?? "読み込めませんでした") as Error & { body?: unknown; status?: number }; e.body = body; e.status = res.status; throw e; }
  return body as T;
}

type Tab = "corrections" | "alcohol" | "reports" | "kaizen" | "settings";

export default function AttendanceRecordsPage() {
  const [tab, setTab] = useState<Tab>("corrections");
  const tabs: Array<[Tab, string]> = [["corrections", "修正申請"], ["alcohol", "アルコールチェック"], ["reports", "日報"], ["kaizen", "改善基準（月）"], ["settings", "勤怠の設定"]];
  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-7 rounded-full bg-indigo-500 shrink-0" />
          <h2 className="text-base md:text-lg font-bold">勤怠の記録</h2>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold border ${tab === k ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        {tab === "corrections" && <Corrections />}
        {tab === "alcohol" && <Alcohol />}
        {tab === "reports" && <Reports />}
        {tab === "kaizen" && <Kaizen />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </AppLayout>
  );
}

// ── 修正申請 ─────────────────────────────────────────
interface Correction {
  id: number; employeeId: number; employeeName: string | null; employeeCode: string | null; workDate: string; kind: string; eventType: string | null;
  requestedAt: string | null; reason: string; status: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string;
  record: { recordedAt: string; eventType: string } | null;
}
function Corrections() {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState<Correction[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api<Correction[]>(`/attendance/corrections?status=${status}`).then(setRows).catch(e => setErr(e.message)); }, [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (c: Correction, approve: boolean, force = false) => {
    setBusy(c.id); setErr(null);
    try {
      await api(`/attendance/corrections/${c.id}/decide`, { method: "POST", body: JSON.stringify({ approve, note: notes[c.id] ?? "", force }) });
      load();
    } catch (e) {
      const b = (e as { body?: { canForce?: boolean; error?: string } }).body;
      if (b?.canForce && window.confirm(`${b.error}\n\n順番が合いませんが、このまま反映しますか？`)) { setBusy(null); return decide(c, approve, true); }
      setErr((e as Error).message);
    } finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">表示：</span>
        {[["pending", "確認待ち"], ["approved", "承認した"], ["rejected", "見送った"], ["all", "すべて"]].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setStatus(v!)} className={`rounded px-2 py-1 ${status === v ? "bg-slate-800 text-white" : "bg-slate-100"}`}>{l}</button>
        ))}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">申請はありません</p> : (
        <div className="space-y-2">
          {rows.map(c => (
            <div key={c.id} className="rounded-xl border bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{c.employeeName}</span>
                <span className="text-xs text-muted-foreground font-mono">{c.employeeCode}</span>
                <span className="text-xs rounded bg-slate-100 px-1.5 py-0.5">{md(c.workDate)} の勤務</span>
                <span className="text-xs font-semibold text-indigo-700">{KIND[c.kind] ?? c.kind}</span>
                <span className="text-xs">{c.eventType ? EV[c.eventType] : ""}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">申請 {fmtDT(c.createdAt)}</span>
              </div>
              <p className="text-sm">
                {c.kind === "add" && <>「{EV[c.eventType ?? ""]}」を <b>{fmtDT(c.requestedAt)}</b> に足す</>}
                {c.kind === "change" && <>「{EV[c.record?.eventType ?? ""]}」{fmtDT(c.record?.recordedAt ?? null)} → <b>{fmtDT(c.requestedAt)}</b></>}
                {c.kind === "cancel" && <>「{EV[c.record?.eventType ?? ""]}」{fmtDT(c.record?.recordedAt ?? null)} を取り消す</>}
              </p>
              <p className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">理由：{c.reason}</p>
              {c.status === "pending" ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <Input value={notes[c.id] ?? ""} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} placeholder="ひとこと（任意・本人に届きます）" className="h-8 text-xs max-w-xs" />
                  <Button size="sm" className="h-8" disabled={busy === c.id} onClick={() => decide(c, true)}>承認して直す</Button>
                  <Button size="sm" variant="outline" className="h-8" disabled={busy === c.id} onClick={() => decide(c, false)}>見送る</Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{c.status === "approved" ? "承認" : "見送り"}：{c.decidedBy}（{fmtDT(c.decidedAt)}）{c.decisionNote ? `「${c.decisionNote}」` : ""}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── アルコールチェック ───────────────────────────────────
function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function Alcohol() {
  const [ym, setYm] = useState(todayJST().slice(0, 7));
  const [rows, setRows] = useState<AlcoholCheck[]>([]);
  const [onlyDetected, setOnlyDetected] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [checker, setChecker] = useState("");
  const { from, to } = monthRange(ym);
  const load = useCallback(() => { api<AlcoholCheck[]>(`/attendance/alcohol?from=${from}&to=${to}`).then(setRows).catch(() => {}); }, [from, to]);
  useEffect(() => { load(); }, [load]);
  const shown = rows.filter(r => !onlyDetected || r.detected);
  const save = async (id: number) => { await api(`/attendance/alcohol/${id}`, { method: "PATCH", body: JSON.stringify({ checker }) }).catch(e => window.alert(e.message)); setEditing(null); load(); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <Input type="month" value={ym} onChange={e => setYm(e.target.value)} className="h-8 w-40" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyDetected} onChange={e => setOnlyDetected(e.target.checked)} />検知ありだけ</label>
        <a href={`${BASE}/api/attendance/alcohol.csv?from=${from}&to=${to}`} className="ml-auto"><Button size="sm" variant="outline">CSV で出す</Button></a>
      </div>
      <p className="text-xs text-muted-foreground">運送業のアルコールチェックの記録は1年間保存します（このシステムでは消せません）。確認した人の名前だけ、ここで直せます。</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-2 py-2 text-left">勤務日</th><th className="px-2 text-left">確認日時</th><th className="px-2 text-left">氏名</th><th className="px-2 text-left">乗る前/後</th><th className="px-2 text-right">数値(mg/L)</th><th className="px-2 text-left">酒気帯び</th><th className="px-2 text-left">方法</th><th className="px-2 text-left">確認した人</th><th className="px-2 text-left">車両</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">記録はありません</td></tr>}
            {shown.map(r => (
              <tr key={r.id} className={`border-t ${r.detected ? "bg-red-50 text-red-800 font-semibold" : ""}`}>
                <td className="px-2 py-1.5">{md(r.workDate)}</td>
                <td className="px-2">{fmtDT(r.checkedAt)}</td>
                <td className="px-2">{r.employeeName}</td>
                <td className="px-2">{r.phase === "before" ? "乗る前" : "乗った後"}</td>
                <td className="px-2 text-right amount">{r.valueMg ?? "—"}</td>
                <td className="px-2">{r.detected ? "あり" : "なし"}</td>
                <td className="px-2">{METHOD_LABELS[r.method] ?? r.method}</td>
                <td className="px-2">
                  {editing === r.id ? (
                    <span className="flex gap-1"><Input value={checker} onChange={e => setChecker(e.target.value)} className="h-7 text-xs w-28" /><Button size="sm" className="h-7 text-xs" onClick={() => save(r.id)}>保存</Button></span>
                  ) : (
                    <button type="button" className="underline decoration-dotted" onClick={() => { setEditing(r.id); setChecker(r.checker ?? ""); }}>{r.checker || "（未記入）"}</button>
                  )}
                </td>
                <td className="px-2">{r.vehicle ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 日報 ─────────────────────────────────────────────
function Reports() {
  const [to, setTo] = useState(todayJST());
  const [from, setFrom] = useState(addDays(todayJST(), -6));
  const [rows, setRows] = useState<Array<DailyReport & { employeeName: string | null; employeeCode: string | null }>>([]);
  useEffect(() => { api<typeof rows>(`/attendance/reports?from=${from}&to=${to}`).then(setRows).catch(() => {}); }, [from, to]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-40" />〜
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-40" />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-2 py-2 text-left">勤務日</th><th className="px-2 text-left">氏名</th><th className="px-2 text-left">車両</th><th className="px-2 text-left">発着地</th><th className="px-2 text-right">メーター</th><th className="px-2 text-right">走行</th><th className="px-2 text-left">荷主</th><th className="px-2 text-right">待機</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">日報はありません</td></tr>}
            {rows.map(r => {
              const deps = (r.departure ?? "").split("\n"), arrs = (r.arrival ?? "").split("\n");
              const route = Array.from({ length: Math.max(deps.length, arrs.length) }, (_, i) => [deps[i], arrs[i]].filter(Boolean).join("→")).filter(Boolean).join(" / ");
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-2 py-1.5">{md(r.workDate)}</td>
                  <td className="px-2">{r.employeeName}</td>
                  <td className="px-2">{r.vehicle ?? ""}</td>
                  <td className="px-2 max-w-[18rem]">{route}</td>
                  <td className="px-2 text-right amount whitespace-nowrap">{r.startOdometer ?? "—"} → {r.endOdometer ?? "—"}</td>
                  <td className="px-2 text-right amount">{r.distanceKm != null ? `${r.distanceKm} km` : ""}</td>
                  <td className="px-2">{r.shipper ?? ""}</td>
                  <td className="px-2 text-right">{r.waitingMinutes != null ? minToStr(r.waitingMinutes) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 改善基準（月） ──────────────────────────────────────
interface EmpCompliance { employeeId: number; employeeName: string; employeeCode: string; isOfficeStaff: boolean; days: DayCompliance[]; monthRestraintMinutes: number; yearRestraintMinutes: number; flags: ComplianceFlag[] }
function Kaizen() {
  const [ym, setYm] = useState(todayJST().slice(0, 7));
  const [rows, setRows] = useState<EmpCompliance[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const [y, m] = ym.split("-");
    api<EmpCompliance[]>(`/attendance/compliance?year=${y}&month=${Number(m)}`).then(setRows).catch(() => {});
  }, [ym]);
  const drivers = useMemo(() => rows.filter(r => !r.isOfficeStaff), [rows]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Input type="month" value={ym} onChange={e => setYm(e.target.value)} className="h-8 w-40" />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        トラック運転者の改善基準告示（2024年4月から）の目安：1日の拘束13時間（延ばしても15時間）・休息は継続11時間（最低9時間）・1か月の拘束284時間・1年3,300時間・連続運転4時間。
        打刻からの推定です（運転と荷役を分けて打刻していないため、連続運転は「休憩なしで続けて働いた時間」で見ています）。
      </p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-2 py-2 text-left">氏名</th><th className="px-2 text-right">月の拘束</th><th className="px-2 text-right">直近12か月</th><th className="px-2 text-right">超えた日</th><th className="px-2"></th></tr>
          </thead>
          <tbody>
            {drivers.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">打刻がありません</td></tr>}
            {drivers.map(r => {
              const badDays = r.days.filter(d => d.flags.length > 0);
              const monthRed = r.flags.some(f => f.code === "month284");
              const yearRed = r.flags.some(f => f.code === "year3300");
              return (
                <Fragment key={r.employeeId}>
                  <tr className="border-t">
                    <td className="px-2 py-1.5">{r.employeeName}</td>
                    <td className={`px-2 text-right amount ${monthRed ? "text-red-600 font-bold" : ""}`}>{minToStr(r.monthRestraintMinutes)}</td>
                    <td className={`px-2 text-right amount ${yearRed ? "text-red-600 font-bold" : ""}`}>{minToStr(r.yearRestraintMinutes)}</td>
                    <td className={`px-2 text-right ${badDays.length ? "text-red-600 font-bold" : "text-muted-foreground"}`}>{badDays.length}日</td>
                    <td className="px-2 text-right"><button type="button" className="text-xs underline" onClick={() => setOpen(open === r.employeeId ? null : r.employeeId)}>{open === r.employeeId ? "閉じる" : "日ごと"}</button></td>
                  </tr>
                  {open === r.employeeId && (
                    <tr className="bg-muted/20">
                      <td colSpan={5} className="px-3 py-2">
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground"><tr><th className="text-left py-1">日</th><th className="text-left">出勤〜退勤</th><th className="text-right">拘束</th><th className="text-right">休息</th><th className="text-right">続けて最長</th><th className="text-left pl-3">目安を超えたこと</th></tr></thead>
                          <tbody>
                            {r.days.map(d => {
                              const red = (p: string) => d.flags.find(f => f.code.startsWith(p));
                              const cls = (f?: ComplianceFlag) => (f ? (f.level === "danger" ? "text-red-600 font-bold" : "text-amber-700 font-semibold") : "");
                              return (
                                <tr key={d.date} className="border-t">
                                  <td className="py-1">{md(d.date)}</td>
                                  <td>{fmtDT(d.clockIn)} 〜 {d.open ? "（退勤なし）" : fmtDT(d.clockOut)}</td>
                                  <td className={`text-right ${cls(red("restraint"))}`}>{minToStr(d.restraintMinutes)}</td>
                                  <td className={`text-right ${cls(red("rest"))}`}>{d.restBeforeMinutes === null ? "—" : minToStr(d.restBeforeMinutes)}</td>
                                  <td className={`text-right ${cls(red("cont"))}`}>{minToStr(d.maxContinuousMinutes)}</td>
                                  <td className="pl-3">{d.flags.map(f => <span key={f.code} className={`block ${cls(f)}`}>{f.text}</span>)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {r.flags.map(f => <p key={f.code} className="text-xs text-red-600 font-bold mt-1">● {f.text}</p>)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 勤怠の設定 ────────────────────────────────────────
interface AttSettings { requireChecklist: boolean; requireAlcohol: boolean; vehicles: string[]; officeRounding: "all_office" | "hourly_only" | "none" }
function SettingsTab() {
  const [s, setS] = useState<AttSettings | null>(null);
  const [vehicles, setVehicles] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api<AttSettings>("/attendance/settings").then(v => { setS(v); setVehicles(v.vehicles.join("\n")); }).catch(e => setMsg(e.message)); }, []);
  if (!s) return <p className="text-sm text-muted-foreground">{msg ?? "読み込み中..."}</p>;
  const save = async () => {
    try {
      const v = await api<AttSettings>("/attendance/settings", { method: "PUT", body: JSON.stringify({ ...s, vehicles: vehicles.split(/\r?\n/).map(x => x.trim()).filter(Boolean) }) });
      setS(v); setVehicles(v.vehicles.join("\n")); setMsg("保存しました");
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="max-w-xl space-y-4 rounded-xl border bg-card p-4">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={s.requireChecklist} onChange={e => setS({ ...s, requireChecklist: e.target.checked })} />
        <span><b>日常点検を全部つけないと出勤できないようにする</b><br /><span className="text-xs text-muted-foreground">オフのときは、出勤を押したときに点検をうながすだけです（事務員は対象外）。</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={s.requireAlcohol} onChange={e => setS({ ...s, requireAlcohol: e.target.checked })} />
        <span><b>乗る前のアルコールチェックを記録しないと出勤できないようにする</b><br /><span className="text-xs text-muted-foreground">オフのときは、うながすだけです（事務員は対象外）。</span></span>
      </label>
      <div className="space-y-1">
        <p className="text-sm font-bold">車両の一覧（1行に1台）</p>
        <p className="text-xs text-muted-foreground">点検・アルコールチェック・日報で選べるようになります。空なら手で書きます。</p>
        <Textarea value={vehicles} onChange={e => setVehicles(e.target.value)} className="h-32 text-sm" placeholder={"例：\n1号車（群馬100あ1234）\n2号車"} />
      </div>
      <div className="space-y-1 text-sm">
        <p className="font-bold">事務員の実働時間を30分単位で切り上げる相手</p>
        {([["all_office", "事務員は全員（時給も月給も）＝これまでと同じ"], ["hourly_only", "時給の人だけ"], ["none", "切り上げない（分のまま）"]] as const).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2"><input type="radio" name="rounding" checked={s.officeRounding === v} onChange={() => setS({ ...s, officeRounding: v })} />{l}</label>
        ))}
        <p className="text-xs text-muted-foreground">会社の決まり（就業規則）に合わせて選んでください。月次実績への取り込みと、事務員の打刻ページの「計算時間」に効きます。</p>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save}>保存</Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}
