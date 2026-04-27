import { useState, useEffect, useRef, useCallback } from "react";
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
import { Reorder, useDragControls } from "framer-motion";
import { calculateIncomeTaxReiwa8, getInsuranceGrade, round50sen } from "@/lib/tax-tables-reiwa8";

function roundJapanese(amount: number): number {
  return Math.floor(amount);
}

let uidCounter = 0;
function newUid() {
  return `row-${Date.now()}-${++uidCounter}`;
}

interface Props {
  employee: Employee;
  monthlyData?: { workDays: number; saturdayWorkDays: number; sundayWorkHours: number };
}

type AllowanceRow = { uid: string; defId: number | null; amount: number };
type DeductionRow = { uid: string; defId: number | null; amount: number };

/* ── ドラッグハンドル付き手当行 ── */
function AllowanceReorderItem({
  row,
  allowanceDefinitions,
  onChange,
  onDelete,
}: {
  row: AllowanceRow;
  allowanceDefinitions: { id: number; name: string; isTaxable: boolean }[] | undefined;
  onChange: (uid: string, patch: Partial<AllowanceRow>) => void;
  onDelete: (uid: string) => void;
}) {
  const controls = useDragControls();
  const def = allowanceDefinitions?.find(d => d.id === row.defId);

  return (
    <Reorder.Item
      key={row.uid}
      value={row}
      dragListener={false}
      dragControls={controls}
      className="list-none"
      whileDrag={{ scale: 1.025, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", zIndex: 50, borderRadius: "8px", backgroundColor: "hsl(var(--background))" }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-background hover:bg-primary/5 transition-colors border-b border-border/50 group">
        {/* ドラッグハンドル */}
        <div
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0"
          title="ドラッグして並び替え"
        >
          <GripVertical className="h-4 w-4" />
        </div>

        {/* 名称 */}
        <div className="flex-1 min-w-0">
          <Select
            value={row.defId?.toString() ?? ""}
            onValueChange={(v) => onChange(row.uid, { defId: parseInt(v, 10) })}
          >
            <SelectTrigger className="h-7 text-xs border border-border/60 bg-transparent focus:ring-1 focus:ring-primary px-2 w-full rounded">
              <SelectValue placeholder="手当を選択…" />
            </SelectTrigger>
            <SelectContent>
              {allowanceDefinitions?.map(d => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 課税バッジ */}
        <div className="w-[44px] text-center shrink-0">
          {def && (
            <span
              className={`px-1 py-0.5 rounded border font-medium ${def.isTaxable ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}
              style={{ fontSize: "9px" }}
            >
              {def.isTaxable ? "課税" : "非課税"}
            </span>
          )}
        </div>

        {/* 金額 */}
        <div className="w-24 shrink-0">
          <Input
            type="text"
            inputMode="numeric"
            className="h-7 w-full text-right border border-border/60 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-2 text-xs rounded"
            value={row.amount || ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, "");
              onChange(row.uid, { amount: raw === "" ? 0 : parseInt(raw, 10) });
            }}
            placeholder="0"
          />
        </div>

        {/* 削除 */}
        <button
          type="button"
          onClick={() => onDelete(row.uid)}
          className="text-muted-foreground/40 hover:text-destructive transition-colors p-0.5 shrink-0"
          title="削除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}

/* ── ドラッグハンドル付き差引行 ── */
function DeductionReorderItem({
  row,
  deductionDefinitions,
  onChange,
  onDelete,
}: {
  row: DeductionRow;
  deductionDefinitions: { id: number; name: string }[] | undefined;
  onChange: (uid: string, patch: Partial<DeductionRow>) => void;
  onDelete: (uid: string) => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      key={row.uid}
      value={row}
      dragListener={false}
      dragControls={controls}
      className="list-none"
      whileDrag={{ scale: 1.025, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", zIndex: 50, borderRadius: "8px", backgroundColor: "hsl(var(--background))" }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-background hover:bg-primary/5 transition-colors border-b border-border/50 group">
        {/* ドラッグハンドル */}
        <div
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0"
          title="ドラッグして並び替え"
        >
          <GripVertical className="h-4 w-4" />
        </div>

        {/* 名称 */}
        <div className="flex-1 min-w-0">
          <Select
            value={row.defId?.toString() ?? ""}
            onValueChange={(v) => onChange(row.uid, { defId: parseInt(v, 10) })}
          >
            <SelectTrigger className="h-7 text-xs border border-border/60 bg-transparent focus:ring-1 focus:ring-primary px-2 w-full rounded">
              <SelectValue placeholder="差引を選択…" />
            </SelectTrigger>
            <SelectContent>
              {deductionDefinitions?.map(d => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 空 (課税列の幅合わせ) */}
        <div className="w-[44px] shrink-0" />

        {/* 金額 */}
        <div className="w-24 shrink-0">
          <Input
            type="text"
            inputMode="numeric"
            className="h-7 w-full text-right border border-border/60 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-2 text-xs rounded"
            value={row.amount || ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, "");
              onChange(row.uid, { amount: raw === "" ? 0 : parseInt(raw, 10) });
            }}
            placeholder="0"
          />
        </div>

        {/* 削除 */}
        <button
          type="button"
          onClick={() => onDelete(row.uid)}
          className="text-muted-foreground/40 hover:text-destructive transition-colors p-0.5 shrink-0"
          title="削除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
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

  const [rows, setRows] = useState<AllowanceRow[]>([{ uid: newUid(), defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState<number>(0);
  const baseSalaryRef = useRef<HTMLInputElement>(null);

  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ uid: newUid(), defId: null, amount: 0 }]);

  useEffect(() => {
    if (employeeAllowances && employeeAllowances.length > 0) {
      setRows(employeeAllowances.map(a => ({ uid: newUid(), defId: a.allowanceDefinitionId, amount: a.amount })));
    } else {
      setRows([{ uid: newUid(), defId: null, amount: 0 }]);
    }
  }, [employeeAllowances, employeeId]);

  useEffect(() => {
    if (employeeDeductions && employeeDeductions.length > 0) {
      setDeductionRows(employeeDeductions.map(d => ({ uid: newUid(), defId: d.deductionDefinitionId, amount: d.amount })));
    } else {
      setDeductionRows([{ uid: newUid(), defId: null, amount: 0 }]);
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

  const handleAllowanceChange = useCallback((uid: string, patch: Partial<AllowanceRow>) => {
    setRows(prev => prev.map(r => r.uid === uid ? { ...r, ...patch } : r));
  }, []);

  const handleAllowanceDelete = useCallback((uid: string) => {
    setRows(prev => prev.filter(r => r.uid !== uid));
  }, []);

  const handleDeductionChange = useCallback((uid: string, patch: Partial<DeductionRow>) => {
    setDeductionRows(prev => prev.map(r => r.uid === uid ? { ...r, ...patch } : r));
  }, []);

  const handleDeductionDelete = useCallback((uid: string) => {
    setDeductionRows(prev => prev.filter(r => r.uid !== uid));
  }, []);

  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;

  const healthInsuranceRate = company?.healthInsuranceEmployeeRate ?? 0.0575;
  const careInsuranceRate = company?.careInsuranceRate ?? 0.0091;
  const pensionRate = company?.pensionEmployeeRate ?? 0.0915;

  const empSR = (employee as unknown as { standardRemuneration?: number }).standardRemuneration ?? 0;
  const gradeBase = empSR > 0 ? empSR : grandTotal;
  const { stdMonthly } = getInsuranceGrade(gradeBase);

  const healthInsurance = round50sen(stdMonthly * healthInsuranceRate);
  const careInsurance = (employee.careInsuranceApplied === true && healthInsuranceRate < 0.055)
    ? round50sen(stdMonthly * careInsuranceRate)
    : 0;
  const pensionInsurance = round50sen(Math.min(stdMonthly, 650_000) * pensionRate);
  const employmentInsurance = (employee.employmentInsuranceApplied !== false)
    ? round50sen(grandTotal * 0.0055)
    : 0;

  const totalInsurance = healthInsurance + careInsurance + pensionInsurance + employmentInsurance;

  const afterInsuranceSalary = Math.max(0, grandTotal - totalInsurance);
  const dependentEquivCount = (employee.dependentCount ?? 0) + ((employee.hasSpouse ?? false) ? 1 : 0);
  const incomeTax = calculateIncomeTaxReiwa8(afterInsuranceSalary, dependentEquivCount);

  const residentTax = employee.residentTax ?? 0;
  const customDeductionsTotal = deductionRows.reduce((s, r) => s + (r.amount || 0), 0);
  const otherDeductionFixed = (employee as unknown as { otherDeductionMonthly?: number }).otherDeductionMonthly ?? 0;

  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal + otherDeductionFixed);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

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
              <th className="border border-border px-1 py-1.5 text-center font-medium text-muted-foreground" style={{ width: "44px" }}>課税</th>
              <th className="border border-border px-2 py-1.5 text-right font-medium text-muted-foreground" style={{ width: "100px" }}>金額（円）</th>
            </tr>
          </thead>
          <tbody>
            {/* ── 支給セクション ── */}
            <tr className="bg-background">
              {sectionLabel("支　給", 3)}
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
                  placeholder="0"
                />
              </td>
            </tr>

            {/* ── 手当ドラッグ列 (1行にまとめてReorderを内包) ── */}
            <tr>
              <td colSpan={3} className="border border-border p-0">
                <Reorder.Group
                  axis="y"
                  values={rows}
                  onReorder={setRows}
                  className="divide-y divide-border/40"
                  style={{ listStyle: "none", margin: 0, padding: 0 }}
                >
                  {rows.map((row) => (
                    <AllowanceReorderItem
                      key={row.uid}
                      row={row}
                      allowanceDefinitions={allowanceDefinitions as { id: number; name: string; isTaxable: boolean }[] | undefined}
                      onChange={handleAllowanceChange}
                      onDelete={handleAllowanceDelete}
                    />
                  ))}
                </Reorder.Group>
                <div className="px-2 py-1.5 bg-muted/10">
                  <button
                    type="button"
                    onClick={() => setRows(prev => [...prev, { uid: newUid(), defId: null, amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    行を追加
                  </button>
                </div>
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

            {/* ── 控除（社会保険料）セクション ── */}
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

            {/* ── 差引セクション ── */}
            <tr className="bg-background">
              {sectionLabel("差引金額", 5)}
              <td className="border border-border px-2 py-1 text-muted-foreground">所得税</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(incomeTax)}</td>
            </tr>
            <tr className="bg-muted/20">
              <td className="border border-border px-2 py-1 text-muted-foreground">市町村民税</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(residentTax)}</td>
            </tr>

            {/* ── 差引ドラッグ列 ── */}
            <tr>
              <td colSpan={3} className="border border-border p-0">
                <Reorder.Group
                  axis="y"
                  values={deductionRows}
                  onReorder={setDeductionRows}
                  className="divide-y divide-border/40"
                  style={{ listStyle: "none", margin: 0, padding: 0 }}
                >
                  {deductionRows.map((row) => (
                    <DeductionReorderItem
                      key={row.uid}
                      row={row}
                      deductionDefinitions={deductionDefinitions as { id: number; name: string }[] | undefined}
                      onChange={handleDeductionChange}
                      onDelete={handleDeductionDelete}
                    />
                  ))}
                </Reorder.Group>
                <div className="px-2 py-1.5 bg-muted/10">
                  <button
                    type="button"
                    onClick={() => setDeductionRows(prev => [...prev, { uid: newUid(), defId: null, amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    行を追加
                  </button>
                </div>
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
            適用料率：健保 {(healthInsuranceRate * 100).toFixed(2)}%・厚年 {(pensionRate * 100).toFixed(2)}%・雇保 0.55%
            {empSR > 0 && (
              <span className="ml-2 text-blue-600">（健保・厚年は標準報酬月額 {empSR.toLocaleString("ja-JP")} 円ベース）</span>
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
