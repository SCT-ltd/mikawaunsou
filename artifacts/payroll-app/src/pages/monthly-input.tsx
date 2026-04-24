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
  useListPayrolls,
  Employee
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Plus, X, CalendarDays as CalIcon, RefreshCw } from "lucide-react";
import { AttendanceCalendarDialog } from "@/components/attendance-calendar-dialog";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical } from "lucide-react";

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

  type AllowanceRow = { id: string; defId: number | null; amount: number };
  const [rows, setRows] = useState<AllowanceRow[]>([{ id: "init", defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState<number>(0);
  const baseSalaryRef = useRef<HTMLInputElement>(null);
  const rowAmountRefs = useRef<Record<string, HTMLInputElement | null>>({});

  type DeductionRow = { id: string; defId: number | null; amount: number };
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ id: "init-ded", defId: null, amount: 0 }]);
  const deductionRowAmountRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const focusRowAmount = (id: string) => {
    setTimeout(() => rowAmountRefs.current[id]?.focus(), 30);
  };
  const focusDeductionRowAmount = (id: string) => {
    setTimeout(() => deductionRowAmountRefs.current[id]?.focus(), 30);
  };

  useEffect(() => {
    if (employeeAllowances && employeeAllowances.length > 0) {
      setRows(employeeAllowances.map(a => ({
        id: `a-${a.id}`,
        defId: a.allowanceDefinitionId,
        amount: a.amount
      })));
    } else {
      setRows([{ id: Math.random().toString(36).substr(2, 9), defId: null, amount: 0 }]);
    }
  }, [employeeAllowances, employeeId]);

  useEffect(() => {
    if (employeeDeductions && employeeDeductions.length > 0) {
      setDeductionRows(employeeDeductions.map(d => ({
        id: `d-${d.id}`,
        defId: d.deductionDefinitionId,
        amount: d.amount
      })));
    } else {
      setDeductionRows([{ id: Math.random().toString(36).substr(2, 9), defId: null, amount: 0 }]);
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
  const pensionInsurance = (employee?.pensionApplied !== false)
    ? roundJapanese(grandTotal * pensionRate)
    : 0;
  const employmentInsurance = (employee?.employmentInsuranceApplied !== false)
    ? roundJapanese(grandTotal * employmentInsuranceRate)
    : 0;
  const totalInsurance = healthInsurance + pensionInsurance + employmentInsurance;

  const nonTaxableAllowancesTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions?.find(d => d.id === r.defId);
    return s + (def?.isTaxable === false ? (r.amount || 0) : 0);
  }, 0);

  // ── 税金計算 ──
  const afterInsuranceSalary = Math.max(0, grandTotal - nonTaxableAllowancesTotal - totalInsurance);
  const dependentEquivCount = (employee?.dependentCount ?? 0) + (employee?.hasSpouse ? 1 : 0);
  const incomeTax = calculateIncomeTax(afterInsuranceSalary, dependentEquivCount);
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

        <div className="flex-1 overflow-y-auto px-1 pt-1 pb-4">
          <div className="grid grid-cols-[22px_20px_1fr_42px_100px] border border-border bg-background shadow-sm rounded-sm overflow-hidden text-xs">
            {/* Header */}
            <div className="col-span-1 border-b border-r bg-muted/60 py-1.5"></div>
            <div className="border-b border-r bg-muted/60 py-1.5"></div> {/* Grip col header */}
            <div className="border-b border-r bg-muted/60 px-2 py-1.5 font-medium text-muted-foreground">名称</div>
            <div className="border-b border-r bg-muted/60 px-1 py-1.5 text-center font-medium text-muted-foreground">課税</div>
            <div className="border-b bg-muted/60 px-2 py-1.5 text-right font-medium text-muted-foreground">金額（円）</div>

            {/* ── 支給セクション ───────────────────────── */}
            <div
              className="row-start-2 border-r bg-muted/30 flex items-center justify-center font-medium"
              style={{
                writingMode: "vertical-rl",
                letterSpacing: "0.15em",
                padding: "6px 3px",
                fontSize: "11px",
                gridRow: `span ${rows.length + 3}`
              }}
            >
              支　給
            </div>

            {/* 基本給 (固定) */}
            <div className="col-start-2 border-b border-r bg-background/50"></div> {/* Dummy grip col */}
            <div className="col-start-3 border-b border-r px-2 py-1 bg-background/50">
              <div className="font-medium">基本給</div>
              {isDaily && (
                <div className="text-muted-foreground leading-tight" style={{ fontSize: "9px" }}>
                  日給制（自動計算）
                </div>
              )}
            </div>
            <div className="border-b border-r px-1 py-1 text-center bg-background/50 flex items-center justify-center">
              <span className="px-1 py-0.5 rounded border bg-red-50 text-red-700 border-red-200" style={{ fontSize: "10px" }}>課税</span>
            </div>
            <div className="border-b px-1 py-0.5 bg-background/50">
              {isDaily ? (
                <div className="h-7 w-full text-right px-1 text-xs font-medium flex items-center justify-end tabular-nums text-blue-700">
                  {baseSalaryInput.toLocaleString("ja-JP")}
                </div>
              ) : (
                <Input
                  ref={baseSalaryRef}
                  type="number"
                  min="0"
                  className="h-7 w-full text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs font-medium"
                  value={baseSalaryInput || ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                    setBaseSalaryInput(isNaN(v) ? 0 : v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (rows.length > 0) focusRowAmount(rows[0].id);
                    }
                  }}
                  placeholder="0"
                />
              )}
            </div>

            {/* 手当 Reorder Group */}
            <Reorder.Group
              axis="y"
              values={rows}
              onReorder={setRows}
              as="div"
              className="col-start-2 col-span-4 contents"
            >
              {rows.map((row) => {
                const def = allowanceDefinitions?.find(d => d.id === row.defId);
                return (
                  <Reorder.Item
                    key={row.id}
                    value={row}
                    as="div"
                    className="col-start-2 col-span-4 grid grid-cols-[20px_1fr_42px_100px] group cursor-grab active:cursor-grabbing border-b border-border bg-background"
                    whileDrag={{ 
                      scale: 1.01, 
                      backgroundColor: "var(--muted)", 
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", 
                      zIndex: 50,
                      position: "relative"
                    }}
                  >
                    <div className="border-r flex items-center justify-center bg-muted/5 group-hover:bg-muted/10 transition-colors">
                      <GripVertical className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                    </div>
                    <div className="border-r px-1 py-0.5 flex items-center relative">
                      <Select
                        value={row.defId?.toString() ?? ""}
                        onValueChange={(v) => setRows(prev => prev.map((r) => r.id === row.id ? { ...r, defId: parseInt(v, 10) } : r))}
                      >
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full">
                          <SelectValue placeholder="手当を選択…" />
                        </SelectTrigger>
                        <SelectContent>
                          {allowanceDefinitions?.map(d => (
                            <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="border-r px-1 py-1 text-center flex items-center justify-center">
                      {def ? (
                        <span className={`px-1 py-0.5 rounded border ${def.isTaxable ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`} style={{ fontSize: "10px" }}>
                          {def.isTaxable ? "課税" : "非課税"}
                        </span>
                      ) : null}
                    </div>
                    <div className="px-1 py-0.5 flex items-center gap-0.5">
                      <Input
                        ref={(el) => { rowAmountRefs.current[row.id] = el; }}
                        type="number"
                        min="0"
                        className="h-7 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                        value={row.amount || ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                          setRows(prev => prev.map((r) => r.id === row.id ? { ...r, amount: isNaN(v) ? 0 : v } : r));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const idx = rows.findIndex(r => r.id === row.id);
                            if (idx + 1 < rows.length) {
                              focusRowAmount(rows[idx + 1].id);
                            } else {
                              const newId = Math.random().toString(36).substr(2, 9);
                              setRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]);
                              setTimeout(() => focusRowAmount(newId), 30);
                            }
                          }
                        }}
                        placeholder="0"
                      />
                      <button
                        type="button"
                        onClick={() => setRows(prev => prev.filter((r) => r.id !== row.id))}
                        className="text-muted-foreground hover:text-destructive p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="この行を削除"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>

            {/* 行追加ボタン */}
            <div className="col-start-2 col-span-4 border-b bg-muted/5 px-2 py-1.5 flex items-center">
              <button
                type="button"
                onClick={() => {
                  const newId = Math.random().toString(36).substr(2, 9);
                  setRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]);
                  setTimeout(() => focusRowAmount(newId), 30);
                }}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                手当行を追加
              </button>
            </div>

            {/* 支給合計 */}
            <div className="col-start-2 col-span-3 border-b border-r bg-blue-50/50 px-2 py-2 text-muted-foreground font-semibold flex items-center justify-center">
              総支給金額
            </div>
            <div className="border-b bg-blue-50/50 px-2 py-2 text-right tabular-nums font-bold text-blue-800 text-sm">
              {grandTotal > 0 ? grandTotal.toLocaleString("ja-JP") : "—"}
            </div>

            {/* ── 控除（社会保険料）セクション ──────────── */}
            <div
              className="border-r bg-muted/30 flex items-center justify-center font-medium"
              style={{
                writingMode: "vertical-rl",
                letterSpacing: "0.15em",
                padding: "6px 3px",
                fontSize: "11px",
                gridRow: "span 5"
              }}
            >
              控　除
            </div>
            <div className="col-start-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">健康保険料</div>
            <div className="col-start-3 col-span-2 border-b border-r bg-background"></div>
            <div className="border-b px-2 py-1.5 text-right tabular-nums bg-background">{fmt(healthInsurance)}</div>

            <div className="col-start-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-muted/5">厚生年金保険料</div>
            <div className="col-start-3 col-span-2 border-b border-r bg-muted/5"></div>
            <div className="border-b px-2 py-1.5 text-right tabular-nums bg-muted/5">{fmt(pensionInsurance)}</div>

            <div className="col-start-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">雇用保険料</div>
            <div className="col-start-3 col-span-2 border-b border-r bg-background"></div>
            <div className="col-start-2 col-span-3 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">雇用保険料</div>
            <div className="border-b px-2 py-1.5 text-right tabular-nums bg-background">{fmt(employmentInsurance)}</div>

            <div className="col-start-2 col-span-3 border-b border-r px-2 py-1.5 text-muted-foreground font-medium bg-muted/5">
              社会保険料控除後の金額
            </div>
            <div className="border-b px-2 py-1.5 text-right tabular-nums font-medium bg-muted/5">{fmt(afterInsuranceSalary)}</div>

            <div className="col-start-2 col-span-3 border-b border-r px-2 py-2 text-center text-muted-foreground font-semibold bg-orange-50/50">
              社会保険料合計
            </div>
            <div className="border-b px-2 py-2 text-right tabular-nums text-orange-800 font-bold bg-orange-50/50">
              {fmt(totalInsurance)}
            </div>

            {/* ── 差引金額セクション ──────────────────── */}
            <div
              className="border-r bg-muted/30 flex items-center justify-center font-medium"
              style={{
                writingMode: "vertical-rl",
                letterSpacing: "0.15em",
                padding: "6px 3px",
                fontSize: "11px",
                gridRow: `span ${2 + deductionRows.length + 1 + 2}`
              }}
            >
              差引金額
            </div>
            <div className="col-start-2 col-span-3 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">所得税</div>
            <div className="border-b px-2 py-1.5 text-right tabular-nums bg-background">{fmt(incomeTax)}</div>

            <div className="col-start-2 col-span-3 border-b border-r px-2 py-1.5 text-muted-foreground bg-muted/5">市町村民税</div>
            <div className="border-b px-2 py-1.5 text-right tabular-nums bg-muted/5">{fmt(residentTax)}</div>

            {/* 差引 Reorder Group */}
            <Reorder.Group
              axis="y"
              values={deductionRows}
              onReorder={setDeductionRows}
              as="div"
              className="col-start-1 col-span-5 contents"
            >
              {deductionRows.map((row) => (
                <Reorder.Item
                  key={row.id}
                  value={row}
                  as="div"
                  className="col-start-1 col-span-5 grid grid-cols-[22px_20px_1fr_42px_100px] group cursor-grab active:cursor-grabbing border-b border-border bg-background"
                  whileDrag={{ 
                    scale: 1.01, 
                    backgroundColor: "var(--muted)", 
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)", 
                    zIndex: 50,
                    position: "relative"
                  }}
                >
                  <div className="border-r flex items-center justify-center bg-muted/5 group-hover:bg-muted/10 transition-colors">
                    <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                  </div>
                  <div className="border-r bg-background"></div>
                  <div className="border-r px-1 py-0.5 flex items-center gap-1.5 relative">
                    <Select
                      value={row.defId?.toString() ?? ""}
                      onValueChange={(v) => setDeductionRows(prev => prev.map((r) => r.id === row.id ? { ...r, defId: parseInt(v, 10) } : r))}
                    >
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full">
                        <SelectValue placeholder="差引を選択…" />
                      </SelectTrigger>
                      <SelectContent>
                        {deductionDefinitions?.map(d => (
                          <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="border-r bg-background"></div>
                  <div className="px-1 py-0.5 flex items-center gap-0.5 bg-background">
                    <Input
                      ref={(el) => { deductionRowAmountRefs.current[row.id] = el; }}
                      type="number"
                      min="0"
                      className="h-7 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                      value={row.amount || ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                        setDeductionRows(prev => prev.map((r) => r.id === row.id ? { ...r, amount: isNaN(v) ? 0 : v } : r));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const idx = deductionRows.findIndex(r => r.id === row.id);
                          if (idx + 1 < deductionRows.length) {
                            focusDeductionRowAmount(deductionRows[idx + 1].id);
                          } else {
                            const newId = Math.random().toString(36).substr(2, 9);
                            setDeductionRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]);
                            setTimeout(() => focusDeductionRowAmount(newId), 30);
                          }
                        }
                      }}
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => setDeductionRows(prev => prev.filter((r) => r.id !== row.id))}
                      className="text-muted-foreground hover:text-destructive p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="この行を削除"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </Reorder.Item>
              ))}
            </Reorder.Group>

            {/* 差引行追加ボタン */}
            <div className="col-start-1 col-span-5 border-b bg-muted/5 px-2 py-1.5 flex items-center">
              <button
                type="button"
                onClick={() => {
                  const newId = Math.random().toString(36).substr(2, 9);
                  setDeductionRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]);
                  setTimeout(() => focusDeductionRowAmount(newId), 30);
                }}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                差引行を追加
              </button>
            </div>

            {/* 差引合計・支給額 */}
            <div className="col-start-1 col-span-4 border-b border-r bg-muted/10 px-2 py-2 text-center text-muted-foreground font-semibold">
              差引合計額
            </div>
            <div className="border-b px-2 py-2 text-right tabular-nums text-red-700 font-bold bg-muted/10">
              {fmt(totalDeductions)}
            </div>

            <div className="col-start-2 col-span-2 bg-green-50/60 px-2 py-2 text-center font-bold text-green-900 border-r border-green-100">
              差引支給額
            </div>
            <div className="bg-green-50/60 px-2 py-2 text-right tabular-nums text-green-800 font-extrabold text-sm border-green-100">
              {fmt(netSalary)}
            </div>
          </div>

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

