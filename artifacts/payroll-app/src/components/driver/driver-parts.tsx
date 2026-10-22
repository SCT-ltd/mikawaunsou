import { useEffect, useState, type ReactNode } from "react";
import type { PushState } from "@/lib/push-setup";

/**
 * 打刻ページ（ドライバー・事務員）で使う小さな部品。
 * どれもスマホで片手で押せる大きさにしてある。
 */

export function fmtHM(dateStr: string | number): string {
  return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
}
export function fmtMD(dateStr: string): string {
  return `${Number(dateStr.slice(5, 7))}月${Number(dateStr.slice(8, 10))}日`;
}
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

/** 下から出てくる入れ物 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}
           style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
          <p className="font-bold text-base">{title}</p>
          <button type="button" onClick={onClose} className="text-gray-400 text-xl leading-none px-2 py-1" aria-label="閉じる">✕</button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

export interface Choice { label: string; tone?: "primary" | "danger" | "plain"; onClick: () => void }

/** 確かめるための画面（ボタンを2〜3個並べる） */
export function ChoiceSheet({ open, title, message, choices, onClose }: { open: boolean; title: string; message: ReactNode; choices: Choice[]; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-sm leading-relaxed text-gray-700">{message}</div>
      <div className="flex flex-col gap-2 pt-1">
        {choices.map(c => (
          <button key={c.label} type="button" onClick={c.onClick}
            className={`w-full rounded-xl py-3.5 text-base font-bold active:scale-[0.98] transition-all ${
              c.tone === "danger" ? "bg-red-500 text-white" : c.tone === "plain" ? "bg-gray-100 text-gray-700" : "bg-primary text-primary-foreground"}`}>
            {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

const METHODS: Array<[string, string]> = [["face", "対面"], ["phone", "電話"], ["video", "ビデオ通話"], ["other", "その他"]];

export interface AlcoholValues { phase: "before" | "after"; valueMg: number; detected: boolean; method: string; checker: string; vehicle: string; note: string }

/** アルコールチェックの記録（乗る前・乗った後） */
export function AlcoholSheet({ open, phase, defaultChecker, defaultMethod, vehicles, defaultVehicle, onSubmit, onClose }: {
  open: boolean; phase: "before" | "after"; defaultChecker: string; defaultMethod: string; vehicles: string[]; defaultVehicle: string;
  onSubmit: (v: AlcoholValues) => Promise<string | null>; onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [detected, setDetected] = useState(false);
  const [method, setMethod] = useState(defaultMethod || "face");
  const [checker, setChecker] = useState(defaultChecker);
  const [vehicle, setVehicle] = useState(defaultVehicle);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValue(""); setDetected(false); setErr(null); setNote("");
    setMethod(defaultMethod || "face"); setChecker(defaultChecker); setVehicle(defaultVehicle);
  }, [open, defaultChecker, defaultMethod, defaultVehicle]);
  const num = value.trim() === "" ? null : Number(value);
  const over = num !== null && num > 0;
  const submit = async () => {
    setErr(null);
    if (num === null || !Number.isFinite(num) || num < 0 || num > 5) { setErr("検知器の数値を入れてください（検知しなければ 0）"); return; }
    if (!checker.trim()) { setErr("確認した人の名前を入れてください"); return; }
    setBusy(true);
    const e = await onSubmit({ phase, valueMg: num, detected: detected || over, method, checker: checker.trim(), vehicle, note });
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Sheet open={open} onClose={onClose} title={phase === "before" ? "🍺 乗る前のアルコールチェック" : "🍺 乗った後のアルコールチェック"}>
      <p className="text-xs text-gray-500 leading-relaxed">検知器で測った数値を入れてください。運行管理者などに、対面か電話・ビデオ通話で確かめてもらってください。記録は1年間残します。</p>
      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">検知器の数値（mg/L）</span>
        <input type="number" inputMode="decimal" step="0.01" min="0" value={value} onChange={e => setValue(e.target.value)} placeholder="例：0.00"
          className="w-full rounded-xl border border-gray-200 px-3 py-3 text-lg" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={detected || over} disabled={over} onChange={e => setDetected(e.target.checked)} />
        <span>酒気帯び（アルコールを検知した）</span>
      </label>
      {over && <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">アルコールを検知しています。運転しないで、すぐ事務所に連絡してください。</p>}
      <div>
        <span className="block text-xs font-semibold text-gray-600 mb-1">確認の方法</span>
        <div className="grid grid-cols-4 gap-1.5">
          {METHODS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMethod(v)}
              className={`rounded-lg py-2.5 text-sm font-semibold border ${method === v ? "bg-primary text-primary-foreground border-primary" : "bg-white text-gray-600 border-gray-200"}`}>{l}</button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">確認した人</span>
        <input type="text" value={checker} onChange={e => setChecker(e.target.value)} placeholder="例：運行管理者の名前" className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base" />
      </label>
      <VehiclePicker vehicles={vehicles} value={vehicle} onChange={setVehicle} />
      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">メモ（任意）</span>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base" />
      </label>
      {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      <button type="button" disabled={busy} onClick={submit} className="w-full rounded-xl py-3.5 bg-primary text-primary-foreground text-base font-bold disabled:opacity-50">{busy ? "記録しています…" : "記録する"}</button>
    </Sheet>
  );
}

/** 車両番号を選ぶ（会社の設定に一覧があれば選ぶ・無ければ書く） */
export function VehiclePicker({ vehicles, value, onChange }: { vehicles: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">車両</span>
      {vehicles.length > 0 ? (
        <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base bg-white">
          <option value="">選んでください</option>
          {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
          {value && !vehicles.includes(value) && <option value={value}>{value}</option>}
        </select>
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="例：1号車" className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base" />
      )}
    </label>
  );
}

export interface CorrectionRecord { id: number; eventType: string; recordedAt: string; workDate: string }
export interface CorrectionRequest { id: number; kind: string; eventType: string | null; workDate: string; requestedAt: string | null; reason: string; status: string; decisionNote: string | null; createdAt: string }
export interface CorrectionValues { kind: "add" | "change" | "cancel"; recordId?: number; eventType?: string; workDate?: string; requestedAt?: string; reason: string }

const EV_LABEL: Record<string, string> = { clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了" };
const KIND_LABEL: Record<string, string> = { add: "打ち忘れを足す", change: "時刻を直す", cancel: "取り消す" };
const STATUS_LABEL: Record<string, string> = { pending: "確認待ち", approved: "承認", rejected: "見送り" };

/** 打刻の修正申請（ドライバーが理由をつけて出す。事務所が承認すると直る） */
export function CorrectionSheet({ open, records, shiftDate, mine, onSubmit, onClose, initial }: {
  open: boolean; records: CorrectionRecord[]; shiftDate: string; mine: CorrectionRequest[];
  onSubmit: (v: CorrectionValues) => Promise<string | null>; onClose: () => void;
  initial?: Partial<{ kind: "add" | "change" | "cancel"; eventType: string; workDate: string }>;
}) {
  const [kind, setKind] = useState<"add" | "change" | "cancel">("add");
  const [recordId, setRecordId] = useState<number | null>(null);
  const [eventType, setEventType] = useState("clock_out");
  const [date, setDate] = useState(shiftDate);
  const [time, setTime] = useState("");
  const [nextDay, setNextDay] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? "add"); setEventType(initial?.eventType ?? "clock_out"); setDate(initial?.workDate ?? shiftDate);
    setRecordId(null); setTime(""); setNextDay(false); setReason(""); setErr(null);
  }, [open, shiftDate, initial?.kind, initial?.eventType, initial?.workDate]);
  const submit = async () => {
    setErr(null);
    if (!reason.trim()) { setErr("理由を書いてください（例：退勤を押し忘れました）"); return; }
    const v: CorrectionValues = { kind, reason: reason.trim() };
    if (kind !== "add") {
      if (!recordId) { setErr("直したい打刻を選んでください"); return; }
      v.recordId = recordId;
    } else {
      v.eventType = eventType; v.workDate = date;
    }
    if (kind !== "cancel") {
      if (!/^\d{2}:\d{2}$/.test(time)) { setErr("時刻を入れてください"); return; }
      const base = kind === "add" ? date : (records.find(r => r.id === recordId)?.workDate ?? date);
      const t = new Date(`${base}T${time}:00+09:00`);
      if (nextDay) t.setTime(t.getTime() + 24 * 3600000);
      v.requestedAt = t.toISOString();
    }
    setBusy(true);
    const e = await onSubmit(v);
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Sheet open={open} onClose={onClose} title="✏️ 打刻の修正を申請">
      <p className="text-xs text-gray-500 leading-relaxed">押し忘れ・押し間違いは、理由を書いて事務所に申請してください。事務所が承認すると直ります。直した記録は残ります。</p>
      <div className="grid grid-cols-3 gap-1.5">
        {(["add", "change", "cancel"] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-lg py-2.5 text-sm font-semibold border ${kind === k ? "bg-primary text-primary-foreground border-primary" : "bg-white text-gray-600 border-gray-200"}`}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      {kind === "add" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">足したい打刻</span>
            <select value={eventType} onChange={e => setEventType(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base bg-white">
              {Object.entries(EV_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">勤務の日（出勤した日）</span>
            <input type="date" value={date} max={todayJst()} onChange={e => setDate(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base" />
          </label>
        </div>
      ) : (
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold text-gray-600">直したい打刻（いまの勤務）</span>
          {records.length === 0 && <p className="text-sm text-gray-400">打刻がありません</p>}
          {records.map(r => (
            <button key={r.id} type="button" onClick={() => setRecordId(r.id)}
              className={`w-full flex justify-between rounded-lg border px-3 py-2.5 text-sm ${recordId === r.id ? "border-primary bg-primary/5 font-bold" : "border-gray-200"}`}>
              <span>{EV_LABEL[r.eventType] ?? r.eventType}</span><span className="font-mono">{fmtHM(r.recordedAt)}</span>
            </button>
          ))}
        </div>
      )}
      {kind !== "cancel" && (
        <div className="flex items-end gap-3">
          <label className="block flex-1">
            <span className="block text-xs font-semibold text-gray-600 mb-1">{kind === "add" ? "押すはずだった時刻" : "正しい時刻"}</span>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base" />
          </label>
          <label className="flex items-center gap-1.5 text-sm pb-3">
            <input type="checkbox" className="w-5 h-5" checked={nextDay} onChange={e => setNextDay(e.target.checked)} />翌日
          </label>
        </div>
      )}
      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">理由</span>
        <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="例：退勤を押し忘れました" className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base" />
      </label>
      {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      <button type="button" disabled={busy} onClick={submit} className="w-full rounded-xl py-3.5 bg-primary text-primary-foreground text-base font-bold disabled:opacity-50">{busy ? "送っています…" : "申請する"}</button>
      {mine.length > 0 && (
        <div className="pt-2 border-t">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">これまでの申請</p>
          <ul className="space-y-1.5">
            {mine.slice(0, 8).map(m => (
              <li key={m.id} className="text-xs flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
                <span>{fmtMD(m.workDate)} {KIND_LABEL[m.kind] ?? m.kind}{m.eventType ? `（${EV_LABEL[m.eventType] ?? m.eventType}${m.requestedAt ? ` ${fmtHM(m.requestedAt)}` : ""}）` : ""}{m.decisionNote ? ` — ${m.decisionNote}` : ""}</span>
                <span className={`shrink-0 font-bold ${m.status === "approved" ? "text-emerald-600" : m.status === "rejected" ? "text-gray-500" : "text-amber-600"}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

/** スマホの通知の案内（iPhone はホーム画面に追加してから） */
export function PushCard({ state, message, onEnable }: { state: PushState; message: string | null; onEnable: () => void }) {
  if (state === "granted" && !message) return null;
  return (
    <div className="mx-4 mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 space-y-2">
      {state === "ios-install" ? (
        <>
          <p className="font-bold">📳 iPhone で通知を受け取るには</p>
          <ol className="list-decimal pl-5 space-y-0.5 text-xs leading-relaxed">
            <li>下の <b>共有ボタン</b>（□に↑）を押す</li>
            <li><b>「ホーム画面に追加」</b>を押す</li>
            <li>ホーム画面にできた <b>三川打刻</b> のアイコンから開く</li>
            <li>開いた画面で <b>「通知をオンにする」</b> を押す</li>
          </ol>
          <p className="text-xs text-sky-700">ホーム画面から開いたときは、暗証番号をもう一度入れてください。</p>
        </>
      ) : state === "denied" ? (
        <p className="text-xs leading-relaxed">通知が「許可しない」になっています。スマホの設定（ブラウザ→通知）で、このページの通知を許可してください。</p>
      ) : state === "unsupported" ? (
        <p className="text-xs leading-relaxed">この端末・ブラウザでは通知を受け取れません。事務所からのメッセージは、この画面を開いたときに届きます。</p>
      ) : state === "default" ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-xs leading-relaxed">事務所からのメッセージや、打ち忘れのお知らせをスマホに出します。</p>
          <button type="button" onClick={onEnable} className="shrink-0 rounded-lg bg-sky-600 text-white px-3 py-2 text-sm font-bold">通知をオンにする</button>
        </div>
      ) : null}
      {message && <p className="text-xs font-semibold">{message}</p>}
    </div>
  );
}
