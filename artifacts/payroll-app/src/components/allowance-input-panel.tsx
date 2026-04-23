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
import { Plus, X } from "lucide-react";
import { calculateIncomeTaxReiwa8, getInsuranceGrade, round50sen, calculateSocialInsurance } from "@/lib/tax-tables-reiwa8";

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

  type AllowanceRow = { defId: number | null; amount: number };
  const [rows, setRows] = useState<AllowanceRow[]>([{ defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState<number>(0);
  const baseSalaryRef = useRef<HTMLInputElement>(null);
  const rowAmountRefs = useRef<(HTMLInputElement | null)[]>([]);

  type DeductionRow = { defId: number | null; amount: number };
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ defId: null, amount: 0 }]);
  const deductionRowAmountRefs = useRef<(HTMLInputElement | null)[]>([]);

  const focusRowAmount = (idx: number) => {
    setTimeout(() => {
      const el = rowAmountRefs.current[idx];
      if (el) { el.focus(); el.select(); }
    }, 30);
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
      // 日給制かつ baseSalary 未設定の場合のみ自動計算値を使用
      setBaseSalaryInput(computedDailyBaseSalary);
    } else {
      // 手動設定値（または固定給）を優先
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
  const totalRows = rows.length + 3;

    // ────────────────────────────────────────────────────────────────
  // 社会保険料の計算（令和8年版テーブル参照に統一）
  // ────────────────────────────────────────────────────────────────
  const empSR = (employee as unknown as { standardRemuneration?: number }).standardRemuneration ?? 0;
  const gradeBase = empSR > 0 ? empSR : grandTotal;
  
  const socIns = calculateSocialInsurance(gradeBase, { careInsuranceApplied: employee.careInsuranceApplied ?? false });
  const healthInsurance = socIns.healthInsurance;
  const pensionInsurance = socIns.pension;

  // 雇用保険：grossSalary × 0.55%（全社員統一）
  const employmentInsurance = (employee.employmentInsuranceApplied !== false)
    ? round50sen(grandTotal * 0.0055)
    : 0;

  const totalInsurance = healthInsurance + pensionInsurance + employmentInsurance;

  // ────────────────────────────────────────────────────────────────
  // 源泉所得税（令和8年月額表甲欄）
  // ────────────────────────────────────────────────────────────────
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

  // 控除合計・差引: パネル入力値からリアルタイム計算（令和8年ベース）
  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal + otherDeductionFixed);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

  // BW社員フラグ（UI表示用のみ）
  const isBwEmployee = !!(employee as unknown as { useBluewingLogic?: boolean }).useBluewingLogic;

  const fmt = (v: number) => v > 0 ? v.toLocaleString("ja-JP") : v === 0 ? "0" : "—";

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
    <div className="flex flex-col gap-0">
      <div className="overflow-x-auto">
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
            {/* 支給セクション */}
            <tr className="bg-background">
              {sectionLabel("支　給", totalRows)}
              <td className="border border-border px-2 py-1">
                <div className="font-medium">基本給</div>
                {isDaily && (
                  <div className="text-muted-foreground leading-tight" style={{ fontSize: "9px" }}>日給制（手動設定可）</div>
                )}
              </td>
              <td className="border border-border px-1 py-1 text-center">
                <span className="px-1 py-0.5 rounded border bg-red-50 text-red-700 border-red-200" style={{ fontSize: "10px" }}>課税</span>
              </td>
              <td className="border border-border px-1 py-0.5">
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
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); focusRowAmount(0); }
                  }}
                  placeholder="0"
                />
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
                        type="text"
                        inputMode="numeric"
                        className="h-6 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                        value={row.amount || ""}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          const v = raw === "" ? 0 : parseInt(raw, 10);
                          setRows(prev => prev.map((r, i) => i === idx ? { ...r, amount: isNaN(v) ? 0 : v } : r));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
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

            <tr className="bg-blue-50 font-semibold">
              <td className="border border-border px-2 py-1.5 text-muted-foreground text-center" colSpan={2}>
                総支給金額
                {isBwEmployee && (
                  <span className="ml-1 text-xs text-blue-600 font-normal">※BW分除く</span>
                )}
              </td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums font-bold text-blue-800">
                {grandTotal > 0 ? grandTotal.toLocaleString("ja-JP") : "—"}
              </td>
            </tr>

            {/* 控除（社会保険料）セクション */}
            <tr className="bg-background">
              {sectionLabel("控　除", 5)}
              <td className="border border-border px-2 py-1 text-muted-foreground">健康保険料</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(healthInsurance)}</td>
            </tr>
            <tr className="bg-muted/20">
              <td className="border border-border px-2 py-1 text-muted-foreground">厚生年金保険料</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(pensionInsurance)}</td>
            </tr>
            <tr className="bg-background">
              <td className="border border-border px-2 py-1 text-muted-foreground">雇用保険料</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(employmentInsurance)}</td>
            </tr>
            <tr className="bg-muted/20">
              <td className="border border-border px-2 py-1 text-muted-foreground font-medium" colSpan={2}>
                社会保険料控除後の金額
              </td>
              <td className="border border-border px-2 py-1.5 text-right tabular-nums font-medium">{fmt(afterInsuranceSalary)}</td>
            </tr>
            <tr className="bg-orange-50 font-semibold">
              <td className="border border-border px-2 py-1.5 text-center text-muted-foreground" colSpan={2}>社会保険料合計</td>
              <td className="border border-border px-2 py-1.5 text-right tabular-nums text-orange-800 font-bold">{fmt(totalInsurance)}</td>
            </tr>

            {/* 差引金額セクション */}
            <tr className="bg-background">
              {sectionLabel("差引金額", 2 + deductionRows.length + 1 + 2)}
              <td className="border border-border px-2 py-1 text-muted-foreground">所得税</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(incomeTax)}</td>
            </tr>
            <tr className="bg-muted/20">
              <td className="border border-border px-2 py-1 text-muted-foreground">市町村民税</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(residentTax)}</td>
            </tr>

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
                      type="text"
                      inputMode="numeric"
                      className="h-6 flex-1 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs"
                      value={row.amount || ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        const v = raw === "" ? 0 : parseInt(raw, 10);
                        setDeductionRows(prev => prev.map((r, i) => i === idx ? { ...r, amount: isNaN(v) ? 0 : v } : r));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const focusDeduction = (i: number) => {
                            setTimeout(() => {
                              const el = deductionRowAmountRefs.current[i];
                              if (el) { el.focus(); el.select(); }
                            }, 30);
                          };
                          if (idx + 1 < deductionRows.length) {
                            focusDeduction(idx + 1);
                          } else {
                            setDeductionRows(prev => [...prev, { defId: null, amount: 0 }]);
                            focusDeduction(idx + 1);
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
              <td className="border border-border px-2 py-1.5 text-right tabular-nums text-red-700 font-bold">{fmt(totalDeductions)}</td>
            </tr>
            <tr className="bg-green-50 font-bold">
              <td className="border border-border px-2 py-1.5 text-center font-semibold" colSpan={2}>差引支給額</td>
              <td className="border border-border px-2 py-1.5 text-right tabular-nums text-green-800 text-sm font-extrabold">{fmt(netSalary)}</td>
            </tr>
          </tbody>
        </table>

        {isBwEmployee && (
          <div className="mx-0 mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
            <strong>BW社員:</strong> 上記は基本給・手当のみ。時間外手当・業績手当（BW計算）は「給与明細」タブで確認してください。
          </div>
        )}
        {company && (
          <div className="mx-0 mt-2 mb-1 px-3 py-2 bg-muted/40 border rounded text-xs text-muted-foreground">
            適用料率：健保・厚年は「令和8年度 保険料額表」ベース・雇保 0.55%
            {empSR > 0 && (
              <span className="ml-2 text-blue-600">（標準報酬月額 {empSR.toLocaleString("ja-JP")} 円等級）</span>
            )}
          </div>
        )}
      </div>

      <div className="border-t pt-3 mt-2">
        <Button
          className="w-full"
          onClick={handleSave}
          disabled={updateAllowances.isPending || updateDeductions.isPending}
        >
          保存
        </Button>
      </div>
    </div>
  );
}
