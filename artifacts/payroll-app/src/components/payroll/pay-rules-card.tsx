import { useEffect, useState } from "react";
import { useGetCompany, getGetCompanyQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Save, Scale } from "lucide-react";

/**
 * 会社設定のうち「給与計算の切り替え（スイッチ）」と法令まわりの設定。
 * スイッチを入れると支給額・控除額が変わるので、社労士・税理士に確認してから入れる。
 * 既定はすべて OFF（今までどおりの計算）。式は lib/tax-tables-reiwa8/src/payroll-core.ts。
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** 最低賃金をもとにした単価の1円未満：50銭未満切り捨て・50銭以上切り上げ（昭和63年3月14日 基発150号） */
const roundRate = (x: number) => Math.round(x);

type Rules = Record<string, unknown>;

const SWITCHES: Array<{ key: string; no: string; title: string; body: string; who: string }> = [
  { key: "rulePremiumBaseIncludesAllowances", no: "①", title: "割増賃金の基礎に手当を入れる",
    body: "残業・休日・深夜の単価を「基本給＋手当マスターで『割増の基礎に入れる』印を付けた手当 ÷ 所定時間」から出します（労基法37条）。今の単価より低くはしません。",
    who: "社労士" },
  { key: "ruleRestDayOvertime", no: "②", title: "土曜・祝日の8時間超を残業として払う",
    body: "月次実績の「土曜・祝日の8時間超」の時間を、残業時給で早出残業手当に足します。日曜は時間ごとに払っているので対象外です。",
    who: "社労士" },
  { key: "ruleOver60IncludesRestDays", no: "③", title: "月60時間超の判定に土曜・祝日の時間を含める",
    body: "60時間を数えるとき、土曜・祝日に働いた時間（日数×所定時間）も足します。超えた分は5割増（残業時給×0.2を追加）。",
    who: "社労士" },
  { key: "ruleBluewingPerformanceV2", no: "④", title: "ブルーウィングの業績手当を新しい式にする",
    body: "いまの式は「歩合から残業代を差し引く」形で、国際自動車事件（最高裁 令和2年3月30日）で割増賃金を払ったことにならないとされた形です。新しい式は残業代を差し引きません（支給額が増えます）。賃金規程の書き換えも要ります。",
    who: "弁護士・社労士" },
  { key: "ruleBluewingOver60", no: "⑤", title: "ブルーウィングの月60時間超を5割増にする",
    body: "残業が月60時間を超えた分に、残業単価×0.2を追加します（労基法37条1項ただし書）。",
    who: "社労士" },
  { key: "ruleCommissionPremium", no: "⑥", title: "歩合給（業績手当）の時間外の割増を払う",
    body: "歩合給 ÷ 総労働時間 × 0.25 × 残業時間 を払います（労基則19条1項6号）。手当マスターに「歩合割増手当」（名前に「歩合割増」を含む手当）を作ってください。",
    who: "社労士" },
  { key: "rulePaidLeaveBySalaryType", no: "⑦", title: "有給の日の賃金を給与の形ごとに出す",
    body: "日給＝平日日当×日数、時給＝時給×所定時間×日数、月給＝足さない（基本給に含まれる）。今は全員「平日日当×日数」を足しています（月給の人は二重）。",
    who: "社労士" },
  { key: "ruleHourlyHolidayNoDouble", no: "⑧", title: "時給の人の土日の休日出勤手当を「割増の分だけ」にする",
    body: "時給の人は基本給（時給×実働時間）に土日の時間も入っているため、休日出勤手当は割増の分（土曜0.25・日曜0.35）だけにします。",
    who: "社労士" },
  { key: "ruleAbsenceDeduction", no: "⑨", title: "月給の人の欠勤を差し引く",
    body: "月次実績の欠勤日数 × 日割りの額を基本給から引きます。日割りの式は下で選びます（就業規則に合わせる）。",
    who: "社労士" },
];

