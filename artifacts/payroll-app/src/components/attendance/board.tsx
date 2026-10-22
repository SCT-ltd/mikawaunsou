import { AlertTriangle } from "lucide-react";
import {
  EmployeeStatus,
  AttendanceRecord,
  AbsenceRecord,
  Status,
  ABSENCE_LABELS,
  Avatar,
  fmt,
  minToStr,
} from "./shared";

/**
 * 勤怠ダッシュボードの「ひと目で分かる」部品。
 *   - 状態で絞り込む札（全員／出勤中／休憩中／退勤済／未出勤／要確認）
 *   - 1日の帯（出勤〜退勤を緑、休憩を黄で、時刻の目盛りの上に描く）
 *   - 全員の帯を縦に並べたタイムライン
 * 打刻の時刻はすべて日本時間で扱う（パソコンの時刻の設定に左右されないように）。
 */

const H = 3600000;
const JST = 9 * H;

/* ── 1日の区間（勤務・休憩）────────────────────────── */
export interface Segment { from: number; to: number; kind: "work" | "break"; open: boolean }

/** 打刻から勤務と休憩の区間を作る。退勤していなければ「いま」まで（今日を見ているときだけ）。 */
export function segmentsOf(records: AttendanceRecord[], now: Date, live: boolean): Segment[] {
  const recs = [...records].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const out: Segment[] = [];
  let workFrom: number | null = null;
  let breakFrom: number | null = null;
  for (const r of recs) {
    const t = new Date(r.recordedAt).getTime();
    if (r.eventType === "clock_in") { if (workFrom === null) workFrom = t; }
    else if (r.eventType === "break_start") { if (breakFrom === null) breakFrom = t; }
    else if (r.eventType === "break_end") { if (breakFrom !== null) { out.push({ from: breakFrom, to: t, kind: "break", open: false }); breakFrom = null; } }
    else if (r.eventType === "clock_out") {
      if (breakFrom !== null) { out.push({ from: breakFrom, to: t, kind: "break", open: false }); breakFrom = null; }
      if (workFrom !== null) { out.push({ from: workFrom, to: t, kind: "work", open: false }); workFrom = null; }
    }
  }
  const end = now.getTime();
  if (breakFrom !== null) out.push({ from: breakFrom, to: live ? end : breakFrom, kind: "break", open: live });
  if (workFrom !== null) out.push({ from: workFrom, to: live ? end : workFrom, kind: "work", open: live });
  // 勤務を先に描き、その上に休憩を重ねる
  return out.sort((a, b) => (a.kind === b.kind ? a.from - b.from : a.kind === "work" ? -1 : 1));
}

/** 実働（休憩を引いた分）・休憩・拘束（出勤から退勤／いままで）を分で */
export function dayTotals(records: AttendanceRecord[], now: Date, live: boolean) {
  const segs = segmentsOf(records, now, live);
  const work = segs.filter((s) => s.kind === "work").reduce((m, s) => m + (s.to - s.from), 0);
  const brk = segs.filter((s) => s.kind === "break").reduce((m, s) => m + (s.to - s.from), 0);
  const recs = [...records].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const firstIn = recs.find((r) => r.eventType === "clock_in");
  const lastOut = [...recs].reverse().find((r) => r.eventType === "clock_out");
  return {
    workMin: Math.max(0, Math.round((work - brk) / 60000)),
    breakMin: Math.round(brk / 60000),
    restraintMin: Math.round(work / 60000),
    clockIn: firstIn?.recordedAt ?? null,
    clockOut: lastOut && (!firstIn || new Date(lastOut.recordedAt) > new Date(firstIn.recordedAt)) ? lastOut.recordedAt : null,
  };
}

/* ── 帯の表示範囲（勤務日の何時から何時まで）──────────── */
export interface Window { start: number; end: number }

/** 勤務日の0時（日本時間）の時刻 */
function dayStart(workDate: string): number {
  return new Date(`${workDate}T00:00:00+09:00`).getTime();
}

/**
 * 表示範囲を決める。ふだんは 5時〜24時。早出・日をまたぐ勤務があれば、それが入るまで広げる（翌6時まで）。
 * 全員を並べるときは全員ぶんの区間を渡して同じ範囲にそろえる。
 */
export function windowFor(workDate: string, segs: Segment[]): Window {
  const base = dayStart(workDate);
  let s = 5, e = 24;
  for (const g of segs) {
    s = Math.min(s, Math.floor((g.from - base) / H));
    e = Math.max(e, Math.ceil((g.to - base) / H));
  }
  s = Math.max(0, s);
  e = Math.min(30, e);
  if (e - s < 12) e = s + 12;
  return { start: base + s * H, end: base + e * H };
}

