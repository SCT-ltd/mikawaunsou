import { useState, useEffect, useRef } from "react";
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
  useGetEmployeeDeductions,
  getGetEmployeeDeductionsQueryKey,
  useUpdateEmployeeDeductions,
  useListDeductionDefinitions,
  useUpdateEmployee,
  useGetCompany,
  getListEmployeesQueryKey,
  Employee
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Plus, X, CalendarDays as CalIcon, RefreshCw } from "lucide-react";
import { AttendanceCalendarDialog } from "@/components/attendance-calendar-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── 給与計算ユーティリティ（フロントエンド用）────────────────────

function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  return fraction <= 0.5 ? Math.floor(amount) : Math.ceil(amount);
}

/**
 * 源泉所得税計算（月額表甲欄）
 * 国税庁 令和6年分 給与所得の源泉徴収税額表（月額表）に準拠
 * tax_0 = X × 税率 - 定額 → tax_B = max(0, tax_0 - B × 3,750) → × 1.021
 */
function calculateIncomeTax(afterInsuranceSalary: number, dependentCount: number): number {
  const X = afterInsuranceSalary;

  let tax0: number;
  if (X < 88_000) {
    tax0 = 0;
  } else if (X < 257_700) {
    tax0 = X * 0.05 - 4_273;
  } else if (X < 429_460) {
    tax0 = X * 0.10 - 17_158;
  } else if (X < 695_000) {
    tax0 = X * 0.20 - 60_104;
  } else if (X < 900_000) {
    tax0 = X * 0.23 - 80_954;
  } else if (X < 1_800_000) {
    tax0 = X * 0.33 - 170_954;
  } else if (X < 4_000_000) {
    tax0 = X * 0.40 - 296_954;
  } else {
    tax0 = X * 0.45 - 496_954;
  }

  const taxB = Math.max(0, tax0 - dependentCount * 3_750);
  return roundJapanese(Math.max(0, taxB * 1.021));
}

// ── サイドバー ────────────────────────────────────────────────────

