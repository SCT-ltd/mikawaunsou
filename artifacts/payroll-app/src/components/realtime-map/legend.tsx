import { Status, EventType, STATUS_COLOR, EVENT_CONFIG } from "./shared";

/* 凡例（ステータス色 + 打刻イベント種別） */
export function Legend() {
  return (
    <div className="px-4 py-3 border-t bg-muted/30 shrink-0">
      <p className="text-xs font-bold text-muted-foreground mb-2 jp-tight">凡例</p>
      <div className="grid grid-cols-2 gap-1">
        {(["出勤中", "休憩中", "退勤済"] as Status[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
            <span className="text-xs text-muted-foreground">{s} (現在地)</span>
          </div>
        ))}
        {(Object.entries(EVENT_CONFIG) as [EventType, typeof EVENT_CONFIG[EventType]][]).map(([, cfg]) => (
          <div key={cfg.label} className="flex items-center gap-1.5">
            <span className="text-xs">{cfg.emoji}</span>
            <span className="text-xs text-muted-foreground">{cfg.label}地点</span>
          </div>
        ))}
      </div>
    </div>
  );
}
