import { useCallback, useEffect, useRef, useState } from "react";
import { pushState, isIos, isStandalone, type PushState } from "@/lib/push-setup";
import { prepareFile } from "@/components/messages/attachments";
import { Sheet, fmtHM, fmtMD, todayJst } from "./driver-parts";

/**
 * 打刻ページ（/driver/:id）に足した機能。
 *   PermissionGate … 位置情報と通知を ON にするまで使えないようにする（会社の設定で切り替え）
 *   WorkTimeBar    … 休憩なしの時間・拘束時間（改善基準告示の目安）
 *   RequestsTab    … 経費・立替の申請（レシートの写真つき）・休み／有給の申請
 *   MeTab          … わたしの記録（今月の日数・時間・有給の残り）・給与明細
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type Headers = () => Record<string, string>;

async function call<T>(headers: Headers, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...headers(), ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? (res.status === 413 ? "写真が大きすぎます" : `うまくいきませんでした（${res.status}）`));
  return body as T;
}
const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const hm = (min: number) => `${Math.floor(min / 60)}時間${String(Math.round(min % 60)).padStart(2, "0")}分`;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** 写真を縮めてから上げる（レシート・アルコール検知器） */
export async function uploadStaffFile(employeeId: number, kind: "receipt" | "alcohol", file: File, headers: Headers): Promise<number> {
  const p = await prepareFile(file);
  if ("error" in p) throw new Error(p.error);
  const res = await fetch(`${BASE}/api/staff/${employeeId}/files?kind=${kind}`, { method: "POST", body: p.blob, headers: { ...headers(), "Content-Type": p.mime } });
  const body = await res.json().catch(() => null) as { id?: number; error?: string } | null;
  if (!res.ok || !body?.id) throw new Error(body?.error ?? (res.status === 413 ? "写真が大きすぎます" : "写真を送れませんでした。電波の良いところでもう一度送ってください。"));
  return body.id;
}

