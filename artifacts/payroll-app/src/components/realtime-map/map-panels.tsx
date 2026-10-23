import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Route, MapPin, Plus, Pencil, Trash2, Clock, X, Crosshair } from "lucide-react";
import {
  EmployeeLocation, Track, MonthDistance, Place, Visit, PLACE_KIND, EVENT_CONFIG, formatTime, kmText,
} from "./shared";
import type { Nearest } from "./map-view";

/**
 * リアルタイムマップの左側の切り替え（社員・道すじ・場所・到着と出発）と、地図の設定。
 * 地図に何を描くかはページ（pages/realtime-map.tsx）が持ち、ここは表示と入力だけ。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `うまくいきませんでした（${res.status}）`);
  return body as T;
}

/* ── 道すじ ─────────────────────────────────────────── */
export function TrackPanel({
  employees, employeeId, date, onChange, track, month, loading, retentionDays,
}: {
  employees: EmployeeLocation[];
  employeeId: number | null;
  date: string;
  onChange: (employeeId: number | null, date: string) => void;
  track: Track | null;
  month: MonthDistance | null;
  loading: boolean;
  retentionDays: number;
}) {
  const minDate = addDays(todayJst(), -retentionDays);
  const firstIn = track?.events.find((e) => e.eventType === "clock_in");
  const lastOut = track ? [...track.events].reverse().find((e) => e.eventType === "clock_out") : null;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-panel="track">
      <div className="space-y-2">
        <select value={employeeId ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, date)} className={`${sel} w-full`} aria-label="社員">
          <option value="">社員を選ぶ</option>
          {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.employeeCode} {e.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-9 px-2" onClick={() => onChange(employeeId, addDays(date, -1))} disabled={date <= minDate} aria-label="前の日">‹</Button>
          <input type="date" value={date} min={minDate} max={todayJst()} onChange={(e) => e.target.value && onChange(employeeId, e.target.value)} className={`${sel} flex-1`} aria-label="日付" />
          <Button type="button" size="sm" variant="outline" className="h-9 px-2" onClick={() => onChange(employeeId, addDays(date, 1))} disabled={date >= todayJst()} aria-label="次の日">›</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">位置の記録は{retentionDays}日分残しています（それより前は消えます）。</p>
      </div>

      {!employeeId && <p className="text-sm text-muted-foreground py-6 text-center">社員を選ぶと、その日の道すじを地図に出します。</p>}
      {employeeId && loading && <p className="text-sm text-muted-foreground py-6 text-center">読み込み中…</p>}
      {employeeId && !loading && track && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-2.5">
              <p className="text-[11px] text-muted-foreground">この日の走行距離（目安）</p>
              <p className="text-xl font-bold amount" data-track-km="">{track.distanceKm.toFixed(1)}<span className="text-xs font-normal ml-0.5">km</span></p>
            </div>
            <div className="rounded-lg border p-2.5">
              <p className="text-[11px] text-muted-foreground">勤務</p>
              <p className="text-sm font-semibold amount">{firstIn ? formatTime(firstIn.recordedAt) : "--:--"}〜{lastOut ? formatTime(lastOut.recordedAt) : "（勤務中）"}</p>
            </div>
          </div>
          {month && (
            <div className="rounded-lg border p-2.5 text-xs space-y-1" data-month-km="">
              <p className="font-semibold">{Number(month.ym.slice(5))}月の走行距離</p>
              <div className="flex justify-between"><span className="text-muted-foreground">位置から出した目安（{month.days.length}日分）</span><span className="amount font-semibold">{month.totalKm.toFixed(1)}km</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">月次実績に入っている距離</span><span className="amount font-semibold">{month.monthlyRecordKm != null ? `${month.monthlyRecordKm}km` : "未入力"}</span></div>
              {month.monthlyRecordKm != null && month.totalKm > 0 && Math.abs(month.monthlyRecordKm - month.totalKm) / Math.max(month.totalKm, 1) > 0.3 && (
                <p className="text-amber-700">3割以上ちがいます。月次実績の入力か、位置が届かなかった日がないか確かめてください。</p>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground leading-relaxed">距離は届いた位置と位置の直線距離の合計（目安）です。道なりの距離より少し短く出ます。位置が届かなかった間は数えられません。</p>
          {track.points.length === 0 && <p className="text-sm text-muted-foreground py-3 text-center">この日の位置の記録はありません。</p>}

          {track.visits.length > 0 && (
            <section>
              <h4 className="text-xs font-bold text-muted-foreground mb-1">場所への到着・出発</h4>
              <ul className="space-y-1">
                {track.visits.map((v) => (
                  <li key={v.id} className="text-xs flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <MapPin className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                    <span className="font-semibold truncate flex-1">{v.placeName}</span>
                    <span className="amount">{formatTime(v.arrivedAt)}〜{v.leftAt ? formatTime(v.leftAt) : "いる"}</span>
                    <span className="text-muted-foreground amount w-12 text-right">{v.minutes}分</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {track.stops.length > 0 && (
            <section>
              <h4 className="text-xs font-bold text-muted-foreground mb-1">止まっていたところ（地図の黄色い丸）</h4>
              <ul className="space-y-1">
                {track.stops.map((s, i) => (
                  <li key={i} className="text-xs flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span className="amount">{formatTime(s.from)}〜{formatTime(s.to)}</span>
                    <span className="truncate flex-1 text-muted-foreground">{s.place ?? "登録していない場所"}</span>
                    <span className="amount font-semibold">{s.minutes}分</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {track.events.length > 0 && (
            <section>
              <h4 className="text-xs font-bold text-muted-foreground mb-1">打刻</h4>
              <ul className="flex flex-wrap gap-1.5">
                {track.events.map((e, i) => (
                  <li key={i} className="text-[11px] rounded-full border px-2 py-0.5" style={{ color: EVENT_CONFIG[e.eventType].color }}>
                    {EVENT_CONFIG[e.eventType].label} <span className="amount">{formatTime(e.recordedAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ── よく行く場所 ───────────────────────────────────── */
export function PlacesPanel({
  places, onAddByMap, onEdit, onDelete, onFocus, picking,
}: {
  places: Place[];
  onAddByMap: () => void;
  onEdit: (p: Place) => void;
  onDelete: (p: Place) => void;
  onFocus: (p: Place) => void;
  picking: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-panel="places">
      <div className="rounded-lg bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
        現場・営業所・荷主などを登録しておくと、スタッフが円の中に入った時刻（到着）と出た時刻（出発）が自動で残ります。日報の確認に使えます。
      </div>
      <Button type="button" className="w-full gap-1.5" variant={picking ? "secondary" : "default"} onClick={onAddByMap} data-add-place="">
        {picking ? <><Crosshair className="h-4 w-4" />地図で場所を押してください（もう一度押すとやめる）</> : <><Plus className="h-4 w-4" />地図を押して場所を登録する</>}
      </Button>
      {places.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">まだ登録した場所はありません。</p>}
      <ul className="space-y-1.5">
        {places.map((p) => {
          const k = PLACE_KIND[p.kind] ?? PLACE_KIND["other"]!;
          return (
            <li key={p.id} className="rounded-lg border p-2.5 flex items-start gap-2" data-place-id={p.id}>
              <span className="mt-1 h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: k.color }} />
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onFocus(p)}>
                <p className="text-sm font-semibold truncate">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{k.label}・半径{p.radiusM}m{p.address ? `・${p.address}` : ""}</p>
              </button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="変える" onClick={() => onEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="消す" onClick={() => onDelete(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface PlaceDraft { id?: number; name: string; kind: string; latitude: number; longitude: number; radiusM: number; address: string; note: string }
export function PlaceDialog({ draft, onClose, onSaved }: { draft: PlaceDraft | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [v, setV] = useState<PlaceDraft | null>(draft);
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(draft), [draft]);
  if (!v) return null;
  const save = async () => {
    setSaving(true);
    try {
      await api(v.id ? `/map/places/${v.id}` : "/map/places", { method: v.id ? "PUT" : "POST", body: JSON.stringify(v) });
      toast({ title: v.id ? "場所を変えました" : "場所を登録しました", description: v.name });
      onSaved();
    } catch (e) {
      toast({ title: "保存できませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={!!draft} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{v.id ? "場所を変える" : "場所を登録する"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1"><span className="text-xs font-semibold">名前</span>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例：〇〇建設 第2現場" autoFocus aria-label="場所の名前" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1"><span className="text-xs font-semibold">種類</span>
              <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} className={`${sel} w-full`} aria-label="種類">
                {Object.entries(PLACE_KIND).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
              </select></label>
            <label className="block space-y-1"><span className="text-xs font-semibold">範囲（半径 m）</span>
              <Input type="number" min={30} max={2000} step={10} value={v.radiusM} onChange={(e) => setV({ ...v, radiusM: Number(e.target.value) })} aria-label="範囲" /></label>
          </div>
          <label className="block space-y-1"><span className="text-xs font-semibold">住所・目印（任意）</span>
            <Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
          <label className="block space-y-1"><span className="text-xs font-semibold">メモ（任意）</span>
            <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
          <p className="text-[11px] text-muted-foreground">位置：{v.latitude.toFixed(5)}, {v.longitude.toFixed(5)}（{v.id ? "位置を変えるときは、消して登録し直してください" : "地図で押したところ"}）。広い現場は範囲を大きくしてください。</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>やめる</Button>
          <Button type="button" onClick={save} disabled={saving || !v.name.trim()}>{saving ? "保存中…" : "保存する"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── その日の全員の到着・出発 ───────────────────────── */
export function VisitsPanel({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const [rows, setRows] = useState<Visit[] | null>(null);
  useEffect(() => {
    let off = false;
    setRows(null);
    api<Visit[]>(`/map/visits?date=${date}`).then((r) => { if (!off) setRows(r); }).catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [date]);
  const byEmp = new Map<string, Visit[]>();
  for (const v of rows ?? []) { const k = v.employeeName ?? "（不明）"; if (!byEmp.has(k)) byEmp.set(k, []); byEmp.get(k)!.push(v); }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-panel="visits">
      <input type="date" value={date} max={todayJst()} onChange={(e) => e.target.value && onDate(e.target.value)} className={`${sel} w-full`} aria-label="日付" />
      {rows === null && <p className="text-sm text-muted-foreground text-center py-4">読み込み中…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">この日の到着・出発の記録はありません。<br /><span className="text-xs">「場所」で現場などを登録すると残るようになります。</span></p>}
      {[...byEmp.entries()].map(([name, vs]) => (
        <section key={name} className="rounded-lg border">
          <h4 className="text-xs font-bold px-2.5 py-1.5 border-b bg-muted/40">{name}</h4>
          <ul className="divide-y">
            {[...vs].reverse().map((v) => (
              <li key={v.id} className="text-xs flex items-center gap-2 px-2.5 py-1.5">
                <span className="font-semibold truncate flex-1">{v.placeName}</span>
                <span className="amount">到着 {formatTime(v.arrivedAt)}</span>
                <span className="amount w-16 text-right">{v.leftAt ? `出発 ${formatTime(v.leftAt)}` : "いる"}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ── 近い人（地図の上に出す） ───────────────────────── */
export function NearestCard({ nearest, onPick, onClose }: { nearest: Nearest | null; onPick: (e: EmployeeLocation) => void; onClose: () => void }) {
  return (
    <div className="absolute left-3 top-14 z-[850] w-72 max-w-[calc(100%-1.5rem)] rounded-xl border bg-white/95 dark:bg-slate-900/95 shadow-xl" data-nearest="">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <p className="text-sm font-bold">近い人</p>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted" aria-label="閉じる"><X className="h-4 w-4" /></button>
      </div>
      {!nearest && <p className="px-3 py-3 text-xs text-muted-foreground">地図で場所を押すと、そこから近いスタッフ（勤務中）を順に出します。</p>}
      {nearest && nearest.list.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">位置が分かる勤務中のスタッフがいません。</p>}
      {nearest && nearest.list.length > 0 && (
        <ol className="max-h-72 overflow-y-auto divide-y">
          {nearest.list.map(({ emp, m }, i) => (
            <li key={emp.employeeId}>
              <button type="button" onClick={() => onPick(emp)} className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/60" data-nearest-row="">
                <span className="w-5 text-xs font-bold text-muted-foreground amount">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{emp.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{emp.status}{emp.stale ? "・位置が古い" : ""}</span>
                </span>
                <span className="text-sm font-bold amount">{kmText(m)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="px-3 py-1.5 border-t text-[10px] text-muted-foreground">直線距離です（道のりではありません）。</p>
    </div>
  );
}

/* ── 地図の設定 ─────────────────────────────────────── */
interface MapSettings { mapTrackOnlyOnDuty: boolean; mapStaleMinutes: number; mapLongStopMinutes: number; mapRetentionDays: number }
export function MapSettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [all, setAll] = useState<Record<string, unknown> | null>(null);
  const [v, setV] = useState<MapSettings | null>(null);
  useEffect(() => {
    if (!open) return;
    api<Record<string, unknown>>("/attendance/settings").then((s) => {
      setAll(s);
      setV({ mapTrackOnlyOnDuty: s["mapTrackOnlyOnDuty"] !== false, mapStaleMinutes: Number(s["mapStaleMinutes"] ?? 10), mapLongStopMinutes: Number(s["mapLongStopMinutes"] ?? 30), mapRetentionDays: Number(s["mapRetentionDays"] ?? 60) });
    }).catch(() => toast({ title: "設定を読み込めませんでした", variant: "destructive" }));
  }, [open, toast]);
  const save = async () => {
    if (!all || !v) return;
    try {
      await api("/attendance/settings", { method: "PUT", body: JSON.stringify({ ...all, ...v }) });
      toast({ title: "地図の設定を保存しました" });
      onSaved(); onClose();
    } catch (e) { toast({ title: "保存できませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>地図の設定</DialogTitle></DialogHeader>
        {!v ? <p className="text-sm text-muted-foreground">読み込み中…</p> : (
          <div className="space-y-4 text-sm">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={v.mapTrackOnlyOnDuty} onChange={(e) => setV({ ...v, mapTrackOnlyOnDuty: e.target.checked })} aria-label="勤務中だけ" />
              <span><span className="font-semibold">勤務中（出勤〜退勤）だけ位置を残す・見せる</span><br /><span className="text-xs text-muted-foreground">退勤したあとや休みの日の位置は、残さず地図にも出しません（スタッフの安心のため。おすすめ）。</span></span>
            </label>
            <label className="block space-y-1"><span className="font-semibold">位置が届かないと知らせるまでの分数</span>
              <Input type="number" min={3} max={120} value={v.mapStaleMinutes} onChange={(e) => setV({ ...v, mapStaleMinutes: Number(e.target.value) })} aria-label="届かない分数" />
              <span className="text-xs text-muted-foreground">勤務中なのに、この分数より長く位置が届かない人を赤く出し、右上のベルで知らせます。</span></label>
            <label className="block space-y-1"><span className="font-semibold">長く止まっていると知らせるまでの分数</span>
              <Input type="number" min={0} max={480} value={v.mapLongStopMinutes} onChange={(e) => setV({ ...v, mapLongStopMinutes: Number(e.target.value) })} aria-label="止まっている分数" />
              <span className="text-xs text-muted-foreground">登録した場所の外で、この分数より長く止まっていたら知らせます（0＝知らせない）。</span></label>
            <label className="block space-y-1"><span className="font-semibold">位置の記録を残す日数</span>
              <Input type="number" min={7} max={400} value={v.mapRetentionDays} onChange={(e) => setV({ ...v, mapRetentionDays: Number(e.target.value) })} aria-label="残す日数" />
              <span className="text-xs text-muted-foreground">これより古い道すじは自動で消します（個人の情報なので、必要な日数だけ残すのがおすすめ）。場所への到着・出発の記録は消しません。</span></label>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>やめる</Button>
          <Button type="button" onClick={save} disabled={!v}>保存する</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { api as mapApi, Route };
