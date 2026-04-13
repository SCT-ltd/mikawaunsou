import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useListEmployees, 
  useListMonthlyRecords, 
  useCreateMonthlyRecord, 
  useUpdateMonthlyRecord,
  getListMonthlyRecordsQueryKey,
  useGetEmployeeAllowances,
  getGetEmployeeAllowancesQueryKey,
  useUpdateEmployeeAllowances,
  useListAllowanceDefinitions,
  Employee
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Save, ChevronRight } from "lucide-react";

function AllowanceSidebar({
  employee,
  open,
  onClose,
}: {
  employee: Employee | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const employeeId = employee?.id ?? 0;

  const { data: allowanceDefinitions } = useListAllowanceDefinitions({ activeOnly: true });
  const { data: employeeAllowances } = useGetEmployeeAllowances(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeAllowancesQueryKey(employeeId) }
  });
  const updateAllowances = useUpdateEmployeeAllowances();

  const [amounts, setAmounts] = useState<Record<number, number>>({});

  useEffect(() => {
    if (employeeAllowances) {
      const init: Record<number, number> = {};
      employeeAllowances.forEach(a => {
        init[a.allowanceDefinitionId] = a.amount;
      });
      setAmounts(init);
    } else {
      setAmounts({});
    }
  }, [employeeAllowances, employeeId]);

  const handleSave = async () => {
    try {
      const payload = Object.entries(amounts)
        .map(([id, amount]) => ({ allowanceDefinitionId: parseInt(id, 10), amount }))
        .filter(a => a.amount > 0);
      await updateAllowances.mutateAsync({ id: employeeId, data: { allowances: payload } });
      queryClient.invalidateQueries({ queryKey: getGetEmployeeAllowancesQueryKey(employeeId) });
      toast({ title: "保存しました", description: `${employee?.name}の手当を更新しました。` });
    } catch {
      toast({ title: "エラー", description: "手当の保存に失敗しました。", variant: "destructive" });
    }
  };

  const total = Object.values(amounts).reduce((s, v) => s + (v || 0), 0);

  if (!employee) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col gap-0 p-0 overflow-hidden">
        <SheetHeader className="px-5 py-3 border-b shrink-0">
          <SheetTitle className="text-sm font-semibold">手当入力</SheetTitle>
          <SheetDescription className="text-xs">{employee.name}　{employee.department}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {!allowanceDefinitions || allowanceDefinitions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 px-6">
              手当マスタが登録されていません。
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60">
                  <th className="border border-border px-3 py-2 text-left font-medium text-xs text-muted-foreground w-8"></th>
                  <th className="border border-border px-3 py-2 text-left font-medium text-xs text-muted-foreground">手当名称</th>
                  <th className="border border-border px-3 py-2 text-center font-medium text-xs text-muted-foreground w-16">課税</th>
                  <th className="border border-border px-3 py-2 text-right font-medium text-xs text-muted-foreground w-32">金額（円）</th>
                </tr>
              </thead>
              <tbody>
                {allowanceDefinitions.map((def, idx) => (
                  <tr key={def.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    {idx === 0 && (
                      <td
                        rowSpan={allowanceDefinitions.length}
                        className="border border-border text-center align-middle font-medium text-xs"
                        style={{ writingMode: "vertical-rl", letterSpacing: "0.15em", padding: "8px 4px" }}
                      >
                        支　給
                      </td>
                    )}
                    <td className="border border-border px-3 py-1.5 text-sm">{def.name}</td>
                    <td className="border border-border px-2 py-1.5 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${def.isTaxable ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                        {def.isTaxable ? "課税" : "非課税"}
                      </span>
                    </td>
                    <td className="border border-border px-2 py-1">
                      <Input
                        type="number"
                        min="0"
                        className="h-7 w-full text-right text-sm border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1"
                        value={amounts[def.id] || ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                          setAmounts(prev => ({ ...prev, [def.id]: isNaN(v) ? 0 : v }));
                        }}
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/50 font-semibold">
                  <td className="border border-border px-3 py-2 text-xs text-muted-foreground text-center" colSpan={2}>合　計</td>
                  <td className="border border-border" />
                  <td className="border border-border px-3 py-2 text-right text-sm tabular-nums">
                    {total > 0 ? `¥${total.toLocaleString()}` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t px-5 py-3 shrink-0">
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={updateAllowances.isPending || !allowanceDefinitions?.length}
          >
            <Save className="mr-2 h-4 w-4" />
            手当を保存
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function MonthlyInput() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees, isLoading: employeesLoading } = useListEmployees({ active: true });
  const { data: monthlyRecords, isLoading: recordsLoading } = useListMonthlyRecords({ year, month });
  
  const createRecord = useCreateMonthlyRecord();
  const updateRecord = useUpdateMonthlyRecord();

  const [edits, setEdits] = useState<Record<number, any>>({});
  const [saving, setSaving] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (employees && monthlyRecords) {
      const initialEdits: Record<number, any> = {};
      employees.forEach(emp => {
        const record = monthlyRecords.find(r => r.employeeId === emp.id);
        if (record) {
          initialEdits[emp.id] = { ...record };
        } else {
          initialEdits[emp.id] = {
            workDays: 0, overtimeHours: 0, lateNightHours: 0,
            holidayWorkDays: 0, drivingDistanceKm: 0, deliveryCases: 0,
            absenceDays: 0, notes: ""
          };
        }
      });
      setEdits(initialEdits);
    }
  }, [employees, monthlyRecords, year, month]);

  const handleEditChange = (employeeId: number, field: string, value: string) => {
    setEdits(prev => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [field]: field === 'notes' ? value : Number(value) || 0
      }
    }));
  };

  const handleSaveAll = async () => {
    if (!employees) return;
    setSaving(true);
    try {
      for (const emp of employees) {
        const editData = edits[emp.id];
        const existingRecord = monthlyRecords?.find(r => r.employeeId === emp.id);
        if (existingRecord) {
          await updateRecord.mutateAsync({ 
            id: existingRecord.id, 
            data: {
              workDays: editData.workDays,
              overtimeHours: editData.overtimeHours,
              lateNightHours: editData.lateNightHours,
              holidayWorkDays: editData.holidayWorkDays,
              drivingDistanceKm: editData.drivingDistanceKm,
              deliveryCases: editData.deliveryCases,
              absenceDays: editData.absenceDays,
              notes: editData.notes
            }
          });
        } else {
          const hasData = editData.workDays > 0 || editData.drivingDistanceKm > 0 || editData.deliveryCases > 0;
          if (hasData) {
            await createRecord.mutateAsync({
              data: { employeeId: emp.id, year, month, ...editData }
            });
          }
        }
      }
      toast({ title: "保存完了", description: `${month}月分の実績を保存しました。` });
      queryClient.invalidateQueries({ queryKey: getListMonthlyRecordsQueryKey({ year, month }) });
    } catch {
      toast({ title: "エラー", description: "一部のデータの保存に失敗しました。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const years = Array.from({ length: 3 }, (_, i) => currentDate.getFullYear() - 1 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const isLoading = employeesLoading || recordsLoading;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">月次実績入力</h2>
          <div className="flex gap-4">
            <div className="flex gap-2">
              <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                <SelectTrigger className="w-[120px] bg-card">
                  <SelectValue placeholder="年" />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                <SelectTrigger className="w-[100px] bg-card">
                  <SelectValue placeholder="月" />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => (
                    <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSaveAll} disabled={isLoading || saving || !employees?.length}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "保存中..." : "一括保存"}
            </Button>
          </div>
        </div>

        <div className="rounded-md border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="min-w-[160px] sticky left-0 bg-muted/50 z-10">社員名</TableHead>
                  <TableHead className="w-[100px]">出勤日数</TableHead>
                  <TableHead className="w-[100px]">欠勤日数</TableHead>
                  <TableHead className="w-[100px]">残業(h)</TableHead>
                  <TableHead className="w-[100px]">深夜(h)</TableHead>
                  <TableHead className="w-[100px]">休日出勤</TableHead>
                  <TableHead className="w-[120px]">走行距離(km)</TableHead>
                  <TableHead className="w-[100px]">配送件数</TableHead>
                  <TableHead className="w-[200px]">備考</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">読み込み中...</TableCell>
                  </TableRow>
                ) : !employees || employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">有効な社員が見つかりません</TableCell>
                  </TableRow>
                ) : (
                  employees.map((emp) => {
                    const rowData = edits[emp.id] || {};
                    const isSelected = selectedEmployee?.id === emp.id && sidebarOpen;
                    return (
                      <TableRow key={emp.id} className="hover:bg-transparent">
                        <TableCell
                          className={`font-medium sticky left-0 z-10 border-r shadow-[1px_0_0_0_hsl(var(--border))] cursor-pointer select-none transition-colors ${isSelected ? "bg-primary/10" : "bg-card hover:bg-muted/40"}`}
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setSidebarOpen(true);
                          }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div className="min-w-0">
                              <div className="truncate" title={emp.name}>{emp.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{emp.department}</div>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </div>
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" max="31" step="0.5" className="h-8 w-full text-right"
                            value={rowData.workDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'workDays', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" max="31" step="0.5" className="h-8 w-full text-right"
                            value={rowData.absenceDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'absenceDays', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" step="0.5" className="h-8 w-full text-right"
                            value={rowData.overtimeHours || ""}
                            onChange={(e) => handleEditChange(emp.id, 'overtimeHours', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" step="0.5" className="h-8 w-full text-right"
                            value={rowData.lateNightHours || ""}
                            onChange={(e) => handleEditChange(emp.id, 'lateNightHours', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" max="31" step="0.5" className="h-8 w-full text-right"
                            value={rowData.holidayWorkDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'holidayWorkDays', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" step="0.1" className="h-8 w-full text-right"
                            value={rowData.drivingDistanceKm || ""}
                            onChange={(e) => handleEditChange(emp.id, 'drivingDistanceKm', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" className="h-8 w-full text-right"
                            value={rowData.deliveryCases || ""}
                            onChange={(e) => handleEditChange(emp.id, 'deliveryCases', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="text" className="h-8 w-full" placeholder="摘要"
                            value={rowData.notes || ""}
                            onChange={(e) => handleEditChange(emp.id, 'notes', e.target.value)} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <AllowanceSidebar
        employee={selectedEmployee}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
    </AppLayout>
  );
}
