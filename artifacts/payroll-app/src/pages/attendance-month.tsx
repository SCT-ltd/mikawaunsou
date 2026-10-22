import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Download, Printer, CalendarRange, ExternalLink, Search } from "lucide-react";
import { ABSENCE_LABELS, minToStr, todayJST, type AbsenceType } from "@/components/attendance/shared";

/**
 * 月の勤怠表（社員×日付）。
 *   ・1人1行、1日1マスに出勤と退勤の時刻（休みはその種類、予定だけの日は予定）
 *   ・予定（シフト）と比べて、遅刻・早退・出勤していない・退勤の打ち忘れ・休みの日の出勤に色を付ける
 *   ・右に月の合計（出勤日数・実働・残業・深夜・遅刻・早退・出勤なし・打ち忘れ・欠勤・有給）
 *   ・マスを押すとその日の予定を直せる／名前を押すと「予定の型」（曜日ごと）を決められる
 *   ・CSV と印刷（A4横）
 * 数え方は月次実績への取り込みと同じ（休憩を引く・退勤が無い日は0時間）。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "読み込めませんでした");
  return body as T;
}

interface Sched { start: string | null; end: string | null; off: boolean; note: string | null; source: "day" | "pattern" }
interface Cell {
  clockIn: string | null; clockOut: string | null; workMin: number; breakMin: number; nightMin: number; open: boolean; punches: number;
  absences: Array<{ id: number; type: AbsenceType; note: string | null }>;
  schedule: Sched | null; lateMin: number; earlyMin: number;
  flags: Array<"late" | "early" | "noshow" | "offwork" | "missingOut" | "missingIn" | "conflict">;
}
interface Totals {
  workDays: number; workMin: number; overtimeMin: number; nightMin: number; breakMin: number;
  late: number; lateMin: number; early: number; earlyMin: number; noShow: number; missingOut: number; offWork: number;
  absenceDays: number; paidLeaveDays: number;
}
interface Row {
  employee: { id: number; employeeCode: string; name: string; department: string; isOfficeStaff: boolean };
  hasPattern: boolean; cells: Record<string, Cell>; totals: Totals;
  /** 「確認済み」にした人と日時 */
  checked: { by: string | null; at: string } | null;
}
interface Grid {
  year: number; month: number; from: string; to: string; today: string;
  days: Array<{ date: string; day: number; dow: number; holiday: string | null }>;
  settings: { lateGraceMinutes: number; noShowAlertMinutes: number };
  rows: Row[];
}
interface PatternDay { start: string; end: string }
interface Pattern { employeeId: number; days: Record<string, PatternDay | null>; holidayOff: boolean; from: string | null }

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const hm = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(11, 16) : "");
const hmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const FLAG_LABEL: Record<Cell["flags"][number], string> = {
  late: "遅刻", early: "早退", noshow: "出勤なし", offwork: "休みの日の出勤", missingOut: "退勤なし", missingIn: "出勤なし（打刻あり）", conflict: "休みと出勤が重なる",
};

