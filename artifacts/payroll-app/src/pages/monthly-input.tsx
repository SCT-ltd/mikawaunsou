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
import { HelpTip } from "@/components/help-tip";
import { useNavigationGuard } from "@/context/navigation-guard-context";
import {
  EmployeeExt,
  CompanySettings,
  RowData,
  hasAnyRecordData,
} from "@/components/monthly-input/estimate";
import {
  EmployeeList,
  filterEmployees,
  SalaryTypeBadge,
  BWBadge,
} from "@/components/monthly-input/employee-list";
import { RecordForm } from "@/components/monthly-input/record-form";
import { useMonthInsurance } from "@/lib/insurance-rates";
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
  // 表示中の月の保険料率・標準報酬月額（マスターの履歴）。社員一覧・実績入力の手取り概算に使う
  const monthInsurance = useMonthInsurance(year, month);
  const company = companyData as CompanySettings | undefined;

  const employees: EmployeeExt[] = useMemo(() => employeesData ?? [], [employeesData]);

  const createRecord = useCreateMonthlyRecord();
  const updateRecord = useUpdateMonthlyRecord();

  const [edits, setEdits] = useState<Record<number, RowData>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
  /** 保存・計算中の対象。"dirty"=変更した社員すべて、数値=その社員1名、null=待機中 */
  const [savingTarget, setSavingTarget] = useState<"dirty" | number | null>(null);
  const saving = savingTarget !== null;
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("record");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isAutoFilling = useRef(false);
  const isDirtyRef = useRef(false);
  const dirtyIdsRef = useRef<Set<number>>(new Set());
  const { setIsDirty } = useNavigationGuard();

  // dirtyIds → ナビゲーションガード同期
  useEffect(() => {
    const dirty = dirtyIds.size > 0;
    isDirtyRef.current = dirty;
    dirtyIdsRef.current = dirtyIds;
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
          // 取り込みは下記フィールドを打刻集計で上書きする（深夜時間は対象外）。
          // 未保存の手入力がある社員の値まで無言で消えてしまうため、事前に確認を取る。
          if (shouldMarkDirty) {
            const dirtyTargets = (summary as Array<{ employeeId: number }>)
              .filter((s) => dirtyIdsRef.current.has(s.employeeId))
              .map((s) => employees.find((e) => e.id === s.employeeId)?.name ?? `社員ID ${s.employeeId}`);
            if (dirtyTargets.length > 0) {
              const ok = window.confirm(
                `未保存の手入力がある社員がいます:\n${dirtyTargets.join("・")}\n\n` +
                  "打刻データを取り込むと、これらの社員の\n" +
                  "「平日出勤・土曜出勤・日曜出勤・祝日出勤・欠勤・有給・残業時間・走行距離・実働時間」は\n" +
                  "打刻集計の値で上書きされます（深夜時間は上書きされません）。\n\n" +
                  "取り込みを続けますか？"
              );
              if (!ok) return;
            }
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
                sundayWorkHours: s.sundayWorkHours ?? 0,
                // 平日の祝日に出勤した日数（勤怠から自動で見分ける）
                holidayWorkDays: (s as { holidayWorkDays?: number }).holidayWorkDays ?? 0,
                overtimeHours: s.overtimeHours,
                absenceDays: s.absenceDays ?? 0,
                paidLeaveDays: s.paidLeaveDays ?? 0,
                drivingDistanceKm: s.drivingDistanceKm ?? 0,
                actualWorkHours: s.actualWorkHours ?? 0,
              };
            }
            return next;
          });
          if (shouldMarkDirty) {
            toast({
              title: "勤怠データを取り込みました",
              description: `${summary.length}名分の出勤・残業・走行距離を反映しました。深夜時間は打刻から取り込めないため手入力のまま残ります。確認後「実績を保存」してください。`,
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
    [year, month, toast, employees]
  );

  // 手動ボタン用
  const handleImportAttendance = useCallback(() => {
    applyAttendanceSummary(edits, true);
  }, [applyAttendanceSummary, edits]);

  // DB データロード後に編集状態を初期化する。
  // 社員一覧・月次実績が再取得されるたびに走るので、同じ月のうちは「未保存の編集がある社員」の
  // 入力を保持する。以前は全員をDBの値で作り直していたため、手当・控除の自動保存が社員一覧を
  // 再取得した瞬間に、入力途中の残業時間などが巻き戻っていた（実ブラウザ検証で発覚）。
  // 月を切り替えたときは、前の月の編集を持ち越さないよう全員を作り直す。
  const editsMonthRef = useRef<string | null>(null);
  useEffect(() => {
    if (!employees.length || !monthlyRecords) return;

    const monthKey = `${year}-${month}`;
    const sameMonth = editsMonthRef.current === monthKey;
    const keepIds = sameMonth ? new Set(dirtyIdsRef.current) : new Set<number>();

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
          absenceDays: 0, paidLeaveDays: 0, saturdayWorkDays: 0, sundayWorkDays: 0, sundayWorkHours: 0, notes: "",
          bluewingSalesAmount: 0, actualWorkHours: 0,
        };
      }
    });
    setEdits((prev) => {
      if (keepIds.size === 0) return initialEdits;
      const merged = { ...initialEdits };
      keepIds.forEach((id) => {
        if (prev[id]) merged[id] = prev[id];
      });
      return merged;
    });
    if (!sameMonth) setDirtyIds(new Set());
    editsMonthRef.current = monthKey;
  }, [employees, monthlyRecords, year, month]);

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

  // 保存して計算。対象の社員だけ月次実績を保存し、その社員の給与明細を計算する。
  // 以前はボタンに「◯名分」と出ていても、実績のある社員全員を画面の値で保存し直して全員を
  // 再計算していた。そのため (1) 別のPCで先に保存された内容を古い画面の値で上書きする、
  // (2) 触っていない社員の明細まで作り直す（月の初回は自動計算/BW自動計算で作られる）、
  // (3) 変更が1人でも全員分待たされる、という問題があった。
  const saveAndCalculate = async (targetIds: number[], target: "dirty" | number) => {
    const targets = employees.filter((e) => targetIds.includes(e.id));
    if (!targets.length) return;
    setSavingTarget(target);
    try {
      const savedEmployeeIds: number[] = [];
      for (const emp of targets) {
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
          paidLeaveDays: Number(ed.paidLeaveDays) || 0,
          saturdayWorkDays: Number(ed.saturdayWorkDays) || 0,
          sundayWorkDays: Number(ed.sundayWorkDays) || 0,
          sundayWorkHours: Number(ed.sundayWorkHours) || 0,
          notes: String(ed.notes || ""),
          bluewingSalesAmount: Number(ed.bluewingSalesAmount) || 0,
          actualWorkHours: Number(ed.actualWorkHours) || 0,
        };

        if (existingRecord) {
          await updateRecord.mutateAsync({ id: existingRecord.id, data: payload });
          savedEmployeeIds.push(emp.id);
        } else if (hasAnyRecordData(payload as unknown as RowData)) {
          // 残業・深夜・日曜出勤・欠勤だけを入力したケースも「データあり」として保存する
          await createRecord.mutateAsync({ data: { employeeId: emp.id, year, month, ...payload } });
          savedEmployeeIds.push(emp.id);
        }
      }

      // 保存した社員の給与を計算する。計算方法は必ず手入力固定（manual）。
      // 事務所は全員を手入力固定で確定している。指定しないと、その月に明細がまだ無い社員は
      // 自動計算（BW社員はBW自動計算）で作られ、内部計算の残業手当・固定残業代に手当・控除タブの
      // 早出残業手当・職務手当まで足されて二重計上になっていた（2026年9月に5件発生）。
      // 確定済み(409)と、それ以外の失敗は黙って捨てると気付けないので、分けて表示する。
      let calculated = 0;
      let confirmedSkipped = 0;
      const failures: string[] = [];
      for (const employeeId of savedEmployeeIds) {
        const name = employees.find((e) => e.id === employeeId)?.name ?? `社員ID ${employeeId}`;
        try {
          const res = await fetch(`${BASE}/api/payroll/calculate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employeeId, year, month, calculationMode: "manual" }),
          });
          if (res.ok) calculated++;
          else if (res.status === 409) confirmedSkipped++;
          else {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            failures.push(`${name}（${body?.error ?? `HTTP ${res.status}`}）`);
          }
        } catch {
          failures.push(`${name}（通信エラー）`);
        }
      }

      const single = typeof target === "number";
      const who = single ? `${targets[0].name}さん` : `${savedEmployeeIds.length}名分`;
      const lines: string[] = [];
      if (savedEmployeeIds.length === 0) {
        lines.push("保存する実績がありません（入力がすべて0です）。");
      } else if (single) {
        lines.push(calculated > 0 ? `${month}月分の実績を保存し、給与を計算しました。` : `${month}月分の実績を保存しました。`);
      } else {
        lines.push(`${month}月分の実績${savedEmployeeIds.length}名分を保存し、${calculated}名分の給与を計算しました。`);
      }
      if (confirmedSkipped > 0) {
        lines.push(`確定済みのため${confirmedSkipped}名分は再計算されていません。給与明細画面で確定を解除してから計算してください。`);
      }
      if (failures.length > 0) {
        lines.push(`計算できなかった社員: ${failures.join("、")}`);
      }
      const problem = confirmedSkipped > 0 || failures.length > 0;
      toast({
        title: problem ? `${who}：一部の明細が更新されていません` : `${who}を保存して計算しました`,
        description: lines.join("\n"),
        variant: problem ? "destructive" : undefined,
      });

      // 処理した社員だけ「変更あり」を外す（1名分の保存で他の社員の未保存の変更を消さない）
      setDirtyIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
      queryClient.invalidateQueries({ queryKey: getListMonthlyRecordsQueryKey({ year, month }) });
    } catch {
      toast({ title: "エラー", description: "一部のデータの保存に失敗しました。", variant: "destructive" });
    } finally {
      setSavingTarget(null);
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

  // ── ボタンのツールチップ（カーソルを置くと出る詳しい説明）──
  const dirtyNames = employees.filter((e) => dirtyIds.has(e.id)).map((e) => e.name);
  const dirtyNamesLabel = dirtyNames.length > 5
    ? `${dirtyNames.slice(0, 5).join("、")} ほか${dirtyNames.length - 5}名`
    : dirtyNames.join("、");
  const importTip =
    `打刻データを集計して、${month}月分の実績入力欄に反映します（まだ保存はされません）。\n` +
    "・反映する項目：平日出勤・土曜出勤・日曜の時間・祝日の日数・欠勤・有給・残業時間・走行距離・実働時間\n" +
    "・深夜時間は打刻から集計できないため反映しません\n" +
    "・手入力した値は打刻の値で上書きされます（未保存の入力がある社員は確認が出ます）\n" +
    "・反映した社員は「変更あり」になるので、確認後に「保存して計算」を押してください";
  const saveDirtyTip = savingTarget === "dirty"
    ? "変更した社員の実績を保存し、給与明細を計算しています…"
    : dirtyCount > 0
    ? `変更した${dirtyCount}名分の実績を保存し、給与明細を計算します。\n` +
      `対象：${dirtyNamesLabel}\n` +
      "・変更していない社員は保存も計算もしません\n" +
      "・計算方法は手入力固定です（基本給＋手当・控除タブの金額。自動計算は使いません）\n" +
      "・確定済みの明細は計算しません\n" +
      "・手当の金額は「手当・控除」タブで自動保存されます"
    : "変更した社員がいないため押せません。\n" +
      "「実績入力」タブで数値を変えると押せるようになります。\n" +
      "全員をまとめて計算し直すときは、給与明細画面の「一括計算」を使ってください。";


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
              <HelpTip content={importTip}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImportAttendance}
                  disabled={isLoading || importing || saving || !employees.length}
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${importing ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">{importing ? "取り込み中..." : "勤怠から一括反映"}</span>
                  <span className="sm:hidden">{importing ? "取込中..." : "勤怠反映"}</span>
                </Button>
              </HelpTip>
              <HelpTip content={saveDirtyTip} align="end">
                <Button
                  size="sm"
                  onClick={() => saveAndCalculate([...dirtyIds], "dirty")}
                  disabled={isLoading || saving || dirtyCount === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {savingTarget === "dirty"
                    ? "保存して計算中..."
                    : dirtyCount > 0
                    ? `${dirtyCount}名分を保存して計算`
                    : "変更なし"}
                </Button>
              </HelpTip>
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
                insurance={monthInsurance}
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
                    <HelpTip
                      align="end"
                      content={
                        `${selectedEmployee.name}さんの${month}月分の実績だけを保存し、給与明細を計算します。\n` +
                        "・他の社員の未保存の変更はそのまま残ります\n" +
                        `・未保存の変更：${dirtyIds.has(selectedEmployee.id) ? "あり（ボタンが青色）" : "なし"}\n` +
                        "・確定済みの明細は計算しません\n" +
                        "・手当の金額は「手当・控除」タブで自動保存されます"
                      }
                    >
                      <Button
                        variant={dirtyIds.has(selectedEmployee.id) ? "default" : "outline"}
                        size="sm"
                        className={`gap-1.5 shrink-0 ${
                          dirtyIds.has(selectedEmployee.id) ? "bg-indigo-600 hover:bg-indigo-700 text-white" : ""
                        }`}
                        onClick={() => saveAndCalculate([selectedEmployee.id], selectedEmployee.id)}
                        disabled={isLoading || saving}
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">
                          {savingTarget === selectedEmployee.id ? "計算中..." : "この社員を保存して計算"}
                        </span>
                      </Button>
                    </HelpTip>
                    <HelpTip
                      align="end"
                      content={
                        `${selectedEmployee.name}さんの打刻を、月のカレンダーで表示します。\n` +
                        "・出勤した日に丸印が付きます\n" +
                        "・日付を押すと、出勤・休憩・退勤の時刻を確認できます\n" +
                        "・表示のみで、ここから打刻や実績は変更できません"
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => setCalendarOpen(true)}
                      >
                        <CalIcon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">勤怠カレンダー</span>
                      </Button>
                    </HelpTip>
                    {/* 前へ／次へ */}
                    <div className="hidden md:flex items-center border rounded-md overflow-hidden shrink-0">
                      <HelpTip
                        align="end"
                        content={
                          selectedIdx <= 0
                            ? "先頭の社員です。"
                            : "前の社員に移動します（Ctrl+↑）。\n左のリストの並び順（検索中は検索結果の順）で移動します。"
                        }
                      >
                        <button
                          type="button"
                          className="p-1.5 hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          onClick={() => moveSelection(-1)}
                          disabled={selectedIdx <= 0}
                          aria-label="前の社員"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                      </HelpTip>
                      <span className="px-1.5 text-[11px] text-muted-foreground amount border-x">
                        {selectedIdx + 1}/{filtered.length}
                      </span>
                      <HelpTip
                        align="end"
                        content={
                          selectedIdx === -1 || selectedIdx >= filtered.length - 1
                            ? "最後の社員です。"
                            : "次の社員に移動します（Ctrl+↓）。\n左のリストの並び順（検索中は検索結果の順）で移動します。"
                        }
                      >
                        <button
                          type="button"
                          className="p-1.5 hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          onClick={() => moveSelection(1)}
                          disabled={selectedIdx === -1 || selectedIdx >= filtered.length - 1}
                          aria-label="次の社員"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </HelpTip>
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
                          insurance={monthInsurance}
                        />
                      </TabsContent>
                      <TabsContent value="allowance" className="mt-0 data-[state=inactive]:hidden" forceMount>
                        <AllowancePanel
                          key={`${selectedEmployee.id}-${year}-${month}`}
                          employee={selectedEmployee}
                          year={year}
                          month={month}
                          hasMonthlyRecord={!!monthlyRecords?.some((r) => r.employeeId === selectedEmployee.id)}
                          monthlyData={{
                            workDays: Number(edits[selectedEmployee.id]?.workDays) || 0,
                            saturdayWorkDays: Number(edits[selectedEmployee.id]?.saturdayWorkDays) || 0,
                            sundayWorkHours: Number(edits[selectedEmployee.id]?.sundayWorkHours) || 0,
                            holidayWorkDays: Number(edits[selectedEmployee.id]?.holidayWorkDays) || 0,
                            paidLeaveDays: Number(edits[selectedEmployee.id]?.paidLeaveDays) || 0,
                            overtimeHours: Number(edits[selectedEmployee.id]?.overtimeHours) || 0,
                            lateNightHours: Number(edits[selectedEmployee.id]?.lateNightHours) || 0,
                            actualWorkHours: Number(edits[selectedEmployee.id]?.actualWorkHours) || 0,
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
