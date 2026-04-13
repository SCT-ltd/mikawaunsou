import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useListEmployees, 
  useListMonthlyRecords, 
  useCreateMonthlyRecord, 
  useUpdateMonthlyRecord,
  getListMonthlyRecordsQueryKey
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";

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

  // Local state for inline editing to make it feel fast
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [saving, setSaving] = useState(false);

  // Initialize edits with server data
  useEffect(() => {
    if (employees && monthlyRecords) {
      const initialEdits: Record<number, any> = {};
      employees.forEach(emp => {
        const record = monthlyRecords.find(r => r.employeeId === emp.id);
        if (record) {
          initialEdits[emp.id] = { ...record };
        } else {
          initialEdits[emp.id] = {
            workDays: 0,
            overtimeHours: 0,
            lateNightHours: 0,
            holidayWorkDays: 0,
            drivingDistanceKm: 0,
            deliveryCases: 0,
            absenceDays: 0,
            notes: ""
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
    let successCount = 0;
    
    try {
      // Create an array of promises for sequential or parallel execution
      // We'll execute them one by one to avoid overwhelming the server
      for (const emp of employees) {
        const editData = edits[emp.id];
        const existingRecord = monthlyRecords?.find(r => r.employeeId === emp.id);
        
        // Skip if no changes from 0s for new records, or if we had a deep equal check for existing
        // For simplicity, we just save all currently edited state
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
          // Only create if there's actually some data entered (not all 0s)
          const hasData = editData.workDays > 0 || editData.drivingDistanceKm > 0 || editData.deliveryCases > 0;
          if (hasData) {
            await createRecord.mutateAsync({
              data: {
                employeeId: emp.id,
                year,
                month,
                ...editData
              }
            });
          }
        }
        successCount++;
      }
      
      toast({
        title: "保存完了",
        description: `${month}月分の実績を保存しました。`,
      });
      queryClient.invalidateQueries({ queryKey: getListMonthlyRecordsQueryKey({ year, month }) });
    } catch (error) {
      toast({
        title: "エラー",
        description: "一部のデータの保存に失敗しました。",
        variant: "destructive",
      });
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
                  <TableHead className="min-w-[150px] sticky left-0 bg-muted/50 z-10">社員名</TableHead>
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
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      読み込み中...
                    </TableCell>
                  </TableRow>
                ) : !employees || employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      有効な社員が見つかりません
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((emp) => {
                    const rowData = edits[emp.id] || {};
                    return (
                      <TableRow key={emp.id} className="hover:bg-transparent">
                        <TableCell className="font-medium sticky left-0 bg-card z-10 border-r shadow-[1px_0_0_0_hsl(var(--border))]">
                          <div className="truncate" title={emp.name}>{emp.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{emp.department}</div>
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            max="31" 
                            step="0.5"
                            className="h-8 w-full text-right"
                            value={rowData.workDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'workDays', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            max="31" 
                            step="0.5"
                            className="h-8 w-full text-right"
                            value={rowData.absenceDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'absenceDays', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            step="0.5"
                            className="h-8 w-full text-right"
                            value={rowData.overtimeHours || ""}
                            onChange={(e) => handleEditChange(emp.id, 'overtimeHours', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            step="0.5"
                            className="h-8 w-full text-right"
                            value={rowData.lateNightHours || ""}
                            onChange={(e) => handleEditChange(emp.id, 'lateNightHours', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            max="31" 
                            step="0.5"
                            className="h-8 w-full text-right"
                            value={rowData.holidayWorkDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'holidayWorkDays', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            step="0.1"
                            className="h-8 w-full text-right"
                            value={rowData.drivingDistanceKm || ""}
                            onChange={(e) => handleEditChange(emp.id, 'drivingDistanceKm', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            className="h-8 w-full text-right"
                            value={rowData.deliveryCases || ""}
                            onChange={(e) => handleEditChange(emp.id, 'deliveryCases', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input 
                            type="text" 
                            className="h-8 w-full"
                            value={rowData.notes || ""}
                            onChange={(e) => handleEditChange(emp.id, 'notes', e.target.value)}
                            placeholder="摘要"
                          />
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
    </AppLayout>
  );
}