export function PayRulesCard() {
  const { data: company } = useGetCompany();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [v, setV] = useState<Rules>({});
  const [rateText, setRateText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!company) return;
    const c = company as unknown as Rules;
    setV(c);
    try {
      const t = c.bonusTaxRateTable ? JSON.parse(String(c.bonusTaxRateTable)) as Array<{ from: number; rates: number[] }> : [];
      setRateText(t.map((r) => [r.from, ...r.rates.map((x) => Math.round(x * 100000) / 1000)].join(",")).join("\n"));
    } catch { setRateText(""); }
  }, [company]);

  const set = (k: string, val: unknown) => setV((p) => ({ ...p, [k]: val }));
  const num = (k: string, d: number) => Number(v[k] ?? d);

  const minWage = num("minimumWageHourly", 1226);
  const hpd = num("scheduledHoursPerDay", 8);
  const checks = [
    { label: "平日の日当", amount: Number(v.dailyWageWeekday ?? 0), need: roundRate(minWage * hpd) },
    { label: "土曜の日当（1.25倍）", amount: Number(v.dailyWageSaturday ?? 0), need: roundRate(minWage * hpd * 1.25) },
    { label: "日曜の時給（1.35倍）", amount: Number(v.hourlyWageSunday ?? 0), need: roundRate(minWage * 1.35) },
  ];

  async function save() {
    // 算出率の表：1行＝「前月の社会保険料等控除後の給与（以上）, 0人の率%, 1人, …, 7人」
    let table: Array<{ from: number; rates: number[] }> | null = null;
    const lines = rateText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      table = [];
      for (const l of lines) {
        const cells = l.split(/[,\t]/).map((x) => Number(x.replace(/[%％\s]/g, "")));
        if (cells.length !== 9 || cells.some((x) => !Number.isFinite(x) || x < 0)) {
          toast({ title: "算出率の表の形が違います", description: `「${l}」：以上の額と、0〜7人の8つの率（%）をカンマで区切って入れてください。`, variant: "destructive" });
          return;
        }
        table.push({ from: cells[0]!, rates: cells.slice(1).map((x) => Math.round(x * 1000) / 100000) });
      }
    }
    const body: Rules = {};
    for (const s of SWITCHES) body[s.key] = v[s.key] === true;
    for (const k of ["absenceDeductionMethod", "healthChildcareRounding", "journalDateBasis", "minimumWageEffectiveDate"]) body[k] = v[k];
    for (const k of ["scheduledHoursPerDay", "minimumWageHourly", "childContributionRate", "overtimeYearStartMonth"]) body[k] = Number(v[k]);
    body.bonusTaxRateTable = table ? JSON.stringify(table) : null;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/company`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      await queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
      toast({ title: "保存しました", description: "給与計算の切り替えと法令の設定を保存しました。確定前の明細は「再計算」で反映されます（確定済みの明細は変わりません）。" });
    } catch {
      toast({ title: "保存できませんでした", description: "もう一度お試しください。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Scale className="h-5 w-5" />給与計算の切り替えと法令の設定</CardTitle>
        <CardDescription>
          スイッチを入れると、<strong>支給額・控除額が変わります</strong>。<strong>社労士（④は弁護士も）に確認してから入れてください。</strong>
          既定はすべて「切」＝今までどおりの計算です。確定済みの明細は計算し直しません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="divide-y divide-border rounded-lg border">
          {SWITCHES.map((s) => (
            <div key={s.key} className="flex items-start gap-4 p-3">
              <Switch checked={v[s.key] === true} onCheckedChange={(on) => set(s.key, on)} aria-label={s.title} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.no} {s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.body}</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">入れる前に：{s.who}に確認</p>
                {s.key === "ruleAbsenceDeduction" && (
                  <select className="mt-2 border border-border rounded px-2 py-1 text-sm bg-background" value={String(v.absenceDeductionMethod ?? "fixed22")} onChange={(e) => set("absenceDeductionMethod", e.target.value)}>
                    <option value="fixed22">基本給 ÷ 22日 × 欠勤日数</option>
                    <option value="monthlyAverage">基本給 ÷（月平均所定時間 ÷ 1日の所定時間）× 欠勤日数</option>
                    <option value="scheduledDays">基本給 ÷ その月の平日の日数 × 欠勤日数</option>
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm space-y-1">
            <span className="font-medium">最低賃金（時間額）</span>
            <div className="flex items-center gap-2"><Input type="number" min="0" value={String(v.minimumWageHourly ?? 1226)} onChange={(e) => set("minimumWageHourly", e.target.value)} className="text-right" /><span className="text-muted-foreground shrink-0">円</span></div>
            <span className="text-xs text-muted-foreground">東京都の地域別最低賃金。毎年10月ごろ改定されるので入れ直してください。</span>
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">最低賃金の発効日</span>
            <Input type="date" value={String(v.minimumWageEffectiveDate ?? "")} onChange={(e) => set("minimumWageEffectiveDate", e.target.value)} />
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">1日の所定労働時間</span>
            <div className="flex items-center gap-2"><Input type="number" min="1" step="0.5" value={String(v.scheduledHoursPerDay ?? 8)} onChange={(e) => set("scheduledHoursPerDay", e.target.value)} className="text-right" /><span className="text-muted-foreground shrink-0">時間</span></div>
          </label>
        </div>
        {checks.some((c) => c.amount < c.need) && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>最低賃金 {minWage.toLocaleString("ja-JP")}円をもとにした額より低い単価があります：
              {checks.filter((c) => c.amount < c.need).map((c) => `${c.label} ${c.amount.toLocaleString("ja-JP")}円（${c.need.toLocaleString("ja-JP")}円以上）`).join("、")}。上の「日給レート設定」を直してください。</div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm space-y-1">
            <span className="font-medium">健康保険料と子育て支援金の端数</span>
            <select className="w-full border border-border rounded px-2 py-2 bg-background" value={String(v.healthChildcareRounding ?? "separate")} onChange={(e) => set("healthChildcareRounding", e.target.value)}>
              <option value="separate">別々に50銭で判定（今まで）</option>
              <option value="combined">合わせて50銭で判定</option>
            </select>
            <span className="text-xs text-muted-foreground">協会けんぽの案内で確かめてから変えてください。</span>
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">仕訳の計上日</span>
            <select className="w-full border border-border rounded px-2 py-2 bg-background" value={String(v.journalDateBasis ?? "closing")} onChange={(e) => set("journalDateBasis", e.target.value)}>
              <option value="closing">締め日</option>
              <option value="payment">支払日</option>
            </select>
            <span className="text-xs text-muted-foreground">税理士に確認してください。振込の仕訳は常に支払日です。</span>
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">子ども・子育て拠出金率（会社のみ）</span>
            <div className="flex items-center gap-2"><Input type="number" min="0" step="0.0001" value={String(v.childContributionRate ?? 0.0036)} onChange={(e) => set("childContributionRate", e.target.value)} className="text-right" /></div>
            <span className="text-xs text-muted-foreground">0.0036＝0.36%。仕訳の会社負担に使います。</span>
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">残業の年の数え始め（36協定の起算月）</span>
            <div className="flex items-center gap-2"><Input type="number" min="1" max="12" value={String(v.overtimeYearStartMonth ?? 4)} onChange={(e) => set("overtimeYearStartMonth", e.target.value)} className="text-right w-24" /><span className="text-muted-foreground">月</span></div>
          </label>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">賞与に対する源泉徴収税額の算出率の表（甲欄）</p>
          <p className="text-xs text-muted-foreground">
            国税庁の「賞与に対する源泉徴収税額の算出率の表（令和8年分）」を見て、1行に
            「前月の社会保険料等控除後の給与の額（以上）, 扶養0人の率%, 1人, 2人, 3人, 4人, 5人, 6人, 7人以上」を入れてください。
            このシステムは表の値を推測で入れていません。空のままだと、賞与の源泉税は「前月の給与が無い・10倍を超える」場合しか計算できません。
          </p>
          <Textarea rows={5} value={rateText} onChange={(e) => setRateText(e.target.value)} placeholder="0,0,0,0,0,0,0,0,0" className="font-mono text-xs" />
        </div>

        <p className="text-xs text-muted-foreground">
          携帯代など実費弁償の手当は、手当マスターの「雇用保険の対象外」を入れると雇用保険料の計算から外れます（通勤手当は外しません）。
          実費弁償にあたるかは、支給の決まり（実際にかかった額か・一律の額か）で決まるので社労士に確認してください。
        </p>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />切り替えと法令の設定を保存する</Button>
        </div>
      </CardContent>
    </Card>
  );
}
