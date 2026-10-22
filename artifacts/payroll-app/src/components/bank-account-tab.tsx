import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/office-tools";

/**
 * 社員マスターの「振込口座」タブ。給与明細画面の「振込一覧」と全銀協フォーマットの書き出しに使う。
 * 口座は社員の表とは別に持っている（社員の一覧や、QR打刻ページの応答に口座が載らないように）。
 * 保存は社員情報の「保存する」と一緒に行う（親から save() を呼ぶ）。
 */
export interface BankAccount {
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: number;
  accountNumber: string;
  holderKana: string;
}

const EMPTY: BankAccount = { bankCode: "", bankName: "", branchCode: "", branchName: "", accountType: 1, accountNumber: "", holderKana: "" };

export interface BankAccountTabHandle {
  /** 変更があれば保存する。保存できた（または変更なし）なら true、入力の誤りなどで保存できなければ false */
  save: () => Promise<{ ok: boolean; error?: string }>;
  isDirty: () => boolean;
}

export const BankAccountTab = forwardRef<BankAccountTabHandle, { employeeId: number; onDirtyChange?: (d: boolean) => void; disabled?: boolean }>(
  function BankAccountTab({ employeeId, onDirtyChange, disabled }, ref) {
    const [v, setV] = useState<BankAccount>(EMPTY);
    const [orig, setOrig] = useState<string>(JSON.stringify(EMPTY));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let alive = true;
      setLoading(true);
      apiJson<BankAccount | null>(`/office-tools/bank-accounts/${employeeId}`)
        .then((row) => {
          if (!alive) return;
          const next = row ? { ...EMPTY, ...row } : EMPTY;
          setV(next);
          setOrig(JSON.stringify(pick(next)));
        })
        .catch(() => { if (alive) setError("口座を読み込めませんでした"); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, [employeeId]);

    const dirty = JSON.stringify(pick(v)) !== orig;
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

    useImperativeHandle(ref, () => ({
      isDirty: () => dirty,
      save: async () => {
        if (!dirty) return { ok: true };
        try {
          const saved = await apiJson<BankAccount>(`/office-tools/bank-accounts/${employeeId}`, { method: "PUT", body: pick(v) });
          const next = { ...EMPTY, ...saved };
          setV(next);
          setOrig(JSON.stringify(pick(next)));
          setError(null);
          return { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "口座を保存できませんでした";
          setError(msg);
          return { ok: false, error: msg };
        }
      },
    }), [dirty, employeeId, v]);

    const set = <K extends keyof BankAccount>(k: K, val: BankAccount[K]) => setV((p) => ({ ...p, [k]: val }));
    const row = (label: string, hint: string, el: React.ReactNode) => (
      <label className="block text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
        <span className="block mt-1">{el}</span>
      </label>
    );

    if (loading) return <p className="text-sm text-muted-foreground py-4">読み込み中…</p>;
    return (
      <fieldset disabled={disabled} className="space-y-3" data-testid="bank-tab">
        <p className="text-xs text-muted-foreground">
          給与の振込先です。給与明細画面の「振込一覧」で、全銀協フォーマット（銀行に取り込む形式）に書き出すときに使います。
          通帳やキャッシュカードを見ながら入れてください。
        </p>
        <div className="grid grid-cols-2 gap-3">
          {row("銀行コード（4桁）", "例：0001", <Input value={v.bankCode} inputMode="numeric" onChange={(e) => set("bankCode", e.target.value.replace(/\D/g, "").slice(0, 4))} />)}
          {row("銀行名", "カナで入れると書き出しにも載ります", <Input value={v.bankName} onChange={(e) => set("bankName", e.target.value)} />)}
          {row("支店コード（3桁）", "例：123", <Input value={v.branchCode} inputMode="numeric" onChange={(e) => set("branchCode", e.target.value.replace(/\D/g, "").slice(0, 3))} />)}
          {row("支店名", "", <Input value={v.branchName} onChange={(e) => set("branchName", e.target.value)} />)}
          {row("預金種目", "", (
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.accountType} onChange={(e) => set("accountType", Number(e.target.value))}>
              <option value={1}>普通</option><option value={2}>当座</option><option value={4}>貯蓄</option><option value={9}>その他</option>
            </select>
          ))}
          {row("口座番号（7桁まで）", "", <Input value={v.accountNumber} inputMode="numeric" onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, "").slice(0, 7))} />)}
        </div>
        {row("口座名義（カナ）", "通帳のとおりにカナで（例：ヤマダ タロウ）", <Input value={v.holderKana} onChange={(e) => set("holderKana", e.target.value)} />)}
        {error && <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
        {dirty && <p className="text-xs text-amber-700 dark:text-amber-300">下の「保存する」を押すと、口座も一緒に保存されます。</p>}
      </fieldset>
    );
  },
);

function pick(v: BankAccount): BankAccount {
  return {
    bankCode: v.bankCode, bankName: v.bankName, branchCode: v.branchCode, branchName: v.branchName,
    accountType: v.accountType, accountNumber: v.accountNumber, holderKana: v.holderKana,
  };
}