function hourLabel(t: number): string {
  const h = new Date(t + JST).getUTCHours();
  return `${h}`;
}

/* ── 1日の帯 ────────────────────────────────────────── */
export function DayBar({
  segs, win, now, live, height = "h-3.5", ticks = true,
}: {
  segs: Segment[]; win: Window; now: Date; live: boolean; height?: string; ticks?: boolean;
}) {
  const span = win.end - win.start;
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - win.start) / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0.6, ((Math.min(b, win.end) - Math.max(a, win.start)) / span) * 100)}%`;
  const nowT = now.getTime();
  const hours: number[] = [];
  for (let t = win.start; t <= win.end; t += H) hours.push(t);
  return (
    <div className={`relative w-full ${height} rounded bg-slate-100 dark:bg-slate-800 overflow-hidden`}>
      {ticks && hours.slice(1, -1).map((t) => {
        const major = new Date(t + JST).getUTCHours() % 3 === 0;
        return <span key={t} className={`absolute top-0 bottom-0 w-px ${major ? "bg-slate-300/80 dark:bg-slate-600" : "bg-slate-200/70 dark:bg-slate-700/60"}`} style={{ left: pct(t) }} />;
      })}
      {segs.map((g, i) => (
        <span
          key={i}
          className={`absolute top-0 bottom-0 ${g.kind === "work" ? "bg-emerald-500/85 dark:bg-emerald-500/70" : "bg-amber-400 dark:bg-amber-400/90"} ${g.kind === "break" ? "top-[2px] bottom-[2px] rounded-sm" : ""}`}
          style={{ left: pct(g.from), width: width(g.from, g.to) }}
          title={`${g.kind === "work" ? "勤務" : "休憩"} ${fmt(new Date(g.from).toISOString())}〜${g.open ? "（いま）" : fmt(new Date(g.to).toISOString())}`}
        />
      ))}
      {live && nowT > win.start && nowT < win.end && (
        <span className="absolute -top-px -bottom-px w-0.5 bg-red-500" style={{ left: pct(nowT) }} title="いま" />
      )}
    </div>
  );
}

/** 帯の上の時刻の目盛り（3時間ごと） */
export function HourScale({ win }: { win: Window }) {
  const span = win.end - win.start;
  const marks: number[] = [];
  for (let t = win.start; t <= win.end; t += H) if (new Date(t + JST).getUTCHours() % 3 === 0) marks.push(t);
  return (
    <div className="relative h-4 text-[10px] text-slate-400 amount select-none">
      {marks.map((t) => {
        const left = ((t - win.start) / span) * 100;
        return (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${left}%` }}>
            {left > 98 ? "" : hourLabel(t)}
          </span>
        );
      })}
    </div>
  );
}

/* ── 要確認（いま事務所が見るべきこと）────────────────── */
export function attentionOf(d: EmployeeStatus, now: Date, live: boolean): string[] {
  const out: string[] = [];
  const insp = d.inspection;
  if (insp && insp.ng.length > 0 && insp.officeDecision == null) out.push(`点検で異常${insp.ng.length}件`);
  if ((d.alcohol ?? []).some((a) => a.detected)) out.push("アルコール検知");
  if (d.compliance?.flags.some((f) => f.level === "danger")) out.push("改善基準超え");
  if ((d.pendingCorrections ?? 0) > 0) out.push(`修正申請${d.pendingCorrections}件`);
  if (live && (d.status === "出勤中" || d.status === "休憩中") && d.clockInTime && now.getTime() - new Date(d.clockInTime).getTime() > 14 * H) {
    out.push("退勤の打ち忘れ？");
  }
  if (live && d.status === "休憩中") {
    const lastBreak = [...d.records].reverse().find((r) => r.eventType === "break_start");
    if (lastBreak && now.getTime() - new Date(lastBreak.recordedAt).getTime() > 3 * H) out.push("休憩が3時間超");
  }
  return out;
}

/* ── 絞り込みの札 ───────────────────────────────────── */
export type FilterKey = "all" | Status | "attention";

