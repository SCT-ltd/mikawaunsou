import { useState, useEffect, useCallback, useMemo } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  useGetEmployeeAllowances,
  getGetEmployeeAllowancesQueryKey,
  useUpdateEmployeeAllowances,
  useListAllowanceDefinitions,
  getListAllowanceDefinitionsQueryKey,
  useGetEmployeeDeductions,
  getGetEmployeeDeductionsQueryKey,
  useUpdateEmployeeDeductions,
  useListDeductionDefinitions,
  getListDeductionDefinitionsQueryKey,
  useUpdateEmployee,
  useGetCompany,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Plus, X, GripVertical, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  EmployeeExt,
  CompanySettings,
  roundJapanese,
  resolvePensionApplied,
  calculateIncomeTaxFromOfficialTable,
} from "./estimate";

/**
 * 手当・控除タブ。
 * 旧 AllowanceSidebar（右から出る Sheet）の内容を詳細パネル内のタブとして移植。
 * 保存先は社員マスタ（手当・差引・基本給）のため、月次一括保存とは独立した保存ボタンを持つ。
 * 計算ロジックは旧実装から変更なし。
 */

// ── UID生成ユーティリティ ─────────────────────────────────────────────────
let _uidCounter = 0;
function genUid() {
  return `row-${++_uidCounter}-${Date.now()}`;
}

type AllowanceRow = { uid: string; defId: number | null; amount: number };
type DeductionRow = { uid: string; defId: number | null; amount: number };

