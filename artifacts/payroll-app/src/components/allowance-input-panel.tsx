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
import { calculateIncomeTaxReiwa8, round50sen } from "@/lib/tax-tables-reiwa8";

function roundJapanese(amount: number): number {
  return Math.floor(amount);
}

let uidCounter = 0;
function newUid() {
  return `row-${Date.now()}-${++uidCounter}`;
}

interface Props {
  employee: Employee;
  monthlyData?: { workDays: number; saturdayWorkDays: number; sundayWorkDays: number };
  onDirtyChange?: (isDirty: boolean) => void;
  year?: number;
  month?: number;
}

type AllowanceRow = { uid: string; defId: number | null; amount: number };
type DeductionRow = { uid: string; defId: number | null; amount: number };

/* ── ドラッグハンドル付き手当行 ── */
function AllowanceReorderItem({
  row,
  allowanceDefinitions,
  onChange,
  onDelete,
  inputRef,
  onEnterKey,
}: {
  row: AllowanceRow;
  allowanceDefinitions: { id: number; name: string; isTaxable: boolean }[] | undefined;
  onChange: (uid: string, patch: Partial<AllowanceRow>) => void;
  onDelete: (uid: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnterKey?: () => void;
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
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-background hover:bg-primary/5 transition-colors border-b border-border/50 group select-none">
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
            ref={inputRef}
            type="text"
            inputMode="numeric"
            className="h-7 w-full text-right border border-border/60 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-2 text-xs rounded"
            value={row.amount || ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, "");
              onChange(row.uid, { amount: raw === "" ? 0 : parseInt(raw, 10) });
            }}
            onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnterKey?.();
              }
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
  inputRef,
  onEnterKey,
}: {
  row: DeductionRow;
  deductionDefinitions: { id: number; name: string }[] | undefined;
  onChange: (uid: string, patch: Partial<DeductionRow>) => void;
  onDelete: (uid: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnterKey?: () => void;
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
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-background hover:bg-primary/5 transition-colors border-b border-border/50 group select-none">
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
            ref={inputRef}
            type="text"
            inputMode="numeric"
            className="h-7 w-full text-right border border-border/60 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-2 text-xs rounded"
            value={row.amount || ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, "");
              onChange(row.uid, { amount: raw === "" ? 0 : parseInt(raw, 10) });
            }}
            onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnterKey?.();
              }
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

