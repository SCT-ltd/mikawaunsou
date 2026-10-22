import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/office-tools";
import { useCanWrite } from "@/lib/use-can-write";

/**
 * 振込元（会社の口座）と委託者の設定。給与明細画面の「振込一覧」から全銀協フォーマットで
 * 書き出すときに使う。どれも銀行との契約で決まる値なので、推測で埋めずに銀行の資料のとおりに入れる。
 */
interface TransferSettings {
  consignorCode: string;
  consignorName: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: number;
  accountNumber: string;
  kindCode: string;
  designation: string;
  newline: boolean;
}

const EMPTY: TransferSettings = {
  consignorCode: "", consignorName: "", bankCode: "", bankName: "", branchCode: "", branchName: "",
  accountType: 1, accountNumber: "", kindCode: "11", designation: "", newline: true,
};

export function TransferSettingsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const { data, isLoading } = useQuery<TransferSettings>({
    queryKey: ["office-transfer-settings"],
    queryFn: () => apiJson<TransferSettings>("/office-tools/transfer-settings"),
  });
  const [v, setV] = useState<TransferSettings>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data && !dirty) setV({ ...EMPTY, ...data }); }, [data, dirty]);

  const set = <K extends keyof TransferSettings>(k: K, val: TransferSettings[K]) => { setV((p) => ({ ...p, [k]: val })); setDirty(true); };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await apiJson("/office-tools/transfer-settings", { method: "PUT", body: v });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["office-transfer-settings"] });
      toast({ title: "振込元を保存しました" });
    } catch (e) {
      toast({ title: "保存できませんでした", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, hint: string, el: React.ReactNode) => (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="block text-[11px] text-muted-foreground mb-1">{hint}</span>
      {el}
    </label>
  );

  return (
    <Card data-testid="transfer-settings">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Landmark className="h-5 w-5" />振込元（全銀協フォーマットの書き出し）</CardTitle>
        <CardDescription>
          給与明細画面の「振込一覧」から、銀行に取り込む振込データを書き出すときに使います。
          どれも銀行との契約で決まる値です。銀行から届いた資料のとおりに入れてください。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">読み込み中…</p> : (
          <fieldset disabled={!canWrite} className="grid gap-4 md:grid-cols-2">
            {field("委託者コード（10桁）", "銀行と契約したときに銀行から渡される番号", (
              <Input value={v.consignorCode} inputMode="numeric" onChange={(e) => set("consignorCode", e.target.value.replace(/\D/g, "").slice(0, 10))} />
            ))}
            {field("委託者名（カナ）", "例：ミカワウンソウ(カ　※カナ・英大文字・数字で", (
              <Input value={v.consignorName} onChange={(e) => set("consignorName", e.target.value)} />
            ))}
            {field("銀行コード（4桁）", "会社の口座がある銀行の番号", (
              <Input value={v.bankCode} inputMode="numeric" onChange={(e) => set("bankCode", e.target.value.replace(/\D/g, "").slice(0, 4))} />
            ))}
            {field("銀行名（カナ）", "カナで入れると書き出しにも載ります（漢字のときは空欄で書き出します）", (
              <Input value={v.bankName} onChange={(e) => set("bankName", e.target.value)} />
            ))}
            {field("支店コード（3桁）", "", (
              <Input value={v.branchCode} inputMode="numeric" onChange={(e) => set("branchCode", e.target.value.replace(/\D/g, "").slice(0, 3))} />
            ))}
            {field("支店名（カナ）", "", (
              <Input value={v.branchName} onChange={(e) => set("branchName", e.target.value)} />
            ))}
            {field("預金種目", "会社の口座の種類", (
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.accountType} onChange={(e) => set("accountType", Number(e.target.value))}>
                <option value={1}>普通</option><option value={2}>当座</option><option value={4}>貯蓄</option><option value={9}>その他</option>
              </select>
            ))}
            {field("口座番号（7桁まで）", "", (
              <Input value={v.accountNumber} inputMode="numeric" onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, "").slice(0, 7))} />
            ))}
            {field("種別コード", "銀行と契約した振込の種類に合わせて選びます", (
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.kindCode} onChange={(e) => set("kindCode", e.target.value)}>
                <option value="11">11 給与振込</option><option value="12">12 賞与振込</option><option value="21">21 総合振込</option>
              </select>
            ))}
            {field("振込指定区分", "銀行から指定があるときだけ入れます（ふだんは空欄）", (
              <Input value={v.designation} maxLength={1} onChange={(e) => set("designation", e.target.value.toUpperCase().slice(0, 1))} className="w-20" />
            ))}
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="h-4 w-4" checked={v.newline} onChange={(e) => set("newline", e.target.checked)} />
              1件ごとに改行を入れる（銀行の取り込みの指定に合わせます。分からなければ入れたまま）
            </label>
            <div className="md:col-span-2 flex justify-end">
              <Button type="button" onClick={save} disabled={saving || !dirty}>
                <Save className="h-4 w-4 mr-1" />{saving ? "保存中…" : dirty ? "振込元を保存する" : "保存済み"}
              </Button>
            </div>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
