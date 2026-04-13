import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListAllowanceDefinitions,
  getListAllowanceDefinitionsQueryKey,
  useCreateAllowanceDefinition,
  useUpdateAllowanceDefinition,
  useDeleteAllowanceDefinition,
  useListEmployees,
  getListEmployeesQueryKey,
  useUpdateEmployee,
  useGetCompany,
  getGetCompanyQueryKey,
  useUpdateCompany,
  AllowanceDefinition,
  Employee,
  Company,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Edit2, Trash2, Settings2, Users, Wallet, Calculator } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const calcTypeLabels: Record<string, { label: string; color: string }> = {
  fixed: { label: "固定給型", color: "bg-blue-50 text-blue-700 border-blue-200" },
  variable: { label: "変動入力型", color: "bg-orange-50 text-orange-700 border-orange-200" },
  unit_time: { label: "単価×時間型", color: "bg-purple-50 text-purple-700 border-purple-200" },
};

// ─── 手当マスター Tab ──────────────────────────────────────────────

const allowanceSchema = z.object({
  name: z.string().min(1, "手当名称を入力してください"),
  description: z.string().optional(),
  isTaxable: z.boolean().default(true),
  calculationType: z.enum(["fixed", "variable", "unit_time"]).default("variable"),
  isActive: z.boolean().default(true).optional(),
});
type AllowanceFormValues = z.infer<typeof allowanceSchema>;

function AllowanceMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allowances, isLoading } = useListAllowanceDefinitions({});
  const createAllowance = useCreateAllowanceDefinition();
  const updateAllowance = useUpdateAllowanceDefinition();
  const deleteAllowance = useDeleteAllowanceDefinition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingAllowance, setEditingAllowance] = useState<AllowanceDefinition | null>(null);
  const [deletingAllowance, setDeletingAllowance] = useState<AllowanceDefinition | null>(null);

  const form = useForm<AllowanceFormValues>({
    resolver: zodResolver(allowanceSchema),
    defaultValues: { name: "", description: "", isTaxable: true, calculationType: "variable", isActive: true },
  });

  const handleOpenCreate = () => {
    setEditingAllowance(null);
    form.reset({ name: "", description: "", isTaxable: true, calculationType: "variable", isActive: true });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (allowance: AllowanceDefinition) => {
    setEditingAllowance(allowance);
    form.reset({
      name: allowance.name,
      description: allowance.description || "",
      isTaxable: allowance.isTaxable,
      calculationType: (allowance.calculationType as "fixed" | "variable" | "unit_time") ?? "variable",
      isActive: allowance.isActive,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: AllowanceFormValues) => {
    try {
      if (editingAllowance) {
        await updateAllowance.mutateAsync({
          id: editingAllowance.id,
          data: { name: data.name, description: data.description || undefined, isTaxable: data.isTaxable, calculationType: data.calculationType, isActive: data.isActive ?? true },
        });
        toast({ title: "保存しました", description: "手当マスタを更新しました。" });
      } else {
        await createAllowance.mutateAsync({
          data: { name: data.name, description: data.description || undefined, isTaxable: data.isTaxable, calculationType: data.calculationType },
        });
        toast({ title: "追加しました", description: "新しい手当を登録しました。" });
      }
      queryClient.invalidateQueries({ queryKey: getListAllowanceDefinitionsQueryKey() });
      setIsDialogOpen(false);
    } catch {
      toast({ title: "エラー", description: "手当マスタの保存に失敗しました。", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deletingAllowance) return;
    try {
      await deleteAllowance.mutateAsync({ id: deletingAllowance.id });
      toast({ title: "削除しました", description: "手当を削除しました。" });
      queryClient.invalidateQueries({ queryKey: getListAllowanceDefinitionsQueryKey() });
      setIsDeleteDialogOpen(false);
    } catch {
      toast({ title: "エラー", description: "手当の削除に失敗しました。", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">手当マスター</h3>
          <p className="text-sm text-muted-foreground">会社固有のカスタム手当を定義します。</p>
        </div>
        <Button onClick={handleOpenCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" />手当を追加
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">読み込み中...</div>
          ) : !allowances || allowances.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border-dashed border rounded-md m-4">
              手当が登録されていません。「手当を追加」ボタンから登録してください。
            </div>
          ) : (
            <div className="rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>手当名称</TableHead>
                    <TableHead>説明</TableHead>
                    <TableHead>計算タイプ</TableHead>
                    <TableHead>課税区分</TableHead>
                    <TableHead className="w-20">表示順</TableHead>
                    <TableHead className="w-24">状態</TableHead>
                    <TableHead className="w-24 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allowances.map((a) => {
                    const ct = calcTypeLabels[a.calculationType] ?? calcTypeLabels.variable;
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-muted-foreground">{a.description || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ct.color}>{ct.label}</Badge>
                        </TableCell>
                        <TableCell>
                          {a.isTaxable ? (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">課税</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">非課税</Badge>
                          )}
                        </TableCell>
                        <TableCell>{a.sortOrder}</TableCell>
                        <TableCell>
                          {a.isActive ? <Badge variant="secondary">有効</Badge> : <Badge variant="outline" className="text-muted-foreground">無効</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(a)}><Edit2 className="h-4 w-4 text-muted-foreground" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => { setDeletingAllowance(a); setIsDeleteDialogOpen(true); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAllowance ? "手当を編集" : "新しい手当を追加"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>手当名称 <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="例：資格手当" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>説明</FormLabel>
                  <FormControl><Input placeholder="例：資格取得者に支給" {...field} value={field.value || ""} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="calculationType" render={({ field }) => (
                <FormItem>
                  <FormLabel>計算タイプ</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="計算タイプを選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="fixed">固定給型（毎月固定額を支給）</SelectItem>
                      <SelectItem value="variable">変動入力型（月ごとに金額入力）</SelectItem>
                      <SelectItem value="unit_time">単価×時間型（単価×時間数で計算）</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="isTaxable" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <FormLabel className="text-base">課税対象</FormLabel>
                    <p className="text-sm text-muted-foreground">所得税の計算対象に含める場合はオン</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              {editingAllowance && (
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <FormLabel className="text-base">有効</FormLabel>
                      <p className="text-sm text-muted-foreground">無効にすると給与計算に使用されません</p>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>キャンセル</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>保存する</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>本当に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>「{deletingAllowance?.name}」を削除します。この操作は元に戻せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── 社員マスター Tab ──────────────────────────────────────────────

const employeeEditSchema = z.object({
  dependentCount: z.coerce.number().int().min(0),
  hasSpouse: z.boolean().default(false),
  employmentInsuranceApplied: z.boolean().default(true),
});
type EmployeeEditValues = z.infer<typeof employeeEditSchema>;

function EmployeeMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: employees, isLoading } = useListEmployees({}, { query: { staleTime: 0, refetchOnMount: true } });
  const updateEmployee = useUpdateEmployee();
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const form = useForm<EmployeeEditValues>({
    resolver: zodResolver(employeeEditSchema),
    defaultValues: {
      dependentCount: 0, hasSpouse: false, employmentInsuranceApplied: true,
    },
  });

  const handleOpenEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    form.reset({
      dependentCount: emp.dependentCount,
      hasSpouse: emp.hasSpouse ?? false,
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
    });
  };

  const onSubmit = async (data: EmployeeEditValues) => {
    if (!editingEmployee) return;
    try {
      await updateEmployee.mutateAsync({ id: editingEmployee.id, data });
      toast({ title: "保存しました", description: `${editingEmployee.name}の情報を更新しました。` });
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setEditingEmployee(null);
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  const activeEmployees = employees?.filter(e => e.isActive) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">社員マスター</h3>
        <p className="text-sm text-muted-foreground">扶養・保険など各社員の基本設定を管理します。社会保険料は計算テーブルマスターの料率を使用して自動計算されます。</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">読み込み中...</div>
          ) : activeEmployees.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border-dashed border rounded-md m-4">
              社員が登録されていません。
            </div>
          ) : (
            <div className="rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>社員番号</TableHead>
                    <TableHead>氏名</TableHead>
                    <TableHead>部署</TableHead>
                    <TableHead>扶養</TableHead>
                    <TableHead>配偶者</TableHead>
                    <TableHead>雇保</TableHead>
                    <TableHead className="w-20 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeEmployees.map((emp) => (
                    <TableRow key={emp.id} className="cursor-pointer hover:bg-muted/40" onClick={() => handleOpenEdit(emp)}>
                      <TableCell className="text-muted-foreground text-sm">{emp.employeeCode}</TableCell>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell className="text-sm">{emp.department}</TableCell>
                      <TableCell className="text-sm">{emp.dependentCount}人</TableCell>
                      <TableCell>
                        {(emp.hasSpouse ?? false) ? (
                          <Badge variant="outline" className="bg-pink-50 text-pink-700 border-pink-200 text-xs">有</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">無</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {(emp.employmentInsuranceApplied ?? true) ? (
                          <Badge variant="secondary" className="text-xs">適用</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-xs">非適用</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenEdit(emp); }}>
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Employee Edit Dialog */}
      <Dialog open={!!editingEmployee} onOpenChange={(open) => { if (!open) setEditingEmployee(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee?.name}　扶養・保険設定</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{editingEmployee?.employeeCode}　{editingEmployee?.department}</p>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* 扶養・家族 */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">扶養・家族設定</h4>
                <div className="space-y-3">
                  <FormField control={form.control} name="dependentCount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>扶養親族数（人）</FormLabel>
                      <FormControl><Input type="number" min={0} placeholder="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="hasSpouse" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>配偶者の有無</FormLabel>
                        <p className="text-xs text-muted-foreground">配偶者控除の適用に使用</p>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>

              <Separator />

              {/* 社会保険 */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">社会保険設定</h4>
                <p className="text-xs text-muted-foreground mb-3">保険料は計算テーブルマスターの料率を使って自動計算されます。</p>
                <FormField control={form.control} name="employmentInsuranceApplied" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>雇用保険適用</FormLabel>
                      <p className="text-xs text-muted-foreground">適用外の場合はオフ（役員等）</p>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingEmployee(null)}>キャンセル</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>保存する</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 計算テーブルマスター Tab ──────────────────────────────────────

const TAX_BRACKETS = [
  { min: 0, max: 88_000, rates: ["0", "0", "0", "0", "0", "0", "0"] },
  { min: 88_000, max: 89_000, rates: ["130", "0", "0", "0", "0", "0", "0"] },
  { min: 89_000, max: 90_000, rates: ["180", "0", "0", "0", "0", "0", "0"] },
  { min: 90_000, max: 91_000, rates: ["220", "0", "0", "0", "0", "0", "0"] },
  { min: 95_000, max: 100_000, rates: ["320", "0", "0", "0", "0", "0", "0"] },
  { min: 100_000, max: 110_000, rates: ["640", "0", "0", "0", "0", "0", "0"] },
  { min: 110_000, max: 120_000, rates: ["1_020", "0", "0", "0", "0", "0", "0"] },
  { min: 120_000, max: 130_000, rates: ["1_420", "0", "0", "0", "0", "0", "0"] },
  { min: 150_000, max: 160_000, rates: ["3_150", "1_490", "0", "0", "0", "0", "0"] },
  { min: 200_000, max: 210_000, rates: ["6_420", "4_750", "3_090", "1_440", "0", "0", "0"] },
  { min: 250_000, max: 260_000, rates: ["10_500", "8_840", "7_180", "5_520", "3_860", "2_200", "540"] },
  { min: 300_000, max: 310_000, rates: ["15_000", "13_300", "11_600", "9_940", "8_280", "6_620", "4_960"] },
  { min: 400_000, max: 410_000, rates: ["25_800", "24_000", "22_200", "20_400", "18_600", "16_800", "15_000"] },
  { min: 500_000, max: 510_000, rates: ["39_800", "37_900", "36_100", "34_300", "32_500", "30_700", "28_900"] },
];

const companySchema = z.object({
  healthInsuranceEmployeeRate: z.coerce.number().min(0).max(1),
  healthInsuranceEmployerRate: z.coerce.number().min(0).max(1),
  pensionEmployeeRate: z.coerce.number().min(0).max(1),
  pensionEmployerRate: z.coerce.number().min(0).max(1),
  employmentInsuranceRate: z.coerce.number().min(0).max(1),
  employmentInsuranceEmployerRate: z.coerce.number().min(0).max(1),
  overtimeRate: z.coerce.number().min(1),
  lateNightAdditionalRate: z.coerce.number().min(0),
  holidayRate: z.coerce.number().min(1),
  monthlyAverageWorkHours: z.coerce.number().min(1),
});
type CompanyFormValues = z.infer<typeof companySchema>;

function CalcTableMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: company, isLoading } = useGetCompany();
  const updateCompany = useUpdateCompany();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      healthInsuranceEmployeeRate: 0.05, healthInsuranceEmployerRate: 0.05,
      pensionEmployeeRate: 0.0915, pensionEmployerRate: 0.0915,
      employmentInsuranceRate: 0.006, employmentInsuranceEmployerRate: 0.0085,
      overtimeRate: 1.25, lateNightAdditionalRate: 0.25, holidayRate: 1.35,
      monthlyAverageWorkHours: 160,
    },
    values: company ? {
      healthInsuranceEmployeeRate: company.healthInsuranceEmployeeRate,
      healthInsuranceEmployerRate: company.healthInsuranceEmployerRate,
      pensionEmployeeRate: company.pensionEmployeeRate,
      pensionEmployerRate: company.pensionEmployerRate,
      employmentInsuranceRate: company.employmentInsuranceRate,
      employmentInsuranceEmployerRate: company.employmentInsuranceEmployerRate,
      overtimeRate: company.overtimeRate,
      lateNightAdditionalRate: company.lateNightAdditionalRate,
      holidayRate: company.holidayRate,
      monthlyAverageWorkHours: company.monthlyAverageWorkHours,
    } : undefined,
  });

  const onSubmit = async (data: CompanyFormValues) => {
    try {
      await updateCompany.mutateAsync({ data });
      toast({ title: "保存しました", description: "計算テーブルマスタを更新しました。" });
      queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  const pct = (v: unknown) => `${(Number(v) * 100).toFixed(2)}%`;

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">読み込み中...</div>;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold">計算テーブルマスター</h3>
          <p className="text-sm text-muted-foreground">社会保険料率・時間外割増率などの計算パラメータを管理します。</p>
        </div>

        {/* 社会保険料率 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">社会保険料率マスタ</CardTitle>
            <CardDescription>料率は小数で入力してください。例：5% → 0.05</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-3 text-muted-foreground">健康保険</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="healthInsuranceEmployeeRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>本人負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.0500" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="healthInsuranceEmployerRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>会社負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.0500" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-3 text-muted-foreground">厚生年金保険</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="pensionEmployeeRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>本人負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.0915" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="pensionEmployerRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>会社負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.0915" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-3 text-muted-foreground">雇用保険</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="employmentInsuranceRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>本人負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.006" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="employmentInsuranceEmployerRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>会社負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.0085" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 時間外単価計算 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">時間外単価計算ロジック</CardTitle>
            <CardDescription>割増率は1.0基準で入力してください。例：25%増 → 1.25</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <FormField control={form.control} name="overtimeRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>残業割増率</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="1.25" {...field} /></FormControl>
                  <p className="text-xs text-muted-foreground">時給 × 残業時間 × この率</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lateNightAdditionalRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>深夜追加割増率</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="0.25" {...field} /></FormControl>
                  <p className="text-xs text-muted-foreground">深夜：残業率+この率（例：1.25+0.25=1.50）</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="holidayRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>休日出勤割増率</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="1.35" {...field} /></FormControl>
                  <p className="text-xs text-muted-foreground">時給 × 8h × 休日日数 × この率</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="monthlyAverageWorkHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>月平均労働時間（時間）</FormLabel>
                  <FormControl><Input type="number" step="1" placeholder="160" {...field} /></FormControl>
                  <p className="text-xs text-muted-foreground">時給単価 = 基本給 ÷ この時間数</p>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </CardContent>
        </Card>

        {/* 源泉徴収税額表（参考表示） */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">源泉徴収税額表（月額表・甲欄）</CardTitle>
            <CardDescription>
              国税庁の月額源泉徴収税額表（甲欄）に基づく参考値です。復興特別所得税2.1%込み。
              実際の計算はシステムが自動適用します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">課税給与所得（円）</TableHead>
                    <TableHead className="text-xs text-right">扶養0人</TableHead>
                    <TableHead className="text-xs text-right">扶養1人</TableHead>
                    <TableHead className="text-xs text-right">扶養2人</TableHead>
                    <TableHead className="text-xs text-right">扶養3人</TableHead>
                    <TableHead className="text-xs text-right">扶養4人</TableHead>
                    <TableHead className="text-xs text-right">扶養5人</TableHead>
                    <TableHead className="text-xs text-right">扶養6人</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TAX_BRACKETS.map((row, i) => (
                    <TableRow key={i} className="text-xs">
                      <TableCell className="font-mono text-muted-foreground">
                        {row.min.toLocaleString()}〜{row.max.toLocaleString()}
                      </TableCell>
                      {row.rates.map((rate, j) => (
                        <TableCell key={j} className="text-right font-mono">{rate.replace(/_/g, "")}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">※ 上記は代表的な区分の税額（円）の抜粋です。実際の計算には完全な税額表が使用されます。</p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            保存する
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function MasterManagement() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 border-b pb-4">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Settings2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">マスター管理</h2>
            <p className="text-sm text-muted-foreground mt-1">
              社員・手当・計算テーブルの基本設定を管理します。
            </p>
          </div>
        </div>

        <Tabs defaultValue="employees" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="employees" className="flex items-center gap-2">
              <Users className="h-4 w-4" />社員マスター
            </TabsTrigger>
            <TabsTrigger value="allowances" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />手当マスター
            </TabsTrigger>
            <TabsTrigger value="calc-tables" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />計算テーブルマスター
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employees">
            <EmployeeMasterTab />
          </TabsContent>

          <TabsContent value="allowances">
            <AllowanceMasterTab />
          </TabsContent>

          <TabsContent value="calc-tables">
            <CalcTableMasterTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
