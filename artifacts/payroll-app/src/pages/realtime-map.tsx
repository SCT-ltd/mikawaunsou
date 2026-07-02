import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { RefreshCw, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  EmployeeLocation,
  EventLocation,
  FlyToTarget,
  MapEventLocation,
  formatTime,
  filterLocations,
} from "@/components/realtime-map/shared";
import { EmployeePanel, EmployeePanelProps } from "@/components/realtime-map/employee-panel";
import { MapView } from "@/components/realtime-map/map-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * リアルタイムマップ（全幅マスターディテール型）。
 * 左: 社員リスト（GPS取得済み/未取得・打刻地点・検索）、右: Leaflet 地図。
 * 10秒ポーリング・fly-to・fit-bounds・マーカー等のロジックは旧実装から変更なし。
 */
export default function RealtimeMapPage() {
  const [locations, setLocations] = useState<EmployeeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());
  const [flyTarget, setFlyTarget] = useState<FlyToTarget | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [search, setSearch] = useState("");

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

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 地図は全件、リストは検索でフィルタ
  const withGps = useMemo(() => locations.filter((l) => l.latitude != null && l.longitude != null), [locations]);
  const withoutGps = useMemo(() => locations.filter((l) => l.latitude == null), [locations]);
  const filteredWithGps = useMemo(() => filterLocations(withGps, search), [withGps, search]);
  const filteredWithoutGps = useMemo(() => filterLocations(withoutGps, search), [withoutGps, search]);

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

  // 地図に表示する全員の全打刻イベント
  const allEventLocations: MapEventLocation[] = useMemo(
    () =>
      locations.flatMap((emp) =>
        (emp.eventLocations ?? []).map((ev) => ({ ...ev, name: emp.name, employeeId: emp.employeeId }))
      ),
    [locations]
  );

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
  };

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        <div className="flex-1 min-h-0 flex md:gap-4">
          {/* ── デスクトップ 左パネル ── */}
          <div className="hidden md:flex w-80 lg:w-96 shrink-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden">
            <EmployeePanel {...panelProps} />
          </div>

          {/* ── 地図パネル ── */}
          <div className="flex-1 relative min-h-0 rounded-xl border bg-card overflow-hidden">
            {withGps.length === 0 && allEventLocations.length === 0 && !loading && (
              <div className="absolute inset-0 z-[800] flex flex-col items-center justify-center bg-background/80 pointer-events-none px-6 text-center">
                <MapPin className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-muted-foreground font-medium text-sm">GPS情報を持つ打刻がありません</p>
                <p className="text-muted-foreground/60 text-xs mt-1">従業員が出退勤を記録するとここに表示されます</p>
              </div>
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
              withGps={withGps}
              allEventLocations={allEventLocations}
              flyTarget={flyTarget}
              center={defaultCenter}
            />
          </div>
        </div>
      </div>

      {/* ── モバイル ボトムシート（社員リスト）── */}
      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent side="bottom" className="md:hidden p-0 h-[85dvh] rounded-t-2xl flex flex-col gap-0">
          <SheetHeader className="px-4 py-3 pr-12 border-b shrink-0 flex-row items-center justify-between space-y-0 gap-3">
            <div className="text-left min-w-0">
              <SheetTitle className="text-base jp-tight">社員リスト</SheetTitle>
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
            <EmployeePanel {...panelProps} showHeader={false} />
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
