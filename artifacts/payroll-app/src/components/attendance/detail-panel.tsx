import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  X, Plus, Trash2, Pencil, GripVertical, CalendarOff, QrCode, ArrowLeft, AlertTriangle,
} from "lucide-react";
import { attentionOf, dayTotals, DayBar, HourScale, segmentsOf, windowFor, planOf } from "./board";
import { Link } from "wouter";
import { MapPin } from "lucide-react";
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
  minToStr,
  METHOD_LABELS,
  isNextDayOf,
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
  onDecideInspection,
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
  onAddRecord: (eventType: EventType, time: string, nextDay: boolean) => Promise<string | null>;
  /** 日常点検の「否」への事務所の処置と、運行してよいかの判断 */
  onDecideInspection?: (id: number, officeAction: string, decision: "ok" | "ng" | null) => Promise<void>;
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
  /** 日をまたぐ打刻（翌2時の退勤など）。日付は勤務日のまま、時刻だけ翌日にする */
  const [addNextDay, setAddNextDay] = useState(false);
  const [inspAction, setInspAction] = useState<string | null>(null);

  // 欠勤・休暇フォーム
  const [absenceMode, setAbsenceMode] = useState(false);
  const [absenceType, setAbsenceType] = useState<AbsenceType>("sick");
  const [absenceNote, setAbsenceNote] = useState("");

  const empAbsences = absences.filter((a) => a.employeeId === selected.employee.id);
  const hasTimeline = selected.records.length > 0 || empAbsences.length > 0;

  const handleAdd = async () => {
    setAddError(null);
    const err = await onAddRecord(addEventType, addTime, addNextDay);
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
  const totals = dayTotals(selected.records, now, isToday);
  const daySegs = segmentsOf(selected.records, now, isToday);
  const dayDate = selected.workDate ?? selected.records[0]?.workDate ?? new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const plan = planOf(dayDate, selected.schedule);
  const dayWin = windowFor(dayDate, plan ? [...daySegs, { from: plan.start, to: plan.end, kind: "work", open: false }] : daySegs);
  const attention = attentionOf(selected, now, isToday);

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
        <Link href={`/realtime-map?emp=${selected.employee.id}`}>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" title="地図で見る（いまいる場所・打刻した場所）">
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">地図</span>
          </Button>
        </Link>
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
        <div className="px-4 py-4 border-b border-slate-100 dark:border-slate-800">
          {/* 要確認（いま事務所が見るべきこと） */}
          {attention.length > 0 && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-red-700 dark:text-red-300 leading-relaxed">{attention.join("　／　")}</p>
            </div>
          )}
          {/* 時刻と時間を1行に */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-px rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 overflow-hidden">
            {[
              ["出勤", fmt(totals.clockIn), ""],
              ["退勤", totals.clockOut ? fmt(totals.clockOut) : showElapsed ? "勤務中" : "—", showElapsed ? "text-emerald-600 text-sm" : ""],
              [showElapsed ? "経過" : "拘束", showElapsed ? elapsedStr(selected.clockInTime, now) : totals.restraintMin > 0 ? minToStr(totals.restraintMin) : "—",
                showElapsed && elapMs >= 10 * 3600000 ? "text-red-600" : showElapsed && elapMs >= 8 * 3600000 ? "text-orange-500" : ""],
              ["休憩", breakMs > 0 ? msToStr(breakMs) : "—", "text-amber-700 dark:text-amber-300"],
              ["実働", totals.restraintMin > 0 ? minToStr(totals.workMin) : "—", "text-indigo-700 dark:text-indigo-300"],
            ].map(([label, value, tone]) => (
              <div key={label} className="px-2.5 py-2 min-w-0 bg-slate-50 dark:bg-slate-900">
                <p className="text-[10px] font-semibold text-slate-400 tracking-wider">{label}</p>
                <p className={`text-[15px] font-bold amount whitespace-nowrap text-slate-800 dark:text-slate-100 ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
          {/* 1日の帯 */}
          {/* 予定（シフト）と予定との比べ */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">予定</span>
            <span className="font-semibold amount">
              {selected.schedule ? (selected.schedule.off ? "休み" : `${selected.schedule.start}〜${selected.schedule.end}`) : "なし"}
              {selected.schedule?.note ? <span className="ml-1 font-normal text-muted-foreground">（{selected.schedule.note}）</span> : null}
            </span>
            {(selected.plan?.lateMin ?? 0) > 0 && <span className="text-orange-600 font-semibold">遅刻 {selected.plan!.lateMin}分</span>}
            {(selected.plan?.earlyMin ?? 0) > 0 && <span className="text-orange-600 font-semibold">早退 {selected.plan!.earlyMin}分</span>}
            {selected.plan?.offWork && <span className="text-purple-600 font-semibold">予定では休みの日の出勤</span>}
            <Link href={`/attendance-month?y=${dayDate.slice(0, 4)}&m=${Number(dayDate.slice(5, 7))}`} className="ml-auto text-indigo-600 hover:underline">予定を直す（月の勤怠表）</Link>
          </div>
          {(daySegs.length > 0 || plan) && (
            <div className="mt-3">
              <HourScale win={dayWin} />
              <DayBar segs={daySegs} win={dayWin} now={now} live={isToday} height="h-4" plan={plan} />
            </div>
          )}

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

          {/* 日常点検：全項目に答えるまでは「未点検」（以前は1つもつけていなくても「異常なし」と出ていた） */}
          {(() => {
            let insp = selected.inspection ?? null;
            if (!insp) {
              const clockInRec = selected.records.find((r) => r.eventType === "clock_in" && r.checklistNgItems);
              if (clockInRec?.checklistNgItems) {
                try {
                  const p = JSON.parse(clockInRec.checklistNgItems) as { total: number; checked: number; ng: string[] };
                  insp = { id: 0, workDate: clockInRec.workDate, vehicle: null, items: {}, total: p.total, checked: p.checked, ng: p.ng ?? [], complete: p.total > 0 && p.checked >= p.total, officeAction: null, officeDecision: null, decidedBy: null, decidedAt: null, updatedAt: "" };
                } catch { /* 古い形 */ }
              }
            }
            if (!insp) {
              if (selected.employee.isOfficeStaff || selected.status === "未出勤") return null;
              return (
                <div className="mt-2 rounded-xl border px-3.5 py-3 flex items-center gap-2.5 bg-amber-50/80 border-amber-200">
                  <span className="text-lg shrink-0">📋</span>
                  <p className="text-[11px] font-bold text-amber-700">日常点検 未点検（0/21項目）</p>
                </div>
              );
            }
            const hasNg = insp.ng.length > 0;
            const tone = hasNg ? "bg-red-50/80 border-red-200" : insp.complete ? "bg-emerald-50/80 border-emerald-100" : "bg-amber-50/80 border-amber-200";
            const label = hasNg ? `異常${insp.ng.length}件` : insp.complete ? "異常なし" : "未点検";
            return (
              <div className={`mt-2 rounded-xl border px-3.5 py-3 flex items-start gap-2.5 ${tone}`}>
                <span className="text-lg shrink-0">{hasNg ? "⚠️" : insp.complete ? "✅" : "📋"}</span>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className={`text-[11px] font-bold leading-none ${hasNg ? "text-red-600" : insp.complete ? "text-emerald-600" : "text-amber-700"}`}>日常点検 {label}</p>
                    <span className="text-[10px] text-slate-400">（{insp.checked}/{insp.total}項目）</span>
                    {insp.vehicle && <span className="text-[10px] font-semibold text-slate-600 bg-white/70 border px-1.5 rounded">{insp.vehicle}</span>}
                  </div>
                  {hasNg && (
                    <div className="flex flex-wrap gap-1">
                      {insp.ng.map((item) => (
                        <span key={item} className="text-xs bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full font-medium">{item}</span>
                      ))}
                    </div>
                  )}
                  {hasNg && insp.id > 0 && onDecideInspection && (
                    <div className="space-y-1.5 pt-1">
                      <Textarea
                        value={inspAction ?? insp.officeAction ?? ""}
                        onChange={(e) => setInspAction(e.target.value)}
                        placeholder="処置の内容（例：ブレーキを調整した）"
                        className="h-14 text-xs resize-none bg-white"
                      />
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Button size="sm" variant={insp.officeDecision === "ok" ? "default" : "outline"} className="h-7 text-xs" disabled={saving}
                          onClick={() => { void onDecideInspection(insp!.id, inspAction ?? insp!.officeAction ?? "", "ok"); setInspAction(null); }}>運行してよい</Button>
                        <Button size="sm" variant={insp.officeDecision === "ng" ? "destructive" : "outline"} className="h-7 text-xs" disabled={saving}
                          onClick={() => { void onDecideInspection(insp!.id, inspAction ?? insp!.officeAction ?? "", "ng"); setInspAction(null); }}>運行しない</Button>
                        {insp.officeDecision ? (
                          <span className="text-[10px] text-slate-500">判断：{insp.officeDecision === "ok" ? "運行してよい" : "運行しない"}（{insp.decidedBy}）</span>
                        ) : <span className="text-[10px] font-bold text-red-600">事務所の判断がまだです</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* アルコールチェック（乗る前・乗った後） */}
          {!selected.employee.isOfficeStaff && (selected.status !== "未出勤" || (selected.alcohol?.length ?? 0) > 0) && (() => {
            const list = selected.alcohol ?? [];
            const before = list.filter((a) => a.phase === "before");
            const after = list.filter((a) => a.phase === "after");
            const detected = list.some((a) => a.detected);
            return (
              <div className={`mt-2 rounded-xl border px-3.5 py-3 flex items-start gap-2.5 ${detected ? "bg-red-50/80 border-red-300" : before.length ? "bg-slate-50 border-slate-200" : "bg-amber-50/80 border-amber-200"}`}>
                <span className="text-lg shrink-0">🍺</span>
                <div className="flex-1 min-w-0 text-xs space-y-0.5">
                  <p className={`text-[11px] font-bold ${detected ? "text-red-700" : "text-slate-600"}`}>アルコールチェック{detected ? "：検知あり（乗務させないでください）" : ""}</p>
                  {[["乗る前", before], ["乗った後", after]].map(([label, arr]) => {
                    const a = (arr as typeof list)[(arr as typeof list).length - 1];
                    return (
                      <p key={label as string} className={a?.detected ? "text-red-700 font-bold" : a ? "text-slate-700" : "text-amber-700"}>
                        {label as string}：{a ? `${a.valueMg ?? "-"} mg/L・${METHOD_LABELS[a.method] ?? a.method}・確認 ${a.checker ?? "（未記入）"}・${fmt(a.checkedAt)}` : "まだ"}
                      </p>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 日報（退勤のときに残したもの） */}
          {selected.report && (selected.report.shipper || selected.report.waitingMinutes != null || selected.report.vehicle) && (
            <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3 flex items-start gap-2.5">
              <span className="text-lg shrink-0">📝</span>
              <div className="text-xs space-y-0.5">
                <p className="text-[11px] font-bold text-slate-600">日報</p>
                {selected.report.shipper && <p>荷主：{selected.report.shipper}</p>}
                {selected.report.waitingMinutes != null && <p>待機時間：{minToStr(selected.report.waitingMinutes)}</p>}
                {selected.report.vehicle && <p>車両：{selected.report.vehicle}</p>}
              </div>
            </div>
          )}

          {/* 改善基準告示の目安（拘束・休息・連続） */}
          {selected.compliance && !selected.employee.isOfficeStaff && (() => {
            const c = selected.compliance!;
            const has = (code: string) => c.flags.find((f) => f.code.startsWith(code));
            const cell = (label: string, value: string, flag?: { level: string }) => (
              <div className={`rounded-lg border px-2.5 py-2 ${flag ? (flag.level === "danger" ? "bg-red-50 border-red-300 text-red-700" : "bg-amber-50 border-amber-300 text-amber-800") : "bg-white border-slate-200 text-slate-700"}`}>
                <p className="text-[10px] font-semibold opacity-70">{label}</p>
                <p className="text-sm font-bold amount">{value}</p>
              </div>
            );
            return (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3">
                <p className="text-[11px] font-bold text-slate-500 mb-1.5">改善基準の目安（打刻からの推定）</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {cell("拘束時間", minToStr(c.restraintMinutes), has("restraint"))}
                  {cell("前の勤務からの休息", c.restBeforeMinutes === null ? "—" : minToStr(c.restBeforeMinutes), has("rest"))}
                  {cell("続けて働いた最長", minToStr(c.maxContinuousMinutes), has("cont"))}
                </div>
                {c.flags.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {c.flags.map((f) => <li key={f.code} className={`text-[11px] font-semibold ${f.level === "danger" ? "text-red-600" : "text-amber-700"}`}>● {f.text}</li>)}
                  </ul>
                )}
              </div>
            );
          })()}

          {/* 1日休みと出勤が両方ある */}
          {empAbsences.some((a) => !["morning_half", "afternoon_half", "paid_leave_am", "paid_leave_pm"].includes(a.absenceType)) && selected.records.some((r) => r.eventType === "clock_in") && (
            <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800">
              ⚠️ この日は休み（欠勤・有給など）と出勤の両方が入っています。どちらが正しいか確かめてください。
            </div>
          )}
        </div>

        {/* 打刻・休暇履歴 */}
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">打刻・休暇履歴</p>
            <button
              onClick={() => { setAddMode(true); setAddTime(nowTimeJST()); setAddEventType("clock_in"); setAddError(null); setAddNextDay(false); }}
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
                    max={isToday && !addNextDay ? nowTimeJST() : undefined}
                    onChange={(e) => { setAddTime(e.target.value); setAddError(null); }}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={addNextDay} onChange={(e) => { setAddNextDay(e.target.checked); setAddError(null); }} />
                翌日の時刻（日をまたいだ退勤など。勤務日は {selected.workDate ?? "この日"} のまま）
              </label>
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
                              <p className="text-sm font-medium opacity-70">{["morning_half", "afternoon_half", "paid_leave_am", "paid_leave_pm"].includes(a.absenceType) ? "半日" : "終日"}</p>
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
                              <p className="text-base font-bold amount">
                                {isNextDayOf(r.recordedAt, r.workDate) && <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1 mr-1 align-middle">翌日</span>}
                                {fmt(r.recordedAt)}
                                {r.source === "auto" && <span className="ml-1.5 text-[10px] font-semibold text-slate-500 align-middle">（自動で入れた）</span>}
                                {r.source === "offline" && <span className="ml-1.5 text-[10px] font-semibold text-slate-500 align-middle">（電波が戻ってから届いた）</span>}
                                {r.source === "correction" && <span className="ml-1.5 text-[10px] font-semibold text-slate-500 align-middle">（修正申請で直した）</span>}
                              </p>
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
                    <SelectItem value="paid_leave_am">有給（午前半日・0.5日）</SelectItem>
                    <SelectItem value="paid_leave_pm">有給（午後半日・0.5日）</SelectItem>
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
