import { useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { RELEASES, LATEST_KEY, type ChangeKind } from "@/lib/changelog";

/** アップデート履歴。開いたら「見た」にして、左メニューの点を消す */
const KIND: Record<ChangeKind, { label: string; cls: string }> = {
  new: { label: "新機能", cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200" },
  improve: { label: "改善", cls: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200" },
  fix: { label: "修正", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  security: { label: "安全", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

export const SEEN_KEY = "mk_updates_seen";

export default function UpdatesPage() {
  useEffect(() => {
    try { localStorage.setItem(SEEN_KEY, LATEST_KEY); window.dispatchEvent(new Event("mk-updates-seen")); } catch { /* 保存できなくても表示はする */ }
  }, []);
  const byDate = useMemo(() => {
    const out: Array<{ date: string; releases: typeof RELEASES }> = [];
    for (const r of RELEASES) {
      if (out.at(-1)?.date !== r.date) out.push({ date: r.date, releases: [] });
      out.at(-1)!.releases.push(r);
    }
    return out;
  }, []);
  const fmt = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${y}年${m}月${day}日`; };

  return (
    <AppLayout>
      <div className="space-y-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight">アップデート</h2>
            <p className="text-[11px] text-muted-foreground leading-tight">このシステムに加えた変更の一覧です（新しい順）。</p>
          </div>
        </div>
        <ol className="relative border-l-2 border-muted ml-2 space-y-6">
          {byDate.map((g, gi) => (
            <li key={g.date} className="pl-5 relative">
              <span className={cn("absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-background", gi === 0 ? "bg-indigo-600" : "bg-muted-foreground/50")} />
              <p className="text-xs font-semibold text-muted-foreground">{fmt(g.date)}{gi === 0 && <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px]">最新</span>}</p>
              <div className="mt-2 space-y-3">
                {g.releases.map((r) => (
                  <section key={r.title} className="rounded-xl border bg-card p-4">
                    <h3 className="font-bold text-sm mb-2">{r.title}</h3>
                    <ul className="space-y-1.5">
                      {r.items.map((it, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                          <span className={cn("shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded w-12 text-center", KIND[it.kind].cls)}>{KIND[it.kind].label}</span>
                          <span>{it.text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </AppLayout>
  );
}