// ── ドラッグハンドル ──────────────────────────────────────────────────────
function DragHandle({ controls }: { controls: ReturnType<typeof useDragControls> }) {
  return (
    <button
      type="button"
      className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1"
      onPointerDown={(e) => controls.start(e)}
      title="ドラッグして並び替え"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

// ── 手当行（ドラッグ対応）────────────────────────────────────────────────
function AllowanceReorderItem({
  row,
  definitions,
  onChange,
  onRemove,
}: {
  row: AllowanceRow;
  definitions: { id: number; name: string; isTaxable: boolean }[];
  onChange: (uid: string, field: "defId" | "amount", value: number | null) => void;
  onRemove: (uid: string) => void;
}) {
  const controls = useDragControls();
  const def = definitions.find((d) => d.id === row.defId);

  return (
    <Reorder.Item
      value={row}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-1 py-1.5 px-4 border-b border-border/60 bg-card hover:bg-muted/20 transition-colors group"
    >
      <DragHandle controls={controls} />

      <div className="flex-1 min-w-0">
        <Select
          value={row.defId?.toString() ?? ""}
          onValueChange={(v) => onChange(row.uid, "defId", parseInt(v, 10))}
        >
          <SelectTrigger className="h-8 text-sm border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full">
            <SelectValue placeholder="手当を選択…" />
          </SelectTrigger>
          <SelectContent>
            {definitions.map((d) => (
              <SelectItem key={d.id} value={d.id.toString()}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {def ? (
        <span
          className={`shrink-0 w-10 text-center px-1 py-0.5 rounded border text-[10px] ${
            def.isTaxable
              ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30"
              : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
          }`}
        >
          {def.isTaxable ? "課税" : "非課税"}
        </span>
      ) : (
        <span className="shrink-0 w-10" />
      )}

      <Input
        type="number"
        min="0"
        className={`h-8 w-28 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-sm amount shrink-0 ${row.amount > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
        value={row.amount || ""}
        onChange={(e) => onChange(row.uid, "amount", e.target.value === "" ? 0 : parseInt(e.target.value, 10))}
        placeholder="0"
      />

      <button
        type="button"
        onClick={() => onRemove(row.uid)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0 transition-all"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Reorder.Item>
  );
}

// ── 控除行（ドラッグ対応）────────────────────────────────────────────────
function DeductionReorderItem({
  row,
  definitions,
  onChange,
  onRemove,
}: {
  row: DeductionRow;
  definitions: { id: number; name: string }[];
  onChange: (uid: string, field: "defId" | "amount", value: number | null) => void;
  onRemove: (uid: string) => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={row}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-1 py-1.5 px-4 border-b border-border/60 bg-card hover:bg-muted/20 transition-colors group"
    >
      <DragHandle controls={controls} />

      <div className="flex-1 min-w-0">
        <Select
          value={row.defId?.toString() ?? ""}
          onValueChange={(v) => onChange(row.uid, "defId", parseInt(v, 10))}
        >
          <SelectTrigger className="h-8 text-sm border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-1 w-full">
            <SelectValue placeholder="差引を選択…" />
          </SelectTrigger>
          <SelectContent>
            {definitions.map((d) => (
              <SelectItem key={d.id} value={d.id.toString()}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Input
        type="number"
        min="0"
        className={`h-8 w-28 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-sm amount shrink-0 ${row.amount > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
        value={row.amount || ""}
        onChange={(e) => onChange(row.uid, "amount", e.target.value === "" ? 0 : parseInt(e.target.value, 10))}
        placeholder="0"
      />

      <button
        type="button"
        onClick={() => onRemove(row.uid)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0 transition-all"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Reorder.Item>
  );
}

// ── メイン: 手当・控除パネル ────────────────────────────────────────────
export function AllowancePanel({
  employee,
  monthlyData,
}: {
  employee: EmployeeExt;
  monthlyData?: { workDays: number; saturdayWorkDays: number; sundayWorkDays: number };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const employeeId = employee.id;

  const { data: allowanceDefinitions = [], isLoading: isAllowDefsLoading } = useListAllowanceDefinitions(
    { activeOnly: true },
    { query: { queryKey: getListAllowanceDefinitionsQueryKey({ activeOnly: true }), staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeAllowances } = useGetEmployeeAllowances(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeAllowancesQueryKey(employeeId), staleTime: 0, refetchOnMount: true },
  });
  const { data: deductionDefinitions = [], isLoading: isDedDefsLoading } = useListDeductionDefinitions(
    { activeOnly: true },
    { query: { queryKey: getListDeductionDefinitionsQueryKey({ activeOnly: true }), staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeDeductions } = useGetEmployeeDeductions(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeDeductionsQueryKey(employeeId), staleTime: 0, refetchOnMount: true },
  });
  const { data: companyData } = useGetCompany();
  const company = companyData as CompanySettings | undefined;
  const updateAllowances = useUpdateEmployeeAllowances();
  const updateDeductions = useUpdateEmployeeDeductions();
  const updateEmployee = useUpdateEmployee();

  const [rows, setRows] = useState<AllowanceRow[]>([{ uid: genUid(), defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState(0);
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ uid: genUid(), defId: null, amount: 0 }]);
  const [showInsuranceDetail, setShowInsuranceDetail] = useState(false);
  // 手当行の初期化（データ到着後）が済んだかどうか。全データ＋この初期化が揃うまでスケルトン表示
  const [rowsReady, setRowsReady] = useState(false);

  const isDaily = employee.salaryType === "daily";
  const computedDailyBaseSalary =
    isDaily && company
      ? Math.round(
          (monthlyData?.workDays ?? 0) * (company.dailyWageWeekday ?? 9808) +
            (monthlyData?.saturdayWorkDays ?? 0) * (company.dailyWageSaturday ?? 12260) +
            (monthlyData?.sundayWorkDays ?? 0) * (company.dailyWageWeekday ?? 9808) * 1.35
        )
      : null;

  // pinned な手当IDを安定した文字列キーにして effect の依存を安定化する。
  // allowanceDefinitions は `= []` デフォルトのためロード中に毎レンダー参照が変わり、
  // これを直接 effect 依存にすると setRows → 再レンダー → effect の無限ループになる。
  const pinnedIdsKey = useMemo(
    () => allowanceDefinitions
      .filter((d) => (d as { pinned?: boolean }).pinned)
      .map((d) => d.id)
      .sort((a, b) => a - b)
      .join(","),
    [allowanceDefinitions]
  );

  useEffect(() => {
    const base: AllowanceRow[] = (employeeAllowances && employeeAllowances.length > 0)
      ? employeeAllowances.map((a) => ({ uid: genUid(), defId: a.allowanceDefinitionId, amount: a.amount }))
      : [];
    // 「リストに固定」された手当で、まだ行に無いものを金額0で常時表示（毎回追加の手間を省く）
    const presentDefIds = new Set(base.map((r) => r.defId));
    const pinnedIds = pinnedIdsKey ? pinnedIdsKey.split(",").map(Number) : [];
    const pinnedRows: AllowanceRow[] = pinnedIds
      .filter((id) => !presentDefIds.has(id))
      .map((id) => ({ uid: genUid(), defId: id, amount: 0 }));
    const merged = [...base, ...pinnedRows];
    setRows(merged.length > 0 ? merged : [{ uid: genUid(), defId: null, amount: 0 }]);
    // 手当データが到着してから初期化した場合のみ ready（ロード中の暫定初期化では立てない）
    if (employeeAllowances !== undefined) setRowsReady(true);
  }, [employeeAllowances, employeeId, pinnedIdsKey]);

  useEffect(() => {
    if (employeeDeductions && employeeDeductions.length > 0) {
      setDeductionRows(employeeDeductions.map((d) => ({ uid: genUid(), defId: d.deductionDefinitionId, amount: d.amount })));
    } else {
      setDeductionRows([{ uid: genUid(), defId: null, amount: 0 }]);
    }
  }, [employeeDeductions, employeeId]);

  useEffect(() => {
    if (isDaily && computedDailyBaseSalary !== null) {
      setBaseSalaryInput(computedDailyBaseSalary);
    } else {
      setBaseSalaryInput(employee.baseSalary ?? 0);
    }
  }, [employee.baseSalary, employeeId, isDaily, computedDailyBaseSalary]);

  const handleAllowanceChange = useCallback(
    (uid: string, field: "defId" | "amount", value: number | null) => {
      setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value ?? 0 } : r)));
    },
    []
  );
  const handleRemoveAllowance = useCallback((uid: string) => {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  const handleDeductionChange = useCallback(
    (uid: string, field: "defId" | "amount", value: number | null) => {
      setDeductionRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value ?? 0 } : r)));
    },
    []
  );
  const handleRemoveDeduction = useCallback((uid: string) => {
    setDeductionRows((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  // ── 計算（旧 AllowanceSidebar と同一）─────────────────────────────────
  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;
  const nonTaxableAllowancesTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions.find(d => d.id === r.defId);
    return s + (def && !def.isTaxable ? (r.amount || 0) : 0);
  }, 0);

  const healthRate = company?.healthInsuranceEmployeeRate ?? 0.05;
  const pensionRate = company?.pensionEmployeeRate ?? 0.0915;
  const eiRate = company?.employmentInsuranceRate ?? 0.0005;

  const isPensionApplied = resolvePensionApplied(employee);
  const healthInsurance = roundJapanese(grandTotal * healthRate);
  const pensionInsurance = isPensionApplied ? roundJapanese(grandTotal * pensionRate) : 0;
  // 雇用保険: 総支給額（全額）× 料率（非課税手当も含めて計算）
  const employmentInsurance =
    employee.employmentInsuranceApplied !== false
      ? roundJapanese(grandTotal * eiRate)
      : 0;
  const totalInsurance = healthInsurance + pensionInsurance + employmentInsurance;

  const afterInsuranceSalary = Math.max(0, grandTotal - totalInsurance - nonTaxableAllowancesTotal);
  const incomeTax = calculateIncomeTaxFromOfficialTable(
    afterInsuranceSalary,
    employee.dependentCount ?? 0,
    employee.hasSpouse ?? false,
  );
  const residentTax = employee.residentTax ?? 0;
  const customDeductionsTotal = deductionRows.reduce((s, r) => s + (r.amount || 0), 0);
  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

  console.log("[FRONT_INCOME_TAX_SOURCE_CHECK]", {
    page: "monthly-input/AllowancePanel",
    employeeId,
    payrollId: null,
    incomeTaxDisplayed: incomeTax,
    source: "calculateIncomeTaxReiwa8（公式月額表・甲欄）",
    usesLegacyFormula: false,
  });

  console.log("[CUSTOM_DEDUCTIONS_TOTAL_CHECK]", {
    employeeId,
    payrollId: null,
    deductionItems: deductionRows
      .filter(r => r.defId !== null)
      .map(r => ({
        defId: r.defId,
        name: deductionDefinitions.find(d => d.id === r.defId)?.name ?? "(未選択)",
        amount: r.amount,
      })),
    customDeductionsTotal,
    totalDeductions,
    netSalary,
  });

  const fmt = (v: number) =>
    v > 0 ? `¥${v.toLocaleString("ja-JP")}` : v === 0 ? "¥0" : "—";

  const handleSave = async () => {
    try {
      const allowancePayload = rows
        .filter((r) => r.defId !== null && r.amount > 0)
        .map((r) => ({ allowanceDefinitionId: r.defId!, amount: r.amount }));
      const deductionPayload = deductionRows
        .filter((r) => r.defId !== null)
        .map((r) => ({ deductionDefinitionId: r.defId!, amount: r.amount || 0 }));
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

  // 全データ（手当・控除・両定義・会社設定）が揃い、かつ行初期化が済むまでスケルトン表示。
  // 社員切替時の途中状態（金額が順次入る）を見せず、完全に読み込んでから表示する。
  const panelLoading =
    employeeAllowances === undefined ||
    employeeDeductions === undefined ||
    companyData === undefined ||
    isAllowDefsLoading ||
    isDedDefsLoading ||
    !rowsReady;

  if (panelLoading) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden max-w-2xl mx-auto">
        <div className="px-4 py-2 bg-blue-50/70 dark:bg-blue-500/10 border-b border-blue-100 dark:border-blue-500/25 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          <span className="text-xs font-semibold text-blue-800 dark:text-blue-300">読み込み中…</span>
        </div>
        <div className="p-4 space-y-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-6 w-28 bg-muted rounded" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 border-b border-border/40">
              <div className="h-3.5 w-3.5 bg-muted/70 rounded" />
              <div className="h-4 flex-1 bg-muted rounded" />
              <div className="h-4 w-12 bg-muted/70 rounded" />
              <div className="h-4 w-20 bg-muted rounded" />
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-6 w-32 bg-muted rounded" />
          </div>
        </div>
        <div className="px-4 py-3 border-t space-y-3 animate-pulse">
          <div className="h-9 w-full bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden max-w-2xl mx-auto">
      {/* ── 支給セクション ── */}
      <div className="border-b">
        <div className="px-4 py-2 bg-blue-50/70 dark:bg-blue-500/10 border-b border-blue-100 dark:border-blue-500/25 flex items-center justify-between">
          <span className="text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide">支給</span>
        </div>

        {/* 基本給 */}
        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-border/60 bg-card">
          <span className="w-6 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">基本給</div>
            {isDaily && (
              <div className="text-[10px] text-muted-foreground">日給制（勤怠より自動計算）</div>
            )}
          </div>
          <span className="shrink-0 w-10 text-center px-1 py-0.5 rounded border text-[10px] bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
            課税
          </span>
          {isDaily ? (
            <div className="w-28 text-right text-sm font-semibold text-blue-700 dark:text-blue-300 amount shrink-0">
              {baseSalaryInput.toLocaleString("ja-JP")}
            </div>
          ) : (
            <Input
              type="number"
              min="0"
              className="h-8 w-28 text-right border-border/60 shadow-none text-sm font-semibold amount shrink-0"
              value={baseSalaryInput || ""}
              onChange={(e) => {
                const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                setBaseSalaryInput(isNaN(v) ? 0 : v);
              }}
              placeholder="0"
            />
          )}
          <span className="w-6 shrink-0" />
        </div>

        {/* 列ヘッダー（ドラッグ案内兼用） */}
        <div className="flex items-center gap-1 px-4 py-1.5 bg-muted/30 border-b border-border/40">
          <span className="w-6 shrink-0" />
          <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <GripVertical className="h-3 w-3" />手当項目（ドラッグで並替）
          </span>
          <span className="w-10 shrink-0 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">区分</span>
          <span className="w-28 shrink-0 text-right pr-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">金額（円）</span>
          <span className="w-6 shrink-0" />
        </div>
        <Reorder.Group axis="y" values={rows} onReorder={setRows} className="select-none">
          {rows.map((row) => (
            <AllowanceReorderItem
              key={row.uid}
              row={row}
              definitions={allowanceDefinitions}
              onChange={handleAllowanceChange}
              onRemove={handleRemoveAllowance}
            />
          ))}
        </Reorder.Group>

        <div className="px-4 py-2 border-b border-border/60">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { uid: genUid(), defId: null, amount: 0 }])}
            className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            手当を追加
          </button>
        </div>

        {/* 総支給額 */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 dark:bg-blue-500/10">
          <span className="text-sm font-semibold text-blue-900 dark:text-blue-200 jp-tight">総支給額</span>
          <span className="text-lg font-bold text-blue-800 dark:text-blue-300 amount">
            {grandTotal > 0 ? `¥${grandTotal.toLocaleString("ja-JP")}` : "—"}
          </span>
        </div>
      </div>

      {/* ── 社会保険料セクション ── */}
      <div className="border-b">
        <button
          type="button"
          className="w-full px-4 py-2.5 bg-orange-50/70 dark:bg-orange-500/10 border-b border-orange-100 dark:border-orange-500/25 flex items-center justify-between"
          onClick={() => setShowInsuranceDetail((v) => !v)}
        >
          <span className="text-xs font-semibold text-orange-800 dark:text-orange-300 uppercase tracking-wide">
            社会保険料（自動計算）
          </span>
          <div className="flex items-center gap-1 text-sm text-orange-700 dark:text-orange-300 font-semibold amount">
            {fmt(totalInsurance)}
            {showInsuranceDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </div>
        </button>

        {showInsuranceDetail && (
          <div className="divide-y divide-border/50">
            {[
              { label: `健康保険料 (${(healthRate * 100).toFixed(2)}%)`, value: healthInsurance },
              { label: `厚生年金保険料 (${(pensionRate * 100).toFixed(2)}%)`, value: pensionInsurance },
              { label: `雇用保険料 (${(eiRate * 100).toFixed(2)}%)`, value: employmentInsurance },
              { label: "保険料控除後の金額", value: afterInsuranceSalary, highlight: true },
            ].map(({ label, value, highlight }) => (
              <div
                key={label}
                className={`flex items-center justify-between px-4 py-2 ${highlight ? "bg-muted/30" : "bg-card"}`}
              >
                <span className={`text-xs ${highlight ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
                <span className={`text-sm tabular-nums ${highlight ? "font-semibold" : ""}`}>{fmt(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 差引セクション ── */}
      <div className="border-b">
        <div className="px-4 py-2 bg-red-50/70 dark:bg-red-500/10 border-b border-red-100 dark:border-red-500/25">
          <span className="text-xs font-semibold text-red-800 dark:text-red-300 uppercase tracking-wide">差引</span>
        </div>

        {/* 所得税・住民税（固定・自動計算） */}
        {[
          { label: "所得税", value: incomeTax },
          { label: "住民税", value: residentTax },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-1 px-4 py-2.5 border-b border-border/60 bg-card">
            <span className="w-6 shrink-0" />
            <span className="flex-1 text-sm text-muted-foreground">{label}<span className="ml-1.5 text-[10px] text-muted-foreground/60">自動</span></span>
            <span className="w-28 shrink-0 text-right pr-1 text-sm amount">{fmt(value)}</span>
            <span className="w-6 shrink-0" />
          </div>
        ))}

        {/* その他差引（Reorder） */}
        <Reorder.Group axis="y" values={deductionRows} onReorder={setDeductionRows} className="select-none">
          {deductionRows.map((row) => (
            <DeductionReorderItem
              key={row.uid}
              row={row}
              definitions={deductionDefinitions}
              onChange={handleDeductionChange}
              onRemove={handleRemoveDeduction}
            />
          ))}
        </Reorder.Group>

        <div className="px-4 py-2 border-b border-border/60">
          <button
            type="button"
            onClick={() => setDeductionRows((prev) => [...prev, { uid: genUid(), defId: null, amount: 0 }])}
            className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            差引を追加
          </button>
        </div>

        {/* 差引合計 */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-50/60 dark:bg-red-500/10">
          <span className="text-sm font-semibold text-red-900 dark:text-red-200 jp-tight">差引合計</span>
          <span className="text-lg font-bold text-red-800 dark:text-red-300 amount">{fmt(totalDeductions)}</span>
        </div>
      </div>

      {/* ── 差引支給額（手取り＝この画面のヒーロー数値）── */}
      <div className="px-4 py-4 bg-gradient-to-br from-emerald-50 to-green-50/40 dark:from-emerald-500/10 dark:to-emerald-500/[0.04] border-t-2 border-emerald-200 dark:border-emerald-500/30">
        <div className="flex items-end justify-between gap-3">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 jp-tight">
            差引支給額<span className="text-muted-foreground font-normal">（手取り概算）</span>
          </div>
          <div className={`text-3xl font-extrabold amount leading-none ${netSalary >= 0 ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-400"}`}>
            {netSalary !== 0 ? `¥${netSalary.toLocaleString("ja-JP")}` : "¥0"}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground mt-1.5">
          ※源泉所得税は月額表甲欄による概算値です
        </div>
      </div>

      {/* ── 保存ボタン ── */}
      <div className="border-t px-4 py-3 bg-card">
        <Button
          className="w-full gap-2"
          onClick={handleSave}
          disabled={updateAllowances.isPending || updateDeductions.isPending || updateEmployee.isPending}
        >
          <Save className="h-4 w-4" />
          {updateAllowances.isPending ? "保存中..." : "手当・控除を保存"}
        </Button>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          社員マスタへ保存されます（月次実績の一括保存とは別）
        </p>
      </div>
    </div>
  );
}
