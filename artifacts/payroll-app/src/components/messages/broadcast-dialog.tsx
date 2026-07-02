import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Megaphone } from "lucide-react";
import { Conversation, Avatar } from "./shared";

export function BroadcastDialog({
  open,
  onOpenChange,
  conversations,
  text,
  onTextChange,
  selected,
  onToggleEmployee,
  onToggleAll,
  broadcasting,
  done,
  onSend,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  text: string;
  onTextChange: (v: string) => void;
  selected: Set<number>;
  onToggleEmployee: (id: number) => void;
  onToggleAll: () => void;
  broadcasting: boolean;
  done: number | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-5 w-5 text-amber-500" />一斉送信
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
          {done != null ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-bold text-green-700 text-lg jp-tight">{done}名に送信しました</p>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium jp-tight">送信先を選択</p>
                  <button onClick={onToggleAll} className="text-xs text-primary hover:underline">
                    {selected.size === conversations.length ? "全員解除" : "全員選択"}
                  </button>
                </div>
                <div className="border rounded-xl overflow-hidden divide-y max-h-48 overflow-y-auto">
                  {conversations.map((conv) => (
                    <label key={conv.employee.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={selected.has(conv.employee.id)}
                        onChange={() => onToggleEmployee(conv.employee.id)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                      <Avatar name={conv.employee.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate jp-tight">{conv.employee.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{conv.employee.department}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{selected.size}名を選択中</p>
              </div>

              <textarea
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                placeholder="送信するメッセージを入力..."
                rows={4}
                autoFocus
                className="w-full rounded-xl border bg-muted/30 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
              <div className="flex justify-end gap-2">
                <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
                  キャンセル
                </button>
                <Button onClick={onSend} disabled={!text.trim() || broadcasting || selected.size === 0} className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4" />
                  {broadcasting ? "送信中..." : `${selected.size}名に送信`}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