export function AllowanceInputPanel({ employee, monthlyData, onDirtyChange, year, month }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const employeeId = employee.id;

  const { data: allowanceDefinitions } = useListAllowanceDefinitions(
    { activeOnly: true },
    { query: { staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeAllowances, isFetching: isAllowancesFetching, dataUpdatedAt: allowancesUpdatedAt } = useGetEmployeeAllowances(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeAllowancesQueryKey(employeeId), staleTime: 60_000, refetchOnMount: true }
  });
  const { data: deductionDefinitions } = useListDeductionDefinitions(
    { activeOnly: true },
    { query: { staleTime: 60_000, refetchOnMount: true } }
  );
  const { data: employeeDeductions, isFetching: isDeductionsFetching, dataUpdatedAt: deductionsUpdatedAt } = useGetEmployeeDeductions(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeDeductionsQueryKey(employeeId), staleTime: 60_000, refetchOnMount: true }
  });
  const { data: company } = useGetCompany();
  const updateAllowances = useUpdateEmployeeAllowances();
  const updateDeductions = useUpdateEmployeeDeductions();
  const updateEmployee = useUpdateEmployee();

  const [rows, setRows] = useState<AllowanceRow[]>([{ uid: newUid(), defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState<number>(0);
  const baseSalaryRef = useRef<HTMLInputElement>(null);

  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ uid: newUid(), defId: null, amount: 0 }]);

  // 金額入力欄の ref マップ（Enter キーでの行間ナビゲーション用）
  const allowanceInputRefsMap = useRef<Map<string, HTMLInputElement>>(new Map());
  const deductionInputRefsMap = useRef<Map<string, HTMLInputElement>>(new Map());

  const getAllowanceInputRef = useCallback((uid: string) => (el: HTMLInputElement | null) => {
    if (el) allowanceInputRefsMap.current.set(uid, el);
    else allowanceInputRefsMap.current.delete(uid);
  }, []);

  const getDeductionInputRef = useCallback((uid: string) => (el: HTMLInputElement | null) => {
    if (el) deductionInputRefsMap.current.set(uid, el);
    else deductionInputRefsMap.current.delete(uid);
  }, []);

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const deductionRowsRef = useRef(deductionRows);
  useEffect(() => { deductionRowsRef.current = deductionRows; }, [deductionRows]);

  const handleAllowanceEnterKey = useCallback((uid: string) => {
    const currentRows = rowsRef.current;
    const idx = currentRows.findIndex(r => r.uid === uid);
    if (idx >= 0 && idx < currentRows.length - 1) {
      const nextInput = allowanceInputRefsMap.current.get(currentRows[idx + 1].uid);
      nextInput?.focus();
    }
  }, []);

  const handleDeductionEnterKey = useCallback((uid: string) => {
    const currentRows = deductionRowsRef.current;
    const idx = currentRows.findIndex(r => r.uid === uid);
    if (idx >= 0 && idx < currentRows.length - 1) {
      const nextInput = deductionInputRefsMap.current.get(currentRows[idx + 1].uid);
      nextInput?.focus();
    }
  }, []);

  // 「このemployeeIdで手当を一度でも初期化したか」を追うフラグ
  const allowancesInitializedRef = useRef<number | null>(null);
  const deductionsInitializedRef = useRef<number | null>(null);

  // 未保存変更追跡
  const [isDirty, setIsDirty] = useState(false);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; });

  const markDirty = useCallback(() => {
    setIsDirty(true);
    onDirtyChangeRef.current?.(true);
  }, []);

  const markClean = useCallback(() => {
    setIsDirty(false);
    onDirtyChangeRef.current?.(false);
  }, []);

  // employeeId が変わったらフラグをリセット（次に data が来たとき再初期化する）
  useEffect(() => {
    allowancesInitializedRef.current = null;
    deductionsInitializedRef.current = null;
    setRows([{ uid: newUid(), defId: null, amount: 0 }]);
    setDeductionRows([{ uid: newUid(), defId: null, amount: 0 }]);
    markClean();
  }, [employeeId, markClean]);

  // 手当データ初回ロード時のみ rows を上書き（refetchOnWindowFocus 等の再取得では上書きしない）
  // ただし「空配列 + fetching中」は stale な空キャッシュの可能性があるのでスキップ
  useEffect(() => {
    if (employeeAllowances === undefined) return;
    if (allowancesInitializedRef.current === employeeId) return;
    if (employeeAllowances.length === 0 && isAllowancesFetching) return;
    allowancesInitializedRef.current = employeeId;
    const initialRows = employeeAllowances.length > 0
      ? employeeAllowances.map(a => ({ uid: newUid(), defId: a.allowanceDefinitionId, amount: a.amount }))
      : [{ uid: newUid(), defId: null, amount: 0 }];
    setRows(initialRows);
    markClean();
  }, [employeeAllowances, employeeId, isAllowancesFetching, allowancesUpdatedAt, markClean]);

  // 差引データ初回ロード時のみ deductionRows を上書き
  useEffect(() => {
    if (employeeDeductions === undefined) return;
    if (deductionsInitializedRef.current === employeeId) return;
    if (employeeDeductions.length === 0 && isDeductionsFetching) return;
    deductionsInitializedRef.current = employeeId;
    if (employeeDeductions.length > 0) {
      setDeductionRows(employeeDeductions.map(d => ({ uid: newUid(), defId: d.deductionDefinitionId, amount: d.amount })));
    } else {
      setDeductionRows([{ uid: newUid(), defId: null, amount: 0 }]);
    }
    markClean();
  }, [employeeDeductions, employeeId, isDeductionsFetching, deductionsUpdatedAt, markClean]);

  const isDaily = employee.salaryType === "daily";
  const computedDailyBaseSalary = isDaily && company
    ? Math.round(
        (monthlyData?.workDays ?? 0) * (company.dailyWageWeekday ?? 9808) +
        (monthlyData?.saturdayWorkDays ?? 0) * (company.dailyWageSaturday ?? 12260) +
        (monthlyData?.sundayWorkDays ?? 0) * (company.dailyWageWeekday ?? 9808) * 1.35
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
      // defId が選択済みの行はすべて保存（金額0でも手当定義IDを保持するため amount > 0 条件を除去）
      const allowancePayload = rows
        .filter(r => r.defId !== null)
        .map(r => ({ allowanceDefinitionId: r.defId!, amount: r.amount }));
      const deductionPayload = deductionRows
        .filter(r => r.defId !== null)
        .map(r => ({ deductionDefinitionId: r.defId!, amount: r.amount || 0 }));

      await Promise.all([
        updateAllowances.mutateAsync({ id: employeeId, data: { allowances: allowancePayload } }),
        updateDeductions.mutateAsync({ id: employeeId, data: { deductions: deductionPayload } }),
        updateEmployee.mutateAsync({ id: employeeId, data: { baseSalary: baseSalaryInput } }),
      ]);

      // キャッシュを保存済みデータで直接更新（次回マウント時の初期化で正しく復元するため）
      // allowanceDefinitionId を含む完全なデータでキャッシュを更新する
      const savedAllowances = allowancePayload.map((item, idx) => {
        const def = (allowanceDefinitions as { id: number; name: string; isTaxable: boolean }[] | undefined)
          ?.find(d => d.id === item.allowanceDefinitionId);
        return {
          id: idx + 1,
          employeeId,
          allowanceDefinitionId: item.allowanceDefinitionId,
          allowanceName: def?.name ?? "",
          isTaxable: def?.isTaxable ?? true,
          amount: item.amount,
          sortOrder: idx,
        };
      });
      queryClient.setQueryData(getGetEmployeeAllowancesQueryKey(employeeId), savedAllowances);

      const savedDeductions = deductionPayload.map((item, idx) => {
        const def = (deductionDefinitions as { id: number; name: string }[] | undefined)
          ?.find(d => d.id === item.deductionDefinitionId);
        return {
          id: idx + 1,
          employeeId,
          deductionDefinitionId: item.deductionDefinitionId,
          deductionName: def?.name ?? "",
          amount: item.amount,
          sortOrder: idx,
        };
      });
      queryClient.setQueryData(getGetEmployeeDeductionsQueryKey(employeeId), savedDeductions);

      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey({ active: true }) });

      toast({ title: "保存しました", description: `${employee.name}の基本給・手当・差引を更新しました。` });
      markClean();
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  const handleAllowanceChange = useCallback((uid: string, patch: Partial<AllowanceRow>) => {
    setRows(prev => prev.map(r => r.uid === uid ? { ...r, ...patch } : r));
    markDirty();
  }, [markDirty]);

  const handleAllowanceDelete = useCallback((uid: string) => {
    setRows(prev => prev.filter(r => r.uid !== uid));
    markDirty();
  }, [markDirty]);

  const handleDeductionChange = useCallback((uid: string, patch: Partial<DeductionRow>) => {
    setDeductionRows(prev => prev.map(r => r.uid === uid ? { ...r, ...patch } : r));
    markDirty();
  }, [markDirty]);

  const handleDeductionDelete = useCallback((uid: string) => {
    setDeductionRows(prev => prev.filter(r => r.uid !== uid));
    markDirty();
  }, [markDirty]);

  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;

  const pensionRate = company?.pensionEmployeeRate ?? 0.0915;
  const empInsRate = (company?.employmentInsuranceRate ?? 0) > 0
    ? company!.employmentInsuranceRate
    : 0.005;

  // 令和8年度レート
  const HEALTH_RATE_NO_CARE = 0.04925;     // 健保のみ: 9.85%/2
  const HEALTH_RATE_WITH_CARE = 0.05735;   // 健保+介護: (9.85+1.62)%/2
  const CHILDCARE_RATE = 0.00115;          // 子育て支援金: 0.23%/2

  const appliedHealthRate = employee.careInsuranceApplied === true
    ? HEALTH_RATE_WITH_CARE
    : HEALTH_RATE_NO_CARE;

  const empSR = (employee as unknown as { standardRemuneration?: number }).standardRemuneration ?? 0;
  const insBase = empSR > 0 ? empSR : grandTotal;

  const healthInsurance = round50sen(insBase * appliedHealthRate);
  const childcareSupportApplicable = !(year !== undefined && month !== undefined && (year < 2026 || (year === 2026 && month <= 4)));
  const childcareSupportContribution = childcareSupportApplicable ? round50sen(insBase * CHILDCARE_RATE) : 0;
  const pensionInsurance = round50sen(Math.min(insBase, 650_000) * pensionRate);
  const employmentInsurance = (employee.employmentInsuranceApplied !== false)
    ? round50sen(grandTotal * empInsRate)
    : 0;

  const totalInsurance = healthInsurance + childcareSupportContribution + pensionInsurance + employmentInsurance;

  const nonTaxableAllowancesTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions?.find(d => d.id === r.defId);
    return s + (def && !def.isTaxable ? (r.amount || 0) : 0);
  }, 0);

  // 所得税計算基礎: 総支給額 - 非課税手当 - 健保 - 厚年 - 雇用保険
  // ※子育て支援金(childcareSupportContribution)は所得税計算基礎から差し引かない
  const incomeTaxBase = Math.max(0,
    grandTotal - nonTaxableAllowancesTotal - healthInsurance - pensionInsurance - employmentInsurance
  );
  // 社会保険料控除後の金額（表示用）: 総支給 - 社保合計（非課税手当は含む）
  const afterInsuranceSalary = Math.max(0,
    grandTotal - healthInsurance - childcareSupportContribution - pensionInsurance - employmentInsurance
  );
  const dependentEquivCount = (employee.dependentCount ?? 0) + ((employee.hasSpouse ?? false) ? 1 : 0);
  const incomeTax = calculateIncomeTaxReiwa8(incomeTaxBase, dependentEquivCount);

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
                    markDirty();
                  }}
                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 0); }}
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
                  onReorder={(newRows) => { setRows(newRows); markDirty(); }}
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
                      inputRef={getAllowanceInputRef(row.uid)}
                      onEnterKey={() => handleAllowanceEnterKey(row.uid)}
                    />
                  ))}
                </Reorder.Group>
                <div className="px-2 py-1.5 bg-muted/10">
                  <button
                    type="button"
                    onClick={() => { setRows(prev => [...prev, { uid: newUid(), defId: null, amount: 0 }]); markDirty(); }}
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
              <td className="border border-border px-2 py-1 text-muted-foreground">
                健康保険料{employee.careInsuranceApplied === true ? "（介護込）" : ""}
              </td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(healthInsurance)}</td>
            </tr>
            <tr className="bg-muted/20">
              <td className="border border-border px-2 py-1 text-muted-foreground">子ども・子育て支援金</td>
              <td className="border border-border" />
              <td className="border border-border px-2 py-1.5 text-right tabular-nums">{fmt(childcareSupportContribution)}</td>
            </tr>
            <tr className="bg-background">
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
                  onReorder={(newRows) => { setDeductionRows(newRows); markDirty(); }}
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
                      inputRef={getDeductionInputRef(row.uid)}
                      onEnterKey={() => handleDeductionEnterKey(row.uid)}
                    />
                  ))}
                </Reorder.Group>
                <div className="px-2 py-1.5 bg-muted/10">
                  <button
                    type="button"
                    onClick={() => { setDeductionRows(prev => [...prev, { uid: newUid(), defId: null, amount: 0 }]); markDirty(); }}
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
            適用料率：健保 {(appliedHealthRate * 100).toFixed(3)}%
            {employee.careInsuranceApplied && <span className="text-amber-600">（介護込）</span>}
            {childcareSupportApplicable ? "・子育て支援金 0.115%" : "・子育て支援金 0%（4月以前）"}・厚年 {(pensionRate * 100).toFixed(2)}%・雇保 {(empInsRate * 100).toFixed(1)}%
            {empSR > 0 && (
              <span className="ml-2 text-blue-600">（健保・厚年{childcareSupportApplicable ? "・支援金" : ""}は標準報酬月額 {empSR.toLocaleString("ja-JP")} 円ベース）</span>
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
