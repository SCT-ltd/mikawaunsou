import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetCompany, useUpdateCompany, getGetCompanyQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Building2, Info } from "lucide-react";
import { RecalcNotice } from "@/components/recalc-notice";
import { TransferSettingsCard } from "@/components/transfer-settings-card";
import { useIsAdmin } from "@/lib/use-can-write";
import { PayRulesCard } from "@/components/payroll/pay-rules-card";

const companySchema = z.object({
  name: z.string().min(1, "会社名を入力してください"),
  closingDay: z.coerce.number().min(1).max(31, "1から31の数値を入力してください（31は月末）"),
  paymentDay: z.coerce.number().min(1).max(31, "1から31の数値を入力してください（31は月末）"),
  dailyWageWeekday: z.coerce.number().min(0, "0以上の数値を入力してください").default(9808),
  dailyWageSaturday: z.coerce.number().min(0, "0以上の数値を入力してください").default(12260),
  hourlyWageSunday: z.coerce.number().min(0, "0以上の数値を入力してください").default(1655),
});

type CompanyFormValues = z.infer<typeof companySchema>;

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  /** 日給の単価などを変えたあと「未確定の明細に反映するには再計算が必要」と知らせる */
  const [showRecalc, setShowRecalc] = useState(false);

  const { data: company, isLoading } = useGetCompany();
  const updateCompany = useUpdateCompany();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      closingDay: 31,
      paymentDay: 25,
      dailyWageWeekday: 9808,
      dailyWageSaturday: 12260,
      hourlyWageSunday: 1655,
    },
  });

  useEffect(() => {
    if (company) {
      form.reset({
        name: company.name,
        closingDay: company.closingDay,
        paymentDay: company.paymentDay,
        dailyWageWeekday: company.dailyWageWeekday ?? 9808,
        dailyWageSaturday: company.dailyWageSaturday ?? 12260,
        hourlyWageSunday: company.hourlyWageSunday ?? 1655,
      });
    }
  }, [company, form]);

  const onSubmit = async (data: CompanyFormValues) => {
    try {
      await updateCompany.mutateAsync({ data });
      toast({
        title: "保存しました",
        description: "会社設定を更新しました。",
      });
      queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
      setShowRecalc(true);
    } catch (error) {
      toast({
        title: "エラー",
        description: "会社設定の更新に失敗しました。",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <AppLayout><div className="flex h-full items-center justify-center">読み込み中...</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 border-b pb-4">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">会社設定</h2>
            <p className="text-sm text-muted-foreground mt-1">
              会社の基本情報・給与締め日・支払日を設定します。有給・住民税・賞与・賃金台帳などは <Link href="/payroll-law" className="underline">給与と法令</Link> の画面です。
            </p>
          </div>
        </div>

        <RecalcNotice show={showRecalc} onClose={() => setShowRecalc(false)} what="会社設定（日給の単価など）" />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {!isAdmin && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                会社設定を変えられるのは管理者だけです（見ることはできます）。
              </p>
            )}
            <fieldset disabled={!isAdmin} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">基本設定</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2 md:col-span-1">
                      <FormLabel>会社名 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="hidden md:block" />

                <FormField
                  control={form.control}
                  name="closingDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>給与締め日</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" min="1" max="31" {...field} className="w-24 text-right" />
                          <span className="text-sm text-muted-foreground">日（31は月末扱い）</span>
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paymentDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>給与支払日</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" min="1" max="31" {...field} className="w-24 text-right" />
                          <span className="text-sm text-muted-foreground">日（31は月末扱い）</span>
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">日給レート設定</CardTitle>
                <CardDescription>給与形態が「日給制」の社員に適用される基本単価です。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="dailyWageWeekday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>平日 日給（円）</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" min="0" {...field} className="text-right" />
                          <span className="text-sm text-muted-foreground shrink-0">円/日</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dailyWageSaturday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>土曜 日給（円）</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" min="0" {...field} className="text-right" />
                          <span className="text-sm text-muted-foreground shrink-0">円/日</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hourlyWageSunday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>日曜 時給（円）</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" min="0" {...field} className="text-right" />
                          <span className="text-sm text-muted-foreground shrink-0">円/時</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            </fieldset>
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/30 px-4 py-3 text-sm text-blue-800 dark:text-blue-200">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
              <div>
                <p className="font-medium mb-1">保険料率・計算パラメータについて</p>
                <p className="text-blue-700 dark:text-blue-200">
                  健康保険・厚生年金・時間外割増率などの税・保険基準は<strong>令和8年の公式値がシステムに内蔵</strong>されています
                  （<strong>マスター管理 → 計算テーブルマスター</strong>で参照）。
                  そこで会社ごとに編集できるのは<strong>月平均労働時間・雇用保険料率</strong>のみです。
                  ここ（会社設定）では会社名・締め日・支払日・日給レートを管理します。
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-4 pb-12">
              <Button type="submit" disabled={form.formState.isSubmitting || !isAdmin}>
                <Save className="mr-2 h-4 w-4" />
                設定を保存する
              </Button>
            </div>
          </form>
        </Form>

        <div className="pb-12">
          <TransferSettingsCard />
        </div>
        {/* 給与計算の切り替え（スイッチ）と法令の設定。保存ボタンは別（上の会社設定とは別に保存する） */}
        <div className="pb-12"><PayRulesCard /></div>
      </div>
    </AppLayout>
  );
}
