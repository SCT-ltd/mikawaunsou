import { useState } from "react";
import { useLocation, Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { useCreateEmployee } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Save } from "lucide-react";

const employeeSchema = z.object({
  employeeCode: z.string().min(1, "社員番号を入力してください"),
  name: z.string().min(1, "氏名を入力してください"),
  nameKana: z.string().min(1, "フリガナを入力してください"),
  department: z.string().min(1, "部署を入力してください"),
  position: z.string().optional(),
  baseSalary: z.coerce.number().min(0, "0以上の数値を入力してください"),
  transportationAllowance: z.coerce.number().min(0).default(0),
  safetyDrivingAllowance: z.coerce.number().min(0).default(0),
  longDistanceAllowance: z.coerce.number().min(0).default(0),
  positionAllowance: z.coerce.number().min(0).default(0),
  commissionRatePerKm: z.coerce.number().min(0).default(0),
  commissionRatePerCase: z.coerce.number().min(0).default(0),
  dependentCount: z.coerce.number().min(0).default(0),
  residentTax: z.coerce.number().min(0).default(0),
  hireDate: z.string().min(1, "入社日を入力してください"),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

export default function EmployeeCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createEmployee = useCreateEmployee();

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeCode: "",
      name: "",
      nameKana: "",
      department: "配送部",
      position: "",
      baseSalary: 200000,
      transportationAllowance: 0,
      safetyDrivingAllowance: 0,
      longDistanceAllowance: 0,
      positionAllowance: 0,
      commissionRatePerKm: 0,
      commissionRatePerCase: 0,
      dependentCount: 0,
      residentTax: 0,
      hireDate: new Date().toISOString().split("T")[0],
    },
  });

  const onSubmit = async (data: EmployeeFormValues) => {
    try {
      const res = await createEmployee.mutateAsync({ data });
      toast({
        title: "社員を登録しました",
        description: `${res.name} の情報を保存しました。`,
      });
      setLocation(`/employees/${res.id}`);
    } catch (error) {
      toast({
        title: "エラー",
        description: "社員の登録に失敗しました。",
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href="/employees">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">新規社員登録</h2>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">基本情報</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="employeeCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>社員番号 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hireDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>入社日 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>氏名 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nameKana"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>フリガナ <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>部署 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="position"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>役職</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dependentCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>扶養親族数</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">歩合・控除情報</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="commissionRatePerKm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>歩合単価（円/km）</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">¥</span>
                          <Input type="number" step="0.1" className="pl-7" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="commissionRatePerCase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>歩合単価（円/件）</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">¥</span>
                          <Input type="number" className="pl-7" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="residentTax"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>住民税（月額）</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">¥</span>
                          <Input type="number" className="pl-7" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => setLocation("/employees")}>
                キャンセル
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <Save className="mr-2 h-4 w-4" />
                保存する
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </AppLayout>
  );
}