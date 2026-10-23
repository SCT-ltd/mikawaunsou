import { useEffect, useState } from "react";
import { FileText, X, Paperclip, Download } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * チャットの添付（写真・PDF）。事務所の画面とスタッフの打刻ページの両方で使う。
 *   ・写真は送る前に端末で縮める（長い辺1600px・JPEG）。スマホの写真は1枚数MBあり、電波の悪い所で送れないため
 *   ・1回に4つまで・1つ10MBまで
 *   ・見るときは、その会話の本人（暗証番号を確かめた端末）と管理者だけ（サーバーで確かめる）
 */
export interface Attachment { id: number; fileName: string; mime: string; size: number }
export interface PendingFile { key: string; file: File; preview: string | null }

export const MAX_FILES = 4;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ACCEPT = "image/*,application/pdf";
const MAX_SIDE = 1600;

export const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

/** 選んだファイルを送れる形にする（写真は縮める・送れない種類や大きすぎるものは理由を返す） */
export async function prepareFile(file: File): Promise<{ blob: Blob; name: string; mime: string } | { error: string }> {
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_BYTES) return { error: `「${file.name}」は大きすぎます（PDFは10MBまで）` };
    return { blob: file, name: file.name, mime: "application/pdf" };
  }
  if (!type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) return { error: `「${file.name}」は送れません（写真とPDFだけ送れます）` };
  if (type === "image/gif") {
    if (file.size > MAX_BYTES) return { error: `「${file.name}」は大きすぎます（10MBまで）` };
    return { blob: file, name: file.name, mime: "image/gif" };
  }
  // 縮めて JPEG にする（iPhone の HEIC もここで JPEG になる）
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // 透明な PNG の背景を白に
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
    if (!blob) throw new Error("縮められませんでした");
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return { blob, name, mime: "image/jpeg" };
  } catch {
    // 縮められない写真（読めない形式）は、そのままの形で送れるものだけ送る
    if (["image/jpeg", "image/png", "image/webp"].includes(type) && file.size <= MAX_BYTES) return { blob: file, name: file.name, mime: type };
    return { error: `「${file.name}」は読み込めませんでした（JPEG・PNGの写真かPDFにしてください）` };
  }
}

/** 1つ上げて番号をもらう（employeeId に "broadcast" を渡すと一斉送信の添付） */
export async function uploadAttachment(base: string, employeeId: number | "broadcast", f: File, headers: Record<string, string> = {}): Promise<Attachment> {
  const p = await prepareFile(f);
  if ("error" in p) throw new Error(p.error);
  const res = await fetch(`${base}/api/messages/${employeeId}/attachments`, {
    method: "POST", credentials: "include", body: p.blob,
    headers: { ...headers, "Content-Type": p.mime, "X-File-Name": encodeURIComponent(p.name) },
  });
  const body = await res.json().catch(() => null) as (Attachment & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? (res.status === 413 ? "ファイルが大きすぎます（10MBまで）" : `送れませんでした（${res.status}）`));
  return body;
}

/** 選んだファイルを足す（数の上限・種類は後で送るときに確かめる） */
export function addPending(prev: PendingFile[], files: FileList | File[]): { next: PendingFile[]; error: string | null } {
  const list = [...prev];
  let error: string | null = null;
  for (const file of Array.from(files)) {
    if (list.length >= MAX_FILES) { error = `添付は1回に${MAX_FILES}つまでです`; break; }
    const isImg = (file.type || "").startsWith("image/");
    list.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, preview: isImg ? URL.createObjectURL(file) : null });
  }
  return { next: list, error };
}

