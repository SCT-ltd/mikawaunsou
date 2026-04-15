import { useEffect } from "react";
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
              会社の基本情報・給与締め日・支払日を設定します。
            </p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
              <div>
                <p className="font-medium mb-1">保険料率・計算パラメータの設定について</p>
                <p className="text-blue-700">
                  健康保険料率・厚生年金料率・雇用保険料率・時間外割増率・月平均所定労働時間などの給与計算パラメータは、
                  <strong>マスター管理 → 計算テーブルマスター</strong>で設定・管理してください。
                  計算テーブルマスターの設定値がサイドバーの給与明細計算に直接反映されます。
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-4 pb-12">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <Save className="mr-2 h-4 w-4" />
                設定を保存する
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </AppLayout>
  );
}
