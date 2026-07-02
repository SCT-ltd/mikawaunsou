import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  X, Plus, Trash2, Pencil, GripVertical, CalendarOff, QrCode, ArrowLeft,
} from "lucide-react";
import {
  EmployeeStatus,
  AttendanceRecord,
  AbsenceRecord,
  EventType,
  AbsenceType,
  EVENT_LABELS,
  EVENT_ICONS,
  EVENT_COLORS,
  ABSENCE_LABELS,
  ABSENCE_COLORS,
  Avatar,
  StatusBadge,
  GpsAddressLink,
  fmt,
  nowTimeJST,
  elapsedStr,
  elapsedMs,
  elapsedColor,
  breakTotalMs,
  msToStr,
} from "./shared";

/**
 * 勤怠詳細ペイン。旧スライドインパネルの内容を常設ペイン化。
 * ドラッグ並べ替えやフォームの一時状態はこのコンポーネント内に保持し、
 * API 操作（追加/欠勤登録/削除/時刻交換/編集ダイアログ）は親から props で受ける。
 * 挙動（楽観的更新→PATCH 時刻交換など）は旧実装のまま。
 */
export function DetailPanel({
  selected,
  now,
  saving,
  isToday,
  absences,
  onEditRecord,
  onSwapRecords,
  onSwapAbsences,
  onDeleteAbsence,
  onAddRecord,
  onSaveAbsence,
  onShowQR,
  onClose,
}: {
  selected: EmployeeStatus;
  now: Date;
  saving: boolean;
  isToday: boolean;
  absences: AbsenceRecord[];
  onEditRecord: (r: AttendanceRecord) => void;
  onSwapRecords: (indexA: number, indexB: number) => void;
  onSwapAbsences: (employeeId: number, indexA: number, indexB: number) => void;
  onDeleteAbsence: (id: number) => void;
  onAddRecord: (eventType: EventType, time: string) => Promise<string | null>;
  onSaveAbsence: (absenceType: AbsenceType, note: string) => Promise<boolean>;
  onShowQR: (employee: EmployeeStatus["employee"]) => void;
  onClose: () => void;
}) {
  // ドラッグ並び替え（打刻）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragInsertBefore, setDragInsertBefore] = useState(true);
  // ドラッグ並び替え（欠勤）
  const [absDragIndex, setAbsDragIndex] = useState<number | null>(null);
  const [absDragOverIndex, setAbsDragOverIndex] = useState<number | null>(null);
  const [absDragInsertBefore, setAbsDragInsertBefore] = useState(true);

  // 手動追加フォーム
  const [addMode, setAddMode] = useState(false);
  const [addEventType, setAddEventType] = useState<EventType>("clock_in");
  const [addTime, setAddTime] = useState(() => nowTimeJST());
  const [addError, setAddError] = useState<string | null>(null);

  // 欠勤・休暇フォーム
  const [absenceMode, setAbsenceMode] = useState(false);
  const [absenceType, setAbsenceType] = useState<AbsenceType>("sick");
  const [absenceNote, setAbsenceNote] = useState("");

  const empAbsences = absences.filter((a) => a.employeeId === selected.employee.id);
  const hasTimeline = selected.records.length > 0 || empAbsences.length > 0;

  const handleAdd = async () => {
    setAddError(null);
    const err = await onAddRecord(addEventType, addTime);
    if (err) setAddError(err);
    else setAddMode(false);
  };

  const handleSaveAbsence = async () => {
    const ok = await onSaveAbsence(absenceType, absenceNote);
    if (ok) { setAbsenceMode(false); setAbsenceNote(""); }
  };

  const breakMs = breakTotalMs(selected.records, now);
  const elapMs = elapsedMs(selected.clockInTime, now);
  const showElapsed = selected.status !== "未出勤" && selected.status !== "退勤済";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── ヘッダー ── */}
      <div className="flex items-center gap-2.5 px-3 md:px-4 py-2.5 border-b shrink-0 bg-muted/20">
        {/* モバイル: リストへ戻る */}
        <button
          type="button"
          className="md:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
          onClick={onClose}
          aria-label="社員リストへ戻る"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="relative shrink-0">
          <Avatar name={selected.employee.name} size="lg" />
          {selected.status === "出勤中" && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-base leading-tight jp-tight truncate">{selected.employee.name}</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            <span className="font-mono">{selected.employee.employeeCode}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            {selected.employee.department}
          </p>
          <div className="mt-1.5">
            <StatusBadge status={selected.status} />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => onShowQR(selected.employee)}
          title="QRコード"
        >
          <QrCode className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">QR</span>
        </Button>
        <button
          onClick={onClose}
          className="hidden md:inline-flex p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 shrink-0"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── スクロール本体 ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 情報カード */}
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">出勤時刻</p>
              <p className="text-lg font-bold amount text-slate-800">{fmt(selected.clockInTime)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">経過時間</p>
              <p className={`text-lg font-bold amount ${elapMs >= 10 * 3600000 ? "text-red-600" : elapMs >= 8 * 3600000 ? "text-orange-500" : "text-slate-800"}`}>
                {showElapsed ? elapsedStr(selected.clockInTime, now) : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-3">
              <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1">休憩合計</p>
              <p className="text-lg font-bold amount text-amber-700">{breakMs > 0 ? msToStr(breakMs) : "—"}</p>
            </div>
          </div>

          {/* 最新の発着地 */}
          {(() => {
            const latest = [...selected.records].reverse().find((r) => r.note);
            return latest?.note ? (
              <div className="mt-3 rounded-xl bg-indigo-50/80 border border-indigo-100 px-3.5 py-3 flex items-center gap-2.5">
                <span className="text-lg">📍</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider leading-none mb-1">最新の発着地</p>
                  <p className="text-sm font-bold text-indigo-700 truncate">{latest.note}</p>
                </div>
              </div>
            ) : null;
          })()}

          {/* 走行メーター */}
          {(() => {
            const allOdo = selected.records.filter((r) => r.startOdometer != null || r.endOdometer != null);
            if (allOdo.length === 0) return null;
            const startVal = allOdo.find((r) => r.startOdometer != null)?.startOdometer;
            const endVal = [...allOdo].reverse().find((r) => r.endOdometer != null)?.endOdometer;
            const distance = startVal != null && endVal != null ? Math.round((endVal - startVal) * 10) / 10 : null;
            return (
              <div className="mt-2 rounded-xl bg-sky-50/80 border border-sky-100 px-3.5 py-3 flex items-center gap-2.5">
                <span className="text-lg">🚛</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-sky-400 uppercase tracking-wider leading-none mb-1">走行メーター</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {startVal != null && <span className="text-sm font-bold text-sky-800 amount">出発 {startVal.toLocaleString()} km</span>}
                    {startVal != null && endVal != null && <span className="text-sky-300 text-xs font-bold">→</span>}
                    {endVal != null && <span className="text-sm font-bold text-sky-800 amount">帰着 {endVal.toLocaleString()} km</span>}
                    {distance != null && (
                      <span className="text-xs font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full border border-sky-200 amount">
                        走行 {distance} km
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 日常点検 */}
          {(() => {
            const clockInRec = selected.records.find((r) => r.eventType === "clock_in" && r.checklistNgItems);
            if (!clockInRec?.checklistNgItems) return null;
            let parsed: { total: number; checked: number; ng: string[] } | null = null;
            try { parsed = JSON.parse(clockInRec.checklistNgItems); } catch { return null; }
            if (!parsed) return null;
            const allOk = parsed.ng.length === 0;
            return (
              <div className={`mt-2 rounded-xl border px-3.5 py-3 flex items-start gap-2.5 ${allOk ? "bg-emerald-50/80 border-emerald-100" : "bg-red-50/80 border-red-200"}`}>
                <span className="text-lg shrink-0">{allOk ? "✅" : "⚠️"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className={`text-[10px] font-bold uppercase tracking-wider leading-none ${allOk ? "text-emerald-600" : "text-red-600"}`}>
                      日常点検 {allOk ? "異常なし" : `異常${parsed.ng.length}件`}
                    </p>
                    <span className="text-[10px] text-slate-400">（{parsed.checked}/{parsed.total}項目）</span>
                  </div>
                  {parsed.ng.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {parsed.ng.map((item) => (
                        <span key={item} className="text-xs bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full font-medium">{item}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 打刻・休暇履歴 */}
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">打刻・休暇履歴</p>
            <button
              onClick={() => { setAddMode(true); setAddTime(nowTimeJST()); setAddEventType("clock_in"); setAddError(null); }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg"
            >
              <Plus className="h-3 w-3" />打刻を追加
            </button>
          </div>

          {/* 手動追加フォーム */}
          {addMode && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
              <p className="text-xs font-medium text-primary">打刻を手動追加</p>
              {addError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{addError}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">種別</Label>
                  <Select value={addEventType} onValueChange={(v) => { setAddEventType(v as EventType); setAddError(null); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clock_in">出勤</SelectItem>
                      <SelectItem value="break_start">休憩開始</SelectItem>
                      <SelectItem value="break_end">休憩終了</SelectItem>
                      <SelectItem value="clock_out">退勤</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">時刻</Label>
                  <Input
                    type="time"
                    value={addTime}
                    max={isToday ? nowTimeJST() : undefined}
                    onChange={(e) => { setAddTime(e.target.value); setAddError(null); }}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAdd} disabled={saving}>
                  <Plus className="h-3 w-3 mr-1" />追加
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddMode(false)} disabled={saving}>
                  キャンセル
                </Button>
              </div>
            </div>
          )}

          {!hasTimeline ? (
            <div className="text-center py-8 text-muted-foreground text-sm">打刻・休暇はありません</div>
          ) : (
            <div className="relative">
              <div className="absolute left-[18px] top-2 bottom-2 w-px bg-border" />
              <div className="flex flex-col gap-3">
                {/* 欠勤・休暇エントリー */}
                {empAbsences.map((a, ai) => {
                  const isDragging = absDragIndex === ai;
                  const isTarget = absDragOverIndex === ai && absDragIndex !== null && absDragIndex !== ai;
                  const isOther = absDragIndex !== null && absDragIndex !== ai;
                  return (
                    <div key={`absence-${a.id}`} className="relative">
                      {isTarget && absDragInsertBefore && (
                        <div className="absolute -top-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                        </div>
                      )}
                      <div
                        className={`flex items-start gap-3 select-none transition-all duration-150 ${isDragging ? "opacity-20 scale-[0.96]" : ""} ${isOther ? "opacity-60" : ""}`}
                        draggable
                        onDragStart={(e) => { setAbsDragIndex(ai); e.dataTransfer.effectAllowed = "move"; }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          const rect = e.currentTarget.getBoundingClientRect();
                          setAbsDragInsertBefore(e.clientY < rect.top + rect.height / 2);
                          setAbsDragOverIndex(ai);
                        }}
                        onDragEnd={() => { setAbsDragIndex(null); setAbsDragOverIndex(null); }}
                        onDrop={(e) => { e.preventDefault(); if (absDragIndex !== null) onSwapAbsences(a.employeeId, absDragIndex, ai); }}
                      >
                        <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${ABSENCE_COLORS[a.absenceType]} border-current ${isDragging ? "shadow-lg" : ""}`}>
                          <CalendarOff className="h-3.5 w-3.5" />
                        </div>
                        <div className={`flex-1 rounded-lg border px-3 py-2 ${ABSENCE_COLORS[a.absenceType]} ${isDragging ? "shadow-xl" : ""}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-semibold jp-tight">{ABSENCE_LABELS[a.absenceType]}</p>
                              <p className="text-sm font-medium opacity-70">終日</p>
                              {a.note && <p className="text-xs opacity-60 mt-0.5">{a.note}</p>}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => onDeleteAbsence(a.id)} disabled={saving} className="p-1.5 rounded hover:bg-black/10 transition-colors opacity-50 hover:opacity-100" title="削除">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <div className="p-1.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-70" title="ドラッグで並び替え">
                                <GripVertical className="h-3.5 w-3.5" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {isTarget && !absDragInsertBefore && (
                        <div className="absolute -bottom-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 打刻履歴エントリー */}
                {selected.records.map((r, i) => {
                  const isDragging = dragIndex === i;
                  const isTarget = dragOverIndex === i && dragIndex !== null && dragIndex !== i;
                  const isOther = dragIndex !== null && dragIndex !== i;
                  return (
                    <div key={r.id} className="relative">
                      {isTarget && dragInsertBefore && (
                        <div className="absolute -top-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                        </div>
                      )}
                      <div
                        className={`flex items-start gap-3 select-none transition-all duration-150 ${isDragging ? "opacity-20 scale-[0.96]" : ""} ${isOther ? "opacity-60" : ""}`}
                        draggable
                        onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          const rect = e.currentTarget.getBoundingClientRect();
                          setDragInsertBefore(e.clientY < rect.top + rect.height / 2);
                          setDragOverIndex(i);
                        }}
                        onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                        onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) onSwapRecords(dragIndex, i); }}
                      >
                        <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${EVENT_COLORS[r.eventType]} border-current ${isDragging ? "shadow-lg" : ""}`}>
                          {EVENT_ICONS[r.eventType]}
                        </div>
                        <div className={`flex-1 rounded-lg border px-3 py-2 ${EVENT_COLORS[r.eventType]} ${isDragging ? "shadow-xl" : ""}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-semibold jp-tight">{EVENT_LABELS[r.eventType]}</p>
                              <p className="text-base font-bold amount">{fmt(r.recordedAt)}</p>
                              {r.note && <p className="text-xs text-muted-foreground mt-0.5">📍 {r.note}</p>}
                              {r.latitude != null && r.longitude != null && <GpsAddressLink lat={r.latitude} lng={r.longitude} />}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => onEditRecord(r)} className="p-1.5 rounded hover:bg-black/5 transition-colors opacity-60 hover:opacity-100" title="修正">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <div className="p-1.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-70" title="ドラッグで並び替え">
                                <GripVertical className="h-3.5 w-3.5" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {isTarget && !dragInsertBefore && (
                        <div className="absolute -bottom-2 left-9 right-0 z-20 flex items-center gap-1.5 pointer-events-none">
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <div className="flex-1 h-0.5 bg-primary rounded-full shadow-sm shadow-primary/40" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 欠勤・休暇登録フォーム */}
        {absenceMode && (
          <div className="px-4 py-4 border-t">
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-3">
              <p className="text-xs font-medium text-orange-800 flex items-center gap-1.5">
                <CalendarOff className="h-3.5 w-3.5" />欠勤・休暇を登録
              </p>
              <div className="space-y-1">
                <Label className="text-xs">種別</Label>
                <Select value={absenceType} onValueChange={(v) => setAbsenceType(v as AbsenceType)}>
                  <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sick">病欠</SelectItem>
                    <SelectItem value="paid_leave">有給休暇</SelectItem>
                    <SelectItem value="bereavement">忌引き</SelectItem>
                    <SelectItem value="morning_half">午前休み（0.5日）</SelectItem>
                    <SelectItem value="afternoon_half">午後休み（0.5日）</SelectItem>
                    <SelectItem value="other">その他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">備考（任意）</Label>
                <Textarea
                  value={absenceNote}
                  onChange={(e) => setAbsenceNote(e.target.value)}
                  className="h-16 text-xs resize-none bg-white"
                  placeholder="理由・コメント..."
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSaveAbsence} disabled={saving}>
                  <Plus className="h-3 w-3 mr-1" />登録
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAbsenceMode(false)} disabled={saving}>
                  キャンセル
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── フッター ── */}
      <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2 bg-muted/20 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs text-slate-600 hover:text-indigo-700 hover:border-indigo-200 hover:bg-indigo-50 transition-all"
          onClick={() => onShowQR(selected.employee)}
        >
          <QrCode className="h-3.5 w-3.5" />QRコード
        </Button>
        {!absenceMode && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs text-slate-600 hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50 transition-all"
            onClick={() => { setAbsenceMode(true); setAbsenceType("sick"); setAbsenceNote(""); }}
          >
            <CalendarOff className="h-3.5 w-3.5" />欠勤・休暇登録
          </Button>
        )}
      </div>
    </div>
  );
}
