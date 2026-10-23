import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Pencil, Trash2, MapPin, MapPinOff, Search, Phone, LocateFixed } from "lucide-react";
import { PLACE_KIND } from "@/components/realtime-map/shared";
import { cn } from "@/lib/utils";

/**
 * 取引先マスター（荷主・現場・営業所など）。リアルタイムマップの「場所」と同じものを扱う。
 *   ・住所を入れると、国土地理院の住所検索で位置を出してリアルタイムマップに載せる
 *     （番地まで当たらないことがあるので、見つかった地名を出して確かめてもらう。ずれていたら地図で直す）
 *   ・地図に載った取引先は、スタッフが着いた時刻・出た時刻が自動で残る
 *   ・荷主はスタッフの日報（打刻ページ）の「荷主」で選べる
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export interface Partner {
  id: number; name: string; kind: string; latitude: number | null; longitude: number | null; radiusM: number;
  address: string | null; note: string | null; phone: string | null; contact: string | null; geoSource: string | null; geoLabel: string | null;
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `うまくいきませんでした（${res.status}）`);
  return body as T;
}
const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const KIND_ORDER = ["shipper", "site", "office", "other"];

interface Draft {
  id?: number; name: string; kind: string; address: string; phone: string; contact: string; note: string; radiusM: number;
  /** 住所から探した結果（保存のときに送る）。null＝まだ探していない／探し直す */
  found: { lat: number; lng: number; label: string } | null;
  /** 今の位置（編集のとき） */
  cur: { lat: number; lng: number; source: string | null; label: string | null } | null;
  addressChanged: boolean;
}

