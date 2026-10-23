import { useState, useEffect, useMemo, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { RefreshCw, MapPin, Users, Crosshair, Settings2, Tag, Layers, Route as RouteIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  EmployeeLocation,
  EventLocation,
  FlyToTarget,
  MapEventLocation,
  Track,
  MonthDistance,
  Place,
  formatTime,
  filterLocations,
  distM,
} from "@/components/realtime-map/shared";
import { EmployeePanel, EmployeePanelProps, STATUS_FILTERS, matchStatus } from "@/components/realtime-map/employee-panel";
import { MapView, PickMode, Nearest } from "@/components/realtime-map/map-view";
import { TrackPanel, PlacesPanel, VisitsPanel, PlaceDialog, PlaceDraft, NearestCard, MapSettingsDialog, mapApi, todayJst } from "@/components/realtime-map/map-panels";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tab = "people" | "track" | "places" | "visits";
const TABS: Array<[Tab, string]> = [["people", "社員"], ["track", "道すじ"], ["places", "場所"], ["visits", "到着・出発"]];

/**
 * リアルタイムマップ（全幅マスターディテール型）。
 * 左: 切り替え（社員・道すじ・場所・到着と出発）、右: Leaflet 地図。
 *   ・社員：いまの位置（10秒ごと）・状態で絞り込み・位置が届かない人を赤く・名前と「◯分前」の札・メッセージ／電話
 *   ・道すじ：社員と日付を選ぶと、その日の移動の線・止まっていたところ・走行距離の目安（月次実績と見比べ）
 *   ・場所：現場・営業所・荷主を登録すると、円の中に入った／出た時刻が自動で残る
 *   ・到着・出発：その日の全員分
 *   ・近い人を探す：地図を押すと、そこから近い勤務中の人を順に出す
 */
export default function RealtimeMapPage() {
  const { toast } = useToast();
  const [locations, setLocations] = useState<EmployeeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());
  const [flyTarget, setFlyTarget] = useState<FlyToTarget | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("people");
  const [statusFilter, setStatusFilter] = useState<string>("すべて");
  const [showLabels, setShowLabels] = useState(() => { try { return localStorage.getItem("mk_map_labels") !== "0"; } catch { return true; } });
  const [showPlaces, setShowPlaces] = useState(true);
  const [places, setPlaces] = useState<Place[]>([]);
  const [pickMode, setPickMode] = useState<PickMode>("none");
  const [nearest, setNearest] = useState<Nearest | null>(null);
  const [placeDraft, setPlaceDraft] = useState<PlaceDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [retentionDays, setRetentionDays] = useState(60);
  // 道すじ
  const [trackEmp, setTrackEmp] = useState<number | null>(null);
  const [trackDate, setTrackDate] = useState(todayJst());
  const [track, setTrack] = useState<Track | null>(null);
  const [month, setMonth] = useState<MonthDistance | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [visitsDate, setVisitsDate] = useState(todayJst());

  const fetchLocations = async () => {
    try {
      const res = await fetch(`${BASE}/api/attendance/location/live`);
      if (!res.ok) throw new Error("fetch error");
      const data: EmployeeLocation[] = await res.json();
      setLocations(data);
      setLastUpdated(new Date());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };
  const fetchPlaces = useCallback(async () => {
    try { setPlaces(await mapApi<Place[]>("/map/places")); } catch { /* 地図は出す */ }
  }, []);
  const fetchSettings = useCallback(async () => {
    try { const s = await mapApi<{ mapRetentionDays?: number }>("/attendance/settings"); setRetentionDays(Number(s.mapRetentionDays ?? 60)); } catch { /* 既定のまま */ }
  }, []);

  useEffect(() => {
    fetchLocations();
    fetchPlaces();
    fetchSettings();
    const interval = setInterval(fetchLocations, 10000);
    return () => clearInterval(interval);
  }, [fetchPlaces, fetchSettings]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── 道すじの読み込み（社員と日付が決まったら。今日なら1分ごとに伸ばす） ──
  useEffect(() => {
    if (!trackEmp) { setTrack(null); setMonth(null); return; }
    let off = false;
    const load = async (first: boolean) => {
      if (first) setTrackLoading(true);
      try {
        const [t, m] = await Promise.all([
          mapApi<Track>(`/map/track?employeeId=${trackEmp}&date=${trackDate}`),
          first ? mapApi<MonthDistance>(`/map/track/month?employeeId=${trackEmp}&ym=${trackDate.slice(0, 7)}`) : Promise.resolve(null),
        ]);
        if (off) return;
        setTrack(t);
        if (m) setMonth(m);
      } catch (e) {
        if (!off && first) toast({ title: "道すじを読み込めませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" });
      } finally { if (!off && first) setTrackLoading(false); }
    };
    void load(true);
    const iv = trackDate === todayJst() ? setInterval(() => void load(false), 60_000) : null;
    return () => { off = true; if (iv) clearInterval(iv); };
  }, [trackEmp, trackDate, toast]);

  // 地図と一覧は状態で絞り込み、一覧はさらに検索で絞る
  const visible = useMemo(() => locations.filter((l) => matchStatus(l, statusFilter)), [locations, statusFilter]);
  const withGps = useMemo(() => visible.filter((l) => l.latitude != null && l.longitude != null), [visible]);
  const withoutGps = useMemo(() => visible.filter((l) => l.latitude == null), [visible]);
  const filteredWithGps = useMemo(() => filterLocations(withGps, search), [withGps, search]);
  const filteredWithoutGps = useMemo(() => filterLocations(withoutGps, search), [withoutGps, search]);
  const counts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map((f) => [f, locations.filter((l) => matchStatus(l, f)).length])), [locations]);

  const defaultCenter: [number, number] = [35.681236, 139.767125];

  const elapsedLabel = (gpsTime: string | null): string => {
    if (!gpsTime) return "";
    const diff = now.getTime() - new Date(gpsTime).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min}分前`;
    const h = Math.floor(min / 60);
    return `${h}時間${min % 60}分前`;
  };

  const handleEmpClick = (emp: EmployeeLocation) => {
    if (emp.latitude == null || emp.longitude == null) return;
    setSelectedId(emp.employeeId);
    setFlyTarget({ lat: emp.latitude, lng: emp.longitude, seq: Date.now() });
    setMobileListOpen(false);
  };

  const openTrack = (emp: EmployeeLocation) => {
    setTrackEmp(emp.employeeId);
    setTrackDate(todayJst());
    setTab("track");
    setSelectedId(emp.employeeId);
    setMobileListOpen(true);
  };

  // 勤怠管理から ?emp=社員ID で来たら、最初に読み込めたときにその人へ寄せる（1回だけ）
  const [focusDone, setFocusDone] = useState(false);
  useEffect(() => {
    if (focusDone || locations.length === 0) return;
    const id = Number(new URLSearchParams(window.location.search).get("emp"));
    setFocusDone(true);
    if (!id) return;
    const emp = locations.find((l) => l.employeeId === id);
    if (!emp) return;
    setSelectedId(emp.employeeId);
    const ev = (emp.eventLocations ?? [])[0];
    if (emp.latitude != null && emp.longitude != null) setFlyTarget({ lat: emp.latitude, lng: emp.longitude, seq: Date.now() });
    else if (ev) setFlyTarget({ lat: ev.latitude, lng: ev.longitude, seq: Date.now() });
    else setSearch(emp.name);
  }, [locations, focusDone]);

  const handleEventClick = (ev: EventLocation) => {
    setFlyTarget({ lat: ev.latitude, lng: ev.longitude, seq: Date.now() });
    setMobileListOpen(false);
  };

  const handleSelectGpslessEmp = (emp: EmployeeLocation) => {
    const evs = emp.eventLocations ?? [];
    if (evs.length === 0) return;
    setSelectedId(emp.employeeId);
    setFlyTarget({ lat: evs[0].latitude, lng: evs[0].longitude, seq: Date.now() });
    setMobileListOpen(false);
  };

  // 地図を押したとき（近い人を探す／場所を登録）
  const handlePick = (lat: number, lng: number) => {
    if (pickMode === "nearest") {
      const list = locations
        .filter((l) => l.latitude != null && l.longitude != null && (l.status === "出勤中" || l.status === "休憩中"))
        .map((emp) => ({ emp, m: distM(lat, lng, emp.latitude!, emp.longitude!) }))
        .sort((a, b) => a.m - b.m);
      setNearest({ origin: { lat, lng }, list });
    } else if (pickMode === "place") {
      setPickMode("none");
      setPlaceDraft({ name: "", kind: "site", latitude: lat, longitude: lng, radiusM: 150, address: "", note: "" });
    }
  };
  const toggleNearest = () => {
    if (pickMode === "nearest") { setPickMode("none"); setNearest(null); return; }
    setPickMode("nearest"); setNearest(null);
  };

  const deletePlace = async (p: Place) => {
    if (!window.confirm(`「${p.name}」を消しますか？（これまでの到着・出発の記録は残ります）`)) return;
    try { await mapApi(`/map/places/${p.id}`, { method: "DELETE" }); toast({ title: "場所を消しました", description: p.name }); void fetchPlaces(); }
    catch (e) { toast({ title: "消せませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
  };

  // 地図に表示する全員の全打刻イベント（道すじを見ている間は、その人の分だけ）
  const allEventLocations: MapEventLocation[] = useMemo(
    () =>
      visible
        .filter((emp) => !(tab === "track" && trackEmp) || emp.employeeId === trackEmp)
        .flatMap((emp) =>
          (emp.eventLocations ?? []).map((ev) => ({ ...ev, name: emp.name, employeeId: emp.employeeId }))
        ),
    [visible, tab, trackEmp]
  );
  const mapPeople = tab === "track" && trackEmp ? withGps.filter((e) => e.employeeId === trackEmp) : withGps;

  const hasAnyData = locations.length > 0;
  const liveCount = withGps.length;

  const panelProps: EmployeePanelProps = {
    withGps: filteredWithGps,
    withoutGps: filteredWithoutGps,
    selectedId,
    loading,
    hasAnyData,
    elapsedLabel,
    onEmpClick: handleEmpClick,
    onEventClick: handleEventClick,
    onSelectGpslessEmp: handleSelectGpslessEmp,
    lastUpdated,
    onRefresh: fetchLocations,
    search,
    onSearchChange: setSearch,
    statusFilter,
    onStatusFilter: setStatusFilter,
    counts,
    onOpenTrack: openTrack,
  };

  const sidePanel = (showHeader: boolean) => (
    <div className="flex flex-col h-full min-h-0">
      <div className="grid grid-cols-4 gap-1 p-1.5 border-b bg-muted/40 shrink-0" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-map-tab={k} onClick={() => setTab(k)}
            className={cn("h-8 rounded-md text-xs font-semibold", tab === k ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "people" && <EmployeePanel {...panelProps} showHeader={showHeader} />}
      {tab === "track" && (
        <TrackPanel employees={locations} employeeId={trackEmp} date={trackDate}
          onChange={(e, d) => { setTrackEmp(e); setTrackDate(d); }} track={track} month={month} loading={trackLoading} retentionDays={retentionDays} />
      )}
      {tab === "places" && (
        <PlacesPanel places={places} picking={pickMode === "place"}
          onAddByMap={() => { setPickMode(pickMode === "place" ? "none" : "place"); setNearest(null); setMobileListOpen(false); }}
          onEdit={(p) => setPlaceDraft({ id: p.id, name: p.name, kind: p.kind, latitude: p.latitude, longitude: p.longitude, radiusM: p.radiusM, address: p.address ?? "", note: p.note ?? "" })}
          onDelete={deletePlace}
          onFocus={(p) => { setShowPlaces(true); setFlyTarget({ lat: p.latitude, lng: p.longitude, seq: Date.now() }); setMobileListOpen(false); }} />
      )}
      {tab === "visits" && <VisitsPanel date={visitsDate} onDate={setVisitsDate} />}
    </div>
  );

  const chip = (on: boolean) => cn("h-8 px-2.5 rounded-lg text-xs font-semibold border shadow-sm flex items-center gap-1 pointer-events-auto backdrop-blur-sm",
    on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white/95 text-slate-700 border-slate-200 hover:bg-white");

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        <div className="flex-1 min-h-0 flex md:gap-4">
          {/* ── デスクトップ 左パネル ── */}
          <div className="hidden md:flex w-80 lg:w-96 shrink-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden">
            {sidePanel(true)}
          </div>

          {/* ── 地図パネル ── */}
          <div className="mk-map flex-1 relative min-h-0 rounded-xl border bg-card overflow-hidden">
            {mapPeople.length === 0 && allEventLocations.length === 0 && !track?.points.length && places.length === 0 && !loading && (
              <div className="absolute inset-0 z-[800] flex flex-col items-center justify-center bg-background/80 pointer-events-none px-6 text-center">
                <MapPin className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-muted-foreground font-medium text-sm">GPS情報を持つ打刻がありません</p>
                <p className="text-muted-foreground/60 text-xs mt-1">従業員が出退勤を記録するとここに表示されます</p>
              </div>
            )}

            {/* 地図の上の道具（近い人・場所・名前・設定）。スマホではタイトルの下に並ぶ */}
            <div className="absolute top-2 right-2 left-14 md:left-auto z-[820] flex flex-wrap justify-end gap-1.5 pointer-events-none max-md:top-14">
              <button type="button" className={chip(pickMode === "nearest")} onClick={toggleNearest} data-map-tool="nearest">
                <Crosshair className="h-3.5 w-3.5" />近い人を探す
              </button>
              <button type="button" className={chip(showPlaces)} onClick={() => setShowPlaces(!showPlaces)} data-map-tool="places" title="登録した場所の円を出す／消す">
                <Layers className="h-3.5 w-3.5" />場所
              </button>
              <button type="button" className={chip(showLabels)} data-map-tool="labels" title="名前と「◯分前」の札を出す／消す"
                onClick={() => { const v = !showLabels; setShowLabels(v); try { localStorage.setItem("mk_map_labels", v ? "1" : "0"); } catch { /* 覚えなくても動く */ } }}>
                <Tag className="h-3.5 w-3.5" />名前
              </button>
              <button type="button" className={chip(false)} onClick={() => setSettingsOpen(true)} data-map-tool="settings" title="地図の設定">
                <Settings2 className="h-3.5 w-3.5" /><span className="max-sm:hidden">設定</span>
              </button>
            </div>
            {pickMode === "place" && (
              <div className="absolute bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-[820] rounded-full bg-indigo-600 text-white text-xs font-semibold px-4 py-2 shadow-lg flex items-center gap-2">
                登録する場所を地図で押してください
                <button type="button" onClick={() => setPickMode("none")} aria-label="やめる"><X className="h-4 w-4" /></button>
              </div>
            )}
            {tab === "track" && trackEmp && track && (
              <div className="absolute bottom-16 md:bottom-4 left-3 z-[820] rounded-lg bg-white/95 border shadow-md px-3 py-1.5 text-xs flex items-center gap-2">
                <RouteIcon className="h-3.5 w-3.5 text-indigo-600" />
                <span className="font-semibold">{locations.find((l) => l.employeeId === trackEmp)?.name}</span>
                <span className="amount">{track.date}・{track.distanceKm.toFixed(1)}km</span>
                <button type="button" onClick={() => setTrackEmp(null)} className="text-muted-foreground hover:text-foreground" aria-label="道すじを消す"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            {pickMode === "nearest" && (
              <NearestCard nearest={nearest} onClose={() => { setPickMode("none"); setNearest(null); }}
                onPick={(emp) => { setSelectedId(emp.employeeId); setFlyTarget({ lat: emp.latitude!, lng: emp.longitude!, seq: Date.now() }); }} />
            )}

            {/* モバイル：地図上の上部バー（タイトル + 更新時刻） */}
            <div className="md:hidden absolute top-2 left-2 right-2 z-[800] flex items-center gap-2 pointer-events-none">
              <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-slate-200 px-3 py-2 flex items-center gap-2 pointer-events-auto">
                <MapPin className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                <div className="leading-tight min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate jp-tight">リアルタイムマップ</p>
                  {lastUpdated && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      更新: <span className="amount">{formatTime(lastUpdated.toISOString())}</span>
                    </p>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 p-0 bg-white/95 backdrop-blur-sm shadow-md pointer-events-auto shrink-0"
                onClick={fetchLocations}
                disabled={loading}
                title="更新"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {/* モバイル：リスト表示ボタン（地図右下） */}
            <button
              type="button"
              onClick={() => setMobileListOpen(true)}
              className="md:hidden absolute right-3 bottom-3 z-[800] flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 active:scale-95 transition-all border-2 border-white"
            >
              <Users className="h-4 w-4" />
              社員リスト
              {liveCount > 0 && (
                <span className="bg-white/20 text-white text-xs font-bold px-1.5 py-0.5 rounded-full amount">{liveCount}</span>
              )}
            </button>

            <MapView
              withGps={mapPeople}
              allEventLocations={allEventLocations}
              flyTarget={flyTarget}
              center={defaultCenter}
              places={places}
              showPlaces={showPlaces}
              track={tab === "track" || trackEmp ? track : null}
              nearest={pickMode === "nearest" ? nearest : null}
              pickMode={pickMode}
              onPick={handlePick}
              showLabels={showLabels}
              now={now.getTime()}
              onOpenTrack={openTrack}
            />
          </div>
        </div>
      </div>

      {/* ── モバイル ボトムシート（社員リスト）── */}
      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent side="bottom" className="md:hidden p-0 h-[85dvh] rounded-t-2xl flex flex-col gap-0">
          <SheetHeader className="px-4 py-3 pr-12 border-b shrink-0 flex-row items-center justify-between space-y-0 gap-3">
            <div className="text-left min-w-0">
              <SheetTitle className="text-base jp-tight">リアルタイムマップ</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                {lastUpdated ? `更新: ${formatTime(lastUpdated.toISOString())}` : "読み込み中..."}
              </SheetDescription>
            </div>
            <Button size="sm" variant="outline" className="h-8 px-2 gap-1 text-xs shrink-0" onClick={fetchLocations} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              更新
            </Button>
          </SheetHeader>
          <div className="flex-1 min-h-0 flex flex-col">
            {sidePanel(false)}
          </div>
        </SheetContent>
      </Sheet>

      <PlaceDialog draft={placeDraft} onClose={() => setPlaceDraft(null)} onSaved={() => { setPlaceDraft(null); void fetchPlaces(); }} />
      <MapSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => { void fetchSettings(); void fetchLocations(); }} />
    </AppLayout>
  );
}