function TooltipInput({ 
  description, 
  ...props 
}: React.ComponentProps<typeof Input> & { description: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Input {...props} />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px] text-[11px] bg-slate-800 text-white border-none shadow-xl">
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

  // 前月データの取得
  const prevDate = new Date(year, month - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;
  const { data: prevMonthlyRecords } = useListMonthlyRecords({ year: prevYear, month: prevMonth });

  const [calendarEmp, setCalendarEmp] = useState<{ id: number; name: string } | null>(null);
  const [importing, setImporting] = useState(false);

  // フィルタ状態
  const [searchTerm, setSearchTerm] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [logicFilter, setLogicFilter] = useState("all");
  const [validationErrors, setValidationErrors] = useState<Record<number, Record<string, string>>>({});

  // 概算プレビューの管理
  const [previews, setPreviews] = useState<Record<number, any>>({});
  const calculationQueue = useRef<Record<number, NodeJS.Timeout>>({});
  const abortControllers = useRef<Record<number, AbortController>>({});

  const { data: prevPayrolls } = useListPayrolls({ year: prevYear, month: prevMonth });

  const fetchPreview = async (empId: number, record: any) => {
    if (abortControllers.current[empId]) {
      abortControllers.current[empId].abort();
    }
    const controller = new AbortController();
    abortControllers.current[empId] = controller;

    try {
      const res = await fetch(`${BASE}/api/payroll/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: empId, year, month, record }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error("計算失敗");
      const data = await res.json();
      setPreviews(prev => ({ ...prev, [empId]: { ...data.result, status: 'success' } }));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setPreviews(prev => ({ ...prev, [empId]: { status: 'error' } }));
    }
  };

  const triggerPreview = (empId: number, record: any) => {
    const errors = validateRow(empId, record);
    if (Object.keys(errors).length > 0) {
      setPreviews(prev => ({ ...prev, [empId]: { status: 'invalid' } }));
      return;
    }

    setPreviews(prev => ({ ...prev, [empId]: { ...prev[empId], status: 'loading' } }));

    if (calculationQueue.current[empId]) clearTimeout(calculationQueue.current[empId]);
    calculationQueue.current[empId] = setTimeout(() => {
      fetchPreview(empId, record);
    }, 500);
  };

  // 前月データの取得ヘルパー
  const getPrevValue = (empId: number, field: string) => {
    if (!prevMonthlyRecords) return null;
    const record = prevMonthlyRecords.find(r => r.employeeId === empId);
    if (!record) return null;
    const val = (record as any)[field];
    if (val === undefined || val === null) return null;

    // 特殊処理: commissionRateは%表記に変換して返す
    if (field === 'commissionRate') return (val * 100).toFixed(1);

    return val;
  };

  const validateRow = (empId: number, data: any) => {
    const errors: Record<string, string> = {};
    const emp = employees?.find(e => e.id === empId);
    if (!emp) return errors;

    const isBW = (emp as any).useBluewingLogic;
    const isMikawa = !!(emp as any).mikawaCommissionRate && !isBW;

    // 数値バリデーション
    if ((Number(data.workDays) || 0) + (Number(data.saturdayWorkDays) || 0) + (Number(data.absenceDays) || 0) > 31) {
      errors.workDays = "合計日数が過大です";
    }
    if ((Number(data.overtimeHours) || 0) > 200) errors.overtimeHours = "残業が過大です";
    if ((Number(data.salesAmount) || 0) < 0) errors.salesAmount = "マイナスは不可です";

    // 必須チェック (ロジック別)
    if (isBW && (data.bluewingSalesAmount === undefined || data.bluewingSalesAmount === null || data.bluewingSalesAmount === "")) {
      errors.bluewingSalesAmount = "BW売上は必須です";
    }
    if (isMikawa && (!data.salesAmount || data.salesAmount === "0")) {
      errors.salesAmount = "売上入力が必要です";
    }

    return errors;
  };

  const handleEditChange = (empId: number, field: string, value: any) => {
    setEdits(prev => {
      const row = { ...(prev[empId] || {}), [field]: field === 'notes' ? value : (value === "" ? 0 : Number(value)) };

      // 即時バリデーション
      const errors = validateRow(empId, row);
      setValidationErrors(vPrev => ({
        ...vPrev,
        [empId]: errors
      }));

      // 概算プレビューのトリガー
      triggerPreview(empId, row);

      return { ...prev, [empId]: row };
    });
  };

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

  // 初期計算のトリガー
  useEffect(() => {
    if (employees && edits) {
      Object.keys(edits).forEach(empIdStr => {
        const empId = Number(empIdStr);
        triggerPreview(empId, edits[empId]);
      });
    }
  }, [employees, monthlyRecords]); // データ取得完了時に一度走らせる

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

  // フィルタリングの適用
  const filteredEmployees = employees?.filter(emp => {
    const nameMatch = emp.name.toLowerCase().includes(searchTerm.toLowerCase());
    const deptMatch = deptFilter === "all" || emp.department === deptFilter;

    let logicMatch = true;
    if (logicFilter === "mikawa") {
      logicMatch = !!(emp as any).mikawaCommissionRate && !(emp as any).useBluewingLogic;
    } else if (logicFilter === "bw") {
      logicMatch = !!(emp as any).useBluewingLogic;
    } else if (logicFilter === "normal") {
      logicMatch = !(emp as any).mikawaCommissionRate && !(emp as any).useBluewingLogic;
    }

    return nameMatch && deptMatch && logicMatch;
  });

  const departments = Array.from(new Set(employees?.map(e => e.department).filter(Boolean)));

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">月次実績入力</h2>
            <p className="text-sm text-muted-foreground">給与計算の基礎となる各社員の月間実績を入力・管理します。</p>
          </div>
          <div className="flex items-center gap-3 bg-muted/30 p-2 rounded-lg border">
            <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-[110px] h-9 bg-card">
                <SelectValue placeholder="年" />
              </SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
              <SelectTrigger className="w-[90px] h-9 bg-card">
                <SelectValue placeholder="月" />
              </SelectTrigger>
              <SelectContent>
                {months.map(m => <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* フィルタリング・アクションエリア */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-muted/20 p-4 rounded-xl border border-border/50 shadow-sm">
          <div className="md:col-span-3 space-y-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider ml-1">社員名検索</label>
            <Input
              placeholder="名前を入力..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 bg-card shadow-sm"
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider ml-1">所属部署</label>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-10 bg-card shadow-sm">
                <SelectValue placeholder="すべて" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべての部署</SelectItem>
                {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider ml-1">ロジック種別</label>
            <Select value={logicFilter} onValueChange={setLogicFilter}>
              <SelectTrigger className="h-10 bg-card shadow-sm">
                <SelectValue placeholder="すべて" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべての社員</SelectItem>
                <SelectItem value="mikawa">三川ロジック</SelectItem>
                <SelectItem value="bw">ブルーウィング</SelectItem>
                <SelectItem value="normal">通常</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-5 flex items-end gap-2">
            <Button
              variant="outline"
              className="h-10 flex-1 border-primary/20 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-all"
              onClick={handleImportAttendance}
              disabled={isLoading || importing || saving || !employees?.length}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${importing ? "animate-spin" : ""}`} />
              {importing ? "取込中..." : "勤怠から一括反映"}
            </Button>
            <Button
              className="h-10 flex-1 shadow-md bg-primary hover:bg-primary/90"
              onClick={handleSaveAll}
              disabled={isLoading || saving || !employees?.length}
            >
              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {saving ? "保存中..." : "実績を保存"}
            </Button>
          </div>
        </div>

        {/* 実績入力テーブル */}
        <div className="rounded-xl border bg-card shadow-lg overflow-hidden monthly-input-table">
          <div className="overflow-x-auto">
            <Table className="border-collapse">
              <TableHeader>
                {/* グルーピングヘッダー */}
                <TableRow className="bg-muted/80 divide-x divide-border/40 hover:bg-muted/80">
                  <TableHead className="min-w-[200px] sticky left-0 bg-muted/95 z-30 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">
                    社員名・所属
                  </TableHead>
                  <TableHead colSpan={7} className="text-center bg-emerald-100/30 text-emerald-900 border-b-2 border-b-emerald-400/50 font-bold py-1">
                    勤怠・時間管理
                  </TableHead>
                  <TableHead colSpan={2} className="text-center bg-blue-100/30 text-blue-900 border-b-2 border-b-blue-400/50 font-bold py-1">
                    運行実績
                  </TableHead>
                  <TableHead colSpan={3} className="text-center bg-orange-100/30 text-orange-900 border-b-2 border-b-orange-400/50 font-bold py-1">
                    給与計算基礎
                  </TableHead>
                  <TableHead className="min-w-[120px] sticky right-0 bg-muted/95 z-30 shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.1)] border-l-2 border-l-primary/30 text-center font-bold">
                    概算
                  </TableHead>
                  <TableHead className="min-w-[150px] text-center">備考</TableHead>
                </TableRow>
                {/* 項目詳細ヘッダー */}
                <TableRow className="bg-muted/40 divide-x divide-border/20 text-[10px] uppercase tracking-tighter hover:bg-muted/40 h-8">
                  <TableHead className="sticky left-0 bg-muted/40 z-30"></TableHead>
                  <TableHead className="w-[64px] text-center px-1">平日</TableHead>
                  <TableHead className="w-[64px] text-center px-1">土曜</TableHead>
                  <TableHead className="w-[64px] text-center px-1">日曜(h)</TableHead>
                  <TableHead className="w-[64px] text-center px-1 text-red-600">欠勤</TableHead>
                  <TableHead className="w-[64px] text-center px-1">残業</TableHead>
                  <TableHead className="w-[64px] text-center px-1">深夜</TableHead>
                  <TableHead className="w-[64px] text-center px-1">休日</TableHead>
                  <TableHead className="w-[84px] text-center px-1">距離(km)</TableHead>
                  <TableHead className="w-[74px] text-center px-1">件数</TableHead>
                  <TableHead className="w-[110px] text-center px-1 font-bold text-orange-700">売上(円)</TableHead>
                  <TableHead className="w-[64px] text-center px-1">歩合%</TableHead>
                  <TableHead className="w-[120px] bg-blue-100/40 text-blue-900 text-center px-1 font-bold">BW売上</TableHead>
                  <TableHead className="sticky right-0 bg-muted/40 z-30 border-l-2 border-l-primary/10"></TableHead>
                  <TableHead className="px-2 text-left">メモ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center py-20 text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw className="h-8 w-8 animate-spin opacity-20" />
                        <span>データを読み込み中...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : !filteredEmployees || filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center py-20 text-muted-foreground">
                      検索条件に一致する社員が見つかりません。
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((emp) => {
                    const rowData = edits[emp.id] || {};
                    const isBW = (emp as any).useBluewingLogic;
                    const isMikawa = !!(emp as any).mikawaCommissionRate && !isBW;

                    return (
                      <TableRow key={emp.id} className="hover:bg-muted/10 divide-x divide-border/10 group h-auto min-h-[40px]">
                        {/* 社員名セル */}
                        <TableCell className="p-0 sticky left-0 z-20 bg-card shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] group-hover:bg-muted/5">
                          <button
                            className="w-full text-left flex items-start gap-2 hover:bg-primary/5 transition-colors p-2 focus:bg-primary/5 focus:outline-none"
                            onClick={() => setCalendarEmp({ id: emp.id, name: emp.name })}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="truncate font-bold text-[13px]">{emp.name}</span>
                                {isBW && (
                                  <span className="bg-blue-600 text-white text-[8px] px-1 rounded-sm font-black shadow-sm uppercase">BW</span>
                                )}
                                {isMikawa && (
                                  <span className="bg-orange-500 text-white text-[8px] px-1 rounded-sm font-black shadow-sm uppercase">三川</span>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate opacity-70">{emp.department}</div>
                              {validationErrors[emp.id] && (
                                <div className="text-[9px] text-red-500 font-bold mt-1 animate-pulse">要確認!</div>
                              )}
                            </div>
                            <CalIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 mt-0.5" />
                          </button>
                        </TableCell>

                        {/* 勤怠明細入力 */}
                        {[
                          { field: 'workDays', label: '平日', desc: '月間（平日）の出勤日数。1日の勤務としてカウント。' },
                          { field: 'saturdayWorkDays', label: '土曜', desc: '月間の土曜出勤日数。日給が平時と異なる場合があります。' },
                          { field: 'sundayWorkHours', label: '日曜', desc: '月間の日曜勤務時間（h）。時給ベースで加算されます。' },
                          { field: 'absenceDays', label: '欠勤', className: 'bg-red-50/5 text-red-700', desc: '月間の欠勤日数。給与から控除対象となる場合があります。' },
                          { field: 'overtimeHours', label: '残業', desc: '1日の実働8時間を超えた累計残業時間。' },
                          { field: 'lateNightHours', label: '深夜', desc: '22時〜翌5時の深夜勤務累計時間。' },
                          { field: 'holidayWorkDays', label: '休日', border: 'border-r-2 border-r-emerald-200/30', desc: '祝日などの休日出勤日数。' },
                        ].map(col => {
                          const error = validationErrors[emp.id]?.[col.field];
                          const prevVal = getPrevValue(emp.id, col.field);
                          return (
                            <TableCell key={col.field} className={`p-1 align-top ${col.className || ""} ${col.border || ""}`}>
                              <TooltipInput
                                description={col.desc}
                                type="number"
                                step="0.5"
                                className={`h-8 text-right text-xs px-1 border-transparent hover:border-border focus:bg-white ${error ? 'border-red-500 bg-red-50/50' : ''}`}
                                value={rowData[col.field] ?? ""}
                                onChange={(e) => handleEditChange(emp.id, col.field, e.target.value)}
                              />
                              {prevVal !== null && (
                                <div className="text-[9px] text-muted-foreground text-right px-1 mt-0.5 opacity-60">
                                  前: {prevVal}
                                </div>
                              )}
                              {error && <div className="text-[8px] text-red-500 text-right px-1 font-bold leading-tight">{error}</div>}
                            </TableCell>
                          );
                        })}

                        {/* 運行明細入力 */}
                        {[
                          { field: 'drivingDistanceKm', label: '距離', desc: '月間の総走行距離（km）。' },
                          { field: 'deliveryCases', label: '件数', border: 'border-r-2 border-r-blue-200/30', desc: '月間の総配達・件数実績。' },
                        ].map(col => {
                          const error = validationErrors[emp.id]?.[col.field];
                          const prevVal = getPrevValue(emp.id, col.field);
                          return (
                            <TableCell key={col.field} className={`p-1 align-top bg-blue-50/10 ${col.border || ""}`}>
                              <TooltipInput
                                description={col.desc}
                                type="number"
                                className={`h-8 text-right text-xs px-1 border-transparent hover:border-border focus:bg-white ${error ? 'border-red-500 bg-red-50/50' : ''}`}
                                value={rowData[col.field] ?? ""}
                                onChange={(e) => handleEditChange(emp.id, col.field, e.target.value)}
                              />
                              {prevVal !== null && (
                                <div className="text-[9px] text-muted-foreground text-right px-1 mt-0.5 opacity-60">
                                  前: {prevVal}
                                </div>
                              )}
                            </TableCell>
                          );
                        })}

                        {/* 給与計算明細入力 */}
                        <TableCell className="p-1 align-top bg-orange-50/10">
                          <TooltipInput
                            description="月間の総売上金額（円）。歩合計算の基礎となります。"
                            type="number"
                            className={`h-8 text-right text-xs px-1 border-transparent hover:border-border focus:bg-white font-bold text-orange-900 ${validationErrors[emp.id]?.salesAmount ? 'border-red-500 bg-red-50/50' : ''}`}
                            value={rowData.salesAmount ?? ""}
                            onChange={(e) => handleEditChange(emp.id, 'salesAmount', e.target.value)}
                          />
                          {getPrevValue(emp.id, 'salesAmount') !== null && (
                            <div className="text-[9px] text-muted-foreground text-right px-1 mt-0.5 opacity-60">
                              前: {Number(getPrevValue(emp.id, 'salesAmount')).toLocaleString()}
                            </div>
                          )}
                          {validationErrors[emp.id]?.salesAmount && <div className="text-[8px] text-red-500 text-right px-1 font-bold">{validationErrors[emp.id].salesAmount}</div>}
                        </TableCell>
                        <TableCell className="p-1 align-top bg-orange-50/10">
                          <TooltipInput
                            description="売上に対する歩合支給の割合。"
                            type="number"
                            step="0.1"
                            className="h-8 text-right text-xs px-1 border-transparent hover:border-border focus:bg-white"
                            value={rowData.commissionRate ? (rowData.commissionRate * 100).toFixed(1) : ""}
                            onChange={(e) => { const pct = parseFloat(e.target.value) || 0; handleEditChange(emp.id, 'commissionRate', String(pct / 100)); }}
                          />
                          {getPrevValue(emp.id, 'commissionRate') !== null && (
                            <div className="text-[9px] text-muted-foreground text-right px-1 mt-0.5 opacity-60">
                              前: {getPrevValue(emp.id, 'commissionRate')}%
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={`p-1 align-top ${isBW ? 'bg-blue-100/30' : 'bg-muted/5 opacity-40'}`}>
                          {isBW ? (
                            <>
                              <TooltipInput
                                description="ブルーウィング案件の専用売上。"
                                type="number"
                                className={`h-8 text-right text-xs px-1 border-transparent hover:border-blue-300 focus:bg-white font-bold text-blue-900 ${validationErrors[emp.id]?.bluewingSalesAmount ? 'border-red-500 bg-red-50/50' : ''}`}
                                value={rowData.bluewingSalesAmount ?? ""}
                                onChange={(e) => handleEditChange(emp.id, 'bluewingSalesAmount', e.target.value)}
                              />
                              {getPrevValue(emp.id, 'bluewingSalesAmount') !== null && (
                                <div className="text-[9px] text-muted-foreground text-right px-1 mt-0.5 opacity-60">
                                  前: {Number(getPrevValue(emp.id, 'bluewingSalesAmount')).toLocaleString()}
                                </div>
                              )}
                              {validationErrors[emp.id]?.bluewingSalesAmount && <div className="text-[8px] text-red-500 text-right px-1 font-bold">{validationErrors[emp.id].bluewingSalesAmount}</div>}
                            </>
                          ) : (
                            <div className="h-8 flex items-center justify-center text-[10px] text-muted-foreground italic">除外</div>
                          )}
                        </TableCell>

                        {/* シミュレーション領域 */}
                        <TableCell className="sticky right-0 z-20 bg-card border-l-2 border-l-primary/30 shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.1)] p-0 group-hover:bg-muted/5 min-w-[140px]">
                          <div className="flex flex-col justify-center px-3 py-1.5 min-h-[60px]">
                            {previews[emp.id]?.status === 'loading' ? (
                              <div className="flex items-center justify-end gap-2 text-muted-foreground/40 italic text-[10px]">
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                計算中
                              </div>
                            ) : previews[emp.id]?.status === 'invalid' ? (
                              <div className="text-right text-[10px] text-orange-500 font-bold">要修正</div>
                            ) : previews[emp.id]?.status === 'error' ? (
                              <div className="text-right text-[10px] text-red-500 font-bold">計算失敗</div>
                            ) : previews[emp.id]?.status === 'success' ? (
                              <div className="space-y-0.5">
                                <div className="flex justify-between text-[9px] text-muted-foreground">
                                  <span>総支給</span>
                                  <span>¥{Math.round(previews[emp.id].grossSalary).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-[9px] text-muted-foreground border-b border-border/30 pb-0.5">
                                  <span>控除</span>
                                  <span>¥{Math.round(previews[emp.id].totalDeductions).toLocaleString()}</span>
                                </div>
                                <div className="text-right font-bold text-[13px] text-primary tabular-nums mt-0.5">
                                  ¥{Math.round(previews[emp.id].netSalary).toLocaleString()}
                                </div>
                                {prevPayrolls?.find(p => p.employeeId === emp.id) && (
                                  <div className={`text-right text-[9px] font-medium ${(previews[emp.id].netSalary - (prevPayrolls.find(p => p.employeeId === emp.id)?.netSalary ?? 0)) >= 0
                                      ? "text-emerald-600"
                                      : "text-red-600"
                                    }`}>
                                    前月比: {(previews[emp.id].netSalary - (prevPayrolls.find(p => p.employeeId === emp.id)?.netSalary ?? 0)) >= 0 ? "+" : ""}
                                    {Math.round(previews[emp.id].netSalary - (prevPayrolls.find(p => p.employeeId === emp.id)?.netSalary ?? 0)).toLocaleString()}
                                  </div>
                                )}
                                <div className="text-[8px] text-muted-foreground/60 text-right mt-1 leading-tight">
                                  ※社保は標準報酬ベースで固定
                                </div>
                              </div>
                            ) : (
                              <div className="text-right text-[10px] text-muted-foreground/30 italic">要入力</div>
                            )}
                          </div>
                        </TableCell>

                        {/* 備考メモ */}
                        <TableCell className="p-1">
                          <Input className="h-8 w-full text-[11px] px-2 border-transparent hover:border-border focus:bg-white" placeholder="..." value={rowData.notes || ""} onChange={(e) => handleEditChange(emp.id, 'notes', e.target.value)} />
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
