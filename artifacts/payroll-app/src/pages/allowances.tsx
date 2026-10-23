import { useState, useEffect, useRef, type ReactNode } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Edit2, Trash2, Settings2, Users, Wallet, Calculator, Minus, Search, KeyRound, RotateCcw, UserPlus, Pin, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DatePartsInput } from "@/components/ui/date-parts-input";
import { InsuranceRatePeriodsCard } from "@/components/insurance/insurance-rate-periods-card";
import { StandardRemunerationHistorySection } from "@/components/insurance/standard-remuneration-history";
import { StandardRemunerationBulkTab } from "@/components/insurance/standard-remuneration-bulk";
import { BankAccountTab, type BankAccountTabHandle } from "@/components/bank-account-tab";
import { RecalcNotice } from "@/components/recalc-notice";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TimeField } from "@/components/ui/time-field";
import type { FieldErrors } from "react-hook-form";

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
  pinned: z.boolean().default(false),
  excludeFromEmploymentInsurance: z.boolean().default(false),
  includeInPremiumBase: z.boolean().default(false),
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
    defaultValues: { name: "", description: "", isTaxable: true, calculationType: "variable", isActive: true, pinned: false, excludeFromEmploymentInsurance: false, includeInPremiumBase: false },
  });

  const handleOpenCreate = () => {
    setEditingAllowance(null);
    form.reset({ name: "", description: "", isTaxable: true, calculationType: "variable", isActive: true, pinned: false, excludeFromEmploymentInsurance: false, includeInPremiumBase: false });
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
      pinned: allowance.pinned ?? false,
      excludeFromEmploymentInsurance: allowance.excludeFromEmploymentInsurance ?? false,
      includeInPremiumBase: (allowance as { includeInPremiumBase?: boolean }).includeInPremiumBase ?? false,
      sortOrder: Math.max(1, allowance.sortOrder),
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: AllowanceFormValues) => {
    try {
      if (editingAllowance) {
        await updateAllowance.mutateAsync({
          id: editingAllowance.id,
          data: { name: data.name, description: data.description || undefined, isTaxable: data.isTaxable, calculationType: data.calculationType, isActive: data.isActive ?? true, sortOrder: data.sortOrder, pinned: data.pinned, excludeFromEmploymentInsurance: data.excludeFromEmploymentInsurance, includeInPremiumBase: data.includeInPremiumBase } as never,
        });
        toast({ title: "保存しました", description: "手当マスタを更新しました。" });
      } else {
        await createAllowance.mutateAsync({
          data: { name: data.name, description: data.description || undefined, isTaxable: data.isTaxable, calculationType: data.calculationType, pinned: data.pinned, excludeFromEmploymentInsurance: data.excludeFromEmploymentInsurance, includeInPremiumBase: data.includeInPremiumBase } as never,
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {a.isTaxable ? (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">課税</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">非課税</Badge>
                            )}
                            {a.pinned && (
                              <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
                                <Pin className="h-3 w-3" />固定
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{Math.max(1, a.sortOrder)}</TableCell>
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
              <FormField control={form.control} name="pinned" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-500/10 dark:border-amber-500/25 p-4">
                  <div>
                    <FormLabel className="text-base flex items-center gap-1.5"><Pin className="h-4 w-4 text-amber-600" />リストに固定</FormLabel>
                    <p className="text-sm text-muted-foreground">オンにすると全社員の手当リストに常時表示され、毎回追加する手間が省けます</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="excludeFromEmploymentInsurance" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50/50 dark:bg-sky-500/10 dark:border-sky-500/25 p-4">
                  <div>
                    <FormLabel className="text-base">雇用保険の対象外にする</FormLabel>
                    <p className="text-sm text-muted-foreground">オンにすると、この手当は雇用保険料の計算基礎から除きます（携帯代など実費弁償の手当向け。交通費は対象に含めるためオフのまま）</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="includeInPremiumBase" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50/50 dark:bg-violet-500/10 dark:border-violet-500/25 p-4">
                  <div>
                    <FormLabel className="text-base">割増の基礎・最低賃金に入れる</FormLabel>
                    <p className="text-sm text-muted-foreground">オンにすると、残業・休日・深夜の単価（会社設定①が入のとき）と最低賃金の比較に、この手当を入れます。家族手当・通勤手当・住宅手当・臨時の手当・残業などの手当は入れません（労基法37条5項）。</p>
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
                        <TableCell>{Math.max(1, d.sortOrder)}</TableCell>
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

function calcAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

const empFullSchema = z.object({
  employeeCode: z.string().min(1, "社員番号を入力してください"),
  name: z.string().min(1, "氏名を入力してください"),
  nameKana: z.string().min(1, "フリガナを入力してください"),
  department: z.string().min(1, "部署を入力してください"),
  position: z.string().optional(),
  /** 電話番号（勤怠管理から電話をかけるため） */
  phone: z.string().optional().default("").refine((v) => !v || /^[0-9０-９+()\-ー－ ]{6,20}$/.test(v.trim()), "数字とハイフンで入れてください（例：080-1234-5678）"),
  dateOfBirth: z.string().optional().default(""),
  hireDate: z.string().min(1, "入社日を入力してください"),
  isActive: z.boolean().default(true),
  isOfficeStaff: z.boolean().default(false),
  salaryType: z.enum(["fixed", "daily", "hourly"]).default("daily"),
  baseSalary: z.coerce.number().min(0).default(0),
  residentTax: z.coerce.number().min(0).default(0),
  otherDeductionMonthly: z.coerce.number().min(0).default(0),
  useBluewingLogic: z.boolean().default(false),
  bluewingCommissionRate: z.coerce.number().min(0).max(100).default(0),
  bluewingFixedOvertimeHours: z.coerce.number().min(0).default(0),
  bluewingFixedOvertimeAmount: z.coerce.number().min(0).default(0),
  dependentCount: z.coerce.number().int().min(0).default(0),
  hasSpouse: z.boolean().default(false),
  standardRemuneration: z.coerce.number().min(0).default(0),
  careInsuranceApplied: z.boolean().default(false),
  employmentInsuranceApplied: z.boolean().default(true),
  pensionAppliedMode: z.enum(["auto", "on", "off"]).default("auto"),
  taxExempt: z.boolean().default(false),
  scheduledWorkStart: z.string().optional().default(""),
  scheduledWorkEnd: z.string().optional().default(""),
  dailyRateWeekday: z.coerce.number().min(0).default(0),
  dailyRateSaturday: z.coerce.number().min(0).default(0),
  overtimeHourlyRate: z.coerce.number().min(0).default(0),
  lateNightHourlyRate: z.coerce.number().min(0).default(0),
  overtimeUnitMinutes: z.coerce.number().int().min(0).default(0),
  overtimeUnitRate: z.coerce.number().min(0).default(0),
});
type EmpFullValues = z.infer<typeof empFullSchema>;

function TipInput({ tip, ...props }: React.ComponentProps<typeof Input> & { tip: string }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Input {...props} />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed whitespace-pre-line">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** 入力欄の名前 → その欄があるタブ（保存を押したとき、誤りのある欄のタブへ移るのに使う）*/
const EMP_FIELD_TAB: Record<string, string> = {
  employeeCode: "basic", name: "basic", nameKana: "basic", department: "basic", position: "basic",
  dateOfBirth: "basic", hireDate: "basic", isOfficeStaff: "basic", scheduledWorkStart: "basic", scheduledWorkEnd: "basic",
  dependentCount: "insurance", hasSpouse: "insurance", standardRemuneration: "insurance", careInsuranceApplied: "insurance",
  employmentInsuranceApplied: "insurance", pensionAppliedMode: "insurance", taxExempt: "insurance",
  isActive: "management",
};
const EMP_FIELD_LABEL: Record<string, string> = {
  employeeCode: "社員番号", name: "氏名", nameKana: "フリガナ", department: "部署", hireDate: "入社日",
  dateOfBirth: "生年月日", baseSalary: "基本給", residentTax: "住民税", otherDeductionMonthly: "その他の控除",
  dependentCount: "扶養人数", standardRemuneration: "標準報酬月額", dailyRateWeekday: "平日の日給",
  dailyRateSaturday: "土曜の日給", overtimeHourlyRate: "残業 時給", lateNightHourlyRate: "深夜 単価",
  bluewingCommissionRate: "BW歩合率", bluewingFixedOvertimeHours: "BW固定残業時間", bluewingFixedOvertimeAmount: "BW固定残業代",
};
const EMP_TAB_LABEL: Record<string, string> = { basic: "基本情報", salary: "給与設定", insurance: "保険・扶養", management: "管理" };

function EmpFormFields({
  form: f,
  salaryType,
  additionalTabs,
  employeeId,
  tab,
  onTabChange,
}: {
  form: ReturnType<typeof useForm<EmpFullValues>>;
  salaryType: string;
  additionalTabs?: Array<{ value: string; label: string; content: ReactNode }>;
  /** 編集中の社員ID（新規登録では無し）。標準報酬月額の履歴を出すのに使う */
  employeeId?: number;
  /** いま開いているタブ（親が持つ。入力の誤りがあるタブへ移すため）*/
  tab?: string;
  onTabChange?: (t: string) => void;
}) {
  const dobValue = f.watch("dateOfBirth");
  const age = calcAge(dobValue);
  const watchUseBluewing = f.watch("useBluewingLogic");

  // 会社設定の共通日給レートを参照（キャッシュ読み取り）。給与タイプの説明ラベルや
  // 個人単価上書き欄のヒントを、固定値ではなく会社設定の実値から動的生成する。
  const { data: company } = useGetCompany();
  const cs = company as { dailyWageWeekday?: number; dailyWageSaturday?: number; hourlyWageSunday?: number } | undefined;
  const wageWeekday  = cs?.dailyWageWeekday  ?? 9808;
  const wageSaturday = cs?.dailyWageSaturday ?? 12260;
  const wageSundayHr = cs?.hourlyWageSunday  ?? 1655;
  const dailyTypeLabel = `日給制（平日${wageWeekday.toLocaleString()}円 / 土曜${wageSaturday.toLocaleString()}円 / 日曜${wageSundayHr.toLocaleString()}円/h）`;

  // 個人単価の入力値を監視し「→ 適用: ◯◯円」の実値表示に使う
  const ovrWeekday  = Number(f.watch("dailyRateWeekday"))   || 0;
  const ovrSaturday = Number(f.watch("dailyRateSaturday"))  || 0;
  const ovrOtRate   = Number(f.watch("overtimeHourlyRate")) || 0;
  const ovrNightRate = Number(f.watch("lateNightHourlyRate")) || 0;
  // 深夜単価が空欄のときに使われる自動の単価（残業時給 ÷ 1.25 × 0.25。サーバーと同じ丸め）
  const autoNightRate = Math.round(Math.round(ovrOtRate / 1.25) * 0.25);

  useEffect(() => {
    if (!dobValue) return;
    const a = calcAge(dobValue);
    if (a === null) return;
    f.setValue("careInsuranceApplied", a >= 40 && a <= 64, { shouldDirty: false });
  }, [dobValue, f]);

  const tabCount = 3 + (additionalTabs?.length ?? 0);

  // 残業時給は給与タイプに関係なく使う（月次実績入力で早出残業手当・深夜手当を自動計算する単価）。
  // 以前は日給制の「個人単価」枠の中にしか無く、固定給・時給制の社員（高橋さんなど）は入力できなかった。
  const overtimeRateField = (
    <FormField control={f.control} name="overtimeHourlyRate" render={({ field }) => (
      <FormItem><FormLabel className="text-xs font-medium">残業 時給（円/時）</FormLabel>
        <FormControl>
          <div className="flex items-center gap-1">
            <TipInput type="number" min={0} step={1} placeholder="未設定"
              tip={"割増込みの残業時給（入力した金額がそのまま1時間あたりの残業代）。\n" +
                "設定すると、月次実績入力で残業・深夜の時間を入れたときに、手当・控除タブの「早出残業手当」「深夜手当」へ自動で入ります。\n" +
                "早出残業手当 = この単価 × 残業時間（60時間超は ×1.20）\n" +
                "深夜手当 = この単価 ÷ 1.25 × 0.25 × 深夜時間\n" +
                "空欄だと自動では入りません（手入力になります）"}
              {...field} value={field.value ? field.value : ""}
              onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
              className="text-right bg-white dark:bg-slate-900/40" />
            <span className="text-xs text-muted-foreground shrink-0">円/時</span>
          </div>
        </FormControl>
        <p className={`text-[11px] mt-1 ${ovrOtRate > 0 ? "text-amber-800 dark:text-amber-300 font-semibold" : "text-muted-foreground"}`}>
          → 適用: {ovrOtRate > 0
            ? `個人 ${ovrOtRate.toLocaleString()}円/時（早出残業手当・深夜手当に自動反映）`
            : "未設定（早出残業手当・深夜手当は自動で入りません）"}
        </p>
        <FormMessage /></FormItem>
    )} />
  );

  // 深夜単価は、残業時給と基礎が違う社員のための個別設定（空欄なら残業時給から自動）。
  const lateNightRateField = (
    <FormField control={f.control} name="lateNightHourlyRate" render={({ field }) => (
      <FormItem><FormLabel className="text-xs font-medium">深夜 単価（円/時）</FormLabel>
        <FormControl>
          <div className="flex items-center gap-1">
            <TipInput type="number" min={0} step={1} placeholder="自動"
              tip={"深夜手当の1時間あたりの単価。\n" +
                "入力すると 深夜手当 = この単価 × 深夜時間 で計算します。\n" +
                "空欄のときは 残業時給 ÷ 1.25 × 0.25 で自動計算します。\n" +
                "残業の単価と深夜の単価の基礎が違う社員だけ入力してください。"}
              {...field} value={field.value ? field.value : ""}
              onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
              className="text-right bg-white dark:bg-slate-900/40" />
            <span className="text-xs text-muted-foreground shrink-0">円/時</span>
          </div>
        </FormControl>
        <p className={`text-[11px] mt-1 ${ovrNightRate > 0 ? "text-amber-800 dark:text-amber-300 font-semibold" : "text-muted-foreground"}`}>
          → 適用: {ovrNightRate > 0
            ? `個人 ${ovrNightRate.toLocaleString()}円/時`
            : ovrOtRate > 0
            ? `自動 ${autoNightRate.toLocaleString()}円/時（残業時給 ÷ 1.25 × 0.25）`
            : "未設定（残業時給も空欄のため、深夜手当は自動で入りません）"}
        </p>
        <FormMessage /></FormItem>
    )} />
  );

  return (
    <Tabs {...(tab !== undefined ? { value: tab, onValueChange: onTabChange } : { defaultValue: "basic" })} className="w-full">
      <TabsList
        className="w-full"
        // 列は minmax(0,1fr)：1fr だけだと一番長い名前に合わせて広がり、スマホで右のタブが切れる
        style={{ display: "grid", gridTemplateColumns: `repeat(${tabCount}, minmax(0, 1fr))` }}
      >
        <TabsTrigger value="basic" className={TAB_CLS}>基本情報</TabsTrigger>
        <TabsTrigger value="salary" className={TAB_CLS}>給与設定</TabsTrigger>
        <TabsTrigger value="insurance" className={TAB_CLS}>保険・扶養</TabsTrigger>
        {additionalTabs?.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className={TAB_CLS}>{t.label}</TabsTrigger>
        ))}
      </TabsList>

      {/* タブ切替で高さがずれないよう、内容を固定高さ＋内部スクロールで包む */}
      <div className="h-[56vh] overflow-y-auto overflow-x-hidden pr-1 mt-1">
      {/* ── 基本情報タブ ── */}
      <TabsContent value="basic" className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField control={f.control} name="employeeCode" render={({ field }) => (
            <FormItem><FormLabel>社員番号 <span className="text-destructive">*</span></FormLabel>
              <FormControl><TipInput tip="社員を一意に識別する番号（例：EMP001）" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="hireDate" render={({ field }) => (
            <FormItem><FormLabel>入社日 <span className="text-destructive">*</span></FormLabel>
              <FormControl><DatePartsInput value={field.value || ""} onChange={field.onChange} /></FormControl>
              <FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>氏名 <span className="text-destructive">*</span></FormLabel>
              <FormControl><TipInput tip="フルネームを入力（例：山田 太郎）" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="nameKana" render={({ field }) => (
            <FormItem><FormLabel>フリガナ <span className="text-destructive">*</span></FormLabel>
              <FormControl><TipInput tip="カタカナで入力（例：ヤマダ タロウ）" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="dateOfBirth" render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormLabel>生年月日</FormLabel>
                {age !== null && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {age}歳{age >= 40 && age <= 64 ? "・介護保険対象" : ""}
                  </span>
                )}
              </div>
              <FormControl><DatePartsInput value={field.value || ""} onChange={field.onChange} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={f.control} name="department" render={({ field }) => (
            <FormItem><FormLabel>部署 <span className="text-destructive">*</span></FormLabel>
              <FormControl><TipInput tip="所属する部署名（例：運転部、事務部）" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={f.control} name="position" render={({ field }) => (
            <FormItem><FormLabel>役職</FormLabel>
              <FormControl><TipInput tip="役職名（例：課長）。未入力でも可" {...field} value={field.value || ""} /></FormControl></FormItem>
          )} />
          <FormField control={f.control} name="phone" render={({ field }) => (
            <FormItem><FormLabel>電話番号</FormLabel>
              <FormControl><TipInput tip="携帯など、事務所から連絡する番号。勤怠管理の「電話」ボタンでかけられます（QRの打刻ページには出ません）" inputMode="tel" placeholder="080-1234-5678" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <Separator />

        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">勤怠区分</h4>
          <FormField control={f.control} name="isOfficeStaff" render={({ field }) => (
            <FormItem>
              <label className="flex items-center gap-3 cursor-pointer select-none rounded-xl border-2 px-4 py-3 transition-colors hover:bg-muted/50"
                style={{ borderColor: field.value ? "#6366f1" : undefined, background: field.value ? "#eef2ff" : undefined }}>
                <input
                  type="checkbox"
                  checked={field.value ?? false}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-indigo-600"
                />
                <div>
                  <span className="font-semibold text-sm">事務員</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    チェックあり→ 事務専用打刻画面　／　チェックなし→ ドライバー打刻画面
                  </p>
                </div>
                {field.value && (
                  <span className="ml-auto text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">事務員</span>
                )}
              </label>
            </FormItem>
          )} />
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
                        <FormControl><TimeField value={field.value ?? ""} onChange={field.onChange} className="h-9 w-full" aria-label="定時の開始時刻" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <span className="text-muted-foreground mt-6">～</span>
                    <FormField control={f.control} name="scheduledWorkEnd" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>終了時刻</FormLabel>
                        <FormControl><TimeField value={field.value ?? ""} onChange={field.onChange} className="h-9 w-full" aria-label="定時の終了時刻" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </TabsContent>

      {/* ── 給与設定タブ ── */}
      <TabsContent value="salary" className="space-y-4 pt-4">
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">給与形態</h4>
          <div className="space-y-3">
            <FormField control={f.control} name="salaryType" render={({ field }) => (
              <FormItem><FormLabel>給与タイプ</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="daily">{dailyTypeLabel}</SelectItem>
                    <SelectItem value="fixed">固定給（毎月固定額）</SelectItem>
                    <SelectItem value="hourly">時給制（時給単価を入力）</SelectItem>
                  </SelectContent>
                </Select><FormMessage /></FormItem>
            )} />
            {salaryType === "fixed" && (
              <FormField control={f.control} name="baseSalary" render={({ field }) => (
                <FormItem><FormLabel>月額固定給（円）</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <TipInput type="number" min={0} step={1000} placeholder="700000" tip="毎月固定で支払う基本給。残業・深夜等の割増は別途加算されます" {...field} className="text-right" />
                      <span className="text-sm text-muted-foreground shrink-0">円</span>
                    </div>
                  </FormControl><FormMessage /></FormItem>
              )} />
            )}
            {salaryType === "hourly" && (
              <FormField control={f.control} name="baseSalary" render={({ field }) => (
                <FormItem><FormLabel>時給単価（円）</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <TipInput type="number" min={0} step={10} placeholder="1200" tip="1時間あたりの基本賃金。月の基本給＝時給×実働時間（30分単位切り上げ）" {...field} className="text-right" />
                      <span className="text-sm text-muted-foreground shrink-0">円/時</span>
                    </div>
                  </FormControl><FormMessage /></FormItem>
              )} />
            )}
            {salaryType === "daily" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/25 p-3.5 space-y-3">
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">個人単価（この社員だけの特別単価）</p>
                <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-0.5">
                  空欄なら会社共通単価が自動で使われます。単価が違う社員だけ入力してください。
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FormField control={f.control} name="dailyRateWeekday" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs font-medium">平日 日当（円/日）</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-1">
                        <TipInput type="number" min={0} step={1} placeholder={wageWeekday.toLocaleString()}
                          tip={`平日1日あたりの個人日当。空欄なら会社共通単価（${wageWeekday.toLocaleString()}円）を使用`}
                          {...field} value={field.value ? field.value : ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                          className="text-right bg-white dark:bg-slate-900/40" />
                        <span className="text-xs text-muted-foreground shrink-0">円/日</span>
                      </div>
                    </FormControl>
                    <p className={`text-[11px] mt-1 ${ovrWeekday > 0 ? "text-amber-800 dark:text-amber-300 font-semibold" : "text-muted-foreground"}`}>
                      → 適用: {ovrWeekday > 0 ? `個人 ${ovrWeekday.toLocaleString()}円` : `会社共通 ${wageWeekday.toLocaleString()}円`}
                    </p>
                    <FormMessage /></FormItem>
                )} />
                <FormField control={f.control} name="dailyRateSaturday" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs font-medium">土曜・休日 日当（円/日）</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-1">
                        <TipInput type="number" min={0} step={1} placeholder={wageSaturday.toLocaleString()}
                          tip={`土曜・休日1日あたりの個人日当。空欄なら会社共通単価（${wageSaturday.toLocaleString()}円）を使用`}
                          {...field} value={field.value ? field.value : ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                          className="text-right bg-white dark:bg-slate-900/40" />
                        <span className="text-xs text-muted-foreground shrink-0">円/日</span>
                      </div>
                    </FormControl>
                    <p className={`text-[11px] mt-1 ${ovrSaturday > 0 ? "text-amber-800 dark:text-amber-300 font-semibold" : "text-muted-foreground"}`}>
                      → 適用: {ovrSaturday > 0 ? `個人 ${ovrSaturday.toLocaleString()}円` : `会社共通 ${wageSaturday.toLocaleString()}円`}
                    </p>
                    <FormMessage /></FormItem>
                )} />
                {overtimeRateField}
                {lateNightRateField}
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">残業を「分単位」で計算する（任意・上級者向け）</summary>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  残業時間を指定の分数で切り上げ、1単位あたりの加算額で計算します（例：10分単位 × 2,031円）。両方入力したときだけ有効です。
                </p>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <FormField control={f.control} name="overtimeUnitMinutes" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs">切り上げ単位（分）</FormLabel>
                      <FormControl>
                        <TipInput type="number" min={0} step={1} placeholder="例: 10"
                          tip={"残業時間をこの分数単位で切り上げ。\n例：10分設定→残業13分は20分に切り上げ。\n空欄なら標準計算（分単位）"}
                          {...field} value={field.value ? field.value : ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                          className="text-right bg-white dark:bg-slate-900/40" />
                      </FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={f.control} name="overtimeUnitRate" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs">1単位あたり加算額（円）</FormLabel>
                      <FormControl>
                        <TipInput type="number" min={0} step={1} placeholder="例: 2,031"
                          tip={"切り上げ1単位あたりの加算額。\n例：10分単位で2,031円→残業20分＝4,062円"}
                          {...field} value={field.value ? field.value : ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                          className="text-right bg-white dark:bg-slate-900/40" />
                      </FormControl>
                      <FormMessage /></FormItem>
                  )} />
                </div>
              </details>
            </div>
            )}
            {salaryType !== "daily" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/25 p-3.5 space-y-3">
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">残業の単価</p>
                <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-0.5">
                  残業したときに手当を付ける社員は入力してください。月次実績入力の残業・深夜の時間から自動で計算されます。
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {overtimeRateField}
                {lateNightRateField}
              </div>
            </div>
            )}
            <FormField control={f.control} name="residentTax" render={({ field }) => (
              <FormItem><FormLabel>市町村民税（月額・円）</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <TipInput type="number" min={0} step={100} placeholder="0" tip={"毎月差し引く住民税（特別徴収）の月額。\n市区町村から届く「税額決定通知書」に記載の金額を入力。\n6月改定が多いため毎年確認してください"} {...field} className="text-right" />
                    <span className="text-sm text-muted-foreground shrink-0">円</span>
                  </div>
                </FormControl>
                <p className="text-xs text-muted-foreground">毎月差し引く住民税（特別徴収）の月額</p>
                <FormMessage /></FormItem>
            )} />
            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">
                健康保険料・厚生年金・源泉所得税は、標準報酬月額と令和8年公式テーブルから
                <span className="font-medium text-foreground">自動計算</span>されます（個別の月額手動設定は廃止）。
              </p>
            </div>
            <FormField control={f.control} name="otherDeductionMonthly" render={({ field }) => (
              <FormItem><FormLabel>その他控除（月額・円）</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-1 max-w-[240px]">
                    <TipInput type="number" min={0} step={100} placeholder="0" tip={"積立金・組合費など毎月定額で差し引くその他の控除額。\n複数ある場合は合計額を入力"} {...field} className="text-right" />
                    <span className="text-sm text-muted-foreground shrink-0">円</span>
                  </div>
                </FormControl>
                <p className="text-xs text-muted-foreground">積立金・組合費等</p>
                <FormMessage /></FormItem>
            )} />
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">ブルーウィング設定</h4>
          <div className="space-y-3">
            <FormField control={f.control} name="useBluewingLogic" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <FormLabel>ブルーウィングロジック使用</FormLabel>
                  <p className="text-xs text-muted-foreground">ONにすると月次でブルーウィング売上を入力すると自動計算</p>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            {watchUseBluewing && (
            <>
            <FormField control={f.control} name="bluewingCommissionRate" render={({ field }) => (
              <FormItem>
                <FormLabel>ブルーウィング歩合率（%）</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <TipInput type="number" min={0} max={100} step={0.1} placeholder="例: 37.5" tip={"ブルーウィングロジック計算時の個人歩合率（%）。\n岡田: 37.5 / 古田・平澤・横井・中村: 37\n玉川・土田・鴨志田: 36.8"} {...field}
                      className="text-right max-w-[160px]" />
                    <span className="text-sm text-muted-foreground shrink-0">%</span>
                  </div>
                </FormControl>
                <p className="text-xs text-muted-foreground">岡田: 37.5 / 古田・平澤・横井・中村: 37 / 玉川・土田・鴨志田: 36.8</p>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={f.control} name="bluewingFixedOvertimeHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>固定残業みなし時間（h）</FormLabel>
                  <FormControl>
                    <TipInput type="number" min={0} step={0.5} placeholder="例: 25" tip={"固定残業代に含まれるみなし残業時間数。\n実際の残業がこの時間を超えた分だけ追加支払い。\n岡田・横井他: 25h / 平澤・玉川: 40h"} {...field} className="text-right" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">岡田・横井他: 25 / 平澤・玉川: 40</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={f.control} name="bluewingFixedOvertimeAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>固定残業代（職務手当）（円）</FormLabel>
                  <FormControl>
                    <TipInput type="number" min={0} step={1000} placeholder="例: 50000" tip={"毎月支払う固定残業代（職務手当）の金額。\nみなし残業時間分が含まれています。\n岡田・横井他: 50,000 / 古田: 40,000 / 平澤・玉川: 120,000"} {...field} className="text-right" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">岡田・横井他: 50,000 / 古田: 40,000 / 平澤・玉川: 120,000</p>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            </>
            )}
          </div>
        </div>
      </TabsContent>

      {/* ── 保険・扶養タブ ── */}
      <TabsContent value="insurance" className="space-y-4 pt-4">
        <details className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
          <summary className="cursor-pointer font-medium">用語のかんたん解説（クリックで開く）</summary>
          <ul className="mt-2 space-y-1 list-disc list-inside text-sky-800">
            <li><strong>標準報酬月額</strong>：健康保険・厚生年金の計算のもとになる金額。4〜6月の給与の平均で決まり、9月から翌年8月まで固定です。</li>
            <li><strong>折半（せっぱん）</strong>：保険料を会社と本人で半分ずつ負担すること。ここに入るのは本人負担分です。</li>
            <li><strong>扶養親族</strong>：生活を支えている家族（子など）。人数が多いほど源泉所得税が安くなります（配偶者は別スイッチ）。</li>
            <li><strong>甲欄（こうらん）</strong>：源泉所得税の表の種類。「扶養控除等申告書」を出した人に使う欄で、本システムは甲欄で計算します。</li>
            <li><strong>全額非課税</strong>：社会保険・所得税・住民税をすべて引かない設定（手取り＝総支給）。特別な場合のみ。</li>
          </ul>
        </details>
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">扶養・家族設定</h4>
          <div className="space-y-3">
            <FormField control={f.control} name="dependentCount" render={({ field }) => (
              <FormItem><FormLabel>扶養親族数（人）</FormLabel>
                <FormControl><TipInput type="number" min={0} placeholder="0" tip={"配偶者以外の扶養親族の人数。\n源泉所得税の計算（甲欄の扶養人数）に影響。\n配偶者は下の「配偶者の有無」スイッチで設定"} {...field} /></FormControl>
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
          <p className="text-xs text-muted-foreground mb-3">保険料は「標準報酬月額 × 計算テーブルマスターの料率（その明細の年月の行）」で計算されます。</p>
          <div className="space-y-3">
            <FormField control={f.control} name="standardRemuneration" render={({ field }) => (
              <FormItem><FormLabel>{employeeId ? "標準報酬月額（初期値）（円）" : "標準報酬月額（円）"}</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <TipInput type="number" min={0} step={1000} placeholder="470000" tip={"健保・厚年の計算基礎となる標準報酬月額。\n4〜6月の平均給与を基に決定し、原則9月分から翌8月分まで固定。\n健康保険料 = この額 × 健康保険料率 の折半\n厚生年金 = この額 × 厚生年金保険料率 の折半\n定時決定などで変わったときは、この欄を書き換えずに下の履歴へ「適用開始」付きで追加してください（過去の月の計算が変わらないように）。"} {...field} className="text-right" />
                    <span className="text-sm text-muted-foreground shrink-0">円</span>
                  </div>
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  {employeeId
                    ? "履歴が無い月に使う値です。変わったときは下の履歴に追加してください（まとめて入れるときは「標準報酬」タブ）。"
                    : "入社時の標準報酬月額。以後の変更は、登録後に編集画面の履歴か「標準報酬」タブで入力します。"}
                </p>
                <FormMessage /></FormItem>
            )} />
            {employeeId ? (
              <StandardRemunerationHistorySection employeeId={employeeId} initialAmount={Number(f.watch("standardRemuneration")) || 0} />
            ) : null}
            <FormField control={f.control} name="employmentInsuranceApplied" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div><FormLabel>雇用保険適用</FormLabel>
                  <p className="text-xs text-muted-foreground">適用外の場合はオフ（役員等）</p></div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            <FormField control={f.control} name="pensionAppliedMode" render={({ field }) => (
              <FormItem className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <FormLabel>厚生年金</FormLabel>
                    <p className="text-xs text-muted-foreground">70歳以上は自動的に不適用。手動で上書き可。</p>
                  </div>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">🔄 自動（生年月日から判定）</SelectItem>
                        <SelectItem value="on">✅ 強制 適用</SelectItem>
                        <SelectItem value="off">❌ 強制 不適用（70歳以上等）</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </div>
              </FormItem>
            )} />
            <FormField control={f.control} name="taxExempt" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div><FormLabel className="text-amber-800">全額非課税</FormLabel>
                  <p className="text-xs text-muted-foreground">ONにすると社会保険・所得税・住民税すべて控除なし（手取り＝総支給）</p></div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </div>
        </div>
      </TabsContent>

      {/* ── 追加タブ ── */}
      {additionalTabs?.map((t) => (
        // 追加のタブ（振込口座など）は、ほかのタブへ移っても入力が消えないよう、隠すだけにする
        <TabsContent key={t.value} value={t.value} forceMount className="pt-4 data-[state=inactive]:hidden">
          {t.content}
        </TabsContent>
      ))}
      </div>
    </Tabs>
  );
}

function EmployeeMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [editTab, setEditTab] = useState("basic");
  const [createTab, setCreateTab] = useState("basic");
  const bankRef = useRef<BankAccountTabHandle>(null);
  const [bankDirty, setBankDirty] = useState(false);
  /** 単価・扶養などを変えたあと「未確定の明細に反映するには再計算が必要」と知らせる */
  const [showRecalc, setShowRecalc] = useState(false);
  // 更新後は invalidateQueries で明示再取得するため、毎マウントの強制リフェッチは不要。
  const { data: employees, isLoading } = useListEmployees({});
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
    // サーバーと同じ決まり（同じ数字の繰り返し・並びは使えない）。送る前に知らせる
    if (weakPinInput(pinInput)) {
      toast({ title: "この番号は使えません", description: "「1111」のような同じ数字の繰り返しや、「1234」「4321」のような並びは使えません。別の番号にしてください。", variant: "destructive" });
      return;
    }
    setPinSaving(true);
    try {
      const res = await fetch(`${BASE}/api/employees/${editingEmployee.id}/pin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (!res.ok) {
        // 断られた理由をそのまま出す（以前は「失敗しました」だけで理由が分からなかった）
        const err = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(err?.error || `PINを設定できませんでした（${res.status}）`);
      }
      setPinSet(true); setPinInput("");
      toast({ title: "PIN設定完了", description: "PINコードを設定しました" });
    } catch (e) {
      toast({ title: "PINを設定できませんでした", description: e instanceof Error && e.message ? e.message : "PIN設定に失敗しました", variant: "destructive" });
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
      employeeCode: "", name: "", nameKana: "", department: "", position: "", phone: "",
      dateOfBirth: "", hireDate: "", isActive: true, isOfficeStaff: false, salaryType: "daily", baseSalary: 0,
      residentTax: 0, otherDeductionMonthly: 0,
      useBluewingLogic: false, bluewingCommissionRate: 0,
      bluewingFixedOvertimeHours: 0, bluewingFixedOvertimeAmount: 0,
      dependentCount: 0, hasSpouse: false, standardRemuneration: 0,
      careInsuranceApplied: false, employmentInsuranceApplied: true, pensionAppliedMode: "auto", taxExempt: false,
      scheduledWorkStart: "", scheduledWorkEnd: "",
      dailyRateWeekday: 0, dailyRateSaturday: 0, overtimeHourlyRate: 0, lateNightHourlyRate: 0,
      overtimeUnitMinutes: 0, overtimeUnitRate: 0,
    },
  });
  const createForm = useForm<EmpFullValues>({
    resolver: zodResolver(empFullSchema),
    defaultValues: {
      employeeCode: "", name: "", nameKana: "", department: "配送部", position: "", phone: "",
      dateOfBirth: "", hireDate: new Date().toISOString().split("T")[0], isActive: true, isOfficeStaff: false,
      salaryType: "daily", baseSalary: 0, residentTax: 0,
      otherDeductionMonthly: 0,
      useBluewingLogic: false, bluewingCommissionRate: 0,
      bluewingFixedOvertimeHours: 0, bluewingFixedOvertimeAmount: 0,
      dependentCount: 0, hasSpouse: false, standardRemuneration: 0,
      careInsuranceApplied: false, employmentInsuranceApplied: true, pensionAppliedMode: "auto", taxExempt: false,
      scheduledWorkStart: "", scheduledWorkEnd: "",
      dailyRateWeekday: 0, dailyRateSaturday: 0, overtimeHourlyRate: 0, lateNightHourlyRate: 0,
      overtimeUnitMinutes: 0, overtimeUnitRate: 0,
    },
  });

  const editSalaryType = editForm.watch("salaryType");
  const createSalaryType = createForm.watch("salaryType");

  const handleOpenEdit = (emp: Employee) => {
    setEditTab("basic");
    setBankDirty(false);
    setEditingEmployee(emp);
    editForm.reset({
      employeeCode: emp.employeeCode,
      name: emp.name,
      nameKana: emp.nameKana,
      department: emp.department,
      position: emp.position || "",
      phone: (emp as unknown as { phone?: string | null }).phone ?? "",
      dateOfBirth: (emp as unknown as { dateOfBirth?: string | null }).dateOfBirth?.split("T")[0] || "",
      hireDate: emp.hireDate.split("T")[0],
      isActive: emp.isActive,
      isOfficeStaff: (emp as unknown as { isOfficeStaff?: boolean }).isOfficeStaff ?? false,
      salaryType: (emp.salaryType as "fixed" | "daily" | "hourly") ?? "daily",
      baseSalary: emp.baseSalary ?? 0,
      residentTax: emp.residentTax ?? 0,
      otherDeductionMonthly: (emp as unknown as { otherDeductionMonthly?: number }).otherDeductionMonthly ?? 0,
      useBluewingLogic: (emp as unknown as { useBluewingLogic?: boolean }).useBluewingLogic ?? false,
      bluewingCommissionRate: ((emp as unknown as { bluewingCommissionRate?: number }).bluewingCommissionRate ?? 0) * 100,
      bluewingFixedOvertimeHours: (emp as unknown as { bluewingFixedOvertimeHours?: number }).bluewingFixedOvertimeHours ?? 0,
      bluewingFixedOvertimeAmount: (emp as unknown as { bluewingFixedOvertimeAmount?: number }).bluewingFixedOvertimeAmount ?? 0,
      dependentCount: emp.dependentCount,
      hasSpouse: emp.hasSpouse ?? false,
      standardRemuneration: emp.standardRemuneration ?? 0,
      careInsuranceApplied: emp.careInsuranceApplied ?? false,
      employmentInsuranceApplied: emp.employmentInsuranceApplied ?? true,
      pensionAppliedMode: (() => {
        const v = (emp as unknown as { pensionApplied?: boolean | null }).pensionApplied;
        if (v === null || v === undefined) return "auto";
        return v ? "on" : "off";
      })() as "auto" | "on" | "off",
      taxExempt: (emp as unknown as { taxExempt?: boolean }).taxExempt ?? false,
      scheduledWorkStart: (emp as unknown as { scheduledWorkStart?: string | null }).scheduledWorkStart ?? "",
      scheduledWorkEnd: (emp as unknown as { scheduledWorkEnd?: string | null }).scheduledWorkEnd ?? "",
      dailyRateWeekday: (emp as unknown as { dailyRateWeekday?: number }).dailyRateWeekday ?? 0,
      dailyRateSaturday: (emp as unknown as { dailyRateSaturday?: number }).dailyRateSaturday ?? 0,
      overtimeHourlyRate: (emp as unknown as { overtimeHourlyRate?: number }).overtimeHourlyRate ?? 0,
      lateNightHourlyRate: (emp as unknown as { lateNightHourlyRate?: number }).lateNightHourlyRate ?? 0,
      overtimeUnitMinutes: (emp as unknown as { overtimeUnitMinutes?: number | null }).overtimeUnitMinutes ?? 0,
      overtimeUnitRate: (emp as unknown as { overtimeUnitRate?: number }).overtimeUnitRate ?? 0,
    });
  };

  const onEditSubmit = async (data: EmpFullValues) => {
    if (!editingEmployee) return;
    try {
      const { pensionAppliedMode, ...rest } = data;
      const saveData = {
        ...rest,
        bluewingCommissionRate: (data.bluewingCommissionRate ?? 0) / 100,
        overtimeUnitMinutes: (data.overtimeUnitMinutes ?? 0) > 0 ? data.overtimeUnitMinutes : null,
        pensionApplied: pensionAppliedMode === "auto" ? null : pensionAppliedMode === "on",
      };
      // 口座（振込口座タブ）も一緒に保存する。誤りがあれば社員情報も保存せず、そのタブを開く
      const bank = await bankRef.current?.save();
      if (bank && !bank.ok) {
        setEditTab("bank");
        toast({ title: "振込口座の入力を直してください", description: bank.error, variant: "destructive" });
        return;
      }
      await updateEmployee.mutateAsync({ id: editingEmployee.id, data: saveData });
      toast({ title: "保存しました", description: `${editingEmployee.name}の情報を更新しました。` });
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setEditingEmployee(null);
      setShowRecalc(true);
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  const onCreateSubmit = async (data: EmpFullValues) => {
    try {
      const { pensionAppliedMode, ...rest } = data;
      const saveData = {
        ...rest,
        bluewingCommissionRate: (data.bluewingCommissionRate ?? 0) / 100,
        pensionApplied: pensionAppliedMode === "auto" ? null : pensionAppliedMode === "on",
      };
      const res = await createEmployee.mutateAsync({ data: saveData });
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
    } catch (err: unknown) {
      // バックエンドが給与明細/月次実績ありで 409 を返した場合はその理由を表示
      let msg = "社員の削除に失敗しました。";
      if (err && typeof err === "object") {
        const e = err as { data?: { error?: string }; message?: string };
        msg = e.data?.error ?? e.message ?? msg;
      }
      toast({ title: "削除できません", description: msg, variant: "destructive" });
    }
  };

  // 保存を押したのに入力の誤りで止まったとき、誤りのある欄のタブへ移って知らせる
  // （以前は別のタブに誤りがあると、押しても何も起きないように見えた）
  const onInvalid = (setTab: (t: string) => void) => (errors: FieldErrors<EmpFullValues>) => {
    const keys = Object.keys(errors);
    if (keys.length === 0) return;
    const tab = EMP_FIELD_TAB[keys[0]!] ?? "salary";
    setTab(tab);
    const names = keys.map((k) => EMP_FIELD_LABEL[k] ?? k).slice(0, 4).join("・");
    toast({ title: "入力を直してください", description: `「${EMP_TAB_LABEL[tab] ?? tab}」タブの ${names} に足りないところ・誤りがあります。`, variant: "destructive" });
  };

  // 閉じる前に確かめる（Esc・外側のクリック・キャンセルで、変更ごと消えていた）
  // ※ react-hook-form の formState は描画のときに読んでおかないと更新されない（あとで読むと常に false）
  const editDirty = editForm.formState.isDirty;
  const createDirty = createForm.formState.isDirty;
  const tryCloseEdit = async () => {
    if (editDirty || bankDirty) {
      const ok = await confirm({
        title: "保存していない変更があります",
        description: "閉じると、この画面で変えた内容は消えます。",
        okLabel: "保存せずに閉じる",
        cancelLabel: "やめる（編集を続ける）",
        danger: true,
      });
      if (!ok) return;
    }
    setEditingEmployee(null);
    setBankDirty(false);
  };
  const tryCloseCreate = async () => {
    if (createDirty) {
      const ok = await confirm({
        title: "入力した内容は保存されていません",
        description: "閉じると、入力した内容は消えます。",
        okLabel: "保存せずに閉じる",
        cancelLabel: "やめる（入力を続ける）",
        danger: true,
      });
      if (!ok) return;
    }
    setIsCreateOpen(false);
    createForm.reset();
  };

  // ?emp=社員ID で開いたとき（お知らせ・確定前チェックから）、その社員の編集を開く
  const openedFromUrlRef = useRef(false);
  useEffect(() => {
    if (openedFromUrlRef.current || !employees) return;
    const id = Number(new URLSearchParams(window.location.search).get("emp"));
    openedFromUrlRef.current = true;
    if (!id) return;
    const emp = employees.find((e) => e.id === id);
    if (emp) handleOpenEdit(emp);
    // 一度だけ開く
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

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
        <Button size="sm" onClick={() => { setCreateTab("basic"); setIsCreateOpen(true); }}>
          <UserPlus className="mr-2 h-4 w-4" />新規登録
        </Button>
      </div>

      <RecalcNotice show={showRecalc} onClose={() => setShowRecalc(false)} what="社員の設定（単価・扶養など）" />

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
            <>
            {/* モバイル：カードリスト */}
            <div className="sm:hidden divide-y">
              {filtered.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => handleOpenEdit(emp)}
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {emp.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{emp.name}</span>
                      {emp.isActive ? (
                        <Badge className="bg-emerald-600 text-xs shrink-0">在籍</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs shrink-0">退職</Badge>
                      )}
                      {emp.isActive && !emp.isOfficeStaff && !emp.hasPin && (
                        <Badge variant="outline" className="text-xs shrink-0 bg-amber-50 text-amber-700 border-amber-300">PIN未設定</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{emp.employeeCode}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground truncate">{emp.department}</span>
                    </div>
                  </div>
                  <Edit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
            {/* デスクトップ：テーブル */}
            <div className="hidden sm:block overflow-x-auto rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>社員番号</TableHead>
                    <TableHead>氏名</TableHead>
                    <TableHead>部署</TableHead>
                    <TableHead>役職</TableHead>
                    <TableHead>給与形態</TableHead>
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
                        ) : (emp.salaryType === "hourly") ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">時給制</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">固定給</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {emp.isActive ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-xs">在籍</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">退職</Badge>
                          )}
                          {emp.isActive && !emp.isOfficeStaff && !emp.hasPin && (
                            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">PIN未設定</Badge>
                          )}
                        </div>
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
            </>
          )}
        </CardContent>
      </Card>

      {/* 新規登録ダイアログ */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (open) setIsCreateOpen(true); else void tryCloseCreate(); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新規社員登録</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit, onInvalid(setCreateTab))} className="space-y-6">
              <EmpFormFields form={createForm} salaryType={createSalaryType} tab={createTab} onTabChange={setCreateTab} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { void tryCloseCreate(); }}>キャンセル</Button>
                <Button type="submit" disabled={createForm.formState.isSubmitting}>
                  <UserPlus className="mr-2 h-4 w-4" />登録する
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 編集ダイアログ */}
      <Dialog open={!!editingEmployee} onOpenChange={(open) => { if (!open) void tryCloseEdit(); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee?.name}　社員情報編集</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{editingEmployee?.employeeCode}　{editingEmployee?.department}</p>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit, onInvalid(setEditTab))} className="space-y-4">
              <EmpFormFields
                form={editForm}
                salaryType={editSalaryType}
                employeeId={editingEmployee?.id}
                tab={editTab}
                onTabChange={setEditTab}
                additionalTabs={[{
                  value: "bank",
                  label: "振込口座",
                  content: editingEmployee ? (
                    <BankAccountTab ref={bankRef} employeeId={editingEmployee.id} onDirtyChange={setBankDirty} />
                  ) : null,
                }, {
                  value: "management",
                  label: "管理",
                  content: (
                    <div className="space-y-4">
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
                          <p className="text-xs text-muted-foreground">PINを設定すると、QRコード読み取り後に4桁の入力が必要になります。「1111」のような同じ数字の繰り返しや「1234」「4321」のような並びは使えません。</p>
                        </div>
                      </div>
                    </div>
                  ),
                }]}
              />

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button type="button" variant="destructive" size="sm" className="mr-auto"
                  onClick={() => setDeleteTarget(editingEmployee)}>
                  <Trash2 className="mr-1 h-4 w-4" />削除
                </Button>
                <Button type="button" variant="outline" onClick={() => { void tryCloseEdit(); }}>キャンセル</Button>
                <Button type="submit" disabled={editForm.formState.isSubmitting}>保存する</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {confirmDialog}

      {/* 削除確認ダイアログ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>社員を完全に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  <strong>退職の場合は削除しないでください。</strong> 編集画面の「在籍」をOFFにすると、
                  給与明細などの記録を残したまま一覧から外せます（賃金台帳は法定保存が必要です）。
                </p>
                <p>「{deleteTarget?.name}」を完全削除します。誤って登録した社員の抹消のみに使用してください。</p>
                <p className="font-semibold text-destructive">⚠️ この操作は元に戻せません。</p>
                <p>以下のデータがすべて完全に削除されます：</p>
                <ul className="list-disc list-inside text-sm space-y-0.5 pl-1">
                  <li>勤怠打刻記録 / 給与明細 / 月次記録</li>
                  <li>メッセージ履歴 / 欠勤・休暇記録</li>
                  <li>その他すべての関連データ</li>
                </ul>
                <p className="text-xs text-muted-foreground">※ 給与明細または月次実績がある社員は削除できません（在籍OFFをご利用ください）。</p>
              </div>
            </AlertDialogDescription>
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

// ① 令和8年度 基準の参照行（読み取り専用）
function RefRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-dotted border-border/60 last:border-0">
      <div className="min-w-0">
        <span className="text-sm">{label}</span>
        {note && <span className="ml-2 text-xs text-muted-foreground">{note}</span>}
      </div>
      <span className="text-sm font-mono font-medium shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

// ② 会社ごとに編集する運用パラメータのみ（日給単価は会社設定に集約）
// 雇用保険料率は年度で変わるため、会社設定ではなく ① の料率の履歴で管理する（2026-09-14〜）
const companyParamsSchema = z.object({
  monthlyAverageWorkHours: z.coerce.number().min(1),
});
type CompanyParamsValues = z.infer<typeof companyParamsSchema>;

function CalcTableMasterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showRecalc, setShowRecalc] = useState(false);
  const { data: company, isLoading } = useGetCompany();
  const updateCompany = useUpdateCompany();

  const form = useForm<CompanyParamsValues>({
    resolver: zodResolver(companyParamsSchema),
    defaultValues: {
      monthlyAverageWorkHours: 160,
    },
    values: company ? {
      monthlyAverageWorkHours: company.monthlyAverageWorkHours,
    } : undefined,
  });

  const onSubmit = async (data: CompanyParamsValues) => {
    try {
      await updateCompany.mutateAsync({ data });
      toast({ title: "保存しました", description: "運用パラメータを更新しました。" });
      queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
      setShowRecalc(true);
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">読み込み中...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">計算テーブルマスター</h3>
        <p className="text-sm text-muted-foreground">
          年度ごとに変わる保険料率の履歴と、割増率などの計算基準・会社ごとの運用パラメータを管理します。
        </p>
      </div>

      <RecalcNotice show={showRecalc} onClose={() => setShowRecalc(false)} what="運用パラメータ" />

      {/* ── ① 保険料率（年度ごとの履歴）── 編集可 */}
      <InsuranceRatePeriodsCard />

      {/* ── 割増率・源泉所得税 ── 読み取り専用 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            割増率・源泉所得税（令和8年分）
            <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-300 text-[10px] font-normal">参照専用・編集不可</Badge>
          </CardTitle>
          <CardDescription>
            国税庁の公式値をシステムに内蔵しています（1円単位一致のため編集不可）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <div>
              <RefRow label="時間外（残業）割増" value="×1.25" note="60h超は×1.50" />
              <RefRow label="深夜追加割増" value="+0.25" />
            </div>
            <div>
              <RefRow label="休日出勤割増（土曜・祝日）" value="×1.25" />
              <RefRow label="休日出勤割増（日曜）" value="×1.35" />
              <RefRow label="源泉所得税" value="月額表・甲欄" note="社保控除後×扶養人数で自動" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── ② 運用パラメータ ── 編集可 */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">② 運用パラメータ（会社ごとに設定）</CardTitle>
              <CardDescription>実際に給与計算へ反映される、会社固有の設定です。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="monthlyAverageWorkHours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>月平均労働時間（時間）</FormLabel>
                    <FormControl><Input type="number" step="1" placeholder="160" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">固定給の時給換算：基本給 ÷ この時間数</p>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <p className="text-xs text-muted-foreground mt-4 pt-3 border-t">
                日給制の単価（平日・土曜・日曜/祝日）は <span className="font-medium">会社設定 → 日給レート設定</span> で管理します。
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              保存する
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

/** 暗証番号として弱すぎるもの（サーバーの weakPin と同じ決まり：同じ数字の繰り返し・並び） */
function weakPinInput(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  return "0123456789012".includes(pin) || "9876543210987".includes(pin);
}

/** 社員編集のタブ：スマホでは文字を小さく・余白を詰めて5つが1行に収まるようにする */
const TAB_CLS = "min-w-0 px-1 sm:px-3 text-[11px] sm:text-sm";

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
          <TabsList className="grid w-full grid-cols-5 mb-6">
            <TabsTrigger value="employees" className="flex items-center gap-1.5">
              <Users className="h-4 w-4" /><span className="hidden sm:inline">社員マスター</span><span className="sm:hidden">社員</span>
            </TabsTrigger>
            <TabsTrigger value="allowances" className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4" /><span className="hidden sm:inline">手当マスター</span><span className="sm:hidden">手当</span>
            </TabsTrigger>
            <TabsTrigger value="deductions" className="flex items-center gap-1.5">
              <Minus className="h-4 w-4" /><span className="hidden sm:inline">差引マスター</span><span className="sm:hidden">差引</span>
            </TabsTrigger>
            <TabsTrigger value="standard-remuneration" className="flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4" /><span className="hidden sm:inline">標準報酬</span><span className="sm:hidden">標報</span>
            </TabsTrigger>
            <TabsTrigger value="calc-tables" className="flex items-center gap-1.5">
              <Calculator className="h-4 w-4" /><span className="hidden sm:inline">計算テーブルマスター</span><span className="sm:hidden">計算</span>
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

          <TabsContent value="standard-remuneration">
            <StandardRemunerationBulkTab />
          </TabsContent>

          <TabsContent value="calc-tables">
            <CalcTableMasterTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
