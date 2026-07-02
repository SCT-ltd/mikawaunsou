import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListEmployees,
  useListMonthlyRecords,
  useCreateMonthlyRecord,
  useUpdateMonthlyRecord,
  getListMonthlyRecordsQueryKey,
  useGetCompany,
} from "@workspace/api-client-react";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Save,
  RefreshCw,
  FileSpreadsheet,
  CalendarDays as CalIcon,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Users,
} from "lucide-react";
import { AttendanceCalendarDialog } from "@/components/attendance-calendar-dialog";
import { useNavigationGuard } from "@/context/navigation-guard-context";
import {
  EmployeeExt,
  CompanySettings,
  RowData,
} from "@/components/monthly-input/estimate";
import {
  EmployeeList,
  filterEmployees,
  SalaryTypeBadge,
  BWBadge,
} from "@/components/monthly-input/employee-list";
import { RecordForm } from "@/components/monthly-input/record-form";
import { AllowancePanel } from "@/components/monthly-input/allowance-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * 月次実績入力（マスターディテール型）。
 * 左: 社員リスト（検索・入力状態・手取り概算）、右: 選択社員の詳細（実績入力／手当・控除タブ）。
 * 保存は従来どおり全員一括（変更のあった社員数をボタンに表示）。
 * データフロー・保存 payload・計算ロジックは旧テーブル型 UI から変更なし。
 */
