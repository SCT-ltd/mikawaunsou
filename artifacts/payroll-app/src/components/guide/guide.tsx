import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, X, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { guideFor, type GuideStep } from "@/lib/guides";

/**
 * 画面のガイド（ステップごとに、画面の一部を明るく照らして説明する）。
 *   ・どの画面でも右上の「ガイド」で始められる。初めて開いた画面では一度だけ自動で始まる（端末ごとに覚える）
 *   ・照らす場所（target）は「css:セレクタ」「text:ボタンや見出しの文字（先頭一致）」で書く（lib/guides.ts）
 *   ・照らす場所が見つからない・隠れているときは、画面の真ん中に説明だけ出す（止まらない）
 * 中身の文章は lib/guides.ts。画面の言葉を変えたら、あちらも直す。
 */
const SEEN_KEY = "mikawa.guide.seen.v1";

function seenSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as string[]); } catch { return new Set(); }
}
function markSeen(key: string) {
  try { const s = seenSet(); s.add(key); localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } catch { /* 使えない端末では覚えない */ }
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none";
};
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "");
const TEXT_SEL = "button,[role=tab],a,label,th,h1,h2,h3,h4,[class*=CardTitle],[data-slot=card-title]";

/** 照らす場所を探す（ガイド自身の部品は除く） */
export function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  // 「A || B」＝A が見つからなければ B（スマホで左のメニューが隠れているときなど）
  if (target.includes(" || ")) {
    for (const t of target.split(" || ")) { const el = findTarget(t); if (el) return el; }
    return null;
  }
  const outside = (el: Element) => !el.closest("[data-guide-layer]");
  if (target.startsWith("css:")) {
    for (const el of document.querySelectorAll(target.slice(4))) if (outside(el) && visible(el)) return el as HTMLElement;
    return null;
  }
  if (target.startsWith("card:")) {
    // その文字を含むいちばん内側の要素から、枠（角丸＋線）まで上がる
    const want = norm(target.slice(5));
    const main = document.getElementById("layout-main") ?? document.body;
    let best: Element | null = null;
    for (const el of main.querySelectorAll("*")) {
      if (el.children.length > 4 || !norm(el.textContent).startsWith(want) || !visible(el)) continue;
      if (!best || norm(el.textContent).length < norm(best.textContent).length) best = el;
    }
    let el: Element | null = best;
    while (el && el !== main && !(/\brounded/.test(el.className?.toString?.() ?? "") && /\bborder\b/.test(el.className?.toString?.() ?? ""))) el = el.parentElement;
    return (el && el !== main ? el : best) as HTMLElement | null;
  }
  if (target.startsWith("text:") || target.startsWith("re:")) {
    const re = target.startsWith("re:") ? new RegExp(target.slice(3)) : null;
    const want = re ? "" : norm(target.slice(5));
    const scopes = [document.querySelector("[role=dialog]"), document.getElementById("layout-main"), document.body].filter(Boolean) as Element[];
    for (const scope of scopes) {
      // 中身がいちばん短い（＝いちばん内側の）ものを選ぶ
      let best: HTMLElement | null = null;
      for (const el of scope.querySelectorAll(TEXT_SEL)) {
        if (!outside(el) || !visible(el)) continue;
        const t = norm(el.textContent);
        if ((re ? re.test(t) : t.startsWith(want)) && (!best || t.length < norm(best.textContent).length)) best = el as HTMLElement;
      }
      if (best) return best;
    }
  }
  return null;
}

type Ctx = { start: () => void; available: boolean };
const GuideContext = createContext<Ctx>({ start: () => {}, available: false });
export const useGuide = () => useContext(GuideContext);

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const guide = guideFor(location);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  const start = useCallback(() => { setI(0); setOpen(true); }, []);
  const close = useCallback(() => { setOpen(false); if (guide) markSeen(guide.key); }, [guide]);

  // 画面が変わったら閉じる。初めての画面なら、表示が落ち着いてから一度だけ自動で始める
  useEffect(() => {
    setOpen(false);
    if (!guide || seenSet().has(guide.key)) return;
    const t = setTimeout(() => {
      if (document.querySelector("[role=dialog],[role=alertdialog]")) return; // 何かの窓が開いていたら邪魔しない
      setI(0); setOpen(true);
    }, 1400);
    return () => clearTimeout(t);
  }, [guide?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GuideContext.Provider value={{ start, available: !!guide }}>
      {children}
      {open && guide && <GuideOverlay steps={guide.steps} title={guide.title} index={i} setIndex={setI} onClose={close} />}
    </GuideContext.Provider>
  );
}

