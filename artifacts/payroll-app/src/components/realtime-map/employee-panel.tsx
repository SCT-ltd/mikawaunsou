import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, MapPin, WifiOff, Search } from "lucide-react";
import {
  EmployeeLocation,
  EventLocation,
  STATUS_COLOR,
  STATUS_BADGE,
  EVENT_CONFIG,
  formatTime,
  formatDateTime,
} from "./shared";
import { Legend } from "./legend";

export interface EmployeePanelProps {
  withGps: EmployeeLocation[];
  withoutGps: EmployeeLocation[];
  selectedId: number | null;
  loading: boolean;
  hasAnyData: boolean;
  elapsedLabel: (gpsTime: string | null) => string;
  onEmpClick: (emp: EmployeeLocation) => void;
  onEventClick: (ev: EventLocation) => void;
  onSelectGpslessEmp: (emp: EmployeeLocation) => void;
  showHeader?: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  search: string;
  onSearchChange: (s: string) => void;
}

// 打刻地点リスト（GPS取得済み/未取得で共通）
function EventList({ events, onEventClick }: { events: EventLocation[]; onEventClick: (ev: EventLocation) => void }) {
  if (events.length === 0) return null;
  return (
    <div className="px-4 pb-2 pl-7 space-y-1">
      {events.map((ev, i) => {
        const cfg = EVENT_CONFIG[ev.eventType];
        return (
          <button
            key={i}
            onClick={() => onEventClick(ev)}
            className="w-full text-left flex items-center gap-1.5 text-xs hover:underline group"
            title="クリックで打刻地点へ移動"
          >
            <span style={{ color: cfg.color }} className="font-bold shrink-0">{cfg.emoji}</span>
            <span className="font-medium text-muted-foreground group-hover:text-foreground">{cfg.label}</span>
            <span className="text-muted-foreground/70 amount">{formatDateTime(ev.recordedAt)}</span>
            <MapPin className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0 ml-auto" />
          </button>
        );
      })}
    </div>
  );
}

export function EmployeePanel({
  withGps,
  withoutGps,
  selectedId,
  loading,
  hasAnyData,
  elapsedLabel,
  onEmpClick,
  onEventClick,
  onSelectGpslessEmp,
  showHeader = true,
  lastUpdated,
  onRefresh,
  search,
  onSearchChange,
}: EmployeePanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {showHeader && (
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-sm jp-tight">リアルタイムマップ</h2>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground mt-0.5">
                更新: <span className="amount">{formatTime(lastUpdated.toISOString())}</span>
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            更新
          </Button>
        </div>
      )}

      {/* 検索 */}
      <div className="p-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="氏名・部署で検索"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* GPS位置表示中の従業員 */}
        {withGps.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wide">
              📍 GPS取得済み ({withGps.length}名)
            </p>
            {withGps.map((emp) => (
              <div
                key={emp.employeeId}
                className={`border-b last:border-0 transition-colors ${
                  selectedId === emp.employeeId ? "bg-indigo-50 border-l-[3px] border-l-indigo-500" : ""
                }`}
              >
                <div className="px-4 py-2.5 cursor-pointer hover:bg-muted/50 active:bg-muted" onClick={() => onEmpClick(emp)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white" style={{ backgroundColor: STATUS_COLOR[emp.status] }} />
                      <span className="text-sm font-semibold truncate jp-tight">{emp.name}</span>
                    </div>
                    <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[emp.status]}`}>
                      {emp.status}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-4.5 space-y-0.5">
                    <p className="text-xs text-muted-foreground">{emp.department}</p>
                    {emp.lastUpdated && (
                      <p className="text-xs text-muted-foreground">
                        現在地更新: <span className="amount">{formatTime(emp.lastUpdated)}</span>（{elapsedLabel(emp.lastUpdated)}）
                      </p>
                    )}
                    {emp.accuracy != null && (
                      <p className="text-xs text-muted-foreground/60">精度: ±{Math.round(emp.accuracy)}m</p>
                    )}
                  </div>
                </div>
                <EventList events={emp.eventLocations ?? []} onEventClick={onEventClick} />
              </div>
            ))}
          </div>
        )}

        {/* GPS未取得の従業員 */}
        {withoutGps.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <WifiOff className="h-3 w-3" /> GPS未取得 ({withoutGps.length}名)
            </p>
            {withoutGps.map((emp) => {
              const evs = emp.eventLocations ?? [];
              const hasEvents = evs.length > 0;
              return (
                <div
                  key={emp.employeeId}
                  className={`border-b last:border-0 transition-colors ${
                    selectedId === emp.employeeId ? "bg-indigo-50 border-l-[3px] border-l-indigo-500" : ""
                  } ${hasEvents ? "" : "opacity-60"}`}
                >
                  <div
                    className={`px-4 py-2.5 ${hasEvents ? "cursor-pointer hover:bg-muted/50 active:bg-muted" : ""}`}
                    onClick={() => { if (hasEvents) onSelectGpslessEmp(emp); }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-300" />
                        <span className="text-sm font-semibold truncate jp-tight">{emp.name}</span>
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[emp.status]}`}>
                        {emp.status}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-4.5 space-y-0.5">
                      <p className="text-xs text-muted-foreground">{emp.department}</p>
                      <p className="text-xs text-muted-foreground/60 flex items-center gap-1">
                        <WifiOff className="h-2.5 w-2.5" />
                        {hasEvents ? `打刻地点 ${evs.length}件（クリックで表示）` : "リアルタイムGPS未取得"}
                      </p>
                    </div>
                  </div>
                  {hasEvents && <EventList events={evs} onEventClick={onEventClick} />}
                </div>
              );
            })}
          </div>
        )}

        {loading && !hasAnyData && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">読み込み中...</div>
        )}

        {!loading && !hasAnyData && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2 px-4 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground/30" />
            <p>表示できる社員データがありません</p>
          </div>
        )}

        {!loading && hasAnyData && withGps.length === 0 && withoutGps.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2 px-4 text-center">
            <Search className="h-7 w-7 text-muted-foreground/30" />
            <p>該当する社員がいません</p>
          </div>
        )}
      </div>

      <Legend />
    </div>
  );
}
