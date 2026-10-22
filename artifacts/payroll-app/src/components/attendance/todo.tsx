import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Phone, ExternalLink, RefreshCw } from "lucide-react";
import { ABSENCE_LABELS, type AbsenceType } from "./shared";

/**
 * やること（事務所が今日片付けること）を上から順に並べる。片付けると消える。
 *   出勤なし → 電話・休みを入れる／退勤の打ち忘れ → 時刻を入れてその場で退勤／修正申請 → その場で承認
 *   点検の「否」・アルコール・出勤の打ち忘れ・休みと出勤の重なり → 「開く」でその日のその人へ
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Item {
  key: string;
  kind: "alcohol" | "inspection" | "noshow" | "missingOut" | "missingIn" | "correction" | "conflict";
  date: string;
  employee: { id: number; name: string; phone: string | null };
  title: string;
  detail: string;
  data?: { clockIn?: string; scheduleEnd?: string | null; correctionId?: number; inspectionId?: number; scheduleStart?: string | null };
}

const TONE: Record<Item["kind"], string> = {
  alcohol: "border-l-red-600", inspection: "border-l-red-500", noshow: "border-l-orange-500",
  missingOut: "border-l-amber-500", missingIn: "border-l-amber-500", correction: "border-l-sky-500", conflict: "border-l-purple-500",
};
const LABEL: Record<Item["kind"], string> = {
  alcohol: "至急", inspection: "至急", noshow: "出勤なし", missingOut: "打ち忘れ", missingIn: "打ち忘れ", correction: "修正申請", conflict: "確認",
};
const hm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(11, 16);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function TodoView({ onOpen, refreshKey, onChanged }: {
  /** その日のその人を一覧で開く */
  onOpen: (date: string, employeeId: number) => void;
  /** 勤怠が変わったら取り直す（SSE の更新に合わせる） */
  refreshKey: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [today, setToday] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/attendance/todo`, { cache: "no-store" });
      if (!res.ok) throw new Error("読み込めませんでした");
      const b = await res.json() as { today: string; items: Item[] };
      setItems(b.items); setToday(b.today); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0 bg-muted/20">
        <p className="text-sm font-bold">やること</p>
        {items && <span className="text-xs text-muted-foreground amount">{items.length}件</span>}
        <span className="text-[11px] text-muted-foreground hidden md:inline">急ぐものから並んでいます。片付けると消えます。</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />更新</Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!items && !err && <p className="text-sm text-muted-foreground py-8 text-center">読み込み中...</p>}
        {items && items.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">いま片付けることはありません</p>
          </div>
        )}
        {items?.map((it) => <TodoRow key={it.key} it={it} today={today} onOpen={onOpen} done={() => { void load(); onChanged(); }} />)}
      </div>
    </div>
  );
}

function TodoRow({ it, today, onOpen, done }: { it: Item; today: string; onOpen: (date: string, id: number) => void; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const defaultOut = it.data?.scheduleEnd ?? (it.data?.clockIn ? hm(new Date(new Date(it.data.clockIn).getTime() + 9 * 3600000).toISOString()) : "17:00");
  const [outTime, setOutTime] = useState(defaultOut);
  const [absType, setAbsType] = useState<AbsenceType>("sick");

  /** 打刻の順番が合わない（409・canForce）ときは確かめてから、force をつけてもう一度送る */
  const run = async (fn: (force?: boolean) => Promise<Response>) => {
    setBusy(true); setMsg(null);
    try {
      let res = await fn();
      if (res.status === 409) {
        const e = await res.clone().json().catch(() => ({})) as { canForce?: boolean; error?: string };
        if (e.canForce && window.confirm(`${e.error}\n\n順番が合いませんが、このまま入れますか？`)) res = await fn(true);
      }
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; setMsg(e.error ?? "できませんでした"); return; }
      done();
    } finally { setBusy(false); }
  };
  const putOut = (force?: boolean) => {
    const inHm = it.data?.clockIn ? hm(it.data.clockIn) : "00:00";
    const d = new Date(`${it.date}T${outTime}:00+09:00`);
    if (outTime < inHm) d.setTime(d.getTime() + 24 * 3600000); // 出勤より前の時刻なら翌日（夜勤）
    return post("/attendance/record", { employeeId: it.employee.id, eventType: "clock_out", recordedAt: d.toISOString(), workDate: it.date, ...(force ? { force: true } : {}) });
  };

  return (
    <div className={`rounded-lg border border-l-4 ${TONE[it.kind]} bg-card px-3 py-2.5`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold px-1.5 rounded bg-muted text-muted-foreground">{LABEL[it.kind]}</span>
            <span className="text-sm font-bold jp-tight">{it.employee.name}</span>
            <span className="text-sm">{it.title}</span>
            {it.date !== today && <span className="text-[11px] text-muted-foreground amount">{md(it.date)}の勤務</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{it.detail}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {it.employee.phone && (
            <a href={`tel:${it.employee.phone}`} title={`電話をかける（${it.employee.phone}）`}>
              <Button variant="outline" size="sm" className="h-8 gap-1"><Phone className="h-3.5 w-3.5" /><span className="hidden lg:inline amount">{it.employee.phone}</span></Button>
            </a>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => it.kind === "alcohol" ? (window.location.href = `${BASE}/attendance-records`) : onOpen(it.date, it.employee.id)}>
            <ExternalLink className="h-3.5 w-3.5" />開く
          </Button>
        </div>
      </div>
      {/* その場でできること */}
      {it.kind === "missingOut" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">退勤</span>
          <Input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className="w-28 h-8" aria-label="退勤の時刻" />
          <Button size="sm" className="h-8" disabled={busy} onClick={() => run((f) => putOut(f))}>この時刻で退勤を入れる</Button>
          <span className="text-[11px] text-muted-foreground">{it.data?.scheduleEnd ? `予定の終わり（${it.data.scheduleEnd}）` : "出勤から9時間後"}を入れてあります</span>
        </div>
      )}
      {it.kind === "noshow" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={absType} onChange={(e) => setAbsType(e.target.value as AbsenceType)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="休みの種類">
            {(["sick", "paid_leave", "paid_leave_am", "paid_leave_pm", "bereavement", "morning_half", "afternoon_half", "other"] as AbsenceType[]).map((t) => <option key={t} value={t}>{ABSENCE_LABELS[t]}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-8" disabled={busy}
            onClick={() => run(() => post("/absences", { employeeId: it.employee.id, absenceType: absType, workDate: it.date, note: null }))}>休みを入れる</Button>
          <span className="text-[11px] text-muted-foreground">遅れて来るときは、このままで大丈夫です（出勤すると消えます）</span>
        </div>
      )}
      {it.kind === "correction" && it.data?.correctionId && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" className="h-8" disabled={busy} onClick={() => run((f) => post(`/attendance/corrections/${it.data!.correctionId}/decide`, { approve: true, ...(f ? { force: true } : {}) }))}>承認して直す</Button>
          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => run(() => post(`/attendance/corrections/${it.data!.correctionId}/decide`, { approve: false }))}>見送る</Button>
        </div>
      )}
      {msg && <p className="mt-1.5 text-xs text-red-600">{msg}</p>}
    </div>
  );
}
