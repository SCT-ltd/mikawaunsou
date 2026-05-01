import { useState, useEffect, useCallback, useRef } from "react";
import { Reorder, useDragControls } from "framer-motion";
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
  Employee,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Save,
  Plus,
  X,
  CalendarDays as CalIcon,
  RefreshCw,
  SlidersHorizontal,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Info,
  FileSpreadsheet,
} from "lucide-react";
import { AttendanceCalendarDialog } from "@/components/attendance-calendar-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigationGuard } from "@/context/navigation-guard-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── UID生成ユーティリティ ─────────────────────────────────────────────────
let _uidCounter = 0;
function genUid() {
  return `row-${++_uidCounter}-${Date.now()}`;
}

// ── 給与計算ユーティリティ ────────────────────────────────────────────────
function roundJapanese(amount: number): number {
  const fraction = amount - Math.floor(amount);
  return fraction <= 0.5 ? Math.floor(amount) : Math.ceil(amount);
}

function calculateIncomeTax(afterInsuranceSalary: number, dependentCount: number): number {
  const X = afterInsuranceSalary;
  let tax0 = 0;
  if (X < 88_000) tax0 = 0;
  else if (X < 257_700) tax0 = X * 0.05 - 4_273;
  else if (X < 429_460) tax0 = X * 0.10 - 17_158;
  else if (X < 695_000) tax0 = X * 0.20 - 60_104;
  else if (X < 900_000) tax0 = X * 0.23 - 80_954;
  else if (X < 1_800_000) tax0 = X * 0.33 - 170_954;
  else if (X < 4_000_000) tax0 = X * 0.40 - 296_954;
  else tax0 = X * 0.45 - 496_954;

  const taxB = Math.max(0, tax0 - dependentCount * 3_750);
  return roundJapanese(Math.max(0, taxB * 1.021));
}

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
type AllowanceRow = { uid: string; defId: number | null; amount: number };
type DeductionRow = { uid: string; defId: number | null; amount: number };