const FILTER_STYLE: Record<FilterKey, { dot: string; on: string }> = {
  all:       { dot: "bg-slate-400",   on: "bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100" },
  "出勤中":  { dot: "bg-emerald-500", on: "bg-emerald-600 text-white border-emerald-600" },
  "休憩中":  { dot: "bg-amber-400",   on: "bg-amber-500 text-white border-amber-500" },
  "退勤済":  { dot: "bg-sky-400",     on: "bg-sky-600 text-white border-sky-600" },
  "未出勤":  { dot: "bg-slate-300",   on: "bg-slate-500 text-white border-slate-500" },
  attention: { dot: "bg-red-500",     on: "bg-red-600 text-white border-red-600" },
};
const FILTER_LABEL: Record<FilterKey, string> = { all: "全員", "出勤中": "出勤中", "休憩中": "休憩中", "退勤済": "退勤済", "未出勤": "未出勤", attention: "要確認" };

export function StatusFilter({
  value, onChange, counts,
}: {
  value: FilterKey; onChange: (k: FilterKey) => void; counts: Record<FilterKey, number>;
}) {
  const keys: FilterKey[] = ["all", "出勤中", "休憩中", "退勤済", "未出勤", "attention"];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-0.5" role="tablist" aria-label="状態で絞り込む">
      {keys.map((k) => {
        const on = value === k;
        const n = counts[k];
        const alert = k === "attention" && n > 0;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(k)}
            className={`shrink-0 inline-flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-full border text-[13px] font-semibold transition-colors jp-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              on ? FILTER_STYLE[k].on
                : alert ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
            }`}
          >
            {k === "attention" ? <AlertTriangle className="h-3.5 w-3.5" /> : <span className={`w-2 h-2 rounded-full ${on ? "bg-white/90" : FILTER_STYLE[k].dot}`} />}
            {FILTER_LABEL[k]}
            <span className={`min-w-[1.4rem] text-center rounded-full px-1.5 text-xs amount ${on ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"}`}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── 全員のタイムライン ──────────────────────────────── */
export function TimelineView({
  rows, now, live, workDate, selectedId, onSelect, absences,
}: {
  rows: EmployeeStatus[]; now: Date; live: boolean; workDate: string;
  selectedId: number | null; onSelect: (id: number) => void; absences: AbsenceRecord[];
}) {
  const segsById = new Map(rows.map((d) => [d.employee.id, segmentsOf(d.records, now, live)]));
  const win = windowFor(workDate, [...segsById.values()].flat());
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-end gap-3 px-3 pt-2 pb-1 border-b shrink-0 bg-muted/20">
        <div className="w-40 sm:w-48 shrink-0 text-[11px] text-muted-foreground pb-0.5">社員</div>
        <div className="flex-1 min-w-0"><HourScale win={win} /></div>
        <div className="w-[5.5rem] shrink-0 text-right text-[11px] text-muted-foreground pb-0.5">実働</div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">該当する社員がいません</div>}
        {rows.map((d) => {
          const segs = segsById.get(d.employee.id) ?? [];
          const t = dayTotals(d.records, now, live);
          const sel = d.employee.id === selectedId;
          const att = attentionOf(d, now, live);
          const abs = absences.filter((a) => a.employeeId === d.employee.id);
          return (
            <button
              key={d.employee.id}
              type="button"
              data-emp-id={d.employee.id}
              onClick={() => onSelect(d.employee.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 border-b border-border/50 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${sel ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-muted/40"}`}
            >
              <div className="w-40 sm:w-48 shrink-0 flex items-center gap-2 min-w-0">
                <Avatar name={d.employee.name} size="sm" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold truncate jp-tight leading-tight">{d.employee.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate leading-tight">
                    {abs.length > 0 ? abs.map((a) => ABSENCE_LABELS[a.absenceType]).join("・") : t.clockIn ? `${fmt(t.clockIn)}〜${t.clockOut ? fmt(t.clockOut) : live ? "" : "退勤なし"}` : d.status}
                  </p>
                </div>
                {att.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 ml-auto" aria-label={att.join("、")} />}
              </div>
              <div className="flex-1 min-w-0"><DayBar segs={segs} win={win} now={now} live={live} /></div>
              <div className="w-[5.5rem] shrink-0 text-right text-xs font-semibold amount whitespace-nowrap text-slate-700 dark:text-slate-200">{t.restraintMin > 0 ? minToStr(t.workMin) : "—"}</div>
            </button>
          );
        })}
      </div>
      <div className="px-3 py-1.5 border-t bg-muted/30 shrink-0 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-500/85" />勤務</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-amber-400" />休憩</span>
        {live && <span className="inline-flex items-center gap-1"><span className="w-0.5 h-3 bg-red-500" />いま</span>}
        <span className="ml-auto amount">{rows.length}名</span>
      </div>
    </div>
  );
}
