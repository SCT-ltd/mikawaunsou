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
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X, GripVertical, ChevronDown, Check } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { calculateIncomeTaxReiwa8, round50sen } from "@/lib/tax-tables-reiwa8";

function roundJapanese(amount: number): number {
  return Math.floor(amount);
}

/**
 * 厚生年金適用判定（サーバー側 resolvePensionApplied と同ロジック）
 * - pensionApplied が true/false → その値をそのまま使用
 * - null/undefined → 生年月日から年齢を算出し 70歳以上なら false
 */
function resolvePensionApplied(
  employee: Employee,
  year?: number,
  month?: number
): boolean {
  const pa = (employee as unknown as { pensionApplied?: boolean | null }).pensionApplied;
  if (pa !== null && pa !== undefined) return pa;
  const dob = (employee as unknown as { dateOfBirth?: string }).dateOfBirth;
  if (!dob) return true;
  const birthDate = new Date(dob);
  const checkYear = year ?? new Date().getFullYear();
  const checkMonth = month ?? new Date().getMonth() + 1;
  const calcDate = new Date(checkYear, checkMonth - 1, 1);
  let age = calcDate.getFullYear() - birthDate.getFullYear();
  const md = calcDate.getMonth() - birthDate.getMonth();
  if (md < 0 || (md === 0 && calcDate.getDate() < birthDate.getDate())) age--;
  return age < 70;
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

// ── 列幅定数（全行で共有） ──────────────────────────────────────────
const COL_DRAG  = "w-5 shrink-0";
const COL_NAME  = "flex-1 min-w-0";
const COL_TAX   = "w-[52px] shrink-0 text-center";
const COL_AMOUNT = "w-[92px] shrink-0";
const COL_DEL   = "w-5 shrink-0";

// ── 検索付きコンボボックス（cmdk不使用・純React実装） ─────────────
function SearchableCombobox({
  options,
  value,
  onValueChange,
  placeholder,
}: {
  options: { id: number; name: string }[];
  value: number | null;
  onValueChange: (id: number) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find(o => o.id === value);
  const filtered = query.trim()
    ? options.filter(o => o.name.includes(query))
    : options;

  const openDropdown = () => {
    setOpen(true);
    setQuery("");
    setActiveIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeDropdown = () => {
    setOpen(false);
    setQuery("");
  };

  const selectOption = (id: number) => {
    onValueChange(id);
    closeDropdown();
  };

  // クリックアウトで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // activeIdx をリスト内に収める
  useEffect(() => {
    setActiveIdx(prev => Math.min(prev, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // activeIdx の項目をスクロールして見せる
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[activeIdx]) selectOption(filtered[activeIdx].id); }
    else if (e.key === "Escape") { closeDropdown(); }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* トリガーボタン */}
      <button
        type="button"
        onClick={openDropdown}
        className="h-7 w-full flex items-center justify-between gap-1 px-2 text-xs border border-border/60 bg-transparent rounded hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
      >
        <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {/* ドロップダウン */}
      {open && (
        <div className="absolute z-50 left-0 top-full mt-0.5 w-full min-w-[180px] max-w-[260px] rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {/* 検索入力 */}
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
              onKeyDown={handleKeyDown}
              placeholder="検索…"
              className="w-full text-xs bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          {/* 候補リスト */}
          <ul ref={listRef} className="max-h-[180px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground text-center">見つかりません</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.id}
                  onMouseDown={(e) => { e.preventDefault(); selectOption(o.id); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors ${i === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"}`}
                >
                  <Check className={`h-3 w-3 shrink-0 ${o.id === value ? "opacity-100 text-primary" : "opacity-0"}`} />
                  <span className="truncate">{o.name}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── 金額入力（固定幅・千区切り表示） ──────────────────────────────
function AmountInput({
  value,
  onChange,
  onEnterKey,
  inputRef,
  placeholder = "0",
}: {
  value: number;
  onChange: (v: number) => void;
  onEnterKey?: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");

  const displayValue = focused
    ? raw
    : value > 0 ? value.toLocaleString("ja-JP") : "";

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      className="h-7 w-full text-right bg-transparent border border-border/60 rounded px-2 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
      value={displayValue}
      placeholder={placeholder}
      onFocus={(e) => {
        setFocused(true);
        setRaw(value > 0 ? String(value) : "");
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
        onChange(isNaN(n) ? 0 : n);
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9]/g, "");
        setRaw(digits);
        const n = parseInt(digits, 10);
        onChange(isNaN(n) ? 0 : n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          onEnterKey?.();
        }
      }}
    />
  );
}

// ── ドラッグハンドル付き手当行 ────────────────────────────────────
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
      value={row}
      dragListener={false}
      dragControls={controls}
      className="list-none"
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 50, borderRadius: "6px", backgroundColor: "hsl(var(--background))" }}
      transition={{ duration: 0.13 }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/40 bg-background hover:bg-primary/5 transition-colors group">
        <div
          onPointerDown={(e) => controls.start(e)}
          className={`${COL_DRAG} cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors`}
        >
          <GripVertical className="h-4 w-4" />
        </div>
        <div className={COL_NAME}>
          <SearchableCombobox
            options={allowanceDefinitions ?? []}
            value={row.defId}
            onValueChange={(id) => onChange(row.uid, { defId: id })}
            placeholder="手当を選択…"
          />
        </div>
        <div className={COL_TAX}>
          {def ? (
            <span
              className={`inline-block px-1 py-0.5 rounded border font-medium leading-none ${def.isTaxable ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}
              style={{ fontSize: "9px" }}
            >
              {def.isTaxable ? "課税" : "非課税"}
            </span>
          ) : null}
        </div>
        <div className={COL_AMOUNT}>
          <AmountInput
            value={row.amount}
            onChange={(v) => onChange(row.uid, { amount: v })}
            onEnterKey={onEnterKey}
            inputRef={inputRef}
          />
        </div>
        <button
          type="button"
          onClick={() => onDelete(row.uid)}
          className={`${COL_DEL} flex items-center justify-center text-muted-foreground/30 hover:text-destructive transition-colors`}
          title="削除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}

// ── ドラッグハンドル付き差引行 ────────────────────────────────────
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
      value={row}
      dragListener={false}
      dragControls={controls}
      className="list-none"
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 50, borderRadius: "6px", backgroundColor: "hsl(var(--background))" }}
      transition={{ duration: 0.13 }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/40 bg-background hover:bg-primary/5 transition-colors group">
        <div
          onPointerDown={(e) => controls.start(e)}
          className={`${COL_DRAG} cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors`}
        >
          <GripVertical className="h-4 w-4" />
        </div>
        <div className={COL_NAME}>
          <SearchableCombobox
            options={deductionDefinitions ?? []}
            value={row.defId}
            onValueChange={(id) => onChange(row.uid, { defId: id })}
            placeholder="差引を選択…"
          />
        </div>
        <div className={COL_TAX} />
        <div className={COL_AMOUNT}>
          <AmountInput
            value={row.amount}
            onChange={(v) => onChange(row.uid, { amount: v })}
            onEnterKey={onEnterKey}
            inputRef={inputRef}
          />
        </div>
        <button
          type="button"
          onClick={() => onDelete(row.uid)}
          className={`${COL_DEL} flex items-center justify-center text-muted-foreground/30 hover:text-destructive transition-colors`}
          title="削除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}

// ── セクションヘッダー ────────────────────────────────────────────
function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1 ${accent} border-b border-border`}>
      <span className="text-[10px] font-bold tracking-widest uppercase">{label}</span>
    </div>
  );
}

// ── 表示行（固定金額表示） ─────────────────────────────────────────
function DisplayRow({
  label,
  value,
  bg = "",
  labelClass = "text-muted-foreground",
  valueClass = "tabular-nums",
  bold = false,
  exempt = false,
}: {
  label: string;
  value: number;
  bg?: string;
  labelClass?: string;
  valueClass?: string;
  bold?: boolean;
  exempt?: boolean;
}) {
  const fmt = (v: number) => v > 0 ? v.toLocaleString("ja-JP") : "0";
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 border-b border-border/40 ${bg}`}>
      <div className={COL_DRAG} />
      <div className={`${COL_NAME} text-xs ${labelClass} ${bold ? "font-semibold" : ""}`}>{label}</div>
      <div className={COL_TAX} />
      <div className={`${COL_AMOUNT} text-right text-xs pr-1 ${valueClass} ${bold ? "font-bold" : ""}`}>
        {exempt
          ? <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">非課税</span>
          : fmt(value)}
      </div>
      <div className={COL_DEL} />
    </div>
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
      allowanceInputRefsMap.current.get(currentRows[idx + 1].uid)?.focus();
    }
  }, []);

  const handleDeductionEnterKey = useCallback((uid: string) => {
    const currentRows = deductionRowsRef.current;
    const idx = currentRows.findIndex(r => r.uid === uid);
    if (idx >= 0 && idx < currentRows.length - 1) {
      deductionInputRefsMap.current.get(currentRows[idx + 1].uid)?.focus();
    }
  }, []);

  const allowancesInitializedRef = useRef<number | null>(null);
  const deductionsInitializedRef = useRef<number | null>(null);

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

  useEffect(() => {
    allowancesInitializedRef.current = null;
    deductionsInitializedRef.current = null;
    setRows([{ uid: newUid(), defId: null, amount: 0 }]);
    setDeductionRows([{ uid: newUid(), defId: null, amount: 0 }]);
    markClean();
  }, [employeeId, markClean]);

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
  // 土曜出勤手当・日曜出勤手当は別項目で計上されるため、基本給プレビューには平日分のみ
  // 個人単価（dailyRateWeekday > 0）があればそれを優先、なければ会社共通単価を使用
  const effectiveDailyRate = (employee.dailyRateWeekday ?? 0) > 0
    ? employee.dailyRateWeekday!
    : (company?.dailyWageWeekday ?? 9808);
  const computedDailyBaseSalary = isDaily && company
    ? Math.round((monthlyData?.workDays ?? 0) * effectiveDailyRate)
    : null;

  useEffect(() => {
    // 日給制は当月の月次実績から常に再計算（マスター employee.baseSalary は無視）
    if (isDaily && computedDailyBaseSalary !== null) {
      setBaseSalaryInput(computedDailyBaseSalary);
    } else {
      setBaseSalaryInput(employee.baseSalary ?? 0);
    }
  }, [employee.baseSalary, employeeId, isDaily, computedDailyBaseSalary]);

  const handleSave = async () => {
    try {
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

  // ── 計算 ──────────────────────────────────────────────────────────
  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;

  const pensionRate = company?.pensionEmployeeRate ?? 0.0915;
  const empInsRate = (company?.employmentInsuranceRate ?? 0) > 0
    ? company!.employmentInsuranceRate
    : 0.0005;

  const HEALTH_RATE_NO_CARE  = 0.04925;
  const HEALTH_RATE_WITH_CARE = 0.05735;
  const CHILDCARE_RATE = 0.00115;

  const appliedHealthRate = employee.careInsuranceApplied === true
    ? HEALTH_RATE_WITH_CARE
    : HEALTH_RATE_NO_CARE;

  const empSR = (employee as unknown as { standardRemuneration?: number }).standardRemuneration ?? 0;
  const insBase = empSR > 0 ? empSR : grandTotal;

  const isTaxExemptEmployee = employee.taxExempt === true;

  const healthInsurance = isTaxExemptEmployee ? 0 : round50sen(insBase * appliedHealthRate);
  const childcareSupportApplicable = !(year !== undefined && month !== undefined && (year < 2026 || (year === 2026 && month <= 3)));
  const childcareSupportContribution = (isTaxExemptEmployee || !childcareSupportApplicable) ? 0 : round50sen(insBase * CHILDCARE_RATE);
  const isPensionApplied = resolvePensionApplied(employee, year, month);
  const pensionInsurance = (isTaxExemptEmployee || !isPensionApplied) ? 0 : round50sen(Math.min(insBase, 650_000) * pensionRate);

  const nonTaxableAllowancesTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions?.find(d => d.id === r.defId);
    return s + (def && !def.isTaxable ? (r.amount || 0) : 0);
  }, 0);

  const employmentInsurance = (isTaxExemptEmployee || employee.employmentInsuranceApplied === false)
    ? 0
    : round50sen(grandTotal * empInsRate);

  const totalInsurance = healthInsurance + childcareSupportContribution + pensionInsurance + employmentInsurance;

  const incomeTaxBase = Math.max(0,
    grandTotal - nonTaxableAllowancesTotal - healthInsurance - childcareSupportContribution - pensionInsurance - employmentInsurance
  );
  const afterInsuranceSalary = Math.max(0,
    grandTotal - healthInsurance - childcareSupportContribution - pensionInsurance - employmentInsurance
  );
  const dependentEquivCount = (employee.dependentCount ?? 0) + ((employee.hasSpouse ?? false) ? 1 : 0);
  const incomeTax = isTaxExemptEmployee ? 0 : calculateIncomeTaxReiwa8(incomeTaxBase, dependentEquivCount);

  const residentTax = employee.residentTax ?? 0;
  const customDeductionsTotal = deductionRows.reduce((s, r) => s + (r.amount || 0), 0);
  const otherDeductionFixed = (employee as unknown as { otherDeductionMonthly?: number }).otherDeductionMonthly ?? 0;

  const totalDeductions = roundJapanese(totalInsurance + incomeTax + residentTax + customDeductionsTotal + otherDeductionFixed);
  const netSalary = roundJapanese(grandTotal - totalDeductions);

  const isBwEmployee = !!(employee as unknown as { useBluewingLogic?: boolean }).useBluewingLogic;
  const fmt = (v: number) => v >= 0 ? v.toLocaleString("ja-JP") : "—";

  return (
    <div className="flex flex-col gap-0 select-none">
      {/* ── ヘッダー行 ── */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/60 border-b border-border text-[10px] font-semibold text-muted-foreground">
        <div className={COL_DRAG} />
        <div className={COL_NAME}>名称</div>
        <div className={`${COL_TAX} text-center`}>課税</div>
        <div className={`${COL_AMOUNT} text-right pr-1`}>金額（円）</div>
        <div className={COL_DEL} />
      </div>

      {/* ══ 支給セクション ══ */}
      <SectionHeader label="支　給" accent="bg-blue-50/80 text-blue-800" />

      {/* 基本給行 */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/40 bg-background">
        <div className={COL_DRAG} />
        <div className={`${COL_NAME} text-xs`}>
          <span className="font-medium">基本給</span>
          {isDaily && (
            <span className="ml-1.5 text-muted-foreground" style={{ fontSize: "9px" }}>日給制（手動設定可）</span>
          )}
        </div>
        <div className={COL_TAX}>
          <span className="inline-block px-1 py-0.5 rounded border font-medium bg-red-50 text-red-700 border-red-200 leading-none" style={{ fontSize: "9px" }}>課税</span>
        </div>
        <div className={COL_AMOUNT}>
          <AmountInput
            value={baseSalaryInput}
            onChange={(v) => { setBaseSalaryInput(v); markDirty(); }}
            inputRef={(el) => { (baseSalaryRef as React.MutableRefObject<HTMLInputElement | null>).current = el; }}
          />
        </div>
        <div className={COL_DEL} />
      </div>

      {/* 手当ドラッグ行 */}
      <Reorder.Group
        axis="y"
        values={rows}
        onReorder={(newRows) => { setRows(newRows); markDirty(); }}
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

      {/* 行を追加 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/40 bg-muted/10">
        <div className={COL_DRAG} />
        <button
          type="button"
          onClick={() => { setRows(prev => [...prev, { uid: newUid(), defId: null, amount: 0 }]); markDirty(); }}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="h-3 w-3" />
          行を追加
        </button>
      </div>

      {/* 総支給金額 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 border-b border-border">
        <div className={COL_DRAG} />
        <div className={`${COL_NAME} text-xs font-semibold text-blue-900`}>
          総支給金額
          {isBwEmployee && <span className="ml-1 font-normal text-blue-600">※BW分除く</span>}
        </div>
        <div className={COL_TAX} />
        <div className={`${COL_AMOUNT} text-right pr-1 text-xs font-bold text-blue-800 tabular-nums`}>
          {grandTotal > 0 ? grandTotal.toLocaleString("ja-JP") : "—"}
        </div>
        <div className={COL_DEL} />
      </div>

      {/* ══ 控除（社会保険料）セクション ══ */}
      <SectionHeader label="控　除（社会保険料）" accent="bg-orange-50/80 text-orange-800" />

      <DisplayRow label={`健康保険料${employee.careInsuranceApplied === true ? "（介護込）" : ""}`} value={healthInsurance} exempt={employee.taxExempt === true} />
      <DisplayRow label="子ども・子育て支援金" value={childcareSupportContribution} bg="bg-muted/10" exempt={employee.taxExempt === true} />
      <DisplayRow label="厚生年金保険料" value={pensionInsurance} exempt={employee.taxExempt === true} />
      <DisplayRow label="雇用保険料" value={employmentInsurance} bg="bg-muted/10" exempt={employee.taxExempt === true} />
      <DisplayRow label="社会保険料控除後の金額" value={afterInsuranceSalary} labelClass="font-medium text-foreground" valueClass="tabular-nums font-medium" />

      {/* 社会保険料合計 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-orange-50 border-b border-border">
        <div className={COL_DRAG} />
        <div className={`${COL_NAME} text-xs font-semibold text-orange-900`}>社会保険料合計</div>
        <div className={COL_TAX} />
        <div className={`${COL_AMOUNT} text-right pr-1 text-xs font-bold text-orange-700 tabular-nums`}>
          {isTaxExemptEmployee
            ? <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">非課税</span>
            : fmt(totalInsurance)}
        </div>
        <div className={COL_DEL} />
      </div>

      {/* ══ 差引セクション ══ */}
      <SectionHeader label="差　引" accent="bg-red-50/80 text-red-800" />

      <DisplayRow label="所得税" value={incomeTax} exempt={employee.taxExempt === true} />
      <DisplayRow label="市町村民税" value={residentTax} bg="bg-muted/10" />

      {/* 差引ドラッグ行 */}
      <Reorder.Group
        axis="y"
        values={deductionRows}
        onReorder={(newRows) => { setDeductionRows(newRows); markDirty(); }}
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

      {/* 差引 行を追加 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/40 bg-muted/10">
        <div className={COL_DRAG} />
        <button
          type="button"
          onClick={() => { setDeductionRows(prev => [...prev, { uid: newUid(), defId: null, amount: 0 }]); markDirty(); }}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="h-3 w-3" />
          行を追加
        </button>
      </div>

      {/* 差引合計額 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/40 border-b border-border">
        <div className={COL_DRAG} />
        <div className={`${COL_NAME} text-xs font-semibold text-muted-foreground`}>差引合計額</div>
        <div className={COL_TAX} />
        <div className={`${COL_AMOUNT} text-right pr-1 text-xs font-bold text-red-700 tabular-nums`}>{fmt(totalDeductions)}</div>
        <div className={COL_DEL} />
      </div>

      {/* 差引支給額 */}
      <div className="flex items-center gap-1.5 px-2 py-2 bg-green-50 border-b border-border">
        <div className={COL_DRAG} />
        <div className={`${COL_NAME} text-xs font-bold text-green-900`}>差引支給額</div>
        <div className={COL_TAX} />
        <div className={`${COL_AMOUNT} text-right pr-1 font-extrabold text-green-800 tabular-nums`} style={{ fontSize: "13px" }}>
          {fmt(netSalary)}
        </div>
        <div className={COL_DEL} />
      </div>

      {/* 注記 */}
      {isBwEmployee && (
        <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
          <strong>BW社員:</strong> 上記は基本給・手当のみ。時間外手当・業績手当（BW計算）は「給与明細」タブで確認してください。
        </div>
      )}
      {company && (
        <div className="mt-1 px-3 py-2 bg-muted/40 border rounded text-xs text-muted-foreground">
          適用料率：健保 {(appliedHealthRate * 100).toFixed(3)}%
          {employee.careInsuranceApplied && <span className="text-amber-600">（介護込）</span>}
          {childcareSupportApplicable ? "・子育て支援金 0.115%" : "・子育て支援金 0%（3月以前）"}・厚年 {(pensionRate * 100).toFixed(2)}%・雇保 {(empInsRate * 100).toFixed(1)}%
          {empSR > 0 && (
            <span className="ml-2 text-blue-600">（健保・厚年{childcareSupportApplicable ? "・支援金" : ""}は標準報酬月額 {empSR.toLocaleString("ja-JP")} 円ベース）</span>
          )}
        </div>
      )}

      {/* 保存ボタン */}
      <div className="border-t pt-3 mt-2">
        <Button
          className="w-full"
          onClick={handleSave}
          disabled={updateAllowances.isPending || updateDeductions.isPending || updateEmployee.isPending}
        >
          {isDirty ? "💾 保存（未保存の変更あり）" : "保存"}
        </Button>
      </div>
    </div>
  );
}
