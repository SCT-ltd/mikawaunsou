import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Megaphone, Search, Check, X, Users, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Conversation, Avatar } from "./shared";
import { AttachButton, PendingStrip, type PendingFile } from "./attachments";

/**
 * 一斉送信（事務所だけ）。
 *   左＝送り先（名前で探す・所属ごとにまとめて選ぶ・選んだ人は上に札で並ぶ）
 *   右＝メッセージ（スタッフにどう届くかをその場で見せる）
 * 一斉送信は取り消せないので、Enter だけでは送らない（Ctrl+Enter か送信ボタン）。
 */
export function BroadcastDialog({
  open,
  onOpenChange,
  conversations,
  text,
  onTextChange,
  selected,
  onToggleEmployee,
  onToggleAll,
  onSelectMany,
  broadcasting,
  done,
  onSend,
  onCancel,
  files,
  onFiles,
  onRemoveFile,
}: {
  /** 送る前の添付（写真・PDF） */
  files: PendingFile[];
  onFiles: (f: FileList) => void;
  onRemoveFile: (key: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  text: string;
  onTextChange: (v: string) => void;
  selected: Set<number>;
  onToggleEmployee: (id: number) => void;
  onToggleAll: () => void;
  /** 所属ごとにまとめて入れる／外す */
  onSelectMany: (ids: number[], on: boolean) => void;
  broadcasting: boolean;
  done: number | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string | null>(null);

  // 所属ごとの人数
  const groups = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const c of conversations) {
      const k = c.employee.department || "所属なし";
      m.set(k, [...(m.get(k) ?? []), c.employee.id]);
    }
    return [...m.entries()].map(([name, ids]) => ({ name, ids }));
  }, [conversations]);

  const shown = conversations.filter((c) => {
    if (dept && (c.employee.department || "所属なし") !== dept) return false;
    const s = q.trim();
    return !s || c.employee.name.replace(/\s/g, "").includes(s.replace(/\s/g, "")) || (c.employee.department ?? "").includes(s);
  });
  const chosen = conversations.filter((c) => selected.has(c.employee.id));
  const allOn = selected.size === conversations.length && conversations.length > 0;
  const canSend = (!!text.trim() || files.length > 0) && !broadcasting && selected.size > 0;
  const shownIds = shown.map((c) => c.employee.id);
  const shownAllOn = shownIds.length > 0 && shownIds.every((id) => selected.has(id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg md:max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3.5 border-b bg-amber-50/60">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="h-8 w-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center"><Megaphone className="h-4.5 w-4.5" /></span>
            <span>一斉送信</span>
            <span className="text-xs font-normal text-muted-foreground ml-1 hidden sm:inline">選んだスタッフ全員の会話に、同じメッセージが届きます</span>
          </DialogTitle>
        </DialogHeader>

        {done != null ? (
          <div className="text-center px-6 py-12">
            <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto mb-3" />
            <p className="font-bold text-green-700 text-lg jp-tight">{done}名に送信しました</p>
            <p className="text-sm text-muted-foreground mt-1">読まれると、各会話の吹き出しの下に「既読」が付きます。</p>
            <Button className="mt-6" onClick={onCancel}>閉じる</Button>
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] min-h-0 max-h-[calc(100dvh-10rem)] md:h-[560px] overflow-y-auto md:overflow-hidden">
              {/* ── 左：送り先 ── */}
              <section className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r">
                <div className="px-4 pt-4 pb-3 space-y-2.5 border-b bg-muted/20">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold flex items-center gap-1.5"><Users className="h-4 w-4 text-muted-foreground" />送り先</p>
                    <span className="text-xs"><b className="text-base text-primary tabular-nums">{selected.size}</b><span className="text-muted-foreground"> / {conversations.length}名</span></span>
                  </div>
                  <div className="relative">
                    <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・所属で探す"
                      className="w-full h-9 rounded-lg border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  {/* 所属で絞る（押すとその所属だけ表示・右の「まとめて」で一括） */}
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setDept(null)}
                      className={cn("px-2.5 h-7 rounded-full text-xs border", !dept ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted")}>すべて</button>
                    {groups.map((g) => {
                      const n = g.ids.filter((id) => selected.has(id)).length;
                      return (
                        <button key={g.name} type="button" onClick={() => setDept(dept === g.name ? null : g.name)}
                          className={cn("px-2.5 h-7 rounded-full text-xs border inline-flex items-center gap-1", dept === g.name ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted")}>
                          {g.name}<span className={cn("tabular-nums", dept === g.name ? "opacity-80" : "text-muted-foreground")}>{n}/{g.ids.length}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 text-xs border-b">
                  {(q || dept) && (
                    <button type="button" onClick={() => onSelectMany(shownIds, !shownAllOn)} disabled={!shownIds.length}
                      className="font-semibold text-primary hover:underline disabled:opacity-40" data-broadcast-many="">
                      {shownAllOn ? `表示中の${shownIds.length}名を外す` : `表示中の${shownIds.length}名をまとめて選ぶ`}
                    </button>
                  )}
                  <span className="flex-1" />
                  <button type="button" onClick={onToggleAll} className="font-semibold text-primary hover:underline">{allOn ? "全員解除" : "全員選択"}</button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto max-h-72 md:max-h-none" data-broadcast-list="">
                  {shown.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">当てはまるスタッフがいません</p>}
                  {shown.map((conv) => {
                    const on = selected.has(conv.employee.id);
                    return (
                      <button key={conv.employee.id} type="button" onClick={() => onToggleEmployee(conv.employee.id)} aria-pressed={on}
                        className={cn("w-full flex items-center gap-3 px-4 py-2 text-left border-b last:border-b-0 transition-colors", on ? "bg-primary/[0.06]" : "hover:bg-muted/40")}>
                        <span className={cn("h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center", on ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40")}>
                          {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                        <Avatar name={conv.employee.name} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate jp-tight">{conv.employee.name}</span>
                          <span className="block text-xs text-muted-foreground truncate">{conv.employee.department}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* ── 右：メッセージ ── */}
              <section className="flex flex-col min-h-0">
                <div className="px-4 pt-4 pb-4 md:pb-3 md:flex-1 md:min-h-0 md:overflow-y-auto space-y-3">
                  <p className="text-sm font-semibold">メッセージ</p>
                  <textarea
                    value={text}
                    onChange={(e) => onTextChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (canSend) onSend(); } }}
                    placeholder={"例）明日は雨の予報です。出発前に積み荷のシートを確認してください。"}
                    rows={6}
                    autoFocus
                    className="w-full rounded-xl border bg-background px-3.5 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                  <div className="rounded-xl border border-dashed p-3">
                    <PendingStrip files={files} onRemove={onRemoveFile} />
                    <div className="flex items-center gap-2.5">
                      <AttachButton onFiles={onFiles} disabled={broadcasting} className="h-9 w-9" />
                      <span className="text-xs text-muted-foreground leading-snug">写真・PDFを添付（1回に4つ・1つ10MBまで）<br className="hidden sm:block" />添付だけでも送れます</span>
                    </div>
                  </div>

                  {/* スタッフの画面での見え方 */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">スタッフの画面ではこう届きます</p>
                    <div className="rounded-xl bg-muted/40 p-3 flex gap-2">
                      <span className="h-7 w-7 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-bold">事</span>
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground mb-0.5">事務所</p>
                        <div className="rounded-2xl rounded-tl-sm bg-white border px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-full">
                          {text.trim() || (files.length ? <span className="text-muted-foreground">📎 添付 {files.length}件</span> : <span className="text-muted-foreground">（メッセージを入力するとここに出ます）</span>)}
                        </div>
                        {text.trim() && files.length > 0 && <p className="text-[11px] text-muted-foreground mt-1">＋ 📎 添付 {files.length}件</p>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 送る前に宛先を見直せるように、選んだ人を札で */}
                <div className="px-4 py-3 border-t bg-muted/20">
                  <p className="text-xs text-muted-foreground mb-1.5">送り先 {selected.size}名</p>
                  <div className="flex flex-wrap gap-1 max-h-[3.4rem] overflow-y-auto" data-broadcast-chips="">
                    {chosen.length === 0 && <span className="text-xs text-destructive">送り先が選ばれていません</span>}
                    {chosen.map((c) => (
                      <span key={c.employee.id} className="inline-flex items-center gap-0.5 pl-2 pr-1 h-6 rounded-full bg-background border text-xs">
                        {c.employee.name}
                        <button type="button" onClick={() => onToggleEmployee(c.employee.id)} aria-label={`${c.employee.name}を外す`} className="h-4 w-4 rounded-full hover:bg-muted flex items-center justify-center"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <div className="flex items-center gap-2 px-5 py-3 border-t">
              <span className="text-xs text-muted-foreground hidden sm:block">Ctrl＋Enter でも送信できます</span>
              <span className="flex-1" />
              <button onClick={onCancel} className="px-4 h-10 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">キャンセル</button>
              <Button onClick={onSend} disabled={!canSend} className="h-10 px-5 flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white" data-broadcast-send="">
                <Megaphone className="h-4 w-4" />
                {broadcasting ? "送信中..." : `${selected.size}名に送信`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
