import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, Search, ChevronDown, ChevronRight, Monitor, Smartphone, QrCode, AlertTriangle, X } from "lucide-react";
import { useListEmployees } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { fieldLabel, fmtValue } from "@/lib/audit-labels";

/**
 * 操作の記録（だれが・いつ・何を・どう変えたか）。
 * 管理画面からの書き込みはすべて、変更の前後（例：打刻の時刻 7:05 → 7:00）まで残る。
 * QR の打刻ページからの打刻・申請・メッセージ、ログインの失敗、断られた操作、CSV の書き出しも残る。
 * 消したり直したりはできない。見られるのは管理者だけ（スタッフ・閲覧のみは 403）。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuditRow {
  id: number;
  at: string;
  userId: number | null;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  summary: string | null;
  category: string | null;
  status: number | null;
  employeeId: number | null;
  userAgent: string | null;
}

const CATS = ["勤怠", "給与", "社員", "マスター", "設定", "ユーザー", "メッセージ", "ログイン", "書き出し", "その他"] as const;
const CAT_STYLE: Record<string, string> = {
  勤怠: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  給与: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  社員: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  マスター: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  設定: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  ユーザー: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  メッセージ: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  ログイン: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  書き出し: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  その他: "bg-muted text-muted-foreground",
};

// 以前の記録（一文が無い）は、操作の名前から日本語にする
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
  "PATCH /attendance/records/:id": "打刻を修正",
  "DELETE /attendance/records/:id": "打刻を削除",
  "POST /attendance/record": "打刻を追加",
  "POST /monthly-records": "月次実績を保存",
  "PUT /monthly-records/:id": "月次実績を保存",
  "bank.update": "振込口座を変更",
  "transfer-settings.update": "振込元を変更",
  "transfer.export": "振込データ（全銀）を書き出し",
};

const titleOf = (r: AuditRow) => r.summary ?? ACTION_LABEL[r.action] ?? r.action;
const jstDay = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" });
const jstTime = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 9 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);

function device(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPhone|Android.+Mobile|Mobile Safari/i.test(ua)) return "スマホ";
  if (/iPad|Android/i.test(ua)) return "タブレット";
  return "パソコン";
}

/**
 * 記録から、対象の明細・社員を開くリンクを作る。
 *   payroll:12 → その明細の詳細／employee:5 → 社員マスターでその社員を開く
 *   本文に社員・年月があれば（給与の計算・月次実績の保存など）その月の画面を開く
 */
function linksOf(r: AuditRow): Array<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = [];
  const t = r.target ?? "";
  const pm = /^payroll:(\d+)$/.exec(t) ?? /^\/payroll\/(\d+)/.exec(t);
  if (pm) out.push({ href: `/payroll/${pm[1]}`, label: "明細を開く" });
  const em = /^employee:(\d+)$/.exec(t) ?? /^\/employees\/(\d+)/.exec(t);
  const empId = r.employeeId ?? (em ? Number(em[1]) : null);
  let body: { year?: unknown; month?: unknown } = {};
  try {
    const d = JSON.parse(r.detail ?? "{}") as { body?: typeof body; query?: typeof body };
    body = { ...(d.query ?? {}), ...(d.body ?? {}) };
  } catch { /* 中身が読めなければ年月のリンクは作らない */ }
  const y = Number(body.year), mo = Number(body.month);
  if (empId && y && mo) {
    if (/monthly-records/.test(r.action)) out.push({ href: `/monthly-input?y=${y}&m=${mo}&emp=${empId}`, label: "月次実績を開く" });
    else if (/payroll|month-items/.test(r.action)) out.push({ href: `/payroll?y=${y}&m=${mo}&emp=${empId}`, label: "その月の明細を開く" });
  }
  if (empId && r.category === "勤怠") out.push({ href: `/attendance?emp=${empId}`, label: "勤怠を開く" });
  if (empId) out.push({ href: `/allowances?emp=${empId}`, label: "社員を開く" });
  return out;
}

interface Parsed {
  changes: Array<[string, unknown, unknown]>;
  created: Array<[string, unknown]>;
  deleted: Array<[string, unknown]>;
  other: Array<[string, unknown]>;
  error: string | null;
  unchanged: boolean;
}

