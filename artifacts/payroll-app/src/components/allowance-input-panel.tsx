import { useState, useEffect, useRef } from "react";
import {
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
  Employee,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X, GripVertical } from "lucide-react";
import { calculateIncomeTaxReiwa8, round50sen, calculateSocialInsurance } from "@/lib/tax-tables-reiwa8";
import { Reorder } from "framer-motion";

function roundJapanese(amount: number): number {
  return Math.floor(amount);
}

interface Props {
  employee: Employee;
  monthlyData?: { workDays: number; saturdayWorkDays: number; sundayWorkHours: number };
}

export function AllowanceInputPanel({ employee, monthlyData }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const employeeId = employee.id;

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
    setTimeout(() => {
      const el = rowAmountRefs.current[id];
      if (el) { el.focus(); el.select(); }
    }, 30);
  };
  const focusDeductionRowAmount = (id: string) => {
    setTimeout(() => {
      const el = deductionRowAmountRefs.current[id];
      if (el) { el.focus(); el.select(); }
    }, 30);
  };

  useEffect(() => {
    if (employeeAllowances && employeeAllowances.length > 0) {
      setRows(employeeAllowances.map(a => ({
        id: `a-${a.id}-${Math.random()}`,
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
        id: `d-${d.id}-${Math.random()}`,
        defId: d.deductionDefinitionId,
        amount: d.amount
      })));
    } else {
      setDeductionRows([{ id: Math.random().toString(36).substr(2, 9), defId: null, amount: 0 }]);
    }
  }, [employeeDeductions, employeeId]);

  const isDaily = employee.salaryType === "daily";
  const computedDailyBaseSalary = isDaily && company
    ? Math.round(
        (monthlyData?.workDays ?? 0) * (company.dailyWageWeekday ?? 9808) +
        (monthlyData?.saturdayWorkDays ?? 0) * (company.dailyWageSaturday ?? 12260) +
        (monthlyData?.sundayWorkHours ?? 0) * (company.hourlyWageSunday ?? 1655)
      )
    : null;

  useEffect(() => {
    if (isDaily && computedDailyBaseSalary !== null && (employee.baseSalary ?? 0) === 0) {
      setBaseSalaryInput(computedDailyBaseSalary);
    } else {
      setBaseSalaryInput(employee.baseSalary ?? 0);
    }
  }, [employee.baseSalary, employeeId, isDaily, computedDailyBaseSalary]);

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
      toast({ title: "保存しました", description: `${employee.name}の基本給・手当・差引を更新しました。` });
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;

  const empSR = (employee as unknown as { standardRemuneration?: number }).standardRemuneration ?? 0;
  const gradeBase = empSR > 0 ? empSR : grandTotal;
  
  const socIns = calculateSocialInsurance(gradeBase, { careInsuranceApplied: employee.careInsuranceApplied ?? false });
  const healthInsurance = socIns.healthInsurance;
  const pensionInsurance = socIns.pension;

  const employmentInsurance = (employee.employmentInsuranceApplied !== false)
    ? round50sen(grandTotal * 0.0055)
    : 0;

  const totalInsurance = healthInsurance + pensionInsurance + employmentInsurance;

  const nonTaxableAllowancesTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions?.find(d => d.id === r.defId);
    return s + (def?.isTaxable === false ? (r.amount || 0) : 0);
  }, 0);

  const afterInsuranceSalary = Math.max(0, grandTotal - nonTaxableAllowancesTotal - totalInsurance);
  const dependentEquivCount = (employee.dependentCount ?? 0) + ((employee.hasSpouse ?? false) ? 1 : 0);
  const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);

  const residentTax = employee.residentTax ?? 0;
  const customDeductionsTotal = deductionRows.reduce((s, r) => s + (r.amount || 0), 0);
  const otherDeductionFixed = (employee as unknown as { otherDeductionMonthly?: number }).otherDeductionMonthly ?? 0;

  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal + otherDeductionFixed);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

  const isBwEmployee = !!(employee as unknown as { useBluewingLogic?: boolean }).useBluewingLogic;
  const fmt = (v: number) => v > 0 ? v.toLocaleString("ja-JP") : v === 0 ? "0" : "—";

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="flex-1 overflow-y-auto pt-1 pb-4 px-1">
        <div className="grid grid-cols-[22px_24px_1fr_42px_100px] border border-border bg-background shadow-sm rounded-sm overflow-hidden text-xs">
          {/* Header */}
          <div className="border-b border-r bg-muted/60 py-1.5"></div>
          <div className="border-b border-r bg-muted/60 py-1.5"></div>
          <div className="border-b border-r bg-muted/60 px-2 py-1.5 font-medium text-muted-foreground text-center">名称</div>
          <div className="border-b border-r bg-muted/60 px-1 py-1.5 text-center font-medium text-muted-foreground">課税</div>
          <div className="border-b bg-muted/60 px-2 py-1.5 text-right font-medium text-muted-foreground">金額（円）</div>

          {/* 支 給 セクション */}
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

          {/* 基本給 */}
          <div className="col-start-2 border-b border-r bg-background/50"></div>
          <div className="col-start-3 border-b border-r px-2 py-1 bg-background/50 flex flex-col justify-center">
            <div className="font-medium">基本給</div>
            {isDaily && (
              <div className="text-muted-foreground leading-tight" style={{ fontSize: "9px" }}>日給制（手動設定可）</div>
            )}
          </div>
          <div className="border-b border-r px-1 py-1 text-center bg-background/50 flex items-center justify-center">
            <span className="px-1 py-0.5 rounded border bg-red-50 text-red-700 border-red-200" style={{ fontSize: "10px" }}>課税</span>
          </div>
          <div className="border-b px-1 py-0.5 bg-background/50">
            <Input
              ref={baseSalaryRef}
              type="number"
              className="h-7 w-full text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs font-medium"
              value={baseSalaryInput || ""}
              onChange={(e) => setBaseSalaryInput(parseInt(e.target.value, 10) || 0)}
              onKeyDown={(e) => e.key === "Enter" && rows.length > 0 && focusRowAmount(rows[0].id)}
            />
          </div>

          <Reorder.Group axis="y" values={rows} onReorder={setRows} as="div" className="col-start-2 col-span-4 contents">
            {rows.map((row) => {
              const def = allowanceDefinitions?.find(d => d.id === row.defId);
              return (
                <Reorder.Item
                  key={row.id}
                  value={row}
                  as="div"
                  className="col-start-2 col-span-4 grid grid-cols-[24px_1fr_42px_100px] group cursor-grab active:cursor-grabbing border-b border-border bg-background"
                  whileDrag={{ scale: 1.01, backgroundColor: "var(--muted)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 50, position: "relative" }}
                >
                  <div className="border-r flex items-center justify-center bg-muted/5 group-hover:bg-muted/10 transition-colors">
                    <GripVertical className="h-4 w-4 text-muted-foreground/80 group-hover:text-primary transition-colors" />
                  </div>
                  <div className="border-r px-1 py-0.5 flex items-center relative">
                    <Select value={row.defId?.toString() ?? ""} onValueChange={(v) => setRows(prev => prev.map(r => r.id === row.id ? { ...r, defId: parseInt(v, 10) } : r))}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full text-left">
                        <SelectValue placeholder="手当を選択…" />
                      </SelectTrigger>
                      <SelectContent>
                        {allowanceDefinitions?.map(d => (
                          <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="border-r px-1 py-1 text-center flex items-center justify-center font-bold">
                    {def ? (
                      <span className={`px-1 py-0.5 rounded border ${def.isTaxable ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`} style={{ fontSize: "10px" }}>
                        {def.isTaxable ? "課税" : "非課税"}
                      </span>
                    ) : null}
                  </div>
                  <div className="px-1 py-0.5 flex items-center gap-0.5">
                    <Input
                      ref={(el) => { rowAmountRefs.current[row.id] = el; }}
                      type="text"
                      inputMode="numeric"
                      className="h-7 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                      value={row.amount || ""}
                      onChange={(e) => {
                        const v = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0;
                        setRows(prev => prev.map(r => r.id === row.id ? { ...r, amount: v } : r));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const idx = rows.findIndex(r => r.id === row.id);
                          if (idx + 1 < rows.length) focusRowAmount(rows[idx+1].id);
                          else {
                            const newId = Math.random().toString(36).substr(2, 9);
                            setRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]);
                            setTimeout(() => focusRowAmount(newId), 30);
                          }
                        }
                      }}
                    />
                    <button type="button" onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))} className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                  </div>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>

          <div className="col-start-2 col-span-4 border-b bg-muted/5 px-2 py-1.5 flex items-center">
            <button type="button" onClick={() => { const newId = Math.random().toString(36).substr(2, 9); setRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]); setTimeout(() => focusRowAmount(newId), 30); }} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium">
              <Plus className="h-3.5 w-3.5" /> 手当行を追加
            </button>
          </div>

          <div className="col-start-2 col-span-3 border-b border-r bg-blue-50/50 px-2 py-2 text-muted-foreground font-semibold flex items-center justify-center">
            総支給金額 {isBwEmployee && <span className="ml-1 text-[10px] text-blue-600 font-normal">(※BW分除く)</span>}
          </div>
          <div className="border-b bg-blue-50/50 px-2 py-2 text-right tabular-nums font-bold text-blue-800 text-sm">{fmt(grandTotal)}</div>

          {/* 控 除 セクション */}
          <div className="border-r bg-muted/30 flex items-center justify-center font-medium" style={{ writingMode: "vertical-rl", letterSpacing: "0.15em", padding: "6px 3px", fontSize: "11px", gridRow: "span 5" }}>控　除</div>
          <div className="col-start-2 col-span-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">健康保険料</div>
          <div className="col-start-4 border-b border-r bg-background"></div>
          <div className="border-b px-2 py-1.5 text-right tabular-nums bg-background">{fmt(healthInsurance)}</div>
          <div className="col-start-2 col-span-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-muted/5">厚生年金保険料</div>
          <div className="col-start-4 border-b border-r bg-muted/5"></div>
          <div className="border-b px-2 py-1.5 text-right tabular-nums bg-muted/5">{fmt(pensionInsurance)}</div>
          <div className="col-start-2 col-span-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">雇用保険料</div>
          <div className="col-start-4 border-b border-r bg-background"></div>
          <div className="border-b px-2 py-1.5 text-right tabular-nums bg-background">{fmt(employmentInsurance)}</div>
          <div className="col-start-2 col-span-3 border-b border-r px-2 py-1.5 text-muted-foreground font-medium bg-muted/5 text-center">社会保険料控除後の金額</div>
          <div className="border-b px-2 py-1.5 text-right tabular-nums font-medium bg-muted/5">{fmt(afterInsuranceSalary)}</div>
          <div className="col-start-2 col-span-3 border-b border-r px-2 py-2 text-center text-muted-foreground font-semibold bg-orange-50/50 text-sm">社会保険料合計</div>
          <div className="border-b px-2 py-2 text-right tabular-nums text-orange-800 font-bold bg-orange-50/50">{fmt(totalInsurance)}</div>

          {/* 差引金額セクション */}
          <div className="border-r bg-muted/30 flex items-center justify-center font-medium" style={{ writingMode: "vertical-rl", letterSpacing: "0.15em", padding: "6px 3px", fontSize: "11px", gridRow: `span ${2 + deductionRows.length + 1 + 2}` }}>差引金額</div>
          <div className="col-start-2 col-span-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-background">所得税</div>
          <div className="col-start-4 border-b border-r bg-background"></div>
          <div className="border-b px-2 py-1.5 text-right tabular-nums bg-background">{fmt(incomeTax)}</div>
          <div className="col-start-2 col-span-2 border-b border-r px-2 py-1.5 text-muted-foreground bg-muted/5">市町村民税</div>
          <div className="col-start-4 border-b border-r bg-muted/5"></div>
          <div className="border-b px-2 py-1.5 text-right tabular-nums bg-muted/5">{fmt(residentTax)}</div>

          <Reorder.Group axis="y" values={deductionRows} onReorder={setDeductionRows} as="div" className="col-start-2 col-span-4 contents">
            {deductionRows.map((row) => (
              <Reorder.Item key={row.id} value={row} as="div" className="col-start-2 col-span-4 grid grid-cols-[24px_1fr_42px_100px] group cursor-grab active:cursor-grabbing border-b border-border bg-background" whileDrag={{ scale: 1.01, backgroundColor: "var(--muted)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 50, position: "relative" }}>
                <div className="border-r flex items-center justify-center bg-muted/5 group-hover:bg-muted/10 transition-colors">
                  <GripVertical className="h-4 w-4 text-muted-foreground/80 group-hover:text-primary transition-colors" />
                </div>
                <div className="border-r px-1 py-0.5 flex items-center relative">
                  <Select value={row.defId?.toString() ?? ""} onValueChange={(v) => setDeductionRows(prev => prev.map(r => r.id === row.id ? { ...r, defId: parseInt(v, 10) } : r))}>
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full text-left">
                      <SelectValue placeholder="項目を選択…" />
                    </SelectTrigger>
                    <SelectContent>
                      {deductionDefinitions?.map(d => (
                        <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-r bg-background col-span-2"></div>
                <div className="px-1 py-0.5 flex items-center gap-0.5 bg-background">
                  <Input
                    ref={(el) => { deductionRowAmountRefs.current[row.id] = el; }}
                    type="text"
                    inputMode="numeric"
                    className="h-7 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                    value={row.amount || ""}
                    onChange={(e) => {
                      const v = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0;
                      setDeductionRows(prev => prev.map(r => r.id === row.id ? { ...r, amount: v } : r));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const idx = deductionRows.findIndex(r => r.id === row.id);
                        if (idx + 1 < deductionRows.length) focusDeductionRowAmount(deductionRows[idx+1].id);
                        else {
                          const newId = Math.random().toString(36).substr(2, 9);
                          setDeductionRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]);
                          setTimeout(() => focusDeductionRowAmount(newId), 30);
                        }
                      }
                    }}
                  />
                  <button type="button" onClick={() => setDeductionRows(prev => prev.filter(r => r.id !== row.id))} className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          <div className="col-start-2 col-span-4 border-b bg-muted/5 px-2 py-1.5 flex items-center">
            <button type="button" onClick={() => { const newId = Math.random().toString(36).substr(2, 9); setDeductionRows(prev => [...prev, { id: newId, defId: null, amount: 0 }]); setTimeout(() => focusDeductionRowAmount(newId), 30); }} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium">
              <Plus className="h-3.5 w-3.5" /> 差引行を追加
            </button>
          </div>

          <div className="col-start-2 col-span-3 border-b border-r bg-muted/10 px-2 py-2 text-center text-muted-foreground font-semibold">差引合計額</div>
          <div className="border-b px-2 py-2 text-right tabular-nums text-red-700 font-bold bg-muted/10">{fmt(totalDeductions)}</div>
          <div className="col-start-2 col-span-3 bg-green-50/60 px-2 py-2 text-center font-bold text-green-900 border-r border-green-100 text-sm">差引支給額</div>
          <div className="bg-green-50/60 px-2 py-2 text-right tabular-nums text-green-800 font-extrabold text-base border-green-100">{fmt(netSalary)}</div>
        </div>

        {isBwEmployee && (
          <div className="mx-0 mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-[10px] text-blue-700 leading-relaxed italic">
            <strong>BW社員:</strong> 時間外手当・業績手当（BW計算）は「給与明細」タブで確認してください。
          </div>
        )}
      </div>

      <div className="border-t pt-3 mt-auto bg-background/80 backdrop-blur-sm sticky bottom-0">
        <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-5 rounded-md shadow-lg transition-all active:scale-[0.98]" onClick={handleSave} disabled={updateAllowances.isPending || updateDeductions.isPending}>
          {updateAllowances.isPending || updateDeductions.isPending ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