function PartnerDialog({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: (p: Partner & { located?: boolean }) => void }) {
  const { toast } = useToast();
  const [v, setV] = useState<Draft | null>(draft);
  const [finding, setFinding] = useState(false);
  const [findErr, setFindErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setV(draft); setFindErr(null); }, [draft]);
  if (!v) return null;
  const find = async () => {
    if (!v.address.trim()) return;
    setFinding(true); setFindErr(null);
    try {
      const hit = await api<{ lat: number; lng: number; label: string }>(`/map/geocode?q=${encodeURIComponent(v.address.trim())}`);
      setV({ ...v, found: hit });
    } catch (e) { setV({ ...v, found: null }); setFindErr(e instanceof Error ? e.message : "見つかりませんでした"); }
    finally { setFinding(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: v.name, kind: v.kind, address: v.address, phone: v.phone, contact: v.contact, note: v.note, radiusM: v.radiusM };
      if (v.found) Object.assign(body, { latitude: v.found.lat, longitude: v.found.lng, geoSource: "gsi", geoLabel: v.found.label });
      else if (v.id && v.addressChanged) body["locate"] = "address";
      const row = await api<Partner & { located: boolean }>(v.id ? `/map/places/${v.id}` : "/map/places", { method: v.id ? "PUT" : "POST", body: JSON.stringify(body) });
      toast({
        title: v.id ? "取引先を変えました" : "取引先を登録しました",
        description: row.located ? `${row.name}（リアルタイムマップに載せました）` : `${row.name}（住所から位置が出せなかったので、地図には載っていません）`,
      });
      onSaved(row);
    } catch (e) {
      toast({ title: "保存できませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  };
  const pos = v.found ? { label: v.found.label, src: "住所から（国土地理院）" } : !v.addressChanged && v.cur ? { label: v.cur.label ?? `${v.cur.lat.toFixed(5)}, ${v.cur.lng.toFixed(5)}`, src: v.cur.source === "manual" ? "地図で決めた位置" : "住所から（国土地理院）" } : null;
  return (
    <Dialog open={!!draft} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{v.id ? "取引先を変える" : "取引先を登録する"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <label className="block space-y-1"><span className="text-xs font-semibold">名前</span>
              <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例：〇〇運輸 小平営業所" autoFocus aria-label="取引先の名前" /></label>
            <label className="block space-y-1"><span className="text-xs font-semibold">種類</span>
              <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} className={`${sel} w-full sm:w-36`} aria-label="種類">
                {KIND_ORDER.map((k) => <option key={k} value={k}>{PLACE_KIND[k]!.label}</option>)}
              </select></label>
          </div>
          <label className="block space-y-1"><span className="text-xs font-semibold">住所</span>
            <div className="flex gap-2">
              <Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value, found: null, addressChanged: true })}
                onBlur={() => { if (v.addressChanged && v.address.trim() && !v.found) void find(); }}
                placeholder="例：東京都小平市花小金井1-13-9" aria-label="住所" />
              <Button type="button" variant="outline" className="gap-1 shrink-0" onClick={find} disabled={finding || !v.address.trim()} data-find-address="">
                <Search className="h-4 w-4" />{finding ? "探し中…" : "位置を探す"}
              </Button>
            </div></label>
          {/* 地図に載る位置（確かめてもらう） */}
          <div className={cn("rounded-md border px-3 py-2 text-xs", pos ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-muted/40 text-muted-foreground")} data-geo-result="">
            {pos ? (<><span className="font-semibold">地図の位置：</span>{pos.label}<span className="ml-1 opacity-70">（{pos.src}）</span>
              <p className="mt-0.5 opacity-80">番地まで当たらないことがあります。ずれていたら、リアルタイムマップの「場所」で位置を直せます。</p></>)
              : findErr ? <span className="text-red-600">{findErr}</span>
              : v.address.trim() ? "住所を入れたら「位置を探す」を押してください（保存のときにも自動で探します）。" : "住所を入れると、リアルタイムマップに載ります。"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1"><span className="text-xs font-semibold">電話番号</span>
              <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" placeholder="例：042-000-0000" aria-label="電話番号" /></label>
            <label className="block space-y-1"><span className="text-xs font-semibold">担当者</span>
              <Input value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} aria-label="担当者" /></label>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="block space-y-1"><span className="text-xs font-semibold">メモ</span>
              <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="例：搬入口は裏手" aria-label="メモ" /></label>
            <label className="block space-y-1"><span className="text-xs font-semibold">到着とみなす範囲</span>
              <div className="flex items-center gap-1"><Input type="number" min={30} max={2000} step={10} value={v.radiusM} onChange={(e) => setV({ ...v, radiusM: Number(e.target.value) })} className="w-24" aria-label="範囲" /><span className="text-xs text-muted-foreground">m</span></div></label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>やめる</Button>
          <Button type="button" onClick={save} disabled={saving || !v.name.trim()}>{saving ? "保存中…" : "保存する"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PartnerMasterTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useQuery<Partner[]>({ queryKey: ["map-places"], queryFn: () => api<Partner[]>("/map/places") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data ?? [])
      .filter((p) => !kind || p.kind === kind)
      .filter((p) => !s || [p.name, p.address, p.contact, p.phone].some((x) => (x ?? "").toLowerCase().includes(s)))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "ja"));
  }, [list.data, q, kind]);
  const unlocated = (list.data ?? []).filter((p) => p.latitude == null).length;
  const blank = (): Draft => ({ name: "", kind: "shipper", address: "", phone: "", contact: "", note: "", radiusM: 150, found: null, cur: null, addressChanged: false });
  const edit = (p: Partner): Draft => ({ id: p.id, name: p.name, kind: p.kind, address: p.address ?? "", phone: p.phone ?? "", contact: p.contact ?? "", note: p.note ?? "", radiusM: p.radiusM,
    found: null, cur: p.latitude != null && p.longitude != null ? { lat: p.latitude, lng: p.longitude, source: p.geoSource, label: p.geoLabel } : null, addressChanged: false });
  const del = async (p: Partner) => {
    if (!window.confirm(`「${p.name}」を消しますか？（これまでの到着・出発の記録は残ります）`)) return;
    try { await api(`/map/places/${p.id}`, { method: "DELETE" }); toast({ title: "取引先を消しました", description: p.name }); void qc.invalidateQueries({ queryKey: ["map-places"] }); }
    catch (e) { toast({ title: "消せませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />取引先マスター</CardTitle>
          <CardDescription className="mt-1">荷主・現場・営業所などを登録します。住所を入れるとリアルタイムマップに載り、スタッフが着いた時刻・出た時刻が自動で残ります。荷主は日報の「荷主」で選べます。</CardDescription>
        </div>
        <Button type="button" className="gap-1 shrink-0" onClick={() => setDraft(blank())} data-add-partner=""><Plus className="h-4 w-4" />取引先を追加</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・住所・担当者で探す" className="w-64 h-9" aria-label="取引先を探す" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={sel} aria-label="種類で絞る">
            <option value="">すべての種類</option>
            {KIND_ORDER.map((k) => <option key={k} value={k}>{PLACE_KIND[k]!.label}</option>)}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">{rows.length}件{unlocated > 0 && <span className="text-amber-700">・地図に載っていない {unlocated}件</span>}</span>
        </div>
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className="text-left px-3 py-2">名前</th><th className="text-left px-3 py-2 whitespace-nowrap">種類</th><th className="text-left px-3 py-2">住所</th><th className="text-left px-3 py-2 whitespace-nowrap">電話・担当</th><th className="text-left px-3 py-2 whitespace-nowrap">地図</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const k = PLACE_KIND[p.kind] ?? PLACE_KIND["other"]!;
                return (
                  <tr key={p.id} className="border-t align-top" data-partner-id={p.id}>
                    <td className="px-3 py-2 font-semibold">{p.name}{p.note && <p className="text-[11px] font-normal text-muted-foreground">{p.note}</p>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: k.color }} />{k.label}</span></td>
                    <td className="px-3 py-2 text-xs">{p.address ?? <span className="text-muted-foreground">（住所なし）</span>}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-1 text-primary hover:underline"><Phone className="h-3 w-3" />{p.phone}</a>}
                      {p.contact && <span className="text-muted-foreground">{p.contact}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {p.latitude != null
                        ? <a href={`/realtime-map?place=${p.id}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline" title={p.geoLabel ?? ""} data-on-map=""><MapPin className="h-3.5 w-3.5" />地図で見る</a>
                        : <span className="inline-flex items-center gap-1 text-amber-700" title="住所から位置が出せませんでした。住所を直すか、リアルタイムマップの「場所」で位置を決めてください。"><MapPinOff className="h-3.5 w-3.5" />位置なし</span>}
                      {p.geoSource === "manual" && <span className="block text-[10px] text-muted-foreground flex items-center gap-0.5"><LocateFixed className="h-2.5 w-2.5" />地図で決めた位置</span>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="変える" onClick={() => setDraft(edit(p))}><Pencil className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="消す" onClick={() => del(p)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                );
              })}
              {!list.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{(list.data ?? []).length ? "条件に合う取引先はありません" : "まだ取引先はありません。「取引先を追加」から登録してください。"}</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
      <PartnerDialog draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); void qc.invalidateQueries({ queryKey: ["map-places"] }); }} />
    </Card>
  );
}