/** 記録の中身を「項目・前・後」の表と、その他の値に分ける */
function parseDetail(detail: string | null): Parsed {
  const out: Parsed = { changes: [], created: [], deleted: [], other: [], error: null, unchanged: false };
  if (!detail) return out;
  let v: Record<string, unknown>;
  try { v = JSON.parse(detail) as Record<string, unknown>; } catch { out.other.push(["中身", detail]); return out; }
  if (!v || typeof v !== "object" || Array.isArray(v)) { out.other.push(["中身", v]); return out; }
  const flat = (o: unknown): Array<[string, unknown]> =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o as Record<string, unknown>).filter(([k, x]) => k !== "__group" && k !== "id" && x !== null && x !== "")
      : [["値", o]];
  for (const [k, x] of Object.entries(v)) {
    if (k === "changes" && x && typeof x === "object") {
      const entries = Object.entries(x as Record<string, [unknown, unknown]>);
      if (entries.length === 0) out.unchanged = true;
      for (const [f, pair] of entries) out.changes.push([f, pair[0], pair[1]]);
    }
    else if (k === "created") out.created.push(...flat(x));
    else if (k === "before") out.deleted.push(...flat(x));
    else if (k === "error") out.error = String(x);
    else if (k === "body" && x && typeof x === "object" && !Array.isArray(x)) out.other.push(...Object.entries(x as Record<string, unknown>));
    else if (k === "query" && x && typeof x === "object" && Object.keys(x).length === 0) continue;
    else out.other.push([k, x]);
  }
  // 窓口の中の記録（diffOf）は { 項目: [前, 後] } をそのまま持っている
  if (out.changes.length === 0 && out.other.length > 0 && out.other.every(([, x]) => Array.isArray(x) && x.length === 2)) {
    out.changes = out.other.map(([f, pair]) => [f, (pair as unknown[])[0], (pair as unknown[])[1]]);
    out.other = [];
  }
  return out;
}