/** カメラで撮る／選ぶ（撮った写真を小さく見せる） */
export function PhotoField({ label, file, onFile, accept = "image/*" }: { label: string; file: File | null; onFile: (f: File | null) => void; accept?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setUrl(null); return; }
    const u = URL.createObjectURL(file); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div>
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2">
          {url ? <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border" /> : <span className="h-16 w-16 rounded-lg border bg-white flex items-center justify-center text-xs">PDF</span>}
          <span className="flex-1 min-w-0 text-xs text-gray-600 truncate">{file.name}</span>
          <button type="button" onClick={() => onFile(null)} className="shrink-0 rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-gray-600">撮り直す</button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-white py-4 text-sm font-semibold text-gray-600 cursor-pointer active:bg-gray-50" data-photo-input="">
          📷 写真を撮る
          <input type="file" accept={accept} capture="environment" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}

// ── 位置情報と通知 ────────────────────────────────────────
type GeoState = "granted" | "prompt" | "denied" | "unsupported" | "unknown";
async function readGeo(): Promise<GeoState> {
  if (!("geolocation" in navigator)) return "unsupported";
  try {
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return p.state as GeoState;
  } catch { return "unknown"; }
}

export function usePermissions(enabled: boolean) {
  const [geo, setGeo] = useState<GeoState>("unknown");
  const [push, setPush] = useState<PushState>(() => pushState());
  /** この画面で位置が取れた（permissions が使えない端末でも、取れたら ON とみなす） */
  const geoOkRef = useRef(false);
  /** 1回は確かめた（確かめる前に「OFF」の画面を出さない） */
  const [checked, setChecked] = useState(false);
  const triedRef = useRef(false);
  const refresh = useCallback(async () => {
    const g = await readGeo();
    // 許可の状態を読めない端末（古い iPhone など）は、1回だけ黙って位置を取ってみる（許可済みなら画面は出ない）
    if (g === "unknown" && !geoOkRef.current && !triedRef.current && "geolocation" in navigator) {
      triedRef.current = true;
      await new Promise<void>((r) => navigator.geolocation.getCurrentPosition(() => { geoOkRef.current = true; r(); }, () => r(), { timeout: 8000, maximumAge: 300000 }));
    }
    setGeo(g === "unknown" && geoOkRef.current ? "granted" : g);
    setPush(pushState());
    setChecked(true);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => void refresh(), 3000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [enabled, refresh]);
  const requestGeo = useCallback(() => new Promise<boolean>((resolve) => {
    if (!("geolocation" in navigator)) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(
      () => { geoOkRef.current = true; setGeo("granted"); resolve(true); },
      (err) => { if (err.code === err.PERMISSION_DENIED) setGeo("denied"); resolve(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }), []);
  const ok = geo === "granted" && push === "granted";
  return { geo, push, ok, checked, refresh, requestGeo };
}

/** 位置情報と通知を ON にする画面（ON になるまで、打刻ページは使えない） */
export function PermissionGate({ name, geo, push, onGeo, onPush, pushMessage }: {
  name: string; geo: GeoState; push: PushState; onGeo: () => void; onPush: () => void; pushMessage: string | null;
}) {
  const ios = isIos();
  const geoOk = geo === "granted", pushOk = push === "granted";
  const Row = ({ ok, icon, title, children }: { ok: boolean; icon: string; title: string; children: React.ReactNode }) => (
    <div className={`rounded-2xl border p-4 ${ok ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <p className="flex-1 font-bold text-gray-900">{title}</p>
        <span className={`text-sm font-bold ${ok ? "text-emerald-700" : "text-amber-700"}`}>{ok ? "✓ ON" : "OFF"}</span>
      </div>
      {!ok && <div className="mt-2 space-y-2 text-sm text-gray-700 leading-relaxed">{children}</div>}
    </div>
  );
  return (
    <div className="min-h-screen bg-gray-50 px-5 py-8 flex flex-col" data-permission-gate="">
      <div className="max-w-md w-full mx-auto space-y-4">
        <div className="text-center">
          <p className="text-xl font-bold text-gray-900">{name}さん</p>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">この打刻ページを使うには、<b>位置情報</b>と<b>通知</b>を ON にしてください。<br />位置は<b>出勤中だけ</b>事務所に届きます（休みの日や退勤後は届きません）。</p>
        </div>
        <Row ok={geoOk} icon="📍" title="位置情報">
          {geo === "denied" ? (
            <>
              <p>位置情報が「許可しない」になっています。スマホの設定で許可してから、この画面に戻ってください。</p>
              {ios ? (
                <ol className="list-decimal pl-5 text-xs space-y-0.5"><li>「設定」アプリ →「プライバシーとセキュリティ」→「位置情報サービス」を ON</li><li>同じ画面の下の {isStandalone() ? "「三川打刻」" : "「Safari の Web サイト」"} を「使用中のみ」にする</li></ol>
              ) : (
                <ol className="list-decimal pl-5 text-xs space-y-0.5"><li>アドレス欄の左の 🔒（または ⓘ）を押す</li><li>「権限」→「位置情報」→「許可」にする</li><li>スマホの位置情報（GPS）も ON にする</li></ol>
              )}
            </>
          ) : geo === "unsupported" ? (
            <p>このスマホ・ブラウザでは位置情報が使えません。事務所に相談してください。</p>
          ) : (
            <button type="button" onClick={onGeo} className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 text-base font-bold" data-gate-geo="">位置情報を ON にする</button>
          )}
        </Row>
        <Row ok={pushOk} icon="🔔" title="通知">
          {push === "ios-install" ? (
            <>
              <p>iPhone は、<b>ホーム画面に追加したアプリ</b>からでないと通知が届きません。</p>
              <ol className="list-decimal pl-5 text-xs space-y-0.5 leading-relaxed">
                <li>画面の下の <b>共有ボタン</b>（□に↑）を押す</li>
                <li><b>「ホーム画面に追加」</b>を押す</li>
                <li>ホーム画面にできた <b>三川打刻</b> のアイコンから開く</li>
                <li>開いた画面で、暗証番号を入れてから「通知を ON にする」を押す</li>
              </ol>
            </>
          ) : push === "denied" ? (
            <>
              <p>通知が「許可しない」になっています。スマホの設定で許可してから、この画面に戻ってください。</p>
              {ios ? <p className="text-xs">「設定」アプリ →「通知」→「三川打刻」→「通知を許可」を ON</p>
                : <ol className="list-decimal pl-5 text-xs space-y-0.5"><li>アドレス欄の左の 🔒（または ⓘ）を押す</li><li>「権限」→「通知」→「許可」にする</li></ol>}
            </>
          ) : push === "unsupported" ? (
            <p>このスマホ・ブラウザでは通知が使えません。Android は Chrome、iPhone は Safari で開いてください。それでもだめなときは事務所に相談してください。</p>
          ) : (
            <button type="button" onClick={onPush} className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 text-base font-bold" data-gate-push="">通知を ON にする</button>
          )}
          {pushMessage && <p className="text-xs font-semibold text-red-700">{pushMessage}</p>}
        </Row>
        <p className="text-xs text-gray-500 text-center leading-relaxed">通知には、事務所からのメッセージ・打刻の押し忘れ・休憩のとり忘れのお知らせが届きます。</p>
      </div>
    </div>
  );
}

// ── 休憩なしの時間・拘束時間 ─────────────────────────────────
interface Rec { eventType: string; recordedAt: string }
export function WorkTimeBar({ records, now }: { records: Rec[]; now: Date }) {
  const sorted = [...records].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const inRec = sorted.find((r) => r.eventType === "clock_in");
  const last = sorted[sorted.length - 1];
  if (!inRec || !last || last.eventType === "clock_out") return null;
  const t = now.getTime();
  const restraint = (t - new Date(inRec.recordedAt).getTime()) / 60000;
  const onBreak = last.eventType === "break_start";
  const resume = [...sorted].reverse().find((r) => r.eventType === "clock_in" || r.eventType === "break_end")!;
  const cont = onBreak ? 0 : (t - new Date(resume.recordedAt).getTime()) / 60000;
  const brk = onBreak ? (t - new Date(last.recordedAt).getTime()) / 60000 : 0;
  const Bar = ({ label, value, max, warn, limitText }: { label: string; value: number; max: number; warn: number; limitText: string }) => {
    const tone = value >= max ? "red" : value >= warn ? "amber" : "emerald";
    const cls = { red: "bg-red-500", amber: "bg-amber-500", emerald: "bg-emerald-500" }[tone];
    const txt = { red: "text-red-700", amber: "text-amber-700", emerald: "text-gray-800" }[tone];
    return (
      <div>
        <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-gray-600">{label}</span><span className={`font-bold tabular-nums ${txt}`}>{hm(value)} <span className="font-normal text-gray-500">／ {limitText}</span></span></div>
        <div className="h-2 rounded-full bg-gray-100 mt-1 overflow-hidden"><div className={`h-full ${cls}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
      </div>
    );
  };
  return (
    <div className="mx-4 mt-3 rounded-xl border bg-white px-4 py-3 space-y-2.5" data-work-time="">
      {onBreak
        ? <p className="text-sm font-bold text-yellow-700">☕ 休憩中 {hm(brk)}（4時間ごとに合計30分以上とってください）</p>
        : <Bar label="休憩なしで続けて" value={cont} max={240} warn={210} limitText="4時間まで" />}
      <Bar label="拘束時間（出勤から）" value={restraint} max={13 * 60} warn={12 * 60} limitText="原則13時間・最大15時間" />
      {!onBreak && cont >= 240 && <p className="text-xs font-bold text-red-700">休憩なしで4時間を超えています。安全な所に止めて休憩し、「休憩開始」を押してください。</p>}
      <p className="text-[11px] text-gray-400">打刻からの目安です（トラック運転者の改善基準告示）。</p>
    </div>
  );
}

// ── 申請（経費・立替／休み） ─────────────────────────────────
interface Expense { id: number; useDate: string; category: string; amount: number; note: string | null; fileId: number | null; status: string; settleYear: number | null; settleMonth: number | null; decisionNote: string | null }
interface Leave { id: number; workDate: string; absenceType: string; reason: string | null; status: string; decisionNote: string | null }
interface Options { expenseTypes: Array<{ value: string; label: string }>; leaveTypes: Array<{ value: string; label: string; days: number }> }

const STATUS: Record<string, [string, string]> = {
  pending: ["確認待ち", "bg-amber-100 text-amber-800"], approved: ["承認", "bg-emerald-100 text-emerald-800"],
  rejected: ["見送り", "bg-red-100 text-red-700"], canceled: ["取り下げ", "bg-gray-100 text-gray-500"],
};
const Badge = ({ s }: { s: string }) => <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS[s]?.[1] ?? "bg-gray-100"}`}>{STATUS[s]?.[0] ?? s}</span>;

export function RequestsTab({ employeeId, headers, online, paidLeaveRemaining, onDone }: { employeeId: number; headers: Headers; online: boolean; paidLeaveRemaining: number | null; onDone: (msg: string) => void }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [mode, setMode] = useState<"expense" | "leave">("expense");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 経費
  const [eDate, setEDate] = useState(todayJst());
  const [eCat, setECat] = useState("fuel");
  const [eAmount, setEAmount] = useState("");
  const [eNote, setENote] = useState("");
  const [eFile, setEFile] = useState<File | null>(null);
  // 休み
  const [lDate, setLDate] = useState("");
  const [lType, setLType] = useState("paid_leave");
  const [lReason, setLReason] = useState("");

  const load = useCallback(() => {
    call<Options>(headers, `/staff/${employeeId}/options`).then(setOpts).catch(() => {});
    call<Expense[]>(headers, `/staff/${employeeId}/expenses`).then(setExpenses).catch(() => {});
    call<Leave[]>(headers, `/staff/${employeeId}/leaves`).then(setLeaves).catch(() => {});
  }, [employeeId, headers]);
  useEffect(() => { load(); }, [load]);

  const sendExpense = async () => {
    setErr(null);
    if (!online) { setErr("電波のある所で申請してください。"); return; }
    const amount = Number(eAmount.replace(/[,，円¥]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) { setErr("金額を入れてください"); return; }
    if (eCat === "other" && !eNote.trim()) { setErr("「その他」のときは何に使ったかを書いてください"); return; }
    setBusy(true);
    try {
      const fileId = eFile ? await uploadStaffFile(employeeId, "receipt", eFile, headers) : null;
      await call(headers, `/staff/${employeeId}/expenses`, { method: "POST", body: JSON.stringify({ useDate: eDate, category: eCat, amount, note: eNote, fileId, clientId: newId() }) });
      setEAmount(""); setENote(""); setEFile(null);
      onDone("経費・立替を申請しました。事務所が確かめると、給与と一緒に払われます");
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "申請できませんでした"); }
    setBusy(false);
  };
  const sendLeave = async () => {
    setErr(null);
    if (!online) { setErr("電波のある所で申請してください。"); return; }
    if (!lDate) { setErr("日付を選んでください"); return; }
    setBusy(true);
    try {
      await call(headers, `/staff/${employeeId}/leaves`, { method: "POST", body: JSON.stringify({ workDate: lDate, absenceType: lType, reason: lReason, clientId: newId() }) });
      setLDate(""); setLReason("");
      onDone("休みを申請しました。事務所が確かめると知らせが届きます");
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "申請できませんでした"); }
    setBusy(false);
  };
  const cancel = async (kind: "expenses" | "leaves", id: number) => {
    try { await call(headers, `/staff/${employeeId}/${kind}/${id}/cancel`, { method: "POST", body: "{}" }); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "取り下げられませんでした"); }
  };
  const chip = (on: boolean) => `rounded-xl py-2.5 text-sm font-semibold border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-white text-gray-700 border-gray-200"}`;
  const input = "w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base";
  const expenseLabel = (v: string) => opts?.expenseTypes.find((x) => x.value === v)?.label ?? v;
  const leaveLabel = (v: string) => opts?.leaveTypes.find((x) => x.value === v)?.label ?? v;

  return (
    <div className="mx-4 mt-3 mb-3 space-y-3" data-requests-tab="">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white border p-1.5">
        <button type="button" onClick={() => { setMode("expense"); setErr(null); }} className={`rounded-xl py-2.5 text-sm font-bold ${mode === "expense" ? "bg-primary text-primary-foreground" : "text-gray-600"}`}>⛽ 経費・立替</button>
        <button type="button" onClick={() => { setMode("leave"); setErr(null); }} className={`rounded-xl py-2.5 text-sm font-bold ${mode === "leave" ? "bg-primary text-primary-foreground" : "text-gray-600"}`}>🌴 休み・有給</button>
      </div>

      {mode === "expense" ? (
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">ガソリン・高速代・駐車場などを立て替えたら、レシートを撮って申請してください。事務所が確かめると、<b>給与と一緒に払われます</b>。</p>
          <div className="grid grid-cols-4 gap-1.5">
            {(opts?.expenseTypes ?? []).map((t) => <button key={t.value} type="button" onClick={() => setECat(t.value)} className={chip(eCat === t.value)}>{t.label}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">使った日</span>
              <input type="date" value={eDate} max={todayJst()} onChange={(e) => setEDate(e.target.value)} className={input} /></label>
            <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">金額（円）</span>
              <input type="text" inputMode="numeric" value={eAmount} onChange={(e) => setEAmount(e.target.value)} placeholder="例：5000" className={input} data-expense-amount="" /></label>
          </div>
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">メモ{eCat === "other" ? "（何に使ったか）" : "（任意）"}</span>
            <input type="text" value={eNote} onChange={(e) => setENote(e.target.value)} placeholder={eCat === "fuel" ? "例：〇〇SS 軽油" : eCat === "toll" ? "例：東名 厚木〜東京" : ""} className={input} /></label>
          <PhotoField label="レシートの写真" file={eFile} onFile={setEFile} accept="image/*,application/pdf" />
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <button type="button" disabled={busy} onClick={sendExpense} className="w-full rounded-xl py-3.5 bg-primary text-primary-foreground text-base font-bold disabled:opacity-50" data-expense-send="">{busy ? "送っています…" : "申請する"}</button>
        </div>
      ) : (
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">休みたい日を申請してください。事務所が確かめると知らせが届き、勤怠にも入ります。{paidLeaveRemaining !== null && <> いまの有給の残りは <b className="text-gray-800">{paidLeaveRemaining}日</b> です。</>}</p>
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">日付</span>
            <input type="date" value={lDate} min={todayJst()} onChange={(e) => setLDate(e.target.value)} className={input} data-leave-date="" /></label>
          <div className="grid grid-cols-2 gap-1.5">
            {(opts?.leaveTypes ?? []).map((t) => <button key={t.value} type="button" onClick={() => setLType(t.value)} className={chip(lType === t.value)}>{t.label}</button>)}
          </div>
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">理由・連絡（任意）</span>
            <input type="text" value={lReason} onChange={(e) => setLReason(e.target.value)} placeholder="例：通院のため" className={input} /></label>
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <button type="button" disabled={busy} onClick={sendLeave} className="w-full rounded-xl py-3.5 bg-primary text-primary-foreground text-base font-bold disabled:opacity-50" data-leave-send="">{busy ? "送っています…" : "申請する"}</button>
        </div>
      )}

      <div className="rounded-2xl border bg-white overflow-hidden">
        <p className="px-4 py-2.5 text-xs font-bold text-gray-500 border-b bg-gray-50">これまでの申請</p>
        {mode === "expense" ? (
          expenses.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">まだありません</p> : (
            <ul className="divide-y">
              {expenses.map((x) => (
                <li key={x.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{expenseLabel(x.category)} <span className="tabular-nums">{yen(x.amount)}</span></p>
                    <p className="text-xs text-gray-500">{fmtMD(x.useDate)}{x.note ? `・${x.note}` : ""}{x.fileId ? "・📷" : ""}</p>
                    {x.status === "approved" && x.settleMonth && <p className="text-xs text-emerald-700">{x.settleMonth}月分の給与で払います</p>}
                    {x.decisionNote && <p className="text-xs text-gray-600">事務所：{x.decisionNote}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge s={x.status} />
                    {x.status === "pending" && <button type="button" onClick={() => cancel("expenses", x.id)} className="text-xs text-gray-500 underline">取り下げる</button>}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          leaves.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">まだありません</p> : (
            <ul className="divide-y">
              {leaves.map((x) => (
                <li key={x.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{fmtMD(x.workDate)} {leaveLabel(x.absenceType)}</p>
                    {x.reason && <p className="text-xs text-gray-500">{x.reason}</p>}
                    {x.decisionNote && <p className="text-xs text-gray-600">事務所：{x.decisionNote}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge s={x.status} />
                    {x.status === "pending" && <button type="button" onClick={() => cancel("leaves", x.id)} className="text-xs text-gray-500 underline">取り下げる</button>}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

// ── わたしの記録・給与明細 ─────────────────────────────────
interface Summary {
  year: number; month: number;
  days: Array<{ date: string; clockIn: string | null; clockOut: string | null; open: boolean; workMinutes: number; restraintMinutes: number; flags: string[] }>;
  totals: { workDays: number; actualWorkHours: number; overtimeHours: number; restDayOvertimeHours: number; lateNightHours: number; drivingDistanceKm: number; absenceDays: number; paidLeaveDays: number; missingClockOut: string[] } | null;
  restraintMinutes: number;
  paidLeave: { remaining: number; obligation: { deadline: string; taken: number; shortage: number } | null } | null;
}
interface SlipItem { id: number; year: number; month: number; grossSalary: number; netSalary: number }
interface Slip { id: number; year: number; month: number; workDays: number; overtimeHours: number; lateNightHours: number; paidLeaveDays: number; earnings: Array<{ label: string; amount: number }>; deductions: Array<{ label: string; amount: number }>; grossSalary: number; totalDeductions: number; netSalary: number }

export function useStaffSummary(employeeId: number, headers: Headers, enabled: boolean, ym: { y: number; m: number }) {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    call<Summary>(headers, `/staff/${employeeId}/summary?year=${ym.y}&month=${ym.m}`).then(setData).catch(() => {});
  }, [employeeId, headers, enabled, ym.y, ym.m]);
  return data;
}

export function MeTab({ employeeId, headers, payslipEnabled }: { employeeId: number; headers: Headers; payslipEnabled: boolean }) {
  const t = todayJst();
  const [ym, setYm] = useState({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) });
  const data = useStaffSummary(employeeId, headers, true, ym);
  const [slips, setSlips] = useState<{ enabled: boolean; items: SlipItem[] } | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [slipErr, setSlipErr] = useState<string | null>(null);
  useEffect(() => { call<{ enabled: boolean; items: SlipItem[] }>(headers, `/staff/${employeeId}/payslips`).then(setSlips).catch(() => setSlips({ enabled: false, items: [] })); }, [employeeId, headers]);
  const move = (d: number) => setYm(({ y, m }) => { const n = new Date(Date.UTC(y, m - 1 + d, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 }; });
  const isNow = ym.y === Number(t.slice(0, 4)) && ym.m === Number(t.slice(5, 7));
  const open = async (id: number) => {
    setSlipErr(null);
    try { setSlip(await call<Slip>(headers, `/staff/${employeeId}/payslips/${id}`)); } catch (e) { setSlipErr(e instanceof Error ? e.message : "開けませんでした"); }
  };
  const tt = data?.totals;
  const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-xl border bg-white px-3 py-2.5"><p className="text-[11px] font-semibold text-gray-500">{label}</p><p className="text-lg font-bold text-gray-900 tabular-nums leading-tight mt-0.5">{value}</p>{sub && <p className="text-[11px] text-gray-500">{sub}</p>}</div>
  );
  return (
    <div className="mx-4 mt-3 mb-3 space-y-3" data-me-tab="">
      <div className="flex items-center justify-between rounded-2xl bg-white border px-2 py-1.5">
        <button type="button" onClick={() => move(-1)} className="px-3 py-2 text-lg text-gray-600" aria-label="前の月">‹</button>
        <p className="font-bold text-gray-900">{ym.y}年{ym.m}月の記録</p>
        <button type="button" onClick={() => move(1)} disabled={isNow} className="px-3 py-2 text-lg text-gray-600 disabled:opacity-20" aria-label="次の月">›</button>
      </div>
      {!data ? <div className="h-32 rounded-xl bg-gray-100 animate-pulse" /> : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="出勤した日" value={`${tt?.workDays ?? 0}日`} />
            <Tile label="実働" value={`${tt?.actualWorkHours ?? 0}h`} />
            <Tile label="残業" value={`${((tt?.overtimeHours ?? 0) + (tt?.restDayOvertimeHours ?? 0)).toFixed(1)}h`} sub={tt?.restDayOvertimeHours ? `休日 ${tt.restDayOvertimeHours}h を含む` : undefined} />
            <Tile label="深夜" value={`${tt?.lateNightHours ?? 0}h`} />
            <Tile label="拘束" value={`${Math.floor(data.restraintMinutes / 60)}h${String(Math.round(data.restraintMinutes % 60)).padStart(2, "0")}`} sub="月284時間まで" />
            <Tile label="走行距離" value={`${(tt?.drivingDistanceKm ?? 0).toLocaleString("ja-JP")}km`} />
          </div>
          {data.paidLeave && (
            <div className="rounded-xl border bg-white px-4 py-3 text-sm">
              <p className="font-semibold text-gray-900">🌴 有給の残り <span className="text-lg tabular-nums">{data.paidLeave.remaining}日</span></p>
              {data.paidLeave.obligation && (
                <p className={`text-xs mt-1 ${data.paidLeave.obligation.shortage > 0 ? "text-amber-700" : "text-gray-500"}`}>
                  {Number(data.paidLeave.obligation.deadline.slice(0, 4))}年{fmtMD(data.paidLeave.obligation.deadline)}までに年5日：いま{data.paidLeave.obligation.taken}日{data.paidLeave.obligation.shortage > 0 ? `（あと${data.paidLeave.obligation.shortage}日とってください）` : "（とれています）"}
                </p>
              )}
            </div>
          )}
          {(tt?.missingClockOut?.length ?? 0) > 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">退勤が押されていない日があります：{tt!.missingClockOut.map(fmtMD).join("・")}。「打刻の修正を申請」から直してください。</p>
          )}
          <div className="rounded-2xl border bg-white overflow-hidden">
            <p className="px-4 py-2.5 text-xs font-bold text-gray-500 border-b bg-gray-50">日ごと</p>
            {data.days.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">この月の打刻はありません</p> : (
              <ul className="divide-y">
                {[...data.days].reverse().map((d) => (
                  <li key={d.date} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-14 font-semibold text-gray-900">{fmtMD(d.date)}</span>
                      <span className="flex-1 text-gray-600 tabular-nums">{d.clockIn ? fmtHM(d.clockIn) : "—"} 〜 {d.clockOut ? fmtHM(d.clockOut) : d.open ? "（勤務中）" : "—"}</span>
                      <span className="text-gray-900 font-semibold tabular-nums">{hm(d.workMinutes)}</span>
                    </div>
                    {d.flags.map((f) => <p key={f} className="text-[11px] text-amber-700 mt-0.5">⚠ {f}</p>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {payslipEnabled && slips?.enabled && (
        <div className="rounded-2xl border bg-white overflow-hidden" data-payslips="">
          <p className="px-4 py-2.5 text-xs font-bold text-gray-500 border-b bg-gray-50">💴 給与明細（確定したもの）</p>
          {slips.items.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">まだありません</p> : (
            <ul className="divide-y">
              {slips.items.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => open(s.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-gray-50" data-payslip-open="">
                    <span className="flex-1 font-semibold text-gray-900">{s.year}年{s.month}月分</span>
                    <span className="text-xs text-gray-500">手取り</span>
                    <span className="font-bold tabular-nums text-gray-900">{yen(s.netSalary)}</span>
                    <span className="text-gray-400">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {slipErr && <p className="px-4 py-2 text-xs text-red-700">{slipErr}</p>}
        </div>
      )}

      <Sheet open={!!slip} onClose={() => setSlip(null)} title={slip ? `${slip.year}年${slip.month}月分 給与明細` : ""}>
        {slip && (
          <div className="space-y-3" data-payslip="">
            <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 text-center">
              <p className="text-xs text-gray-600">差引支給額（手取り）</p>
              <p className="text-3xl font-bold tabular-nums text-gray-900">{yen(slip.netSalary)}</p>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
              {[["出勤", `${slip.workDays}日`], ["残業", `${slip.overtimeHours}h`], ["深夜", `${slip.lateNightHours}h`], ["有給", `${slip.paidLeaveDays}日`]].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-gray-50 border py-1.5"><p className="text-gray-500">{l}</p><p className="font-bold text-gray-900">{v}</p></div>
              ))}
            </div>
            {([["支給", slip.earnings, slip.grossSalary], ["控除", slip.deductions, slip.totalDeductions]] as const).map(([label, rows, total]) => (
              <div key={label} className="rounded-xl border overflow-hidden">
                <p className="px-3 py-2 text-xs font-bold text-gray-600 bg-gray-50 border-b">{label}</p>
                <ul className="divide-y text-sm">
                  {rows.map((r, i) => <li key={i} className="flex justify-between px-3 py-1.5"><span className="text-gray-700">{r.label}</span><span className="tabular-nums text-gray-900">{yen(r.amount)}</span></li>)}
                  <li className="flex justify-between px-3 py-2 font-bold bg-gray-50"><span>{label}の合計</span><span className="tabular-nums">{yen(total)}</span></li>
                </ul>
              </div>
            ))}
            <p className="text-[11px] text-gray-400 text-center">分からないところは事務所に聞いてください。正式な明細は事務所でお渡しするものです。</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