/** 右上の「ガイド」ボタン */
export function GuideButton() {
  const { start, available } = useGuide();
  if (!available) return null;
  return (
    <button type="button" onClick={start} data-tour="guide-btn"
      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
      title="この画面の使い方を順番に説明します">
      <Compass className="h-4 w-4" /><span className="hidden sm:inline">ガイド</span>
    </button>
  );
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;

function GuideOverlay({ steps, title, index, setIndex, onClose }: {
  steps: GuideStep[]; title: string; index: number; setIndex: (n: number) => void; onClose: () => void;
}) {
  const step = steps[index]!;
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bh, setBh] = useState(200);
  const last = index === steps.length - 1;

  // 照らす場所を画面の中へ寄せる
  useEffect(() => {
    const el = findTarget(step.target);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [step]);

  // 位置を追いかける（スクロール・画面の大きさの変化・遅れて出てくる部品に合わせる）
  useEffect(() => {
    let raf = 0;
    let el: HTMLElement | null = null;
    let at = 0;
    const tick = () => {
      const now = performance.now();
      if (!el || !el.isConnected || now - at > 600) { el = findTarget(step.target); at = now; }
      const r = el?.getBoundingClientRect();
      setRect((prev) => {
        if (!r) return prev === null ? prev : null;
        const n = { top: r.top, left: r.left, width: r.width, height: r.height };
        return prev && Math.abs(prev.top - n.top) < 0.5 && Math.abs(prev.left - n.left) < 0.5 && Math.abs(prev.width - n.width) < 0.5 && Math.abs(prev.height - n.height) < 0.5 ? prev : n;
      });
      setVw(window.innerWidth); setVh(window.innerHeight);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => { if (bubbleRef.current) setBh(bubbleRef.current.offsetHeight); }, [index, rect, vw]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (last) onClose(); else setIndex(index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (index > 0) setIndex(index - 1); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [index, last, onClose, setIndex]);

  const mobile = vw < 640;
  const W = Math.min(360, vw - 24);
  // 吹き出しの置き場所：照らした所の下 → 入らなければ上 → それも無理なら右／左 → 真ん中
  let pos: React.CSSProperties;
  if (mobile) {
    // スマホは画面の下にまとめる。照らした所が下半分なら上に出す
    const low = rect && rect.top + rect.height / 2 > vh * 0.55;
    pos = low ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
  } else if (!rect) {
    pos = { left: (vw - W) / 2, top: Math.max(12, (vh - bh) / 2), width: W };
  } else {
    const below = rect.top + rect.height + PAD + 12;
    const above = rect.top - PAD - 12 - bh;
    const cx = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), vw - W - 12);
    if (below + bh <= vh - 12) pos = { left: cx, top: below, width: W };
    else if (above >= 12) pos = { left: cx, top: above, width: W };
    else if (rect.left + rect.width + PAD + 12 + W <= vw - 12) pos = { left: rect.left + rect.width + PAD + 12, top: Math.min(Math.max(12, rect.top), vh - bh - 12), width: W };
    else if (rect.left - PAD - 12 - W >= 12) pos = { left: rect.left - PAD - 12 - W, top: Math.min(Math.max(12, rect.top), vh - bh - 12), width: W };
    else pos = { left: (vw - W) / 2, top: Math.max(12, vh - bh - 12), width: W };
  }

  return createPortal(
    <div data-guide-layer="" className="fixed inset-0 z-[2000]" role="dialog" aria-modal="true" aria-label={`${title}のガイド`}>
      {/* 暗くする幕（照らす所だけ穴を開ける）。押しても何も起きないようにして、ガイド中の誤操作を防ぐ */}
      {rect ? (
        <div className="absolute rounded-xl ring-2 ring-amber-400 transition-all duration-200 pointer-events-none"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgba(15,23,42,0.58)" }}
          data-guide-spot="" />
      ) : <div className="absolute inset-0 bg-slate-900/60" />}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div ref={bubbleRef} style={pos} data-guide-bubble=""
        className="absolute rounded-2xl bg-card text-card-foreground shadow-2xl border overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"><Compass className="h-3.5 w-3.5" />{title}のガイド</span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums" data-guide-count="">{index + 1} / {steps.length}</span>
          <button type="button" onClick={onClose} aria-label="ガイドを閉じる" className="-mr-1 p-1 rounded hover:bg-muted text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-4 pt-1.5 pb-3">
          <p className="font-bold text-[15px] leading-snug" data-guide-title="">{step.title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1.5 whitespace-pre-line">{step.body}</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 border-t bg-muted/30">
          <div className="flex gap-1 flex-wrap max-w-[45%]" aria-hidden="true">
            {steps.map((_, n) => (
              <button key={n} type="button" tabIndex={-1} onClick={() => setIndex(n)}
                className={cn("h-1.5 rounded-full transition-all", n === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50")} />
            ))}
          </div>
          <span className="flex-1" />
          {index > 0 && (
            <button type="button" onClick={() => setIndex(index - 1)} className="inline-flex items-center h-8 px-2.5 rounded-md text-sm text-muted-foreground hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />戻る
            </button>
          )}
          <button type="button" onClick={() => (last ? onClose() : setIndex(index + 1))} data-guide-next=""
            className="inline-flex items-center h-8 px-3.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
            {last ? "わかった" : <>次へ<ChevronRight className="h-4 w-4 -mr-1" /></>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