function AllowanceReorderItem({
  row,
  idx,
  definitions,
  onChange,
  onRemove,
}: {
  row: AllowanceRow;
  idx: number;
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
      className="flex items-center gap-1 py-1 px-2 border-b border-border/60 bg-card hover:bg-muted/20 transition-colors group"
    >
      <DragHandle controls={controls} />

      <div className="flex-1 min-w-0">
        <Select
          value={row.defId?.toString() ?? ""}
          onValueChange={(v) => onChange(row.uid, "defId", parseInt(v, 10))}
        >
          <SelectTrigger className="h-6 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-0 w-full">
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
          className={`shrink-0 px-1 py-0.5 rounded border text-[10px] ${
            def.isTaxable
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
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
        className="h-6 w-24 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs shrink-0"
        value={row.amount || ""}
        onChange={(e) => onChange(row.uid, "amount", e.target.value === "" ? 0 : parseInt(e.target.value, 10))}
        placeholder="0"
      />

      <button
        type="button"
        onClick={() => onRemove(row.uid)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0 transition-all"
      >
        <X className="h-3 w-3" />
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
      className="flex items-center gap-1 py-1 px-2 border-b border-border/60 bg-card hover:bg-muted/20 transition-colors group"
    >
      <DragHandle controls={controls} />

      <div className="flex-1 min-w-0">
        <Select
          value={row.defId?.toString() ?? ""}
          onValueChange={(v) => onChange(row.uid, "defId", parseInt(v, 10))}
        >
          <SelectTrigger className="h-6 text-xs border-0 shadow-none bg-transparent focus:ring-1 focus:ring-primary px-0 w-full">
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
        className="h-6 w-24 text-right border-0 shadow-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 text-xs shrink-0"
        value={row.amount || ""}
        onChange={(e) => onChange(row.uid, "amount", e.target.value === "" ? 0 : parseInt(e.target.value, 10))}
        placeholder="0"
      />

      <button
        type="button"
        onClick={() => onRemove(row.uid)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0 transition-all"
      >
        <X className="h-3 w-3" />
      </button>
    </Reorder.Item>
  );
}

// ── サイドパネル ──────────────────────────────────────────────────────────
function AllowanceSidebar({
  employee,
  open,
  onClose,
  monthlyData,
}: {
  employee: Employee | null;
  open: boolean;
  onClose: () => void;
  monthlyData?: { workDays: number; saturdayWorkDays: number; sundayWorkDays: number };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const employeeId = employee?.id ?? 0;

  const { data: allowanceDefinitions = [] } = useListAllowanceDefinitions(
    { activeOnly: true },
    { query: { staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeAllowances } = useGetEmployeeAllowances(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeAllowancesQueryKey(employeeId), staleTime: 0, refetchOnMount: true },
  });
  const { data: deductionDefinitions = [] } = useListDeductionDefinitions(
    { activeOnly: true },
    { query: { staleTime: 0, refetchOnMount: true } }
  );
  const { data: employeeDeductions } = useGetEmployeeDeductions(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetEmployeeDeductionsQueryKey(employeeId), staleTime: 0, refetchOnMount: true },
  });
  const { data: company } = useGetCompany();
  const updateAllowances = useUpdateEmployeeAllowances();
  const updateDeductions = useUpdateEmployeeDeductions();
  const updateEmployee = useUpdateEmployee();

  const [rows, setRows] = useState<AllowanceRow[]>([{ uid: genUid(), defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState(0);
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ uid: genUid(), defId: null, amount: 0 }]);
  const [showInsuranceDetail, setShowInsuranceDetail] = useState(false);

  const isDaily = employee?.salaryType === "daily";
  const computedDailyBaseSalary =
    isDaily && company
      ? Math.round(
          (monthlyData?.workDays ?? 0) * (company.dailyWageWeekday ?? 9808) +
            (monthlyData?.saturdayWorkDays ?? 0) * (company.dailyWageSaturday ?? 12260) +
            (monthlyData?.sundayWorkDays ?? 0) * (company.dailyWageWeekday ?? 9808) * 1.35
        )
      : null;

  useEffect(() => {
    if (employeeAllowances && employeeAllowances.length > 0) {
      setRows(employeeAllowances.map((a) => ({ uid: genUid(), defId: a.allowanceDefinitionId, amount: a.amount })));
    } else {
      setRows([{ uid: genUid(), defId: null, amount: 0 }]);
    }
  }, [employeeAllowances, employeeId]);

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
      setBaseSalaryInput(employee?.baseSalary ?? 0);
    }
  }, [employee?.baseSalary, employeeId, isDaily, computedDailyBaseSalary]);

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

  // ── 計算 ─────────────────────────────────────────────────────────────
  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;

  const healthRate = company?.healthInsuranceEmployeeRate ?? 0.05;
  const pensionRate = company?.pensionEmployeeRate ?? 0.0915;
  const eiRate = company?.employmentInsuranceRate ?? 0.006;

  const healthInsurance = roundJapanese(grandTotal * healthRate);
  const pensionInsurance = roundJapanese(grandTotal * pensionRate);
  const employmentInsurance =
    employee?.employmentInsuranceApplied !== false ? roundJapanese(grandTotal * eiRate) : 0;
  const totalInsurance = healthInsurance + pensionInsurance + employmentInsurance;

  const afterInsuranceSalary = Math.max(0, grandTotal - totalInsurance);
  const incomeTax = calculateIncomeTax(afterInsuranceSalary, employee?.dependentCount ?? 0);
  const residentTax = employee?.residentTax ?? 0;
  const customDeductionsTotal = deductionRows.reduce((s, r) => s + (r.amount || 0), 0);
  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

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
      toast({ title: "保存しました", description: `${employee?.name}の基本給・手当・差引を更新しました。` });
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    }
  };

  if (!employee) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[380px] sm:w-[440px] flex flex-col p-0 overflow-hidden gap-0">
        {/* ヘッダー */}
        <SheetHeader className="px-5 py-3 border-b shrink-0 bg-muted/30">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            手当・控除設定
          </SheetTitle>
          <SheetDescription className="text-xs">
            {employee.name}　<span className="text-muted-foreground/70">{employee.department}</span>
          </SheetDescription>
        </SheetHeader>

        {/* スクロール領域 */}
        <div className="flex-1 overflow-y-auto">

          {/* ── 支給セクション ── */}
          <div className="border-b">
            <div className="px-4 py-2 bg-blue-50/70 border-b border-blue-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">支給</span>
            </div>

            {/* 基本給 */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-card">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">基本給</div>
                {isDaily && (
                  <div className="text-[10px] text-muted-foreground">日給制（勤怠より自動計算）</div>
                )}
              </div>
              <span className="shrink-0 px-1 py-0.5 rounded border text-[10px] bg-red-50 text-red-700 border-red-200">
                課税
              </span>
              {isDaily ? (
                <div className="w-28 text-right text-xs font-semibold text-blue-700 tabular-nums">
                  {baseSalaryInput.toLocaleString("ja-JP")}
                </div>
              ) : (
                <Input
                  type="number"
                  min="0"
                  className="h-6 w-28 text-right border-border/60 shadow-none text-xs font-medium shrink-0"
                  value={baseSalaryInput || ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
                    setBaseSalaryInput(isNaN(v) ? 0 : v);
                  }}
                  placeholder="0"
                />
              )}
              <div className="w-5 shrink-0" />
            </div>

            {/* 手当行（Reorder） */}
            <div className="text-[10px] text-muted-foreground px-4 py-1 bg-muted/20 border-b border-border/40 flex items-center gap-1">
              <GripVertical className="h-3 w-3" />
              ドラッグして並び替えできます
            </div>
            <Reorder.Group axis="y" values={rows} onReorder={setRows} className="select-none">
              {rows.map((row, idx) => (
                <AllowanceReorderItem
                  key={row.uid}
                  row={row}
                  idx={idx}
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
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="h-3 w-3" />
                手当を追加
              </button>
            </div>

            {/* 総支給額 */}
            <div className="flex items-center justify-between px-4 py-2 bg-blue-50">
              <span className="text-xs font-semibold text-blue-900">総支給額</span>
              <span className="text-sm font-bold text-blue-800 tabular-nums">
                {grandTotal > 0 ? `¥${grandTotal.toLocaleString("ja-JP")}` : "—"}
              </span>
            </div>
          </div>

          {/* ── 社会保険料セクション ── */}
          <div className="border-b">
            <button
              type="button"
              className="w-full px-4 py-2 bg-orange-50/70 border-b border-orange-100 flex items-center justify-between"
              onClick={() => setShowInsuranceDetail((v) => !v)}
            >
              <span className="text-xs font-semibold text-orange-800 uppercase tracking-wide">
                社会保険料（自動計算）
              </span>
              <div className="flex items-center gap-1 text-xs text-orange-700 font-semibold tabular-nums">
                {fmt(totalInsurance)}
                {showInsuranceDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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
                    className={`flex items-center justify-between px-4 py-1.5 ${highlight ? "bg-muted/30" : "bg-card"}`}
                  >
                    <span className={`text-xs ${highlight ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
                    <span className={`text-xs tabular-nums ${highlight ? "font-semibold" : ""}`}>{fmt(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 差引セクション ── */}
          <div className="border-b">
            <div className="px-4 py-2 bg-red-50/70 border-b border-red-100">
              <span className="text-xs font-semibold text-red-800 uppercase tracking-wide">差引</span>
            </div>

            {/* 所得税・住民税（固定） */}
            {[
              { label: "所得税", value: incomeTax },
              { label: "住民税", value: residentTax },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-card">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs tabular-nums">{fmt(value)}</span>
                <div className="w-5 shrink-0" />
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
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="h-3 w-3" />
                差引を追加
              </button>
            </div>

            {/* 差引合計 */}
            <div className="flex items-center justify-between px-4 py-2 bg-red-50/60">
              <span className="text-xs font-semibold text-red-900">差引合計</span>
              <span className="text-sm font-bold text-red-800 tabular-nums">{fmt(totalDeductions)}</span>
            </div>
          </div>

          {/* ── 差引支給額 ── */}
          <div className="px-4 py-4 bg-green-50">
            <div className="text-xs text-green-700 font-medium mb-1">差引支給額（手取り概算）</div>
            <div className={`text-2xl font-extrabold tabular-nums ${netSalary >= 0 ? "text-green-800" : "text-red-700"}`}>
              {netSalary !== 0 ? `¥${netSalary.toLocaleString("ja-JP")}` : "¥0"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              ※源泉所得税は月額表甲欄による概算値です
            </div>
          </div>
        </div>

        {/* フッター：保存ボタン */}
        <div className="border-t px-5 py-3 shrink-0 bg-card">
          <Button
            className="w-full gap-2"
            onClick={handleSave}
            disabled={updateAllowances.isPending || updateDeductions.isPending || updateEmployee.isPending}
          >
            <Save className="h-4 w-4" />
            {updateAllowances.isPending ? "保存中..." : "手当・控除を保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── 概算計算（テーブル行用）──────────────────────────────────────────────
function computeQuickEstimate(
  emp: Employee,
  editData: Record<string, number | string>,
  company: ReturnType<typeof useGetCompany>["data"]
) {
  const isDaily = emp.salaryType === "daily";
  const isHourly = emp.salaryType === "hourly";
  const actualWorkHours = Number(editData.actualWorkHours) || 0;

  // 個人日当単価オーバーライドの有無
  const overrideRate    = isDaily ? ((emp.dailyRateOverride ?? 0) > 0 ? (emp.dailyRateOverride ?? 0) : 0) : 0;
  const hasRateOverride = overrideRate > 0;
  // 会社標準日当（オーバーライドなし社員用）
  const companyDailyRate    = company?.dailyWageWeekday ?? 9808;
  const companySaturdayRate = company?.dailyWageSaturday ?? 12260;

  const baseSalary = isDaily && company
    ? Math.round(
        hasRateOverride
          // 個人単価あり: 平日・土曜・日曜/祝日 すべて一律同単価
          ? ((Number(editData.workDays) || 0) + (Number(editData.saturdayWorkDays) || 0) + (Number(editData.sundayWorkDays) || 0)) * overrideRate
          // 会社標準: 平日=companyDailyRate / 土曜=companySaturdayRate / 日曜祝日=companyDailyRate×1.35
          : (Number(editData.workDays) || 0) * companyDailyRate +
            (Number(editData.saturdayWorkDays) || 0) * companySaturdayRate +
            (Number(editData.sundayWorkDays) || 0) * companyDailyRate * 1.35
      )
    : isHourly
    ? Math.round((emp.baseSalary ?? 0) * actualWorkHours)
    : emp.baseSalary ?? 0;

  const monthlyHours = company?.monthlyWorkingHours ?? 160;
  const overtimeHours = Number(editData.overtimeHours) || 0;
  const lateNightHours = Number(editData.lateNightHours) || 0;
  const holidayWorkDays = Number(editData.holidayWorkDays) || 0;

  // 個人残業単位設定がある場合はその計算式を使用（切り上げ×単位単価）
  const unitMinutes = emp.overtimeUnitMinutes ?? 0;
  const unitRate = emp.overtimeUnitRate ?? 0;
  let overtimePay: number;
  let lateNightPay: number;
  let holidayPay: number;
  if (isDaily && unitMinutes > 0 && unitRate > 0) {
    const overtimeMinutes = overtimeHours * 60;
    overtimePay = overtimeMinutes > 0 ? Math.ceil(overtimeMinutes / unitMinutes) * unitRate : 0;
    const lateNightMinutes = lateNightHours * 60;
    lateNightPay = lateNightMinutes > 0 ? Math.ceil(lateNightMinutes / unitMinutes) * unitRate : 0;
    // 祝日/休日手当は会社標準日当×1.35で計算（個人オーバーライドは使わない）
    holidayPay = roundJapanese(companyDailyRate * 1.35 * holidayWorkDays);
  } else {
    // 日給制: 出勤日数が0でも正しい時間単価を得るため日当÷8hで算出
    const hourlyRate = isHourly
      ? (emp.baseSalary ?? 0)
      : isDaily
      ? (hasRateOverride ? overrideRate : companyDailyRate) / 8
      : monthlyHours > 0 ? baseSalary / monthlyHours : 0;
    overtimePay = roundJapanese(hourlyRate * (company?.overtimeRate ?? 1.25) * overtimeHours);
    lateNightPay = roundJapanese(hourlyRate * (company?.lateNightAdditionalRate ?? 0.25) * lateNightHours);
    holidayPay = roundJapanese(hourlyRate * (company?.holidayRate ?? 1.35) * holidayWorkDays * 8);
  }

  const grossEstimate = baseSalary + overtimePay + lateNightPay + holidayPay;

  // 全額非課税社員は控除なし（手取り=総支給）
  const isExempt = emp.taxExempt === true;
  let net: number;
  if (isExempt) {
    net = grossEstimate;
  } else {
    const healthRate = company?.healthInsuranceEmployeeRate ?? 0.05;
    const pensionRate = company?.pensionEmployeeRate ?? 0.0915;
    const eiRate = company?.employmentInsuranceRate ?? 0.006;
    const totalInsurance = roundJapanese(
      grossEstimate * healthRate +
        grossEstimate * pensionRate +
        (emp.employmentInsuranceApplied !== false ? grossEstimate * eiRate : 0)
    );
    const afterInsurance = Math.max(0, grossEstimate - totalInsurance);
    const incomeTax = calculateIncomeTax(afterInsurance, emp.dependentCount ?? 0);
    const residentTax = emp.residentTax ?? 0;
    net = roundJapanese(grossEstimate - totalInsurance - incomeTax - residentTax);
  }

  return { gross: grossEstimate, net };
}

// ── メイン画面 ────────────────────────────────────────────────────────────
export default function MonthlyInput() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees, isLoading: employeesLoading } = useListEmployees({ active: true });
  const { data: monthlyRecords, isLoading: recordsLoading } = useListMonthlyRecords({ year, month });
  const { data: company } = useGetCompany();

  const createRecord = useCreateMonthlyRecord();
  const updateRecord = useUpdateMonthlyRecord();

  const [edits, setEdits] = useState<Record<number, Record<string, number | string>>>({});
  const [saving, setSaving] = useState(false);
  const [calendarEmp, setCalendarEmp] = useState<{ id: number; name: string } | null>(null);
  const [sidebarEmp, setSidebarEmp] = useState<Employee | null>(null);
  const [importing, setImporting] = useState(false);
  const isAutoFilling = useRef(false);
  const isDirtyRef = useRef(false);
  const { setIsDirty } = useNavigationGuard();

  const markDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, [setIsDirty]);

  // ブラウザ離脱（タブ閉じ・リロード）時の警告（ダーティ時のみ）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ページ離脱時にダーティ状態をリセット
  useEffect(() => {
    return () => { markDirty(false); };
  }, [markDirty]);

  // 勤怠データ取り込み関数（共通）
  const applyAttendanceSummary = useCallback(
    (currentEdits: Record<number, Record<string, number | string>>, shouldMarkDirty: boolean) => {
      setImporting(true);
      fetch(`${BASE}/api/attendance/monthly-summary?year=${year}&month=${month}`)
        .then((res) => res.json())
        .then((summary: unknown) => {
          if (!Array.isArray(summary)) {
            toast({ title: "エラー", description: "勤怠データの取得に失敗しました。再ログインして再試行してください。", variant: "destructive" });
            return;
          }
          if (summary.length === 0) {
            if (shouldMarkDirty) {
              toast({ title: "取り込み対象なし", description: `${year}年${month}月の打刻データが見つかりませんでした。` });
            }
            return;
          }
          isAutoFilling.current = true;
          setEdits((prev) => {
            const next = { ...prev };
            for (const s of summary) {
              next[s.employeeId] = {
                ...(next[s.employeeId] || currentEdits[s.employeeId] || {}),
                workDays: s.workDays,
                saturdayWorkDays: s.saturdayWorkDays,
                sundayWorkDays: s.sundayWorkDays,
                overtimeHours: s.overtimeHours,
                absenceDays: s.absenceDays ?? 0,
                drivingDistanceKm: s.drivingDistanceKm ?? 0,
                actualWorkHours: s.actualWorkHours ?? 0,
              };
            }
            return next;
          });
          if (shouldMarkDirty) {
            toast({
              title: "勤怠データを取り込みました",
              description: `${summary.length}名分の出勤・残業・走行距離を反映しました。確認後「実績を保存」してください。`,
            });
            markDirty(true);
          }
        })
        .catch(() => {
          if (shouldMarkDirty) {
            toast({ title: "エラー", description: "勤怠データの取り込みに失敗しました。", variant: "destructive" });
          }
        })
        .finally(() => {
          setImporting(false);
          isAutoFilling.current = false;
        });
    },
    [year, month, toast, markDirty]
  );

  // 手動ボタン用
  const handleImportAttendance = useCallback(() => {
    applyAttendanceSummary(edits, true);
  }, [applyAttendanceSummary, edits]);

  // DB データロード後に編集状態を初期化
  useEffect(() => {
    if (!employees || !monthlyRecords) return;

    const initialEdits: Record<number, Record<string, number | string>> = {};
    employees.forEach((emp) => {
      const empDefaultRate = (emp as Record<string, unknown>).mikawaCommissionRate as number ?? 0;
      const record = monthlyRecords.find((r) => r.employeeId === emp.id);
      if (record) {
        initialEdits[emp.id] = {
          ...record,
          commissionRate: (record as Record<string, unknown>).commissionRate as number || empDefaultRate,
          bluewingSalesAmount: (record as Record<string, unknown>).bluewingSalesAmount as number ?? 0,
        };
      } else {
        initialEdits[emp.id] = {
          workDays: 0, overtimeHours: 0, lateNightHours: 0,
          holidayWorkDays: 0, drivingDistanceKm: 0, deliveryCases: 0,
          absenceDays: 0, saturdayWorkDays: 0, sundayWorkDays: 0, notes: "",
          salesAmount: 0, commissionRate: empDefaultRate, bluewingSalesAmount: 0, actualWorkHours: 0,
        };
      }
    });
    setEdits(initialEdits);
    setIsDirty(false);
  }, [employees, monthlyRecords]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditChange = (employeeId: number, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [field]: field === "notes" ? value : Number(value) || 0,
      },
    }));
    if (!isAutoFilling.current) {
      markDirty(true);
    }
  };

  const handleSaveAll = async () => {
    if (!employees) return;
    setSaving(true);
    try {
      for (const emp of employees) {
        const ed = edits[emp.id] ?? {};
        const existingRecord = monthlyRecords?.find((r) => r.employeeId === emp.id);
        const payload = {
          workDays: Number(ed.workDays) || 0,
          overtimeHours: Number(ed.overtimeHours) || 0,
          lateNightHours: Number(ed.lateNightHours) || 0,
          holidayWorkDays: Number(ed.holidayWorkDays) || 0,
          drivingDistanceKm: Number(ed.drivingDistanceKm) || 0,
          deliveryCases: Number(ed.deliveryCases) || 0,
          absenceDays: Number(ed.absenceDays) || 0,
          saturdayWorkDays: Number(ed.saturdayWorkDays) || 0,
          sundayWorkDays: Number(ed.sundayWorkDays) || 0,
          notes: String(ed.notes || ""),
          salesAmount: Number(ed.salesAmount) || 0,
          commissionRate: Number(ed.commissionRate) || 0,
          bluewingSalesAmount: Number(ed.bluewingSalesAmount) || 0,
          actualWorkHours: Number(ed.actualWorkHours) || 0,
        };

        if (existingRecord) {
          await updateRecord.mutateAsync({ id: existingRecord.id, data: payload });
        } else {
          const hasData =
            payload.workDays > 0 || payload.saturdayWorkDays > 0 ||
            payload.drivingDistanceKm > 0 || payload.deliveryCases > 0 ||
            payload.salesAmount > 0 || payload.bluewingSalesAmount > 0 ||
            payload.actualWorkHours > 0;
          if (hasData) {
            await createRecord.mutateAsync({ data: { employeeId: emp.id, year, month, ...payload } });
          }
        }

        if ((emp as Record<string, unknown>).useBluewingLogic && payload.bluewingSalesAmount > 0) {
          try {
            await fetch(`${BASE}/api/payroll/calculate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ employeeId: emp.id, year, month, useBluewingLogic: true }),
            });
          } catch {
            // 自動計算失敗は無視
          }
        }
      }
      toast({ title: "保存完了", description: `${month}月分の実績を保存しました。` });
      markDirty(false);
      queryClient.invalidateQueries({ queryKey: getListMonthlyRecordsQueryKey({ year, month }) });
    } catch {
      toast({ title: "エラー", description: "一部のデータの保存に失敗しました。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isLoading = employeesLoading || recordsLoading;

  // 入力値チェック（マイナス等）
  const isInvalid = (v: number | string) => Number(v) < 0;

  return (
    <AppLayout>
      <div className="space-y-0">
        {/* ── スティッキーヘッダー ── */}
        <div className="sticky top-0 z-30 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm mb-4">
          <div className="flex flex-wrap items-center gap-3 py-3">
            {/* タイトル */}
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight leading-tight">月次実績入力</h2>
                <p className="text-[11px] text-muted-foreground leading-tight">給与計算の基礎となる各社員の月次実績を入力・管理します</p>
              </div>
            </div>

            {/* 月選択 ＋ ボタン */}
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <RichMonthPicker
                year={year}
                month={month}
                onChange={(y, m) => { setYear(y); setMonth(m); }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportAttendance}
                disabled={isLoading || importing || saving || !employees?.length}
                title="打刻データから出勤日数・残業時間を自動入力"
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${importing ? "animate-spin" : ""}`} />
                {importing ? "取り込み中..." : "勤怠から一括反映"}
              </Button>
              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={isLoading || saving || !employees?.length}
                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "保存中..." : "実績を保存"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── テーブル ── */}
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-210px)]">
            <table className="monthly-input-table w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                {/* グループ行 */}
                <tr className="border-b border-border">
                  {/* 社員名（2行分） */}
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-30 bg-muted border-r border-border px-3 py-2 text-left font-semibold text-muted-foreground min-w-[160px] align-bottom"
                  >
                    社員名・所属
                  </th>
                  {/* 勤怠・時間管理 */}
                  <th
                    colSpan={6}
                    className="border-x border-sky-200 bg-sky-50 py-1.5 text-center font-semibold text-sky-800 text-[11px] tracking-wide"
                  >
                    <div className="flex items-center justify-center gap-1">
                      勤怠・時間管理
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-sky-500/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[220px]">
                          平日・土曜・日曜（祝日含む）・欠勤・残業・深夜の勤務実績を入力します。給与計算の基礎データになります。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {/* 実働時間（時給制） */}
                  <th
                    colSpan={1}
                    className="border-x border-indigo-200 bg-indigo-50 py-1.5 text-center font-semibold text-indigo-800 text-[11px] tracking-wide"
                  >
                    <div className="flex items-center justify-center gap-1">
                      実働時間
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-indigo-500/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[200px]">
                          時給制（事務員）専用。30分単位切り上げ後の月間実働時間です。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {/* 運行実績 */}
                  <th
                    colSpan={1}
                    className="border-x border-amber-200 bg-amber-50 py-1.5 text-center font-semibold text-amber-800 text-[11px] tracking-wide"
                  >
                    <div className="flex items-center justify-center gap-1">
                      運行実績
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-amber-500/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[200px]">
                          当月の走行距離（km）を入力します。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {/* 給与計算基礎 */}
                  <th
                    colSpan={1}
                    className="border-x border-violet-200 bg-violet-50 py-1.5 text-center font-semibold text-violet-800 text-[11px] tracking-wide"
                  >
                    <div className="flex items-center justify-center gap-1">
                      給与計算基礎
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-violet-500/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[220px]">
                          BW売上を入力します。Bluewing計算方式の社員のみ使用します。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {/* 概算（2行分） */}
                  <th
                    rowSpan={2}
                    className="bg-muted border-x border-border px-2 py-1.5 text-center font-semibold text-muted-foreground align-bottom min-w-[110px]"
                  >
                    <div className="flex items-center justify-center gap-1">
                      概算
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[200px]">
                          基本給・残業代のみの手取り概算値です。手当・カスタム控除は含まれません。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {/* 備考（2行分） */}
                  <th
                    rowSpan={2}
                    className="bg-muted border-l border-border px-2 py-1.5 text-left font-semibold text-muted-foreground align-bottom min-w-[130px]"
                  >
                    <div className="flex items-center gap-1">
                      備考
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[200px]">
                          各社員の摘要・メモを入力します。給与計算には影響しません。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                </tr>

                {/* 個別カラム行 */}
                <tr className="border-b border-border">
                  {/* 勤怠7列 */}
                  {[
                    { label: "平日",  sub: "日", tip: "平日の出勤日数。日給制社員の基本給計算に使用します。" },
                    { label: "土曜",  sub: "日", tip: "土曜日の出勤日数。土曜日給（平日と異なる日給）で計算されます。" },
                    { label: "日曜/祝日",  sub: "日", tip: "日曜・祝日・振替休日など会社が休みとしている赤い日の出勤日数。日当×1.35で計算されます。" },
                    { label: "欠勤",  sub: "日", tip: "欠勤日数。欠勤控除の計算に使用します。" },
                    { label: "残業",  sub: "h",  tip: "法定外残業時間（時間単位）。割増賃金（×1.25）で計算されます。" },
                    { label: "深夜",  sub: "h",  tip: "深夜勤務時間（時間単位）。深夜割増（+0.25）が加算されます。" },
                  ].map(({ label, sub, tip }) => (
                    <th key={label} className="bg-sky-50 border-x border-sky-100 px-1 py-1 text-center font-medium text-sky-700 w-[64px]">
                      <div className="flex items-center justify-center gap-0.5 flex-wrap">
                        <span>{label}</span>
                        <span className="text-[9px] text-sky-500">({sub})</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-2.5 w-2.5 text-sky-400/60 cursor-help flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent className="text-xs max-w-[200px]">{tip}</TooltipContent>
                        </Tooltip>
                      </div>
                    </th>
                  ))}
                  {/* 実働時間（時給制事務員用） */}
                  <th className="bg-indigo-50 border-x border-indigo-100 px-1 py-1 text-center font-medium text-indigo-700 w-[64px]">
                    <div className="flex items-center justify-center gap-0.5 flex-wrap">
                      <span>実働</span>
                      <span className="text-[9px] text-indigo-500">(h)</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-2.5 w-2.5 text-indigo-400/60 cursor-help flex-shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[200px]">時給制（事務員）専用。打刻から自動集計された実働時間（30分切り上げ）。時給×実働時間＝基本給。</TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {/* 運行1列 */}
                  {[
                    { label: "走行KM", sub: "km", tip: "当月の総走行距離（km）。走行距離手当の計算に使用します。" },
                  ].map(({ label, sub, tip }) => (
                    <th key={label} className="bg-amber-50 border-x border-amber-100 px-1 py-1 text-center font-medium text-amber-700 w-[72px]">
                      <div className="flex items-center justify-center gap-0.5 flex-wrap">
                        <span>{label}</span>
                        <span className="text-[9px] text-amber-500">({sub})</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-2.5 w-2.5 text-amber-400/60 cursor-help flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent className="text-xs max-w-[200px]">{tip}</TooltipContent>
                        </Tooltip>
                      </div>
                    </th>
                  ))}
                  {/* 給与基礎1列 */}
                  <th className="bg-violet-50 border-x border-violet-100 px-1 py-1 text-center font-medium text-violet-700 w-[96px]">
                    <div className="flex items-center justify-center gap-0.5 flex-wrap">
                      <span>BW売上</span>
                      <span className="text-[9px] text-violet-500">(円)</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-2.5 w-2.5 text-violet-400/60 cursor-help flex-shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[220px]">
                          Bluewing（BW）計算用の売上金額。BW計算方式の社員のみ入力します。通常の売上とは別に管理されます。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={12} className="text-center py-10 text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        読み込み中...
                      </div>
                    </td>
                  </tr>
                ) : !employees || employees.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center py-10 text-muted-foreground">
                      有効な社員が見つかりません
                    </td>
                  </tr>
                ) : (
                  employees.map((emp, empIdx) => {
                    const rowData = edits[emp.id] ?? {};
                    const { gross, net } = computeQuickEstimate(emp, rowData, company);
                    const isBW = (emp as Record<string, unknown>).useBluewingLogic as boolean;
                    const isHourly = emp.salaryType === "hourly";
                    const rowBg = empIdx % 2 === 0 ? "bg-card" : "bg-muted/20";

                    // 個人残業単位設定（清水さんなど）
                    const unitMinutes = emp.overtimeUnitMinutes ?? 0;
                    const unitRate    = emp.overtimeUnitRate   ?? 0;
                    const hasUnit     = unitMinutes > 0 && unitRate > 0;

                    // 単位（回）入力セル: 表示は "回" 単位、内部は時間で保持
                    const unitInput = (field: "overtimeHours" | "lateNightHours") => {
                      const hours    = Number(rowData[field]) || 0;
                      const unitVal  = hours > 0 ? Math.round(hours * 60 / unitMinutes) : "";
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              className="h-7 w-14 text-right text-xs px-1"
                              value={unitVal}
                              onChange={(e) => {
                                const units = Number(e.target.value) || 0;
                                handleEditChange(emp.id, field, String(units * unitMinutes / 60));
                              }}
                              onWheel={(e) => e.currentTarget.blur()}
                              placeholder="0"
                            />
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">回</span>
                          </div>
                          <div className="text-[9px] text-muted-foreground/60 whitespace-nowrap">
                            1回={unitMinutes}分/¥{unitRate.toLocaleString()}
                          </div>
                        </div>
                      );
                    };

                    const numInput = (
                      field: string,
                      opts?: { max?: number; step?: string; width?: string }
                    ) => {
                      const val = rowData[field];
                      const invalid = isInvalid(val);
                      return (
                        <Input
                          type="number"
                          min="0"
                          max={opts?.max}
                          step={opts?.step ?? "0.5"}
                          className={`h-7 w-full text-right text-xs px-1 ${invalid ? "border-red-400 bg-red-50" : ""}`}
                          value={Number(val) || ""}
                          onChange={(e) => handleEditChange(emp.id, field, e.target.value)}
                          onWheel={(e) => e.currentTarget.blur()}
                          placeholder="0"
                        />
                      );
                    };

                    return (
                      <tr key={emp.id} className={`border-b border-border/40 hover:bg-sky-50/20 transition-colors h-[56px] ${rowBg}`}>
                        {/* 社員名（sticky） */}
                        <td className="sticky left-0 z-10 border-r border-border/60 px-3 py-1.5 bg-inherit shadow-[1px_0_0_0_hsl(var(--border))]">
                          <button
                            className="w-full text-left group flex items-center gap-1.5 hover:text-primary transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40 rounded"
                            onClick={() => setCalendarEmp({ id: emp.id, name: emp.name })}
                            title="クリックして勤怠カレンダーを表示"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{emp.name}</div>
                              <div className="text-[10px] text-muted-foreground truncate">{emp.department}</div>
                            </div>
                            <CalIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                          </button>
                        </td>

                        {/* 勤怠6列 */}
                        <td className="p-1 border-x border-sky-100/60">{numInput("workDays", { max: 31, step: "1" })}</td>
                        <td className="p-1 border-x border-sky-100/60">{numInput("saturdayWorkDays", { max: 31, step: "1" })}</td>
                        <td className="p-1 border-x border-sky-100/60">{numInput("sundayWorkDays", { step: "1" })}</td>
                        <td className="p-1 border-x border-sky-100/60">{numInput("absenceDays", { max: 31, step: "1" })}</td>
                        <td className="p-1 border-x border-sky-100/60">
                          {hasUnit ? unitInput("overtimeHours") : numInput("overtimeHours", { step: "0.5" })}
                        </td>
                        <td className="p-1 border-x border-sky-100/60">
                          {hasUnit ? unitInput("lateNightHours") : numInput("lateNightHours", { step: "0.5" })}
                        </td>

                        {/* 実働時間（時給制事務員用） */}
                        <td className="p-1 border-x border-indigo-100/60">
                          {isHourly ? (
                            numInput("actualWorkHours", { step: "0.5" })
                          ) : (
                            <div className="h-7 flex items-center justify-center text-muted-foreground/40">—</div>
                          )}
                        </td>

                        {/* 運行1列 */}
                        <td className="p-1 border-x border-amber-100/60">{numInput("drivingDistanceKm", { step: "0.1" })}</td>

                        {/* 給与基礎1列 */}
                        <td className="p-1 border-x border-violet-100/60">
                          {isBW ? (
                            numInput("bluewingSalesAmount", { step: "1" })
                          ) : (
                            <div className="h-7 flex items-center justify-center text-muted-foreground/40">—</div>
                          )}
                        </td>

                        {/* 概算 */}
                        <td className="px-2 py-1 border-x border-border/40 text-right align-middle">
                          {gross > 0 ? (
                            <div className="leading-snug">
                              <div className="text-[10px] text-muted-foreground font-medium">総支給</div>
                              <div className="font-semibold text-foreground tabular-nums text-sm">¥{gross.toLocaleString("ja-JP")}</div>
                              <div className="text-[10px] text-muted-foreground font-medium mt-0.5">手取概算</div>
                              <div className={`font-bold tabular-nums text-sm ${net >= 0 ? "text-green-700" : "text-red-600"}`}>¥{net.toLocaleString("ja-JP")}</div>
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground/40 text-xs">—</div>
                          )}
                        </td>

                        {/* 備考 */}
                        <td className="p-1 border-l border-border/40">
                          <Input
                            type="text"
                            className="h-7 w-full text-xs px-1"
                            placeholder="摘要"
                            value={String(rowData.notes || "")}
                            onChange={(e) => handleEditChange(emp.id, "notes", e.target.value)}
                          />
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── ダイアログ群 ── */}
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

      <AllowanceSidebar
        employee={sidebarEmp}
        open={!!sidebarEmp}
        onClose={() => setSidebarEmp(null)}
        monthlyData={
          sidebarEmp
            ? {
                workDays: Number(edits[sidebarEmp.id]?.workDays) || 0,
                saturdayWorkDays: Number(edits[sidebarEmp.id]?.saturdayWorkDays) || 0,
                sundayWorkDays: Number(edits[sidebarEmp.id]?.sundayWorkDays) || 0,
              }
            : undefined
        }
      />
    </AppLayout>
  );
}