function KV({ title, rows }: { title: string; rows: Array<[string, unknown]> }) {
  return (
    <div>
      <p className="font-semibold text-muted-foreground mb-0.5">{title}</p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 max-w-3xl">
        {rows.slice(0, 40).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground whitespace-nowrap">{fieldLabel(k)}</dt>
            <dd className="break-all">{fmtValue(v, k)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DetailView({ r, d }: { r: AuditRow; d: Parsed }) {
  const dev = device(r.userAgent);
  return (
    <div className="space-y-2 text-xs">
      {d.error && <p className="text-red-600 dark:text-red-400">理由：{d.error}</p>}
      {d.changes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full max-w-3xl border rounded-md">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr><th className="text-left px-2 py-1 w-1/3">項目</th><th className="text-left px-2 py-1">変更前</th><th className="px-1" aria-hidden></th><th className="text-left px-2 py-1">変更後</th></tr>
            </thead>
            <tbody>
              {d.changes.map(([f, a, b]) => (
                <tr key={f} className="border-t align-top">
                  <td className="px-2 py-1 font-medium">{fieldLabel(f)}</td>
                  <td className="px-2 py-1 text-muted-foreground break-all">{fmtValue(a, f)}</td>
                  <td className="px-1 text-muted-foreground">→</td>
                  <td className="px-2 py-1 font-semibold break-all">{fmtValue(b, f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.unchanged && <p className="text-muted-foreground">保存しましたが、中身は変わっていません。</p>}
      {d.created.length > 0 && <KV title="作った内容" rows={d.created} />}
      {d.deleted.length > 0 && <KV title="消した内容（消す前）" rows={d.deleted} />}
      {d.other.length > 0 && <KV title="送られた内容" rows={d.other} />}
      <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
        <span>記録番号 {r.id}</span>
        <span>{new Date(r.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
        {dev && <span>端末：{dev}</span>}
        {r.ip && <span>接続元：{r.ip}</span>}
        {r.status && <span>結果：{r.status < 400 ? "できた" : `断られた（${r.status}）`}</span>}
      </p>
    </div>
  );
}

/** 一覧の1行に出す短い要約（最初の変更・変わった項目の数） */
function shortOf(d: Parsed): string {
  if (d.error) return d.error;
  if (d.changes.length) {
    const [f, a, b] = d.changes[0]!;
    const first = `${fieldLabel(f)}：${fmtValue(a, f)} → ${fmtValue(b, f)}`;
    return d.changes.length > 1 ? `${first}　ほか${d.changes.length - 1}項目` : first;
  }
  if (d.unchanged) return "変更なし";
  return "";
}

type Range = "all" | "today" | "7" | "30" | "custom";

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("");
  const [emp, setEmp] = useState("");
  const [uid, setUid] = useState("");
  const [range, setRange] = useState<Range>("7");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(todayJst());
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const { data: employees } = useListEmployees({});
  const users = useQuery<Array<{ id: number; displayName: string | null; username: string }>>({
    queryKey: ["system-users"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/users`, { credentials: "include" }); return r.ok ? r.json() : []; },
  });

  const span: [string, string] | null = range === "all" ? null : range === "today" ? [todayJst(), todayJst()] : range === "7" ? [daysAgo(6), todayJst()] : range === "30" ? [daysAgo(29), todayJst()] : [from, to];
  const list = useInfiniteQuery<AuditRow[], Error>({
    queryKey: ["audit-logs", query, cat, emp, uid, span?.join("~") ?? "", failed],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("before", String(pageParam));
      if (query) params.set("q", query);
      if (cat) params.set("category", cat);
      if (emp) params.set("employeeId", emp);
      if (uid) params.set("userId", uid);
      if (span) { params.set("from", span[0]); params.set("to", span[1]); }
      if (failed) params.set("failed", "1");
      const res = await fetch(`${BASE}/api/audit-logs?${params}`, { credentials: "include" });
      if (res.status === 403) throw new Error("操作の記録を見られるのは管理者だけです。");
      if (!res.ok) throw new Error("読み込めませんでした。");
      return res.json();
    },
    getNextPageParam: (last) => (last.length === 200 ? last[last.length - 1]!.id : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const groups = useMemo(() => {
    const out: Array<{ day: string; rows: Array<{ r: AuditRow; d: Parsed }> }> = [];
    for (const r of rows) {
      const day = jstDay(r.at);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push({ r, d: parseDetail(r.detail) });
    }
    return out;
  }, [rows]);
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const anyFilter = !!(query || cat || emp || uid || failed || range !== "7");
  const clear = () => { setQ(""); setQuery(""); setCat(""); setEmp(""); setUid(""); setRange("7"); setFailed(false); };

  const chip = (on: boolean) => cn("h-7 px-2.5 rounded-full text-xs border transition-colors", on ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted border-input");
  const selCls = "h-8 rounded-md border border-input bg-background px-2 text-xs";
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
              <p className="text-[11px] text-muted-foreground leading-tight">だれが・いつ・何を・どう変えたか（変更の前と後）。消したり直したりはできません。</p>
            </div>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="言葉で探す（氏名・操作・金額など）" className="w-64 h-8 text-xs" />
            <Button type="submit" variant="outline" size="sm" className="gap-1 h-8"><Search className="h-4 w-4" />探す</Button>
          </form>
        </div>

        <div className="rounded-xl border bg-card p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-14 shrink-0">分類</span>
            {["", ...CATS].map((c) => (
              <button key={c || "all"} type="button" onClick={() => setCat(c)} className={chip(cat === c)}>{c || "すべて"}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-14 shrink-0">期間</span>
            {([["today", "今日"], ["7", "7日間"], ["30", "30日間"], ["all", "すべて"], ["custom", "日付を決める"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setRange(k)} className={chip(range === k)}>{l}</button>
            ))}
            {range === "custom" && (
              <span className="flex items-center gap-1 text-xs">
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={selCls} aria-label="いつから" />〜
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={selCls} aria-label="いつまで" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground w-14 shrink-0">絞り込み</span>
            <select value={uid} onChange={(e) => setUid(e.target.value)} className={selCls} aria-label="だれが">
              <option value="">だれが：全員</option>
              <option value="0">ログインしていない操作（QR打刻ページ・ログイン画面）</option>
              {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
            </select>
            <select value={emp} onChange={(e) => setEmp(e.target.value)} className={selCls} aria-label="対象の社員">
              <option value="">対象の社員：全員</option>
              {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.employeeCode ? `${e.employeeCode} ` : ""}{e.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} />断られた操作だけ
            </label>
            {anyFilter && <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={clear}><X className="h-3.5 w-3.5" />条件を消す</Button>}
            <span className="ml-auto text-xs text-muted-foreground">{list.isLoading ? "読み込み中…" : `${rows.length}${list.hasNextPage ? "件以上" : "件"}`}</span>
          </div>
        </div>

        {list.isError && <p className="text-sm text-red-600">{list.error.message}</p>}
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.day} className="rounded-xl border bg-card overflow-hidden">
              <h3 className="px-3 py-1.5 text-xs font-semibold bg-muted/50 border-b">{g.day}<span className="ml-2 font-normal text-muted-foreground">{g.rows.length}件</span></h3>
              <ul className="divide-y">
                {g.rows.map(({ r, d }) => {
                  const isOpen = open.has(r.id);
                  const bad = (r.status ?? 200) >= 400;
                  const short = shortOf(d);
                  const links = linksOf(r);
                  const dev = device(r.userAgent);
                  return (
                    <li key={r.id} data-audit-id={r.id} className={cn(bad && "bg-red-50/70 dark:bg-red-950/20")}>
                      <button type="button" onClick={() => toggle(r.id)} className="w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-muted/40" aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                        <span className="w-16 shrink-0 tabular-nums text-xs text-muted-foreground pt-0.5">{jstTime(r.at)}</span>
                        <span className={cn("shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 w-16 text-center", CAT_STYLE[r.category ?? "その他"] ?? CAT_STYLE["その他"])}>{r.category ?? "その他"}</span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            {bad && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" aria-label="断られた操作" />}
                            <span className="truncate">{titleOf(r)}</span>
                          </span>
                          {short && <span className="block text-xs text-muted-foreground truncate">{short}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground hidden sm:flex items-center gap-1 max-w-[15rem] pt-0.5">
                          {r.userId === null ? <QrCode className="h-3.5 w-3.5 shrink-0" /> : dev === "パソコン" ? <Monitor className="h-3.5 w-3.5 shrink-0" /> : dev ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : null}
                          <span className="truncate">{r.actor}</span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 sm:pl-[7.5rem] space-y-2">
                          <p className="text-xs sm:hidden text-muted-foreground">だれが：{r.actor}</p>
                          <DetailView r={r} d={d} />
                          {links.length > 0 && (
                            <div className="flex flex-wrap gap-3 text-xs">
                              {links.map((l) => <Link key={l.href} href={l.href} className="text-primary hover:underline">{l.label}</Link>)}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!list.isLoading && rows.length === 0 && (
            <div className="rounded-xl border bg-card px-3 py-10 text-center text-sm text-muted-foreground">この条件の記録はありません</div>
          )}
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
