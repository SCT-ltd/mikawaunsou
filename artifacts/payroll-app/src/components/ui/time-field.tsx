import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 時刻の欄（事務所の画面用）。ブラウザ標準の時刻欄は、時と分の細い列をスクロールして選ぶ形で分かりにくかったので作り直した。
 *   ・欄に数字を打つだけで入る：「1630」「16:30」「16時30分」「930」→ 09:30、「16」→ 16:00（全角の数字も可）
 *   ・時計のボタンで、時（0〜23）と分（5分きざみ）を押して選ぶ。「いま」で今の時刻
 *   ・↑↓ キーで5分ずつ動かせる
 * 値はいつも "HH:MM"（空なら ""）。
 */
export function parseTime(raw: string): string | null {
  const s = raw.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[：時]/g, ":").replace(/分/g, "").replace(/\s+/g, "");
  if (!s) return "";
  let h: number, m: number;
  const mm = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (mm) { h = Number(mm[1]); m = Number(mm[2]); }
  else if (/^\d{1,2}:?$/.test(s)) { h = Number(s.replace(":", "")); m = 0; }
  else if (/^\d{3,4}$/.test(s)) { h = Number(s.slice(0, s.length - 2)); m = Number(s.slice(-2)); }
  else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const nowHM = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(11, 16);
const addMin = (v: string, d: number) => {
  const [h, m] = (v || nowHM()).split(":").map(Number);
  const t = (((h! * 60 + m! + d) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function TimeField({
  value, onChange, className, disabled, "aria-label": ariaLabel, placeholder = "例 16:30",
}: {
  value: string; onChange: (v: string) => void; className?: string; disabled?: boolean; "aria-label"?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  /** 選ぶ欄を出す先。ダイアログの中なら、そのダイアログの中（外に出すとダイアログが「外を押した」として押せなくなる） */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(value); setBad(false); }, [value]);

  const commit = (raw: string) => {
    const v = parseTime(raw);
    if (v === null) { setBad(true); return; }
    setBad(false); setText(v);
    if (v !== value) onChange(v);
  };
  const openPop = () => {
    if (disabled) return;
    const r = boxRef.current!.getBoundingClientRect();
    const w = 300, h = 260;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    const dlg = boxRef.current!.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    if (dlg) {
      // ダイアログは transform で中央に置かれているので、ダイアログの中での位置に直す
      const d = dlg.getBoundingClientRect();
      setPos({ top: top - d.top, left: left - d.left });
    } else setPos({ top, left });
    setHost(dlg); setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || boxRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const [curH, curM] = (parseTime(text) || value || "").split(":");
  const pickH = (h: number) => { const v = `${String(h).padStart(2, "0")}:${curM ?? "00"}`; setText(v); onChange(v); };
  const pickM = (m: number) => { const v = `${curH ?? nowHM().slice(0, 2)}:${String(m).padStart(2, "0")}`; setText(v); onChange(v); setOpen(false); };

  return (
    <div ref={boxRef} className={cn("relative inline-flex items-center", className)}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        placeholder={placeholder}
        onFocus={(e) => e.target.select()}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); setOpen(false); }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const v = addMin(parseTime(text) || value, e.key === "ArrowUp" ? 5 : -5); setText(v); onChange(v); }
        }}
        className={cn(
          "h-full w-full min-w-0 rounded-md border bg-background pl-2.5 pr-8 text-sm amount outline-none focus-visible:ring-2 focus-visible:ring-ring",
          bad ? "border-red-400 focus-visible:ring-red-300" : "border-input",
          disabled && "opacity-50",
        )}
        style={{ height: "inherit" }}
      />
      <button type="button" disabled={disabled} onClick={() => (open ? setOpen(false) : openPop())}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
        aria-label="時刻を選ぶ" title="時刻を選ぶ">
        <Clock className="h-4 w-4" />
      </button>
      {bad && <span className="absolute left-0 top-full mt-0.5 text-[10px] text-red-600 whitespace-nowrap">「16:30」や「1630」の形で入れてください</span>}
      {open && createPortal(
        <div ref={popRef} className={cn(host ? "absolute" : "fixed", "z-[100] w-[300px] rounded-xl border bg-popover text-popover-foreground shadow-xl p-3 space-y-2.5")} style={{ top: pos.top, left: pos.left }}
          data-time-picker="" aria-label="時刻を選ぶ">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">時</span>
            <span className="text-sm font-bold amount">{curH ?? "--"}:{curM ?? "--"}</span>
            <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => { const v = nowHM(); setText(v); onChange(v); setOpen(false); }}>いま</button>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: 24 }, (_, h) => (
              <button key={h} type="button" onClick={() => pickH(h)}
                className={cn("h-7 rounded-md text-xs amount border", Number(curH) === h && curH !== undefined ? "bg-indigo-600 text-white border-indigo-600" : "hover:bg-muted border-transparent bg-muted/40")}>
                {h}
              </button>
            ))}
          </div>
          <span className="block text-xs font-semibold text-muted-foreground">分（押すと決まります）</span>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
              <button key={m} type="button" onClick={() => pickM(m)}
                className={cn("h-7 rounded-md text-xs amount border", Number(curM) === m && curM !== undefined ? "bg-indigo-600 text-white border-indigo-600" : "hover:bg-muted border-transparent bg-muted/40")}>
                {String(m).padStart(2, "0")}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">欄に「1630」と打っても入ります。↑↓キーで5分ずつ動かせます。</p>
        </div>,
        host ?? document.body,
      )}
    </div>
  );
}