function AllowanceSidebar({
  employee,
  open,
  onClose,
  monthlyData,
}: {
  employee: Employee | null;
  open: boolean;
  onClose: () => void;
  monthlyData?: { workDays: number; saturdayWorkDays: number; sundayWorkHours: number };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const employeeId = employee?.id ?? 0;

  const { data: allowanceDefinitions } = useListAllowanceDefinitions(
    { activeOnly: true },
    { query: { staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeAllowances } = useGetEmployeeAllowances(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeAllowancesQueryKey(employeeId), staleTime: 0, refetchOnMount: true }
  });
  const { data: deductionDefinitions } = useListDeductionDefinitions(
    { activeOnly: true },
    { query: { staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeDeductions } = useGetEmployeeDeductions(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeDeductionsQueryKey(employeeId), staleTime: 0, refetchOnMount: true }
  });
  const { data: company } = useGetCompany();
  const updateAllowances = useUpdateEmployeeAllowances();
  const updateDeductions = useUpdateEmployeeDeductions();
  const updateEmployee = useUpdateEmployee();

  type AllowanceRow = { defId: number | null; amount: number };
  const [rows, setRows] = useState<AllowanceRow[]>([{ defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState<number>(0);
  const baseSalaryRef = useRef<HTMLInputElement>(null);
  const rowAmountRefs = useRef<(HTMLInputElement | null)[]>([]);

  type DeductionRow = { defId: number | null; amount: number };
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ defId: null, amount: 0 }]);
  const deductionRowAmountRefs = useRef<(HTMLInputElement | null)[]>([]);

  const focusRowAmount = (idx: number) => {
    setTimeout(() => rowAmountRefs.current[idx]?.focus(), 30);
  };

  useEffect(() => {
    if (employeeAllowances && employeeAllowances.length > 0) {
      setRows(employeeAllowances.map(a => ({ defId: a.allowanceDefinitionId, amount: a.amount })));
    } else {
      setRows([{ defId: null, amount: 0 }]);
    }
  }, [employeeAllowances, employeeId]);

  useEffect(() => {
    if (employeeDeductions && employeeDeductions.length > 0) {
      setDeductionRows(employeeDeductions.map(d => ({ defId: d.deductionDefinitionId, amount: d.amount })));
    } else {
      setDeductionRows([{ defId: null, amount: 0 }]);
    }
  }, [employeeDeductions, employeeId]);

  const isDaily = employee?.salaryType === "daily";
  const computedDailyBaseSalary = isDaily && company
    ? Math.round(
        (monthlyData?.workDays ?? 0) * (company.dailyWageWeekday ?? 9808) +
        (monthlyData?.saturdayWorkDays ?? 0) * (company.dailyWageSaturday ?? 12260) +
        (monthlyData?.sundayWorkHours ?? 0) * (company.hourlyWageSunday ?? 1655)
      )
    : null;

  useEffect(() => {
    if (isDaily && computedDailyBaseSalary !== null) {
      setBaseSalaryInput(computedDailyBaseSalary);
    } else {
      setBaseSalaryInput(employee?.baseSalary ?? 0);
    }
  }, [employee?.baseSalary, employeeId, isDaily, computedDailyBaseSalary]);

  const handleSave = async () => {
    try {
      const allowancePayload = rows
        .filter(r => r.defId !== null && r.amount > 0)
        .map(r => ({ allowanceDefinitionId: r.defId!, amount: r.amount }));
      const deductionPayload = deductionRows
        .filter(r => r.defId !== null)
        .map(r => ({ deductionDefinitionId: r.defId!, amount: r.amount || 0 }));
      await Promise.all([
        updateAllowances.mutateAsync({ id: employeeId, data: { allowances: allowancePayload } }),
        updateDeductions.mutateAsync({ id: employeeId, data: { deductions: deductionPayload } }),
        updateEmployee.mutateAsync({ id: employeeId, data: { baseSalary: baseSalaryInput } }),
      ]);
      queryClient.invalidateQueries({ queryKey: getGetEmployeeAllowancesQueryKey(employeeId) });
      queryClient.invalidateQueries({ queryKey: getGetEmployeeDeductionsQueryKey(employeeId) });
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey({ active: true }) });
      toast({ title: "保存しました", description: `${employee?.name}の基本給・手当・差引を更新しました。` });
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;
  // +1 基本給, +1 行追加ボタン行, +1 支給合計
  const totalRows = rows.length + 3;

  // ── 社会保険料計算（計算テーブルマスターの料率を使用）──
  const healthInsuranceRate = company?.healthInsuranceEmployeeRate ?? 0.05;
  const pensionRate = company?.pensionEmployeeRate ?? 0.0915;
  const employmentInsuranceRate = company?.employmentInsuranceRate ?? 0.006;

  const healthInsurance = roundJapanese(grandTotal * healthInsuranceRate);
  const pensionInsurance = roundJapanese(grandTotal * pensionRate);
  const employmentInsurance = (employee?.employmentInsuranceApplied !== false)
    ? roundJapanese(grandTotal * employmentInsuranceRate)
    : 0;
  const totalInsurance = healthInsurance + pensionInsurance + employmentInsurance;

  // ── 税金計算 ──
  const afterInsuranceSalary = Math.max(0, grandTotal - totalInsurance);
  const incomeTax = calculateIncomeTax(afterInsuranceSalary, employee?.dependentCount ?? 0);
  const residentTax = employee?.residentTax ?? 0;

  // ── その他差引（積立等）──
  const customDeductionsTotal = deductionRows.reduce((s, r) => s + (r.amount || 0), 0);

  // ── 差引合計・差引支給額 ──
  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

  const fmt = (v: number) => v > 0 ? v.toLocaleString("ja-JP") : v === 0 ? "0" : "—";

  if (!employee) return null;

  const sectionLabel = (label: string, rowSpan: number) => (
    <td
      rowSpan={rowSpan}
      className="border border-border text-center align-middle font-medium bg-muted/30"
      style={{ writingMode: "vertical-rl", letterSpacing: "0.15em", padding: "6px 3px", fontSize: "11px", width: "22px" }}
    >
      {label}
    </td>
  );

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col gap-0 p-0 overflow-hidden">
        <SheetHeader className="px-5 py-3 border-b shrink-0">
          <SheetTitle className="text-sm font-semibold">手当入力</SheetTitle>
          <SheetDescription className="text-xs">{employee.name}　{employee.department}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-muted/60">
                <th className="border border-border py-1.5 text-center font-medium text-muted-foreground" style={{ width: "22px" }}></th>
                <th className="border border-border px-2 py-1.5 text-left font-medium text-muted-foreground">名称</th>
                <th className="border border-border px-1 py-1.5 text-center font-medium text-muted-foreground" style={{ width: "42px" }}>課税</th>
                <th className="border border-border px-2 py-1.5 text-right font-medium text-muted-foreground" style={{ width: "100px" }}>金額（円）</th>
              </tr>
            </thead>
            <tbody>
              {/* ── 支給セクション ───────────────────────── */}
              <tr className="bg-background">
                {sectionLabel("支　給", totalRows)}
                <td className="border border-border px-2 py-1">
                  <div className="font-medium">基本給</div>
                  {isDaily && (
                    <div className="text-muted-foreground leading-tight" style={{ fontSize: "9px" }}>
                      日給制（自動計算）
                    </div>
                  )}
                </td>
                <td className="border border-border px-1 py-1 text-center">
                  <span className="px-1 py-0.5 rounded border bg-red-50 text-red-700 border-red-200" style={{ fontSize: "10px" }}>課税</span>
                </td>
                <td className="border border-border px-1 py-0.5">
                  {isDaily ? (
                    <div className="h-6 w-full text-right px-1 text-xs font-medium flex items-center justify-end tabular-nums text-blue-700">
                      {baseSalaryInput.toLocaleString("ja-JP")}
                    </div>
                  ) : (
                    <Input
                      ref={baseSalaryRef}
                      type="number"
                      min="0"
                      className="h-6 w-full text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs font-medium"
                      value={baseSalaryInput || ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                        setBaseSalaryInput(isNaN(v) ? 0 : v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); focusRowAmount(0); }
                      }}
                      placeholder="0"
                    />
                  )}
                </td>
              </tr>

              {rows.map((row, idx) => {
                const def = allowanceDefinitions?.find(d => d.id === row.defId);
                return (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <td className="border border-border px-1 py-0.5">
                      <Select
                        value={row.defId?.toString() ?? ""}
                        onValueChange={(v) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, defId: parseInt(v, 10) } : r))}
                      >
                        <SelectTrigger className="h-6 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full">
                          <SelectValue placeholder="手当を選択…" />
                        </SelectTrigger>
                        <SelectContent>
                          {allowanceDefinitions?.map(d => (
                            <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-border px-1 py-1 text-center">
                      {def ? (
                        <span className={`px-1 py-0.5 rounded border ${def.isTaxable ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`} style={{ fontSize: "10px" }}>
                          {def.isTaxable ? "課税" : "非課税"}
                        </span>
                      ) : null}
                    </td>
                    <td className="border border-border px-1 py-0.5">
                      <div className="flex items-center gap-0.5">
                        <Input
                          ref={(el) => { rowAmountRefs.current[idx] = el; }}
                          type="number"
                          min="0"
                          className="h-6 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                          value={row.amount || ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                            setRows(prev => prev.map((r, i) => i === idx ? { ...r, amount: isNaN(v) ? 0 : v } : r));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (idx + 1 < rows.length) {
                                focusRowAmount(idx + 1);
                              } else {
                                setRows(prev => [...prev, { defId: null, amount: 0 }]);
                                focusRowAmount(idx + 1);
                              }
                            }
                          }}
                          placeholder="0"
                        />
                        <button
                          type="button"
                          onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}
                          className="text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                          title="この行を削除"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* 行追加ボタン */}
              <tr className="bg-muted/10">
                <td colSpan={3} className="border border-border px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setRows(prev => [...prev, { defId: null, amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    行を追加
                  </button>
                </td>
              </tr>

              {/* 支給合計 */}
              <tr className="bg-blue-50 font-semibold">
                <td className="border border-border px-2 py-1.5 text-muted-foreground text-center" colSpan={2}>総支給金額</td>
                <td className="border border-border" />
                <td className="border border-border px-2 py-1.5 text-right tabular-nums font-bold text-blue-800">
                  {grandTotal > 0 ? grandTotal.toLocaleString("ja-JP") : "—"}
                </td>
              </tr>

              {/* ── 控除（社会保険料）セクション ──────────── */}
              <tr className="bg-background">
                {sectionLabel("控　除", 5)}
                <td className="border border-border px-2 py-1 text-muted-foreground">健康保険料</td>
                <td className="border border-border" />
                <td className="border border-border px-2 py-1.5 text-right tabular-nums">
                  {fmt(healthInsurance)}
                </td>
              </tr>
              <tr className="bg-muted/20">
                <td className="border border-border px-2 py-1 text-muted-foreground">厚生年金保険料</td>
                <td className="border border-border" />
                <td className="border border-border px-2 py-1.5 text-right tabular-nums">
                  {fmt(pensionInsurance)}
                </td>
              </tr>
              <tr className="bg-background">
                <td className="border border-border px-2 py-1 text-muted-foreground">雇用保険料</td>
                <td className="border border-border" />
                <td className="border border-border px-2 py-1.5 text-right tabular-nums">
                  {fmt(employmentInsurance)}
                </td>
              </tr>
              <tr className="bg-muted/20">
                <td className="border border-border px-2 py-1 text-muted-foreground font-medium" colSpan={2}>
                  社会保険料控除後の金額
                  <span className="ml-1 text-muted-foreground font-normal">(人)</span>
                </td>
                <td className="border border-border px-2 py-1.5 text-right tabular-nums font-medium">
                  {fmt(afterInsuranceSalary)}
                </td>
              </tr>
              <tr className="bg-orange-50 font-semibold">
                <td className="border border-border px-2 py-1.5 text-center text-muted-foreground" colSpan={2}>社会保険料合計</td>
                <td className="border border-border px-2 py-1.5 text-right tabular-nums text-orange-800 font-bold">
                  {fmt(totalInsurance)}
                </td>
              </tr>

              {/* ── 差引金額セクション ──────────────────── */}
              <tr className="bg-background">
                {sectionLabel("差引金額", 2 + deductionRows.length + 1 + 2)}
                <td className="border border-border px-2 py-1 text-muted-foreground">所得税</td>
                <td className="border border-border" />
                <td className="border border-border px-2 py-1.5 text-right tabular-nums">
                  {fmt(incomeTax)}
                </td>
              </tr>
              <tr className="bg-muted/20">
                <td className="border border-border px-2 py-1 text-muted-foreground">市町村民税</td>
                <td className="border border-border" />
                <td className="border border-border px-2 py-1.5 text-right tabular-nums">
                  {fmt(residentTax)}
                </td>
              </tr>

              {/* ── その他差引（積立等）──────────────────── */}
              {deductionRows.map((row, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                  <td className="border border-border px-1 py-0.5">
                    <Select
                      value={row.defId?.toString() ?? ""}
                      onValueChange={(v) => setDeductionRows(prev => prev.map((r, i) => i === idx ? { ...r, defId: parseInt(v, 10) } : r))}
                    >
                      <SelectTrigger className="h-6 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full">
                        <SelectValue placeholder="差引を選択…" />
                      </SelectTrigger>
                      <SelectContent>
                        {deductionDefinitions?.map(d => (
                          <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border border-border" />
                  <td className="border border-border px-1 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <Input
                        ref={(el) => { deductionRowAmountRefs.current[idx] = el; }}
                        type="number"
                        min="0"
                        className="h-6 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                        value={row.amount || ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                          setDeductionRows(prev => prev.map((r, i) => i === idx ? { ...r, amount: isNaN(v) ? 0 : v } : r));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (idx + 1 < deductionRows.length) {
                              setTimeout(() => deductionRowAmountRefs.current[idx + 1]?.focus(), 30);
                            } else {
                              setDeductionRows(prev => [...prev, { defId: null, amount: 0 }]);
                              setTimeout(() => deductionRowAmountRefs.current[idx + 1]?.focus(), 30);
                            }
                          }
                        }}
                        placeholder="0"
                      />
                      <button
                        type="button"
                        onClick={() => setDeductionRows(prev => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                        title="この行を削除"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* 差引行追加ボタン */}
              <tr className="bg-muted/10">
                <td colSpan={3} className="border border-border px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setDeductionRows(prev => [...prev, { defId: null, amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    行を追加
                  </button>
                </td>
              </tr>

              <tr className="bg-muted/40 font-semibold">
                <td className="border border-border px-2 py-1.5 text-center text-muted-foreground" colSpan={2}>差引合計額</td>
                <td className="border border-border px-2 py-1.5 text-right tabular-nums text-red-700 font-bold">
                  {fmt(totalDeductions)}
                </td>
              </tr>
              <tr className="bg-green-50 font-bold">
                <td className="border border-border px-2 py-1.5 text-center font-semibold" colSpan={2}>差引支給額</td>
                <td className="border border-border px-2 py-1.5 text-right tabular-nums text-green-800 text-sm font-extrabold">
                  {fmt(netSalary)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 料率表示 */}
          {company && (
            <div className="mx-3 mt-2 mb-1 px-3 py-2 bg-muted/40 border rounded text-xs text-muted-foreground">
              計算テーブルマスター適用：健保 {(healthInsuranceRate * 100).toFixed(2)}%・厚年 {(pensionRate * 100).toFixed(2)}%・雇保 {(employmentInsuranceRate * 100).toFixed(2)}%
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3 shrink-0">
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={updateAllowances.isPending || updateDeductions.isPending}
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
  const [calendarEmp, setCalendarEmp] = useState<{ id: number; name: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImportAttendance = async () => {
    setImporting(true);
    try {
      const res = await fetch(`${BASE}/api/attendance/monthly-summary?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("取得失敗");
      const summary: { employeeId: number; workDays: number; saturdayWorkDays: number; sundayWorkHours: number; overtimeHours: number; absenceDays: number }[] = await res.json();

      if (summary.length === 0) {
        toast({ title: "取り込み対象なし", description: `${year}年${month}月の打刻データが見つかりませんでした。` });
        return;
      }

      setEdits(prev => {
        const next = { ...prev };
        for (const s of summary) {
          next[s.employeeId] = {
            ...(next[s.employeeId] || {}),
            workDays: s.workDays,
            saturdayWorkDays: s.saturdayWorkDays,
            sundayWorkHours: s.sundayWorkHours,
            overtimeHours: s.overtimeHours,
            absenceDays: s.absenceDays ?? 0,
          };
        }
        return next;
      });

      toast({
        title: "勤怠データを取り込みました",
        description: `${summary.length}名分の出勤日数・残業時間を反映しました。内容を確認して一括保存してください。`,
      });
    } catch {
      toast({ title: "エラー", description: "勤怠データの取り込みに失敗しました。", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (employees && monthlyRecords) {
      const initialEdits: Record<number, any> = {};
      employees.forEach(emp => {
        const empDefaultRate = (emp as unknown as { mikawaCommissionRate?: number }).mikawaCommissionRate ?? 0;
        const record = monthlyRecords.find(r => r.employeeId === emp.id);
        if (record) {
          initialEdits[emp.id] = {
            ...record,
            commissionRate: (record as unknown as { commissionRate?: number }).commissionRate || empDefaultRate,
            bluewingSalesAmount: (record as unknown as { bluewingSalesAmount?: number }).bluewingSalesAmount ?? 0,
          };
        } else {
          initialEdits[emp.id] = {
            workDays: 0, overtimeHours: 0, lateNightHours: 0,
            holidayWorkDays: 0, drivingDistanceKm: 0, deliveryCases: 0,
            absenceDays: 0, saturdayWorkDays: 0, sundayWorkHours: 0, notes: "",
            salesAmount: 0, commissionRate: empDefaultRate, bluewingSalesAmount: 0,
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
              saturdayWorkDays: editData.saturdayWorkDays ?? 0,
              sundayWorkHours: editData.sundayWorkHours ?? 0,
              notes: editData.notes,
              salesAmount: editData.salesAmount ?? 0,
              commissionRate: editData.commissionRate ?? 0,
              bluewingSalesAmount: editData.bluewingSalesAmount ?? 0,
            }
          });
        } else {
          const hasData = editData.workDays > 0 || editData.drivingDistanceKm > 0 || editData.deliveryCases > 0 || (editData.bluewingSalesAmount ?? 0) > 0;
          if (hasData) {
            await createRecord.mutateAsync({
              data: { employeeId: emp.id, year, month, ...editData }
            });
          }
        }
        // ブルーウィングロジック：売上入力済の社員は自動計算
        const isBluewing = (emp as unknown as { useBluewingLogic?: boolean }).useBluewingLogic;
        if (isBluewing && (editData.bluewingSalesAmount ?? 0) > 0) {
          try {
            await fetch(`${BASE}/api/payroll/calculate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ employeeId: emp.id, year, month, useBluewingLogic: true }),
            });
          } catch {
            // 自動計算失敗は無視（保存は成功）
          }
        }
      }
      toast({ title: "保存完了", description: `${month}月分の実績を保存しました。ブルーウィング社員の給与は自動計算されました。` });
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
            <Button
              variant="outline"
              onClick={handleImportAttendance}
              disabled={isLoading || importing || saving || !employees?.length}
              title="勤怠ダッシュボードの打刻データから出勤日数・残業時間を自動入力します"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${importing ? "animate-spin" : ""}`} />
              {importing ? "取り込み中..." : "勤怠から取り込む"}
            </Button>
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
                  <TableHead className="w-[90px]">平日出勤</TableHead>
                  <TableHead className="w-[90px]">土曜出勤</TableHead>
                  <TableHead className="w-[90px]">日曜(h)</TableHead>
                  <TableHead className="w-[90px]">欠勤日数</TableHead>
                  <TableHead className="w-[90px]">残業(h)</TableHead>
                  <TableHead className="w-[90px]">深夜(h)</TableHead>
                  <TableHead className="w-[90px]">休日出勤</TableHead>
                  <TableHead className="w-[110px]">走行距離(km)</TableHead>
                  <TableHead className="w-[90px]">配送件数</TableHead>
                  <TableHead className="w-[130px]">売上金額(円)</TableHead>
                  <TableHead className="w-[100px]">歩合率(%)</TableHead>
                  <TableHead className="w-[140px] bg-blue-50">BW売上(円)</TableHead>
                  <TableHead className="w-[180px]">備考</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">読み込み中...</TableCell>
                  </TableRow>
                ) : !employees || employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">有効な社員が見つかりません</TableCell>
                  </TableRow>
                ) : (
                  employees.map((emp) => {
                    const rowData = edits[emp.id] || {};
                    return (
                      <TableRow key={emp.id} className="hover:bg-transparent">
                        <TableCell
                          className="font-medium sticky left-0 z-10 border-r shadow-[1px_0_0_0_hsl(var(--border))] bg-card"
                        >
                          <button
                            className="min-w-0 w-full text-left group flex items-center gap-1.5 hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                            title="クリックして勤怠カレンダーを表示"
                            onClick={() => setCalendarEmp({ id: emp.id, name: emp.name })}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{emp.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{emp.department}</div>
                            </div>
                            <CalIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                          </button>
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" max="31" step="0.5" className="h-8 w-full text-right"
                            value={rowData.workDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'workDays', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" max="31" step="0.5" className="h-8 w-full text-right"
                            value={rowData.saturdayWorkDays || ""}
                            onChange={(e) => handleEditChange(emp.id, 'saturdayWorkDays', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" step="0.5" className="h-8 w-full text-right"
                            value={rowData.sundayWorkHours || ""}
                            onChange={(e) => handleEditChange(emp.id, 'sundayWorkHours', e.target.value)} />
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
                          <Input type="number" min="0" step="1" className="h-8 w-full text-right"
                            value={rowData.salesAmount || ""}
                            onChange={(e) => handleEditChange(emp.id, 'salesAmount', e.target.value)} />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input type="number" min="0" max="100" step="0.1" className="h-8 w-full text-right"
                            value={rowData.commissionRate ? (rowData.commissionRate * 100).toFixed(1) : ""}
                            onChange={(e) => {
                              const pct = parseFloat(e.target.value) || 0;
                              handleEditChange(emp.id, 'commissionRate', String(pct / 100));
                            }} />
                        </TableCell>
                        <TableCell className="p-2 bg-blue-50/60">
                          {(emp as unknown as { useBluewingLogic?: boolean }).useBluewingLogic ? (
                            <Input type="number" min="0" step="1" className="h-8 w-full text-right border-blue-300 focus-visible:ring-blue-400"
                              value={rowData.bluewingSalesAmount || ""}
                              onChange={(e) => handleEditChange(emp.id, 'bluewingSalesAmount', e.target.value)} />
                          ) : (
                            <div className="h-8 flex items-center justify-center text-xs text-muted-foreground">—</div>
                          )}
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

      {calendarEmp && (
        <AttendanceCalendarDialog
          open={!!calendarEmp}
          onClose={() => setCalendarEmp(null)}
          employeeId={calendarEmp.id}
          employeeName={calendarEmp.name}
          year={year}
          month={month}
        />
      )}
    </AppLayout>
  );
}