export default function AttendanceMonthPage() {
  const [ym, setYm] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const t = todayJST();
    return { y: Number(q.get("y")) || Number(t.slice(0, 4)), m: Number(q.get("m")) || Number(t.slice(5, 7)) };
  });
  const [grid, setGrid] = useState<Grid | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cellOpen, setCellOpen] = useState<{ row: Row; date: string } | null>(null);
  const [patOpen, setPatOpen] = useState<Row | null>(null);
  /** その月の、まだ決めていない修正申請の数（締めの確認に出す） */
  const [pendingCorr, setPendingCorr] = useState<Array<{ id: number; workDate: string; employeeName: string | null }>>([]);
  useEffect(() => {
    api<Array<{ id: number; workDate: string; employeeName: string | null }>>(`/attendance/corrections?status=pending`).then(setPendingCorr).catch(() => setPendingCorr([]));
  }, [grid]);
  const ymKey = `${ym.y}-${String(ym.m).padStart(2, "0")}`;
  const toggleChecked = async (r: Row) => {
    try {
      await api(`/attendance/month-checks/${r.employee.id}/${ymKey}`, { method: r.checked ? "DELETE" : "PUT" });
      void load();
    } catch (e) { setError((e as Error).message); }
  };
  // 締めの確認：月次実績へ取り込む前に直すもの（退勤なし・出勤なし・休みと出勤の重なり・修正申請）
  const closeIssues = useMemo(() => {
    const out: Array<{ row: Row; date: string; label: string; tone: string }> = [];
    if (!grid) return out;
    for (const r of grid.rows) for (const d of grid.days) {
      const c = r.cells[d.date]; if (!c) continue;
      if (c.flags.includes("missingOut")) out.push({ row: r, date: d.date, label: "退勤なし", tone: "text-red-600" });
      if (c.flags.includes("missingIn")) out.push({ row: r, date: d.date, label: "出勤なし（打刻あり）", tone: "text-red-600" });
      if (c.flags.includes("noshow")) out.push({ row: r, date: d.date, label: "予定の日に出勤なし", tone: "text-orange-600" });
      if (c.flags.includes("conflict")) out.push({ row: r, date: d.date, label: "休みと出勤が重なる", tone: "text-purple-600" });
    }
    return out;
  }, [grid]);
  const monthCorr = pendingCorr.filter((c) => c.workDate.startsWith(ymKey));
  const checkedCount = grid ? grid.rows.filter((r) => r.checked).length : 0;
  const allHavePattern = grid ? grid.rows.every((r) => r.hasPattern) : false;

  const load = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([
        api<Grid>(`/attendance/month-grid?year=${ym.y}&month=${ym.m}`),
        api<Pattern[]>(`/attendance/schedule-patterns`),
      ]);
      setGrid(g); setPatterns(p); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [ym]);
  useEffect(() => { void load(); }, [load]);
  // 今月を開いたときは、今日の列が見えるところまで横に送る（月が変わったときだけ）
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!grid || !scrollRef.current) return;
    const key = `${grid.year}-${grid.month}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const th = scrollRef.current.querySelector<HTMLElement>("th[data-today]");
    scrollRef.current.scrollLeft = th ? Math.max(0, th.offsetLeft - scrollRef.current.clientWidth / 2) : 0;
  }, [grid]);
  // 開いたままでも新しい打刻が入るように、1分ごとに取り直す
  useEffect(() => { const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const moveMonth = (d: number) => setYm(({ y, m }) => { const n = new Date(Date.UTC(y, m - 1 + d, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 }; });
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (grid?.rows ?? []).filter((r) => !q || r.employee.name.toLowerCase().includes(q) || r.employee.employeeCode.toLowerCase().includes(q) || (r.employee.department ?? "").toLowerCase().includes(q));
  }, [grid, search]);

  /* ── CSV（1人1日1行・Excelで開けるようにBOMつき） ── */
  const downloadCsv = () => {
    if (!grid) return;
    const head = ["社員コード", "氏名", "部署", "日付", "曜日", "祝日", "予定の始まり", "予定の終わり", "予定は休み", "出勤", "退勤", "実働", "休憩", "深夜", "遅刻(分)", "早退(分)", "休み", "気になる点"];
    const lines = [head];
    for (const r of grid.rows) {
      for (const d of grid.days) {
        const c = r.cells[d.date];
        lines.push([
          r.employee.employeeCode, r.employee.name, r.employee.department ?? "", d.date, DOW[d.dow], d.holiday ?? "",
          c?.schedule && !c.schedule.off ? c.schedule.start ?? "" : "", c?.schedule && !c.schedule.off ? c.schedule.end ?? "" : "", c?.schedule?.off ? "休み" : "",
          hm(c?.clockIn ?? null), hm(c?.clockOut ?? null),
          c && c.clockIn ? hmm(c.workMin) : "", c && c.breakMin ? hmm(c.breakMin) : "", c && c.nightMin ? hmm(c.nightMin) : "",
          c?.lateMin ? String(c.lateMin) : "", c?.earlyMin ? String(c.earlyMin) : "",
          (c?.absences ?? []).map((a) => ABSENCE_LABELS[a.type]).join("・"),
          (c?.flags ?? []).map((f) => FLAG_LABEL[f]).join("・"),
        ]);
      }
    }
    lines.push([]);
    lines.push(["社員コード", "氏名", "出勤日数", "実働", "残業(8時間超)", "深夜", "遅刻(回)", "早退(回)", "出勤なし(回)", "退勤の打ち忘れ(回)", "欠勤(日)", "有給(日)"]);
    for (const r of grid.rows) {
      const t = r.totals;
      lines.push([r.employee.employeeCode, r.employee.name, String(t.workDays), hmm(t.workMin), hmm(t.overtimeMin), hmm(t.nightMin), String(t.late), String(t.early), String(t.noShow), String(t.missingOut), String(t.absenceDays), String(t.paidLeaveDays)]);
    }
    const csv = "﻿" + lines.map((l) => l.map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `勤怠表_${grid.year}年${grid.month}月.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  };

  /* ── 印刷（A4横・新しい窓に表を作って印刷） ── */
  const print = () => {
    if (!grid) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const head = grid.days.map((d) => `<th class="${d.dow === 0 || d.holiday ? "sun" : d.dow === 6 ? "sat" : ""}">${d.day}<br>${DOW[d.dow]}</th>`).join("");
    const body = rows.map((r) => {
      const tds = grid.days.map((d) => {
        const c = r.cells[d.date];
        if (!c) return "<td></td>";
        if (c.absences.length && !c.clockIn) return `<td class="abs">${esc(c.absences.map((a) => ABSENCE_LABELS[a.type]).join(" "))}</td>`;
        if (c.clockIn) return `<td class="${c.flags.length ? "warn" : ""}">${hm(c.clockIn)}<br>${c.clockOut ? hm(c.clockOut) : c.open ? "勤務中" : "退勤なし"}</td>`;
        if (c.flags.includes("noshow")) return `<td class="warn">出勤なし</td>`;
        return `<td class="plan">${c.schedule?.off ? "休" : c.schedule ? `${c.schedule.start}<br>${c.schedule.end}` : ""}</td>`;
      }).join("");
      const t = r.totals;
      return `<tr><th class="name">${esc(r.employee.name)}</th>${tds}<td class="tot">${t.workDays}</td><td class="tot">${hmm(t.workMin)}</td><td class="tot">${hmm(t.overtimeMin)}</td><td class="tot">${t.late}/${t.early}</td><td class="tot">${t.absenceDays}/${t.paidLeaveDays}</td></tr>`;
    }).join("");
    const w = window.open("", "_blank");
    if (!w) { window.alert("新しい窓を開けませんでした（ポップアップを許可してください）"); return; }
    w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>勤怠表 ${grid.year}年${grid.month}月</title><style>
      @page { size: A4 landscape; margin: 7mm; }
      body { font-family: "Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif; margin: 0; color: #111; }
      h1 { font-size: 13px; margin: 0 0 4px; } p { font-size: 9px; margin: 0 0 4px; color: #555; }
      table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 7px; }
      th, td { border: 1px solid #bbb; padding: 1px; text-align: center; line-height: 1.25; overflow: hidden; }
      th { background: #f3f4f6; font-weight: 600; } th.name { width: 62px; text-align: left; font-size: 8px; }
      th.sat { color: #1d4ed8; } th.sun { color: #b91c1c; } td.abs { background: #ecfdf5; } td.warn { background: #fef2f2; } td.plan { color: #999; }
      td.tot { background: #eef2ff; font-weight: 600; width: 26px; } th.tot { width: 26px; }
    </style></head><body>
      <h1>勤怠表　${grid.year}年${grid.month}月</h1>
      <p>上段＝出勤・下段＝退勤（休みは種類、予定だけの日は予定を薄く）。右は 出勤日数／実働／残業（1日8時間超）／遅刻・早退の回数／欠勤・有給の日数。</p>
      <table><thead><tr><th class="name">氏名</th>${head}<th class="tot">日数</th><th class="tot">実働</th><th class="tot">残業</th><th class="tot">遅/早</th><th class="tot">欠/有</th></tr></thead><tbody>${body}</tbody></table>
      <script>window.onload = () => { window.print(); };<\/script>
    </body></html>`);
    w.document.close();
  };

  return (
    <AppLayout fullWidth>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-1 h-7 rounded-full bg-indigo-500 shrink-0" />
            <h2 className="text-base md:text-lg font-bold jp-tight">月の勤怠表</h2>
          </div>
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <button type="button" className="px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 border-r border-slate-100 dark:border-slate-800" onClick={() => moveMonth(-1)} title="前の月"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-4 text-sm font-semibold amount min-w-[8rem] text-center">{ym.y}年{ym.m}月</span>
            <button type="button" className="px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 border-l border-slate-100 dark:border-slate-800" onClick={() => moveMonth(1)} title="次の月"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="氏名・部署で検索" className="h-9 pl-8 w-44" />
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadCsv} disabled={!grid}><Download className="h-3.5 w-3.5" />CSV</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={print} disabled={!grid}><Printer className="h-3.5 w-3.5" />印刷</Button>
          <Link href="/attendance"><Button variant="outline" size="sm">勤怠管理へ</Button></Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>マス＝上が出勤・下が退勤。押すとその日の予定を直せます。名前を押すと曜日ごとの「予定の型」を決められます。</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300" />出勤なし・退勤なし</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-orange-100 border border-orange-300" />遅刻・早退（猶予{grid?.settings.lateGraceMinutes ?? 5}分）</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-200" />休み</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-dashed border-slate-300" />予定だけ</span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {/* 締めの確認 */}
        {grid && (
          <details className="rounded-xl border bg-card" open={closeIssues.length + monthCorr.length > 0}>
            <summary className="cursor-pointer px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
              <b>締めの確認</b>
              <span className={closeIssues.length ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                {closeIssues.length ? `直すもの ${closeIssues.length}件` : "直すものはありません"}
              </span>
              <span className={monthCorr.length ? "text-sky-700 font-semibold" : "text-muted-foreground"}>修正申請 {monthCorr.length}件</span>
              <span className="text-muted-foreground">確認済み {checkedCount}／{grid.rows.length}人</span>
              <Link href="/monthly-input" className="ml-auto">
                <Button size="sm" variant={closeIssues.length + monthCorr.length === 0 ? "default" : "outline"} className="h-7">月次実績入力へ（勤怠から一括反映）</Button>
              </Link>
            </summary>
            {(closeIssues.length > 0 || monthCorr.length > 0) && (
              <div className="border-t px-3 py-2 space-y-1 max-h-56 overflow-y-auto">
                <p className="text-[11px] text-muted-foreground">月次実績へ取り込む前に直してください。退勤が無い日は0時間で数えられます。押すとその日の画面が開きます。</p>
                <div className="flex flex-wrap gap-1.5">
                  {closeIssues.map((x, i) => (
                    <button key={i} type="button" onClick={() => setCellOpen({ row: x.row, date: x.date })}
                      className="text-xs rounded-md border px-2 py-1 hover:bg-muted/60">
                      <span className="font-semibold">{x.row.employee.name.replace(/[\s　]+/g, " ")}</span>
                      <span className="text-muted-foreground amount"> {Number(x.date.slice(5, 7))}/{Number(x.date.slice(8, 10))} </span>
                      <span className={x.tone}>{x.label}</span>
                    </button>
                  ))}
                  {monthCorr.length > 0 && (
                    <Link href="/attendance-records" className="text-xs rounded-md border border-sky-200 bg-sky-50 dark:bg-sky-500/10 px-2 py-1 text-sky-700 dark:text-sky-300 hover:bg-sky-100">
                      まだ決めていない修正申請 {monthCorr.length}件 →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </details>
        )}
        {!grid ? (
          <div className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">読み込み中...</div>
        ) : (
          <div ref={scrollRef} className="rounded-xl border bg-card overflow-auto max-h-[calc(100dvh-13rem)]">
            <table className="border-separate border-spacing-0 text-[11px] amount">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-muted text-left px-2 py-1.5 border-b border-r min-w-[9.5rem] font-semibold">社員</th>
                  {grid.days.map((d) => (
                    <th key={d.date} title={d.holiday ?? undefined} data-today={d.date === grid.today ? "" : undefined}
                      className={`sticky top-0 z-20 border-b px-0.5 py-1 min-w-[3.1rem] font-semibold ${d.date === grid.today ? "bg-indigo-100 dark:bg-indigo-500/20" : "bg-muted"} ${d.dow === 0 || d.holiday ? "text-red-600" : d.dow === 6 ? "text-blue-600" : ""}`}>
                      <div className="text-xs">{d.day}</div><div className="text-[10px] font-normal">{DOW[d.dow]}{d.holiday ? "祝" : ""}</div>
                    </th>
                  ))}
                  {["日数", "実働", "残業", "深夜", "遅刻", "早退", "出勤なし", "打ち忘れ", "欠勤", "有給", "確認"].map((h) => (
                    <th key={h} className="sticky top-0 z-20 bg-indigo-50 dark:bg-indigo-500/10 border-b border-l px-1.5 py-1 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee.id} className="group">
                    <th className="sticky left-0 z-10 bg-card group-hover:bg-muted/60 text-left px-2 py-1 border-b border-r font-normal">
                      <button type="button" className="text-left w-full" onClick={() => setPatOpen(r)} title="予定の型（曜日ごと）を決める">
                        <span className="block text-[13px] font-semibold jp-tight truncate max-w-[8.5rem]">{r.employee.name}</span>
                        {/* 全員に型があるときは「予定の型あり」を出さない（毎行に出て目障りなので）。無い人だけ知らせる */}
                        {!r.hasPattern ? <span className="block text-[10px] text-orange-600">予定の型なし</span>
                          : !allHavePattern ? <span className="block text-[10px] text-indigo-600 dark:text-indigo-300">予定の型あり</span> : null}
                        {r.checked && <span className="block text-[10px] text-emerald-600">✓ 確認済み</span>}
                      </button>
                    </th>
                    {grid.days.map((d) => <GridCell key={d.date} cell={r.cells[d.date]} today={d.date === grid.today} future={d.date > grid.today} onClick={() => setCellOpen({ row: r, date: d.date })} />)}
                    {(() => {
                      const t = r.totals;
                      const v: Array<[string, boolean]> = [
                        [String(t.workDays), false], [hmm(t.workMin), false], [hmm(t.overtimeMin), t.overtimeMin > 0], [hmm(t.nightMin), false],
                        [String(t.late), t.late > 0], [String(t.early), t.early > 0], [String(t.noShow), t.noShow > 0], [String(t.missingOut), t.missingOut > 0],
                        [String(t.absenceDays), false], [String(t.paidLeaveDays), false],
                      ];
                      return v.map(([s, hot], i) => <td key={i} className={`border-b border-l px-1.5 text-right whitespace-nowrap bg-indigo-50/40 dark:bg-indigo-500/5 ${hot ? "text-red-600 font-semibold" : ""}`}>{s}</td>);
                    })()}
                    <td className="border-b border-l px-1.5 text-center bg-indigo-50/40 dark:bg-indigo-500/5">
                      <input type="checkbox" checked={!!r.checked} onChange={() => void toggleChecked(r)} className="h-4 w-4 cursor-pointer"
                        title={r.checked ? `確認済み（${r.checked.by ?? ""}・${new Date(r.checked.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）` : "この人のこの月を確認済みにする"}
                        aria-label={`${r.employee.name}さんの${ym.m}月を確認済みにする`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {cellOpen && grid && (
        <CellDialog row={cellOpen.row} date={cellOpen.date} day={grid.days.find((d) => d.date === cellOpen.date)!}
          onClose={() => setCellOpen(null)} onSaved={() => { setCellOpen(null); void load(); }} />
      )}
      {patOpen && grid && (
        <PatternDialog row={patOpen} rows={grid.rows} pattern={patterns.find((p) => p.employeeId === patOpen.employee.id) ?? null}
          onClose={() => setPatOpen(null)} onSaved={() => { setPatOpen(null); void load(); }} />
      )}
    </AppLayout>
  );
}

function GridCell({ cell, today, future, onClick }: { cell?: Cell; today: boolean; future: boolean; onClick: () => void }) {
  const base = `border-b px-0.5 py-0.5 text-center align-middle cursor-pointer hover:outline hover:outline-2 hover:outline-indigo-400 hover:-outline-offset-2 ${today ? "bg-indigo-50/60 dark:bg-indigo-500/10" : ""}`;
  if (!cell) return <td className={base} onClick={onClick} />;
  const f = cell.flags;
  const bad = f.includes("noshow") || f.includes("missingOut") || f.includes("missingIn") || f.includes("conflict");
  const tone = bad ? "bg-red-50 dark:bg-red-500/15" : f.includes("late") || f.includes("early") ? "bg-orange-50 dark:bg-orange-500/15" : f.includes("offwork") ? "bg-purple-50 dark:bg-purple-500/15" : "";
  const title = [
    cell.schedule ? (cell.schedule.off ? "予定：休み" : `予定：${cell.schedule.start}〜${cell.schedule.end}`) : "",
    cell.clockIn ? `出勤 ${hm(cell.clockIn)} / 退勤 ${cell.clockOut ? hm(cell.clockOut) : "なし"} / 実働 ${minToStr(cell.workMin)}` : "",
    cell.absences.map((a) => ABSENCE_LABELS[a.type]).join("・"),
    f.map((x) => FLAG_LABEL[x] + (x === "late" ? `${cell.lateMin}分` : x === "early" ? `${cell.earlyMin}分` : "")).join("・"),
  ].filter(Boolean).join("\n");
  let body: React.ReactNode;
  if (cell.clockIn) {
    body = (
      <>
        <div className={f.includes("late") ? "text-orange-600 font-semibold" : ""}>{hm(cell.clockIn)}</div>
        <div className={f.includes("early") ? "text-orange-600 font-semibold" : f.includes("missingOut") ? "text-red-600 font-semibold" : cell.open ? "text-emerald-600" : ""}>
          {cell.clockOut ? hm(cell.clockOut) : cell.open ? "勤務中" : "なし"}
        </div>
      </>
    );
  } else if (cell.absences.length) {
    body = <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 leading-tight">{cell.absences.map((a) => ABSENCE_LABELS[a.type].replace("（", "\n（")).join("・")}</div>;
  } else if (f.includes("noshow")) {
    body = <div className="text-[10px] font-bold text-red-600">出勤なし</div>;
  } else if (f.includes("missingIn")) {
    body = <div className="text-[10px] font-bold text-red-600">出勤なし<br />打刻あり</div>;
  } else if (cell.schedule) {
    body = cell.schedule.off
      ? <div className="text-[10px] text-slate-400">休</div>
      : <div className={`text-[10px] leading-tight ${future ? "text-slate-500" : "text-slate-400"}`}>{cell.schedule.start}<br />{cell.schedule.end}</div>;
  }
  const dashed = !cell.clockIn && !cell.absences.length && !bad && cell.schedule && !cell.schedule.off;
  return (
    <td className={`${base} ${tone} ${cell.absences.length && !cell.clockIn ? "bg-emerald-50/70 dark:bg-emerald-500/10" : ""}`} onClick={onClick} title={title}>
      <div className={`rounded-sm leading-tight whitespace-pre-line ${dashed ? "border border-dashed border-slate-300 dark:border-slate-600" : ""} ${cell.schedule?.source === "day" ? "underline decoration-indigo-300 decoration-dotted underline-offset-2" : ""}`}>{body}</div>
    </td>
  );
}

/* ── その日の予定を直す ── */
function CellDialog({ row, date, day, onClose, onSaved }: {
  row: Row; date: string; day: { dow: number; holiday: string | null }; onClose: () => void; onSaved: () => void;
}) {
  const cell = row.cells[date];
  const sch = cell?.schedule ?? null;
  const [off, setOff] = useState(sch?.off ?? false);
  const [start, setStart] = useState(sch?.start ?? "08:00");
  const [end, setEnd] = useState(sch?.end ?? "17:00");
  const [note, setNote] = useState(sch?.source === "day" ? sch.note ?? "" : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api(`/attendance/schedules/${row.employee.id}/${date}`, { method: "PUT", body: JSON.stringify(off ? { isOff: true, note } : { start, end, note }) });
      onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setMsg(null);
    try { await api(`/attendance/schedules/${row.employee.id}/${date}`, { method: "DELETE" }); onSaved(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${DOW[day.dow]}${day.holiday ? `・${day.holiday}` : ""}）`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{row.employee.name}さん　{label}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-1">
            {cell?.clockIn ? (
              <p>出勤 <b className="amount">{hm(cell.clockIn)}</b>　退勤 <b className="amount">{cell.clockOut ? hm(cell.clockOut) : cell.open ? "勤務中" : "なし"}</b>　実働 <b className="amount">{minToStr(cell.workMin)}</b>{cell.breakMin ? `　休憩 ${minToStr(cell.breakMin)}` : ""}</p>
            ) : <p className="text-muted-foreground">打刻はありません</p>}
            {(cell?.absences ?? []).length > 0 && <p>休み：{cell!.absences.map((a) => ABSENCE_LABELS[a.type]).join("・")}</p>}
            {(cell?.flags ?? []).length > 0 && <p className="text-red-600 font-semibold">{cell!.flags.map((x) => FLAG_LABEL[x] + (x === "late" ? ` ${cell!.lateMin}分` : x === "early" ? ` ${cell!.earlyMin}分` : "")).join("・")}</p>}
            <Link href={`/attendance?date=${date}&emp=${row.employee.id}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
              <ExternalLink className="h-3 w-3" />この日の打刻を開く（直す・休みを入れる）
            </Link>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-bold flex items-center gap-1.5"><CalendarRange className="h-4 w-4" />この日の予定</p>
            <p className="text-[11px] text-muted-foreground">
              {sch ? (sch.source === "day" ? "この日だけの予定が入っています。" : "いまは「予定の型」から作った予定です。ここで直すとこの日だけ変わります。") : "予定はありません（予定が無い日は遅刻などを数えません）。"}
            </p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />この日は休み</label>
            {!off && (
              <div className="flex items-center gap-2">
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-28" aria-label="始まり" />
                <span>〜</span>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" aria-label="終わり" />
              </div>
            )}
            {!off && end <= start && <p className="text-[11px] text-indigo-600">終わりが始まりより前なので、翌日の{end}までとして扱います（夜勤）。</p>}
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（例：午後から現場）" maxLength={200} />
          </div>
          {msg && <p className="text-xs text-red-600">{msg}</p>}
          <div className="flex items-center gap-2">
            {sch?.source === "day" && <Button variant="outline" size="sm" className="mr-auto" onClick={reset} disabled={busy}>予定の型に戻す</Button>}
            <Button variant="outline" size="sm" className={sch?.source === "day" ? "" : "ml-auto"} onClick={onClose} disabled={busy}>やめる</Button>
            <Button size="sm" onClick={save} disabled={busy}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── 予定の型（曜日ごと） ── */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
function PatternDialog({ row, rows, pattern, onClose, onSaved }: {
  row: Row; rows: Row[]; pattern: Pattern | null; onClose: () => void; onSaved: () => void;
}) {
  const [days, setDays] = useState<Record<string, { on: boolean; start: string; end: string }>>(() => {
    const o: Record<string, { on: boolean; start: string; end: string }> = {};
    for (let d = 0; d < 7; d++) {
      const v = pattern?.days[String(d)];
      o[String(d)] = v ? { on: true, start: v.start, end: v.end } : { on: !pattern && d >= 1 && d <= 5, start: "08:00", end: "17:00" };
    }
    return o;
  });
  const [holidayOff, setHolidayOff] = useState(pattern?.holidayOff ?? true);
  const [from, setFrom] = useState(pattern?.from ?? todayJST());
  const [also, setAlso] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (d: number, patch: Partial<{ on: boolean; start: string; end: string }>) => setDays((x) => ({ ...x, [String(d)]: { ...x[String(d)]!, ...patch } }));
  const save = async () => {
    setBusy(true); setMsg(null);
    const body = { holidayOff, from, days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v.on ? { start: v.start, end: v.end } : null])) };
    try {
      for (const id of [row.employee.id, ...also]) {
        await api(`/attendance/schedule-patterns/${id}`, { method: "PUT", body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const copyWeekday = () => { const m = days["1"]!; setDays((x) => { const o = { ...x }; for (const d of [2, 3, 4, 5]) o[String(d)] = { ...m }; return o; }); };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">{row.employee.name}さんの予定の型（曜日ごと）</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">毎週の決まった出勤の予定です。日ごとに違う日は、勤怠表のマスを押して直してください（そちらが優先）。チェックを外した曜日は休みです。</p>
          <div className="space-y-1.5">
            {ORDER.map((d) => {
              const v = days[String(d)]!;
              return (
                <div key={d} className="flex items-center gap-2">
                  <label className={`flex items-center gap-1.5 w-14 text-sm font-semibold ${d === 0 ? "text-red-600" : d === 6 ? "text-blue-600" : ""}`}>
                    <input type="checkbox" checked={v.on} onChange={(e) => set(d, { on: e.target.checked })} />{DOW[d]}
                  </label>
                  {v.on ? (
                    <>
                      <Input type="time" value={v.start} onChange={(e) => set(d, { start: e.target.value })} className="w-28 h-8" aria-label={`${DOW[d]}曜の始まり`} />
                      <span>〜</span>
                      <Input type="time" value={v.end} onChange={(e) => set(d, { end: e.target.value })} className="w-28 h-8" aria-label={`${DOW[d]}曜の終わり`} />
                    </>
                  ) : <span className="text-xs text-muted-foreground">休み</span>}
                </div>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            この型を使うのは
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 h-8" aria-label="いつから" />
            から
          </label>
          <p className="text-[11px] text-muted-foreground -mt-2">これより前の日は、この型で遅刻・出勤なしを数えません。</p>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={holidayOff} onChange={(e) => setHolidayOff(e.target.checked)} />祝日は休みにする</label>
            <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={copyWeekday}>月曜の時刻を火〜金にも</button>
          </div>
          <details className="rounded-lg border px-3 py-2">
            <summary className="text-sm cursor-pointer">同じ型を、ほかの人にも入れる{also.length > 0 ? `（${also.length}人）` : ""}</summary>
            <div className="mt-2 grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
              {rows.filter((r) => r.employee.id !== row.employee.id).map((r) => (
                <label key={r.employee.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={also.includes(r.employee.id)} onChange={(e) => setAlso((x) => e.target.checked ? [...x, r.employee.id] : x.filter((i) => i !== r.employee.id))} />
                  <span className="truncate">{r.employee.name}</span>
                </label>
              ))}
            </div>
          </details>
          {msg && <p className="text-xs text-red-600">{msg}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>やめる</Button>
            <Button size="sm" onClick={save} disabled={busy}>保存{also.length > 0 ? `（${also.length + 1}人）` : ""}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
