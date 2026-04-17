import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListAllowanceDefinitions,
  getListAllowanceDefinitionsQueryKey,
  useCreateAllowanceDefinition,
  useUpdateAllowanceDefinition,
  useDeleteAllowanceDefinition,
  useListDeductionDefinitions,
  getListDeductionDefinitionsQueryKey,
  useCreateDeductionDefinition,
  useUpdateDeductionDefinition,
  useDeleteDeductionDefinition,
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
  useGetCompany,
  getGetCompanyQueryKey,
  useUpdateCompany,
  AllowanceDefinition,
  DeductionDefinition,
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Edit2, Trash2, Settings2, Users, Wallet, Calculator, Minus, Search, KeyRound, RotateCcw, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  sortOrder: z.number().int().min(1, "1以上の整数を入力してください").optional(),
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
      sortOrder: Math.max(1, allowance.sortOrder),
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: AllowanceFormValues) => {
    try {
      if (editingAllowance) {
        await updateAllowance.mutateAsync({
          id: editingAllowance.id,
          data: { name: data.name, description: data.description || undefined, isTaxable: data.isTaxable, calculationType: data.calculationType, isActive: data.isActive ?? true, sortOrder: data.sortOrder },
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
                        <TableCell>{Math.max(0, a.sortOrder)}</TableCell>
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
                <>
                  <FormField control={form.control} name="sortOrder" render={({ field }) => (
                    <FormItem>
                      <FormLabel>表示順</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder="例：1"
                          {...field}
                          value={field.value ?? ""}
                          onChange={e => field.onChange(e.target.value === "" ? undefined : parseInt(e.target.value, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <FormLabel className="text-base">有効</FormLabel>
                        <p className="text-sm text-muted-foreground">無効にすると給与計算に使用されません</p>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </>
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

// ─── 差引マスター Tab ──────────────────────────────────────────────

const deductionCalcTypeLabels: Record<string, { label: string; color: string }> = {
  fixed: { label: "固定額型", color: "bg-blue-50 text-blue-700 border-blue-200" },
  variable: { label: "変動入力型", color: "bg-orange-50 text-orange-700 border-orange-200" },
};

const deductionSchema = z.object({
  name: z.string().min(1, "差引名称を入力してください"),
  description: z.string().optional(),
  calculationType: z.enum(["fixed", "variable"]).default("fixed"),
  isActive: z.boolean().default(true).optional(),
  sortOrder: z.number().int().min(1, "1以上の整数を入力してください").optional(),
});
type DeductionFormValues = z.infer<typeof deductionSchema>;

function DeductionMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: deductions, isLoading } = useListDeductionDefinitions({});
  const createDeduction = useCreateDeductionDefinition();
  const updateDeduction = useUpdateDeductionDefinition();
  const deleteDeduction = useDeleteDeductionDefinition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingDeduction, setEditingDeduction] = useState<DeductionDefinition | null>(null);
  const [deletingDeduction, setDeletingDeduction] = useState<DeductionDefinition | null>(null);

  const form = useForm<DeductionFormValues>({
    resolver: zodResolver(deductionSchema),
    defaultValues: { name: "", description: "", calculationType: "fixed", isActive: true },
  });

  const handleOpenCreate = () => {
    setEditingDeduction(null);
    form.reset({ name: "", description: "", calculationType: "fixed", isActive: true });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (deduction: DeductionDefinition) => {
    setEditingDeduction(deduction);
    form.reset({
      name: deduction.name,
      description: deduction.description || "",
      calculationType: (deduction.calculationType as "fixed" | "variable") ?? "fixed",
      isActive: deduction.isActive,
      sortOrder: Math.max(1, deduction.sortOrder),
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: DeductionFormValues) => {
    try {
      if (editingDeduction) {
        await updateDeduction.mutateAsync({
          id: editingDeduction.id,
          data: { name: data.name, description: data.description || undefined, calculationType: data.calculationType, isActive: data.isActive ?? true, sortOrder: data.sortOrder },
        });
        toast({ title: "保存しました", description: "差引マスタを更新しました。" });
      } else {
        await createDeduction.mutateAsync({
          data: { name: data.name, description: data.description || undefined, calculationType: data.calculationType },
        });
        toast({ title: "追加しました", description: "新しい差引項目を登録しました。" });
      }
      queryClient.invalidateQueries({ queryKey: getListDeductionDefinitionsQueryKey() });
      setIsDialogOpen(false);
    } catch {
      toast({ title: "エラー", description: "差引マスタの保存に失敗しました。", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deletingDeduction) return;
    try {
      await deleteDeduction.mutateAsync({ id: deletingDeduction.id });
      toast({ title: "削除しました", description: "差引項目を削除しました。" });
      queryClient.invalidateQueries({ queryKey: getListDeductionDefinitionsQueryKey() });
      setIsDeleteDialogOpen(false);
    } catch {
      toast({ title: "エラー", description: "差引の削除に失敗しました。", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">差引マスター</h3>
          <p className="text-sm text-muted-foreground">積立金・組合費など給与から差し引く項目を定義します。</p>
        </div>
        <Button onClick={handleOpenCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" />差引を追加
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">読み込み中...</div>
          ) : !deductions || deductions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border-dashed border rounded-md m-4">
              差引項目が登録されていません。「差引を追加」ボタンから登録してください。
            </div>
          ) : (
            <div className="rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>差引名称</TableHead>
                    <TableHead>説明</TableHead>
                    <TableHead>計算タイプ</TableHead>
                    <TableHead className="w-20">表示順</TableHead>
                    <TableHead className="w-24">状態</TableHead>
                    <TableHead className="w-24 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deductions.map((d) => {
                    const ct = deductionCalcTypeLabels[d.calculationType] ?? deductionCalcTypeLabels.fixed;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-muted-foreground">{d.description || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ct.color}>{ct.label}</Badge>
                        </TableCell>
                        <TableCell>{Math.max(0, d.sortOrder)}</TableCell>
                        <TableCell>
                          {d.isActive ? <Badge variant="secondary">有効</Badge> : <Badge variant="outline" className="text-muted-foreground">無効</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(d)}><Edit2 className="h-4 w-4 text-muted-foreground" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => { setDeletingDeduction(d); setIsDeleteDialogOpen(true); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
            <DialogTitle>{editingDeduction ? "差引項目を編集" : "新しい差引項目を追加"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>差引名称 <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="例：積立金、組合費、親睦会費" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>説明</FormLabel>
                  <FormControl><Input placeholder="例：毎月一定額を積立" {...field} value={field.value || ""} /></FormControl>
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
                      <SelectItem value="fixed">固定額型（毎月固定額を差し引く）</SelectItem>
                      <SelectItem value="variable">変動入力型（月ごとに金額入力）</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              {editingDeduction && (
                <>
                  <FormField control={form.control} name="sortOrder" render={({ field }) => (
                    <FormItem>
                      <FormLabel>表示順</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder="例：1"
                          {...field}
                          value={field.value ?? ""}
                          onChange={e => field.onChange(e.target.value === "" ? undefined : parseInt(e.target.value, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <FormLabel className="text-base">有効</FormLabel>
                        <p className="text-sm text-muted-foreground">無効にすると給与計算に使用されません</p>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </>
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
            <AlertDialogDescription>「{deletingDeduction?.name}」を削除します。この操作は元に戻せません。</AlertDialogDescription>
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

const empFullSchema = z.object({
  employeeCode: z.string().min(1, "社員番号を入力してください"),
  name: z.string().min(1, "氏名を入力してください"),
  nameKana: z.string().min(1, "フリガナを入力してください"),
  department: z.string().min(1, "部署を入力してください"),
  position: z.string().optional(),
  hireDate: z.string().min(1, "入社日を入力してください"),
  isActive: z.boolean().default(true),
  salaryType: z.enum(["fixed", "daily"]).default("daily"),
  baseSalary: z.coerce.number().min(0).default(0),
  residentTax: z.coerce.number().min(0).default(0),
  commissionRatePerKm: z.coerce.number().min(0).default(0),
  commissionRatePerCase: z.coerce.number().min(0).default(0),
  dependentCount: z.coerce.number().int().min(0).default(0),
  hasSpouse: z.boolean().default(false),
  standardRemuneration: z.coerce.number().min(0).default(0),
  careInsuranceApplied: z.boolean().default(false),
  employmentInsuranceApplied: z.boolean().default(true),
  scheduledWorkStart: z.string().optional().default(""),
  scheduledWorkEnd: z.string().optional().default(""),
});
type EmpFullValues = z.infer<typeof empFullSchema>;

function EmpFormFields({ form: f, salaryType }: { form: ReturnType<typeof useForm<EmpFullValues>>, salaryType: string }) {
  return (
    <>
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">基本情報</h4>
        <div className="grid grid-cols-2 gap-3">
          <FormField control={f.control} name="employeeCode" render={({ field }) => (
            <FormItem><FormLabel>社員番号 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="hireDate" render={({ field }) => (
            <FormItem><FormLabel>入社日 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>氏名 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="nameKana" render={({ field }) => (
            <FormItem><FormLabel>フリガナ <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="department" render={({ field }) => (
            <FormItem><FormLabel>部署 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="position" render={({ field }) => (
            <FormItem><FormLabel>役職</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} /></FormControl></FormItem>
          )} />
        </div>
      </div>
      <Separator />
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">就労時間</h4>
        {(() => {
          const start = f.watch("scheduledWorkStart");
          const end = f.watch("scheduledWorkEnd");
          const isUnset = !start && !end;
          return (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isUnset}
                  onChange={(e) => {
                    if (e.target.checked) {
                      f.setValue("scheduledWorkStart", "");
                      f.setValue("scheduledWorkEnd", "");
                    } else {
                      f.setValue("scheduledWorkStart", "08:00");
                      f.setValue("scheduledWorkEnd", "17:00");
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-muted-foreground">就労時間未定（取引先による）</span>
              </label>
              {!isUnset && (
                <div className="flex items-center gap-3">
                  <FormField control={f.control} name="scheduledWorkStart" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>開始時刻</FormLabel>
                      <FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <span className="text-muted-foreground mt-6">～</span>
                  <FormField control={f.control} name="scheduledWorkEnd" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>終了時刻</FormLabel>
                      <FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}
            </div>
          );
        })()}
      </div>
      <Separator />
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">給与形態</h4>
        <div className="space-y-3">
          <FormField control={f.control} name="salaryType" render={({ field }) => (
            <FormItem><FormLabel>給与タイプ</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="daily">日給制（平日9,808円 / 土曜12,260円 / 日曜1,655円/h）</SelectItem>
                  <SelectItem value="fixed">固定給（毎月固定額）</SelectItem>
                </SelectContent>
              </Select><FormMessage /></FormItem>
          )} />
          {salaryType === "fixed" && (
            <FormField control={f.control} name="baseSalary" render={({ field }) => (
              <FormItem><FormLabel>月額固定給（円）</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} step={1000} placeholder="700000" {...field} className="text-right" />
                    <span className="text-sm text-muted-foreground shrink-0">円</span>
                  </div>
                </FormControl><FormMessage /></FormItem>
            )} />
          )}
          <FormField control={f.control} name="residentTax" render={({ field }) => (
            <FormItem><FormLabel>市町村民税（月額・円）</FormLabel>
              <FormControl>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} step={100} placeholder="0" {...field} className="text-right" />
                  <span className="text-sm text-muted-foreground shrink-0">円</span>
                </div>
              </FormControl>
              <p className="text-xs text-muted-foreground">毎月差し引く住民税（特別徴収）の月額</p>
              <FormMessage /></FormItem>
          )} />
          <div className="grid grid-cols-2 gap-3">
            <FormField control={f.control} name="commissionRatePerKm" render={({ field }) => (
              <FormItem><FormLabel>歩合単価（円/km）</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-sm">¥</span>
                    <Input type="number" step="0.1" {...field} />
                  </div>
                </FormControl></FormItem>
            )} />
            <FormField control={f.control} name="commissionRatePerCase" render={({ field }) => (
              <FormItem><FormLabel>歩合単価（円/件）</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-sm">¥</span>
                    <Input type="number" {...field} />
                  </div>
                </FormControl></FormItem>
            )} />
          </div>
        </div>
      </div>
      <Separator />
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">扶養・家族設定</h4>
        <div className="space-y-3">
          <FormField control={f.control} name="dependentCount" render={({ field }) => (
            <FormItem><FormLabel>扶養親族数（人）</FormLabel>
              <FormControl><Input type="number" min={0} placeholder="0" {...field} /></FormControl>
              <FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="hasSpouse" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <div><FormLabel>配偶者の有無</FormLabel>
                <p className="text-xs text-muted-foreground">配偶者控除の適用に使用</p></div>
              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
        </div>
      </div>
      <Separator />
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">社会保険設定</h4>
        <p className="text-xs text-muted-foreground mb-3">保険料は計算テーブルマスターの料率 × 標準報酬月額で計算されます。</p>
        <div className="space-y-3">
          <FormField control={f.control} name="standardRemuneration" render={({ field }) => (
            <FormItem><FormLabel>標準報酬月額（円）</FormLabel>
              <FormControl>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} step={1000} placeholder="470000" {...field} className="text-right" />
                  <span className="text-sm text-muted-foreground shrink-0">円</span>
                </div>
              </FormControl>
              <p className="text-xs text-muted-foreground">4〜6月の平均報酬で決定、9月〜翌8月固定。健保・厚年の計算基礎。</p>
              <FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="careInsuranceApplied" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <div><FormLabel>介護保険適用</FormLabel>
                <p className="text-xs text-muted-foreground">40〜64歳の対象者はオン</p></div>
              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          <FormField control={f.control} name="employmentInsuranceApplied" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <div><FormLabel>雇用保険適用</FormLabel>
                <p className="text-xs text-muted-foreground">適用外の場合はオフ（役員等）</p></div>
              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
        </div>
      </div>
    </>
  );
}

function EmployeeMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: employees, isLoading } = useListEmployees({}, { query: { staleTime: 0, refetchOnMount: true } });
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  const [pinInput, setPinInput] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinSet, setPinSet] = useState<boolean | null>(null);

  useEffect(() => {
    if (!editingEmployee) { setPinSet(null); setPinInput(""); return; }
    fetch(`${BASE}/api/employees/${editingEmployee.id}/pin/status`)
      .then(r => r.json())
      .then((d: { pinSet: boolean }) => setPinSet(d.pinSet))
      .catch(() => {});
  }, [editingEmployee]);

  const handleSetPin = async () => {
    if (!/^\d{4}$/.test(pinInput) || !editingEmployee) {
      toast({ title: "エラー", description: "4桁の数字を入力してください", variant: "destructive" });
      return;
    }
    setPinSaving(true);
    try {
      const res = await fetch(`${BASE}/api/employees/${editingEmployee.id}/pin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (!res.ok) throw new Error();
      setPinSet(true); setPinInput("");
      toast({ title: "PIN設定完了", description: "PINコードを設定しました" });
    } catch {
      toast({ title: "エラー", description: "PIN設定に失敗しました", variant: "destructive" });
    } finally { setPinSaving(false); }
  };

  const handleResetPin = async () => {
    if (!editingEmployee) return;
    setPinSaving(true);
    try {
      const res = await fetch(`${BASE}/api/employees/${editingEmployee.id}/pin`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setPinSet(false); setPinInput("");
      toast({ title: "PINリセット完了", description: "PINコードを削除しました" });
    } catch {
      toast({ title: "エラー", description: "PINリセットに失敗しました", variant: "destructive" });
    } finally { setPinSaving(false); }
  };

  const editForm = useForm<EmpFullValues>({
    resolver: zodResolver(empFullSchema),
    defaultValues: {
      employeeCode: "", name: "", nameKana: "", department: "", position: "",
      hireDate: "", isActive: true, salaryType: "daily", baseSalary: 0,
      residentTax: 0, commissionRatePerKm: 0, commissionRatePerCase: 0,
      dependentCount: 0, hasSpouse: false, standardRemuneration: 0,
      careInsuranceApplied: false, employmentInsuranceApplied: true,
      scheduledWorkStart: "", scheduledWorkEnd: "",
    },
  });
  const createForm = useForm<EmpFullValues>({
    resolver: zodResolver(empFullSchema),
    defaultValues: {
      employeeCode: "", name: "", nameKana: "", department: "配送部", position: "",
      hireDate: new Date().toISOString().split("T")[0], isActive: true,
      salaryType: "daily", baseSalary: 0, residentTax: 0,
      commissionRatePerKm: 0, commissionRatePerCase: 0,
      dependentCount: 0, hasSpouse: false, standardRemuneration: 0,
      careInsuranceApplied: false, employmentInsuranceApplied: true,
      scheduledWorkStart: "", scheduledWorkEnd: "",
    },
  });

  const editSalaryType = editForm.watch("salaryType");
  const createSalaryType = createForm.watch("salaryType");

  const handleOpenEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    editForm.reset({
      employeeCode: emp.employeeCode,
      name: emp.name,
      nameKana: emp.nameKana,
      department: emp.department,
      position: emp.position || "",
      hireDate: emp.hireDate.split("T")[0],
      isActive: emp.isActive,
      salaryType: (emp.salaryType as "fixed" | "daily") ?? "daily",
      baseSalary: emp.baseSalary ?? 0,
      residentTax: emp.residentTax ?? 0,
      commissionRatePerKm: emp.commissionRatePerKm ?? 0,
      commissionRatePerCase: emp.commissionRatePerCase ?? 0,
      dependentCount: emp.dependentCount,
      hasSpouse: emp.hasSpouse ?? false,
      standardRemuneration: emp.standardRemuneration ?? 0,
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
      scheduledWorkStart: (emp as unknown as { scheduledWorkStart?: string | null }).scheduledWorkStart ?? "",
      scheduledWorkEnd: (emp as unknown as { scheduledWorkEnd?: string | null }).scheduledWorkEnd ?? "",
    });
  };

  const onEditSubmit = async (data: EmpFullValues) => {
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

  const onCreateSubmit = async (data: EmpFullValues) => {
    try {
      const res = await createEmployee.mutateAsync({ data });
      toast({ title: "登録しました", description: `${res.name}を登録しました。` });
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setIsCreateOpen(false);
      createForm.reset();
    } catch {
      toast({ title: "エラー", description: "社員の登録に失敗しました。", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEmployee.mutateAsync({ id: deleteTarget.id });
      toast({ title: "削除しました", description: "社員情報を削除しました。" });
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setDeleteTarget(null);
      if (editingEmployee?.id === deleteTarget.id) setEditingEmployee(null);
    } catch {
      toast({ title: "エラー", description: "社員の削除に失敗しました。", variant: "destructive" });
    }
  };

  const filtered = (employees ?? []).filter(emp => {
    if (!showInactive && !emp.isActive) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return emp.name.toLowerCase().includes(q) ||
      emp.nameKana.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">社員マスター</h3>
          <p className="text-sm text-muted-foreground">社員の基本情報・給与形態・保険設定をまとめて管理します。</p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />新規登録
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="社員番号・氏名・部署で検索..." className="pl-8 bg-card"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          退職済も表示
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">読み込み中...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border-dashed border rounded-md m-4">
              社員が見つかりません。
            </div>
          ) : (
            <div className="rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>社員番号</TableHead>
                    <TableHead>氏名</TableHead>
                    <TableHead>部署</TableHead>
                    <TableHead>役職</TableHead>
                    <TableHead>給与形態</TableHead>
                    <TableHead>扶養</TableHead>
                    <TableHead className="text-right">標準報酬</TableHead>
                    <TableHead>介護保険</TableHead>
                    <TableHead>雇保</TableHead>
                    <TableHead>在籍</TableHead>
                    <TableHead className="w-20 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((emp) => (
                    <TableRow key={emp.id} className="cursor-pointer hover:bg-muted/40" onClick={() => handleOpenEdit(emp)}>
                      <TableCell className="text-muted-foreground text-sm">{emp.employeeCode}</TableCell>
                      <TableCell>
                        <div className="font-medium">{emp.name}</div>
                        <div className="text-xs text-muted-foreground">{emp.nameKana}</div>
                      </TableCell>
                      <TableCell className="text-sm">{emp.department}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{emp.position || "-"}</TableCell>
                      <TableCell>
                        {(emp.salaryType ?? "daily") === "daily" ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">日給制</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">固定給</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{emp.dependentCount}人</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {(emp.standardRemuneration && emp.standardRemuneration > 0)
                          ? emp.standardRemuneration.toLocaleString("ja-JP") + "円"
                          : <span className="text-muted-foreground">未設定</span>}
                      </TableCell>
                      <TableCell>
                        {(emp.careInsuranceApplied ?? false) ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">適用</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">非適用</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {(emp.employmentInsuranceApplied ?? true) ? (
                          <Badge variant="secondary" className="text-xs">適用</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-xs">非適用</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {emp.isActive ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-xs">在籍</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">退職</Badge>
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

      {/* 新規登録ダイアログ */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新規社員登録</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-6">
              <EmpFormFields form={createForm} salaryType={createSalaryType} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>キャンセル</Button>
                <Button type="submit" disabled={createForm.formState.isSubmitting}>
                  <UserPlus className="mr-2 h-4 w-4" />登録する
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 編集ダイアログ */}
      <Dialog open={!!editingEmployee} onOpenChange={(open) => { if (!open) setEditingEmployee(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee?.name}　社員情報編集</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{editingEmployee?.employeeCode}　{editingEmployee?.department}</p>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-6">
              <EmpFormFields form={editForm} salaryType={editSalaryType} />

              <Separator />

              {/* 在籍状況 */}
              <FormField control={editForm.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div><FormLabel className="text-base">在籍状況</FormLabel>
                    <p className="text-sm text-muted-foreground">退職した場合はオフにしてください</p></div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />

              <Separator />

              {/* PINコード管理 */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />打刻PINコード管理
                </h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">現在の状態：</span>
                    {pinSet === null ? (
                      <span className="text-muted-foreground">確認中...</span>
                    ) : pinSet ? (
                      <span className="font-semibold text-green-600">✓ PIN設定済み</span>
                    ) : (
                      <span className="text-muted-foreground">未設定</span>
                    )}
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 max-w-[160px]">
                      <label className="text-xs text-muted-foreground block mb-1">新しいPIN（4桁）</label>
                      <Input type="password" inputMode="numeric" maxLength={4} placeholder="例：1234"
                        value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        className="tracking-widest text-center text-lg" />
                    </div>
                    <Button type="button" onClick={handleSetPin} disabled={pinSaving || pinInput.length !== 4} className="gap-1.5">
                      <KeyRound className="h-3.5 w-3.5" />{pinSet ? "変更" : "設定"}
                    </Button>
                    {pinSet && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" disabled={pinSaving}>
                            <RotateCcw className="h-3.5 w-3.5" />リセット
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>PINコードをリセットしますか？</AlertDialogTitle>
                            <AlertDialogDescription>PINを削除すると、QRコードはPIN入力なしで使えるようになります。</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction onClick={handleResetPin} className="bg-destructive hover:bg-destructive/90">削除する</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">PINを設定すると、QRコード読み取り後に4桁の入力が必要になります。</p>
                </div>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button type="button" variant="destructive" size="sm" className="mr-auto"
                  onClick={() => setDeleteTarget(editingEmployee)}>
                  <Trash2 className="mr-1 h-4 w-4" />削除
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingEmployee(null)}>キャンセル</Button>
                <Button type="submit" disabled={editForm.formState.isSubmitting}>保存する</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>本当に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>「{deleteTarget?.name}」を削除します。この操作は取り消せません（論理削除）。</AlertDialogDescription>
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
  careInsuranceRate: z.coerce.number().min(0).max(1),
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
      healthInsuranceEmployeeRate: 0.04925, healthInsuranceEmployerRate: 0.04925,
      careInsuranceRate: 0.0091,
      pensionEmployeeRate: 0.0915, pensionEmployerRate: 0.0915,
      employmentInsuranceRate: 0.006, employmentInsuranceEmployerRate: 0.0085,
      overtimeRate: 1.25, lateNightAdditionalRate: 0.25, holidayRate: 1.35,
      monthlyAverageWorkHours: 160,
    },
    values: company ? {
      healthInsuranceEmployeeRate: company.healthInsuranceEmployeeRate,
      healthInsuranceEmployerRate: company.healthInsuranceEmployerRate,
      careInsuranceRate: company.careInsuranceRate,
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
                <p className="text-sm font-medium mb-3 text-muted-foreground">介護保険（40〜64歳対象者のみ適用）</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="careInsuranceRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>本人負担率</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.0001" placeholder="0.0091" {...field} />
                          <span className="text-sm text-muted-foreground w-14">{pct(field.value || 0)}</span>
                        </div>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">協会けんぽ標準: 0.0091（1.82%÷2）</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex items-end pb-6">
                    <p className="text-xs text-muted-foreground">
                      従業員マスタの「介護保険適用」フラグが ON の社員にのみ<br />
                      この料率で計算されます。
                    </p>
                  </div>
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
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="employees" className="flex items-center gap-2">
              <Users className="h-4 w-4" />社員マスター
            </TabsTrigger>
            <TabsTrigger value="allowances" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />手当マスター
            </TabsTrigger>
            <TabsTrigger value="deductions" className="flex items-center gap-2">
              <Minus className="h-4 w-4" />差引マスター
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

          <TabsContent value="deductions">
            <DeductionMasterTab />
          </TabsContent>

          <TabsContent value="calc-tables">
            <CalcTableMasterTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
