import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * ブラウザ標準の confirm / alert の代わりに使う確認ダイアログ。
 * 標準のものは見た目がそろわず、文字も小さく、ボタンの名前（OK／キャンセル）から
 * 何が起きるのかが読み取れないため、画面の部品（AlertDialog）にそろえる。
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: "削除しますか？", okLabel: "削除する", danger: true }))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 */
export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** 進めるボタンの名前（例：「削除する」「保存せずに移動」）*/
  okLabel?: string;
  /** やめるボタンの名前。null にするとボタンを1つだけ出す（お知らせ用）*/
  cancelLabel?: string | null;
  /** 取り消せない操作は赤いボタンにする */
  danger?: boolean;
}

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    // 前の確認が開いたままなら「やめる」として閉じる
    resolverRef.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const finish = (ok: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    r?.(ok);
  };

  const confirmDialog = (
    <AlertDialog open={opts !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description != null && (
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground whitespace-pre-line">{opts.description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {opts?.cancelLabel !== null && (
            <AlertDialogCancel onClick={() => finish(false)}>{opts?.cancelLabel ?? "やめる"}</AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={() => finish(true)}
            className={opts?.danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {opts?.okLabel ?? "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