/** 送る前の添付（入力欄の上） */
export function PendingStrip({ files, onRemove }: { files: PendingFile[]; onRemove: (key: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2" data-pending-files="">
      {files.map((f) => (
        <div key={f.key} className="relative shrink-0">
          {f.preview
            ? <img src={f.preview} alt="" className="h-16 w-16 rounded-lg object-cover border" />
            : <div className="h-16 w-28 rounded-lg border bg-muted/40 flex flex-col items-center justify-center px-1.5 text-center"><FileText className="h-5 w-5 text-red-600" /><span className="text-[10px] truncate w-full">{f.file.name}</span></div>}
          <button type="button" onClick={() => onRemove(f.key)} aria-label="添付を外す"
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-800 text-white flex items-center justify-center shadow"><X className="h-3 w-3" /></button>
        </div>
      ))}
    </div>
  );
}

/** 添付を選ぶボタン（スマホではカメラで撮ることもできる） */
export function AttachButton({ onFiles, disabled, className }: { onFiles: (f: FileList) => void; disabled?: boolean; className?: string }) {
  return (
    <label className={cn("shrink-0 inline-flex items-center justify-center rounded-xl border bg-background text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer", disabled && "opacity-40 pointer-events-none", className)}
      title="写真・PDFを添付" aria-label="写真・PDFを添付">
      <Paperclip className="h-4 w-4" />
      <input type="file" accept={ACCEPT} multiple className="sr-only" data-attach-input=""
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
    </label>
  );
}

/** メッセージに付いた添付（写真は小さく出し、押すと大きく。PDFは名前を押すと開く） */
export function AttachmentView({ items, urlOf, mine }: { items: Attachment[]; urlOf: (a: Attachment) => string; mine: boolean }) {
  const [big, setBig] = useState<Attachment | null>(null);
  useEffect(() => {
    if (!big) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [big]);
  if (!items?.length) return null;
  const imgs = items.filter((a) => a.mime.startsWith("image/"));
  const files = items.filter((a) => !a.mime.startsWith("image/"));
  return (
    <div className={cn("space-y-1.5", mine ? "items-end" : "items-start")} data-attachments="">
      {imgs.length > 0 && (
        <div className={cn("grid gap-1.5", imgs.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {imgs.map((a) => (
            <button key={a.id} type="button" onClick={() => setBig(a)} className="block overflow-hidden rounded-xl border bg-muted/30" aria-label={`${a.fileName}を大きく見る`}>
              <img src={urlOf(a)} alt={a.fileName} loading="lazy" className={cn(imgs.length === 1 ? "max-h-64 max-w-[240px] min-h-24 min-w-24 object-contain" : "h-28 w-28 object-cover")} data-attachment-img="" />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a key={a.id} href={urlOf(a)} target="_blank" rel="noopener noreferrer" data-attachment-file=""
          className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs max-w-[260px] no-underline", mine ? "bg-white/15 border-white/30 text-current" : "bg-white text-foreground")}>
          <FileText className="h-5 w-5 shrink-0 text-red-600" />
          <span className="min-w-0"><span className="block font-semibold truncate">{a.fileName}</span><span className="opacity-70">PDF・{sizeText(a.size)}</span></span>
        </a>
      ))}
      {big && (
        <div className="fixed inset-0 z-[1000] bg-black/85 flex flex-col items-center justify-center p-4" onClick={() => setBig(null)} role="dialog" aria-label="写真">
          <img src={urlOf(big)} alt={big.fileName} className="max-h-[85vh] max-w-full min-h-[30vh] object-contain rounded bg-white/5" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3 flex gap-3" onClick={(e) => e.stopPropagation()}>
            <a href={`${urlOf(big)}${urlOf(big).includes("?") ? "&" : "?"}download=1`} className="inline-flex items-center gap-1.5 rounded-full bg-white/90 text-slate-900 text-xs font-semibold px-4 py-2 no-underline"><Download className="h-3.5 w-3.5" />保存する</a>
            <button type="button" onClick={() => setBig(null)} className="inline-flex items-center gap-1.5 rounded-full bg-white/20 text-white text-xs font-semibold px-4 py-2"><X className="h-3.5 w-3.5" />閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}