export default function MonthlyInput() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employeesData, isLoading: employeesLoading } = useListEmployees({ active: true });
  const { data: monthlyRecords, isLoading: recordsLoading } = useListMonthlyRecords({ year, month });
  const { data: companyData } = useGetCompany();
  const company = companyData as CompanySettings | undefined;

  const employees: EmployeeExt[] = useMemo(() => employeesData ?? [], [employeesData]);

  const createRecord = useCreateMonthlyRecord();
  const updateRecord = useUpdateMonthlyRecord();

  const [edits, setEdits] = useState<Record<number, RowData>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("record");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isAutoFilling = useRef(false);
  const isDirtyRef = useRef(false);
  const { setIsDirty } = useNavigationGuard();

  // dirtyIds → ナビゲーションガード同期
  useEffect(() => {
    const dirty = dirtyIds.size > 0;
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, [dirtyIds, setIsDirty]);

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
    return () => {
      isDirtyRef.current = false;
      setIsDirty(false);
    };
  }, [setIsDirty]);

  // 勤怠データ取り込み関数（共通・旧実装と同ロジック）
  const applyAttendanceSummary = useCallback(
    (currentEdits: Record<number, RowData>, shouldMarkDirty: boolean) => {
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
            setDirtyIds((prev) => {
              const next = new Set(prev);
              for (const s of summary) next.add(s.employeeId as number);
              return next;
            });
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
    [year, month, toast]
  );

  // 手動ボタン用
  const handleImportAttendance = useCallback(() => {
    applyAttendanceSummary(edits, true);
  }, [applyAttendanceSummary, edits]);

  // DB データロード後に編集状態を初期化（旧実装と同ロジック）
  useEffect(() => {
    if (!employees.length || !monthlyRecords) return;

    const initialEdits: Record<number, RowData> = {};
    employees.forEach((emp) => {
      const record = monthlyRecords.find((r) => r.employeeId === emp.id);
      if (record) {
        const rec = record as unknown as { bluewingSalesAmount?: number };
        initialEdits[emp.id] = {
          ...record,
          bluewingSalesAmount: rec.bluewingSalesAmount ?? 0,
        };
      } else {
        initialEdits[emp.id] = {
          workDays: 0, overtimeHours: 0, lateNightHours: 0,
          holidayWorkDays: 0, drivingDistanceKm: 0, deliveryCases: 0,
          absenceDays: 0, saturdayWorkDays: 0, sundayWorkDays: 0, notes: "",
          bluewingSalesAmount: 0, actualWorkHours: 0,
        };
      }
    });
    setEdits(initialEdits);
    setDirtyIds(new Set());
  }, [employees, monthlyRecords]);

  const handleEditChange = (employeeId: number, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [field]: field === "notes" ? value : Number(value) || 0,
      },
    }));
    if (!isAutoFilling.current) {
      setDirtyIds((prev) => {
        if (prev.has(employeeId)) return prev;
        const next = new Set(prev);
        next.add(employeeId);
        return next;
      });
    }
  };

  // 一括保存 → 保存した社員をそのまま給与計算（全社員で統一。計算ロジックは
  // employeeId/year/month のみ渡し、BW判定などはサーバ側 emp 設定に一任する）。
  const handleSaveAll = async () => {
    if (!employees.length) return;
    setSaving(true);
    try {
      // 実績を保存し、保存対象（データのある社員）を控える
      const savedEmployeeIds: number[] = [];
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
          bluewingSalesAmount: Number(ed.bluewingSalesAmount) || 0,
          actualWorkHours: Number(ed.actualWorkHours) || 0,
        };

        if (existingRecord) {
          await updateRecord.mutateAsync({ id: existingRecord.id, data: payload });
          savedEmployeeIds.push(emp.id);
        } else {
          const hasData =
            payload.workDays > 0 || payload.saturdayWorkDays > 0 ||
            payload.drivingDistanceKm > 0 || payload.deliveryCases > 0 ||
            payload.bluewingSalesAmount > 0 || payload.actualWorkHours > 0;
          if (hasData) {
            await createRecord.mutateAsync({ data: { employeeId: emp.id, year, month, ...payload } });
            savedEmployeeIds.push(emp.id);
          }
        }
      }

      // 保存した社員の給与を続けて計算（確定済みはサーバが 409 で弾くので無視）。
      // 失敗は個別に無視し、詳細なエラー表示は給与明細画面の一括計算に委ねる。
      let calculated = 0;
      for (const employeeId of savedEmployeeIds) {
        try {
          const res = await fetch(`${BASE}/api/payroll/calculate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employeeId, year, month }),
          });
          if (res.ok) calculated++;
        } catch {
          // 自動計算失敗は無視（給与明細画面で再計算・エラー確認できる）
        }
      }

      toast({
        title: "保存して計算しました",
        description: `${month}月分の実績${savedEmployeeIds.length}名分を保存し、${calculated}名分の給与を計算しました。`,
      });
      setDirtyIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListMonthlyRecordsQueryKey({ year, month }) });
    } catch {
      toast({ title: "エラー", description: "一部のデータの保存に失敗しました。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isLoading = employeesLoading || recordsLoading;

  // ── 選択・ナビゲーション ────────────────────────────────────────────
  const filtered = useMemo(() => filterEmployees(employees, search), [employees, search]);
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedId) ?? null,
    [employees, selectedId]
  );

  // 初回ロード時（デスクトップのみ）先頭社員を自動選択（一度きり。
  // 以降は selectedId=null でも再選択しない）
  const didInitSelectRef = useRef(false);
  useEffect(() => {
    if (didInitSelectRef.current || employees.length === 0) return;
    didInitSelectRef.current = true;
    if (selectedId === null && window.matchMedia("(min-width: 768px)").matches) {
      setSelectedId(employees[0].id);
    }
  }, [employees, selectedId]);

  // 選択社員が一覧から消えた場合はリセット
  useEffect(() => {
    if (selectedId !== null && employees.length > 0 && !employees.some((e) => e.id === selectedId)) {
      setSelectedId(null);
    }
  }, [employees, selectedId]);

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (filtered.length === 0) return;
      const idx = filtered.findIndex((e) => e.id === selectedId);
      const nextIdx =
        idx === -1
          ? 0
          : Math.min(filtered.length - 1, Math.max(0, idx + delta));
      setSelectedId(filtered[nextIdx].id);
    },
    [filtered, selectedId]
  );

  // Ctrl(⌘)+↑↓ で社員切り替え。ただし入力欄への入力中は誤爆で未保存編集が
  // 失われるため無効化（手当・控除タブの編集消失を防ぐ）。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveSelection]);

  const selectedIdx = filtered.findIndex((e) => e.id === selectedId);
  const dirtyCount = dirtyIds.size;

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        {/* ── ツールバー ── */}
        <div className="shrink-0 pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shrink-0">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base md:text-lg font-bold jp-tight leading-tight">月次実績入力</h2>
                <p className="hidden lg:block text-[11px] text-muted-foreground leading-tight">
                  左のリストから社員を選び、月次実績を入力します（Ctrl+↑↓で社員移動）
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <RichMonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportAttendance}
                disabled={isLoading || importing || saving || !employees.length}
                title="打刻データから出勤日数・残業時間を自動入力"
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${importing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{importing ? "取り込み中..." : "勤怠から一括反映"}</span>
                <span className="sm:hidden">{importing ? "取込中..." : "勤怠反映"}</span>
              </Button>
              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={isLoading || saving || !employees.length}
                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving
                  ? "保存して計算中..."
                  : dirtyCount > 0
                  ? `${dirtyCount}名分を保存して計算`
                  : "保存して計算"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── 2ペイン本体 ── */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-sm rounded-xl border bg-card">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            読み込み中...
          </div>
        ) : employees.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm rounded-xl border bg-card">
            有効な社員が見つかりません
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex md:gap-4">
            {/* ── 左ペイン: 社員リスト ── */}
            <div
              className={`${
                selectedId !== null ? "hidden md:flex" : "flex"
              } w-full md:w-72 lg:w-80 2xl:w-96 shrink-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden`}
            >
              <EmployeeList
                employees={employees}
                filtered={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                edits={edits}
                dirtyIds={dirtyIds}
                company={company}
                search={search}
                onSearchChange={setSearch}
              />
            </div>

            {/* ── 右ペイン: 詳細パネル ── */}
            <div
              className={`${
                selectedId === null ? "hidden md:flex" : "flex"
              } flex-1 min-w-0 flex-col min-h-0`}
            >
              {selectedEmployee ? (
                <div className="flex flex-col h-full min-h-0 rounded-xl border bg-card overflow-hidden">
                  {/* 詳細ヘッダー */}
                  <div className="px-3 md:px-4 py-2.5 border-b flex items-center gap-2 md:gap-3 shrink-0 bg-muted/20">
                    {/* モバイル: リストへ戻る */}
                    <button
                      type="button"
                      className="md:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                      onClick={() => setSelectedId(null)}
                      aria-label="社員リストへ戻る"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="h-9 w-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                      {selectedEmployee.name?.charAt(0) ?? "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-base jp-tight truncate">{selectedEmployee.name}</div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-[11px] text-muted-foreground truncate">
                          {selectedEmployee.department}
                        </span>
                        <SalaryTypeBadge emp={selectedEmployee} />
                        {selectedEmployee.useBluewingLogic && <BWBadge />}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => setCalendarOpen(true)}
                      title="勤怠カレンダーを表示"
                    >
                      <CalIcon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">勤怠カレンダー</span>
                    </Button>
                    {/* 前へ／次へ */}
                    <div className="hidden md:flex items-center border rounded-md overflow-hidden shrink-0">
                      <button
                        type="button"
                        className="p-1.5 hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        onClick={() => moveSelection(-1)}
                        disabled={selectedIdx <= 0}
                        title="前の社員（Ctrl+↑）"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="px-1.5 text-[11px] text-muted-foreground amount border-x">
                        {selectedIdx + 1}/{filtered.length}
                      </span>
                      <button
                        type="button"
                        className="p-1.5 hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        onClick={() => moveSelection(1)}
                        disabled={selectedIdx === -1 || selectedIdx >= filtered.length - 1}
                        title="次の社員（Ctrl+↓）"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* タブ */}
                  <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="flex-1 min-h-0 flex flex-col"
                  >
                    <div className="px-3 md:px-4 pt-3 shrink-0">
                      <TabsList className="grid grid-cols-2 w-full sm:w-80">
                        <TabsTrigger value="record">実績入力</TabsTrigger>
                        <TabsTrigger value="allowance">手当・控除</TabsTrigger>
                      </TabsList>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
                      <TabsContent value="record" className="mt-0">
                        <RecordForm
                          employee={selectedEmployee}
                          rowData={edits[selectedEmployee.id] ?? {}}
                          onChange={(field, value) => handleEditChange(selectedEmployee.id, field, value)}
                          company={company}
                        />
                      </TabsContent>
                      <TabsContent value="allowance" className="mt-0 data-[state=inactive]:hidden" forceMount>
                        <AllowancePanel
                          key={selectedEmployee.id}
                          employee={selectedEmployee}
                          monthlyData={{
                            workDays: Number(edits[selectedEmployee.id]?.workDays) || 0,
                            saturdayWorkDays: Number(edits[selectedEmployee.id]?.saturdayWorkDays) || 0,
                            sundayWorkDays: Number(edits[selectedEmployee.id]?.sundayWorkDays) || 0,
                          }}
                        />
                      </TabsContent>
                    </div>
                  </Tabs>
                </div>
              ) : (
                <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-2 rounded-xl border bg-card text-muted-foreground">
                  <Users className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm">左のリストから社員を選択してください</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 勤怠カレンダーダイアログ ── */}
      {selectedEmployee && calendarOpen && (
        <AttendanceCalendarDialog
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          employeeId={selectedEmployee.id}
          employeeName={selectedEmployee.name}
          year={year}
          month={month}
        />
      )}
    </AppLayout>
  );
}
