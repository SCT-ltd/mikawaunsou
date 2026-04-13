import { useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useGetEmployee, 
  getGetEmployeeQueryKey, 
  useUpdateEmployee, 
  useDeleteEmployee,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Save, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";

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
  isActive: z.boolean(),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

export default function EmployeeEdit() {
  const [, setLocation] = useLocation();
  const { id } = useParams();
  const employeeId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employee, isLoading } = useGetEmployee(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeQueryKey(employeeId) }
  });
  
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeCode: "",
      name: "",
      nameKana: "",
      department: "",
      position: "",
      baseSalary: 0,
      transportationAllowance: 0,
      safetyDrivingAllowance: 0,
      longDistanceAllowance: 0,
      positionAllowance: 0,
      commissionRatePerKm: 0,
      commissionRatePerCase: 0,
      dependentCount: 0,
      residentTax: 0,
      hireDate: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (employee) {
      form.reset({
        employeeCode: employee.employeeCode,
        name: employee.name,
        nameKana: employee.nameKana,
        department: employee.department,
        position: employee.position || "",
        baseSalary: employee.baseSalary,
        transportationAllowance: 0,
        safetyDrivingAllowance: 0,
        longDistanceAllowance: 0,
        positionAllowance: 0,
        commissionRatePerKm: employee.commissionRatePerKm,
        commissionRatePerCase: employee.commissionRatePerCase,
        dependentCount: employee.dependentCount,
        residentTax: employee.residentTax,
        hireDate: employee.hireDate.split("T")[0],
        isActive: employee.isActive,
      });
    }
  }, [employee, form]);

  const onSubmit = async (data: EmployeeFormValues) => {
    try {
      await updateEmployee.mutateAsync({ id: employeeId, data });
      toast({
        title: "保存しました",
        description: "社員情報を更新しました。",
      });
      queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(employeeId) });
    } catch (error) {
      toast({
        title: "エラー",
        description: "情報の更新に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteEmployee.mutateAsync({ id: employeeId });
      toast({
        title: "削除しました",
        description: "社員情報を削除しました。",
      });
      setLocation("/employees");
    } catch (error) {
      toast({
        title: "エラー",
        description: "社員の削除に失敗しました。",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <AppLayout><div className="flex h-full items-center justify-center">読み込み中...</div></AppLayout>;
  }

  if (!employee) {
    return <AppLayout><div className="p-6">社員が見つかりません。</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" asChild>
              <Link href="/employees">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h2 className="text-2xl font-bold tracking-tight">社員情報編集</h2>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-2 h-4 w-4" />
                削除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>本当に削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  この操作は取り消せません。社員データは論理削除されます。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  削除する
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">在籍状況</FormLabel>
                        <div className="text-sm text-muted-foreground">
                          退職した場合はオフにしてください
                        </div>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4 pb-4">
              <Button type="button" variant="outline" onClick={() => setLocation("/employees")}>
                キャンセル
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <Save className="mr-2 h-4 w-4" />
                変更を保存
              </Button>
            </div>
          </form>
        </Form>

      </div>
    </AppLayout>
  );
}