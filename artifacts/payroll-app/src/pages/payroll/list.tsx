import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListPayrolls,
  useCalculatePayroll,
  useListEmployees,
  getListPayrollsQueryKey,
  useGetPayroll,
  getGetPayrollQueryKey,
  useConfirmPayroll,
  useUnconfirmPayroll,
  useListMonthlyRecords,
  useGetCompany,
  useGetEmployeeAllowances,
  getGetEmployeeAllowancesQueryKey,
  useGetEmployeeDeductions,
  getGetEmployeeDeductionsQueryKey,
  Payroll,
} from "@workspace/api-client-react";
import { PayslipPrintClassic } from "@/components/payslip-print-classic";
import { PayslipBulkPrint } from "@/components/payslip-bulk-print";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AllowanceInputPanel } from "@/components/allowance-input-panel";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatMonth } from "@/lib/format";
import {
  Calculator, Download, AlertCircle, X, CheckCircle2, FileText, Printer, ArrowLeft, Wallet, Receipt, RotateCcw, Info,
} from "lucide-react";
import { PayrollSummaryStats } from "@/components/payroll/summary-stats";
import { PayrollListPane, filterPayrolls } from "@/components/payroll/payroll-list-pane";

interface CalcError {
  employeeCode: string;
  name: string;
  message: string;
}

export default function PayrollList() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: payrollsData, isLoading: payrollsLoading } = useListPayrolls({ year, month });
  const { data: employees } = useListEmployees({ active: true });
  const { data: company } = useGetCompany();
  const calculatePayroll = useCalculatePayroll();

  const payrolls: Payroll[] = useMemo(() => payrollsData ?? [], [payrollsData]);

  const [calculating, setCalculating] = useState(false);
  const [printPayroll, setPrintPayroll] = useState<NonNullable<ReturnType<typeof useGetPayroll>["data"]> | null>(null);
  const [bulkPrintActive, setBulkPrintActive] = useState(false);
  const [calcErrors, setCalcErrors] = useState<CalcError[]>([]);
  const [selectedPayrollId, setSelectedPayrollId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  // 未保存変更ガード
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const requestAction = useCallback((action: () => void) => {
    if (isDirty) {
      pendingActionRef.current = action;
      setShowUnsavedDialog(true);
    } else {
      action();
    }
  }, [isDirty]);

  const tryClosePanel = useCallback(() => {
    requestAction(() => {
      setSelectedPayrollId(null);
      setIsDirty(false);
    });
  }, [requestAction]);

  const trySelectPayroll = useCallback((id: number) => {
    if (selectedPayrollId === id) return;
    requestAction(() => {
      setSelectedPayrollId(id);
      setIsDirty(false);
    });
  }, [requestAction, selectedPayrollId]);

  const { data: monthlyRecords } = useListMonthlyRecords({ year, month });

  const { data: selectedPayroll, isLoading: detailLoading } = useGetPayroll(
    selectedPayrollId ?? 0,
    { query: { enabled: !!selectedPayrollId, queryKey: getGetPayrollQueryKey(selectedPayrollId ?? 0), staleTime: 0, refetchOnMount: "always" } }
  );
  const confirmPayroll = useConfirmPayroll();
  const unconfirmPayroll = useUnconfirmPayroll();

  const selectedEmployeeId = selectedPayroll?.employeeId ?? 0;
  const { data: printEmployeeAllowances, isFetching: allowancesFetching } = useGetEmployeeAllowances(selectedEmployeeId, {
    query: { enabled: !!selectedPayroll?.employeeId, queryKey: getGetEmployeeAllowancesQueryKey(selectedEmployeeId) },
  });
  const { data: printEmployeeDeductions, isFetching: deductionsFetching } = useGetEmployeeDeductions(selectedEmployeeId, {
    query: { enabled: !!selectedPayroll?.employeeId, queryKey: getGetEmployeeDeductionsQueryKey(selectedEmployeeId) },
  });

  // 初回ロード時（デスクトップのみ）先頭給与を自動選択（一度きり。閉じるボタンを機能させる）
  const didInitSelectRef = useRef(false);
  const sortedPayrolls = useMemo(() => filterPayrolls(payrolls, ""), [payrolls]);
  useEffect(() => {
    if (didInitSelectRef.current || sortedPayrolls.length === 0) return;
    didInitSelectRef.current = true;
    if (selectedPayrollId === null && window.matchMedia("(min-width: 768px)").matches) {
      setSelectedPayrollId(sortedPayrolls[0].id);
    }
  }, [sortedPayrolls, selectedPayrollId]);

  const filtered = useMemo(() => filterPayrolls(payrolls, search), [payrolls, search]);

  const handleConfirm = async () => {
    if (!selectedPayrollId) return;
    try {
      await confirmPayroll.mutateAsync({ id: selectedPayrollId });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(selectedPayrollId) });
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      toast({ title: "給与確定", description: "給与明細を確定済みに変更しました。" });
    } catch {
      toast({ title: "エラー", description: "確定に失敗しました。", variant: "destructive" });
    }
  };

  const handleUnconfirm = async () => {
    if (!selectedPayrollId) return;
    try {
      await unconfirmPayroll.mutateAsync({ id: selectedPayrollId });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(selectedPayrollId) });
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      toast({ title: "確定を解除しました", description: "未確定（draft）に戻しました。再計算・訂正ができます。" });
    } catch {
      toast({ title: "エラー", description: "確定解除に失敗しました。", variant: "destructive" });
    }
  };

  const handlePrint = useCallback(() => {
    if (!selectedPayroll) return;
    // 手当・控除の取得が終わっていないと明細に載らないため、完了を待つ
    if (allowancesFetching || deductionsFetching) {
      toast({ title: "データ取得中", description: "手当・控除の読み込み中です。少し待ってから再度お試しください。" });
      return;
    }
    setPrintPayroll(selectedPayroll);
    // ポータル（印刷対象DOM）の描画を待ってから印刷（2フレーム）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const printTargets = document.querySelectorAll("[data-print-target='payslip-classic']");
        if (printTargets.length !== 1) {
          toast({ title: "印刷を準備できませんでした", description: "もう一度「印刷」を押してください。", variant: "destructive" });
          setPrintPayroll(null);
          return;
        }
        const prevTitle = document.title;
        document.title = `${selectedPayroll.employeeName}_${selectedPayroll.year}年${selectedPayroll.month}月`;
        // 印刷後のクリーンアップ（タイトル復元＋ポータル撤去）。
        // afterprint を主とし、不発ブラウザ向けに setTimeout をフォールバックにする（冪等）。
        const cleanup = () => {
          document.title = prevTitle;
          setPrintPayroll(null);
          window.removeEventListener("afterprint", cleanup);
        };
        window.addEventListener("afterprint", cleanup);
        window.print();
        window.setTimeout(cleanup, 3000);
      });
    });
  }, [selectedPayroll, allowancesFetching, deductionsFetching, toast]);

  const handleCalculateAll = async () => {
    if (!employees) return;
    setCalculating(true);
    setCalcErrors([]);
    let success = 0;
    const errorList: CalcError[] = [];

    try {
      for (const emp of employees) {
        const existing = payrolls.find(p => p.employeeId === emp.id);
        if (existing?.status === "confirmed") continue;

        try {
          await calculatePayroll.mutateAsync({ data: { employeeId: emp.id, year, month } });
          success++;
        } catch (err: unknown) {
          let msg = "不明なエラー";
          if (err && typeof err === "object") {
            const e = err as { data?: { error?: string }; message?: string };
            const apiMsg = (e.data as { error?: string } | null)?.error ?? e.message ?? "";
            if (apiMsg.includes("月次実績") || apiMsg.toLowerCase().includes("monthly record not found")) {
              msg = `${formatMonth(year, month)}の月次実績が未入力です`;
            } else if (apiMsg) {
              msg = apiMsg;
            }
          }
          errorList.push({ employeeCode: emp.employeeCode, name: emp.name, message: msg });
        }
      }

      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });

      if (errorList.length > 0) {
        setCalcErrors(errorList);
        toast({
          title: success > 0 ? `${success}件の計算が完了しました` : "計算エラー",
          description: `${errorList.length}件はエラーのため未計算です。下の詳細を確認してください。`,
          variant: "destructive",
        });
      } else {
        toast({ title: "計算完了", description: `${success}件の給与計算が完了しました。` });
      }
    } finally {
      setCalculating(false);
    }
  };

  const handleExportCsv = async () => {
    const url = `/api/payrolls/export/csv?year=${year}&month=${month}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `給与明細データ_${year}${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ title: "CSVエクスポート", description: "ダウンロードを開始しました。" });
  };

  // この社員のみ再計算（標準モード）
  const recalcSelected = async () => {
    if (!selectedPayroll) return;
    try {
      await calculatePayroll.mutateAsync({ data: { employeeId: selectedPayroll.employeeId, year, month } });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(selectedPayroll.id) });
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      toast({ title: "計算完了", description: `${selectedPayroll.employeeName}の給与計算が完了しました。` });
    } catch {
      toast({ title: "エラー", description: "計算に失敗しました。月次実績を確認してください。", variant: "destructive" });
    }
  };

  // 手入力固定で計算（マスター基本給・手当設定で再計算）
  const recalcManual = async () => {
    if (!selectedPayroll) return;
    try {
      await calculatePayroll.mutateAsync({ data: { employeeId: selectedPayroll.employeeId, year, month, calculationMode: "manual" } });
      queryClient.invalidateQueries({ queryKey: getGetPayrollQueryKey(selectedPayroll.id) });
      queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      toast({ title: "手入力固定で計算完了", description: "マスター基本給と手当設定で給与を再計算しました。" });
    } catch {
      toast({ title: "エラー", description: "計算に失敗しました。", variant: "destructive" });
    }
  };

  const selectedEmployee = employees?.find(e => e.id === selectedPayroll?.employeeId);

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        {/* ── ツールバー ── */}
        <div className="shrink-0 pb-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shrink-0">
                <Wallet className="h-5 w-5" />
              </div>
              <h2 className="text-base md:text-lg font-bold jp-tight leading-tight">給与明細一覧</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <RichMonthPicker
                year={year}
                month={month}
                onChange={(y, m) => requestAction(() => {
                  // 月切替時は選択をクリア（給与IDは社員×年月で一意なため、
                  // 前月の選択が残ると確定/再計算/印刷が前月明細を対象にしてしまう）。
                  // 未保存編集がある場合は requestAction が確認ダイアログを出す。
                  setYear(y);
                  setMonth(m);
                  setSelectedPayrollId(null);
                  setIsDirty(false);
                })}
              />
              <Button variant="secondary" size="sm" onClick={handleCalculateAll} disabled={calculating || !employees?.length}
                title="保存済みの月次実績をもとに、全社員の給与を計算します（確定済みは対象外）。">
                <Calculator className="mr-1.5 h-4 w-4" />
                {calculating ? "計算中..." : "一括計算"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={payrolls.length === 0}>
                <Download className="mr-1.5 h-4 w-4" />CSV出力
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkPrintActive(true)}
                disabled={payrolls.length === 0 || bulkPrintActive}
                title="全員の給与明細を1人1ページで印刷します。複数枚を1ページにまとめたい場合は、印刷ダイアログの「1枚あたりのページ数」で4や16を選んでください。"
              >
                <Printer className="mr-1.5 h-4 w-4" />
                {bulkPrintActive ? "印刷準備中..." : "一括印刷"}
              </Button>
            </div>
          </div>

          {/* 使い方ガイド（常時表示・#1/#2 対策） */}
          <div className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-500" />
            <p className="leading-relaxed">
              <span className="font-semibold">給与の流れ：</span>
              ①「月次実績入力」で保存 → ② ここで<strong>「一括計算」</strong>（1人だけ直すときは明細の<strong>「再計算」</strong>）→ ③ 金額を確認して<strong>「確定」</strong>。
              <span className="ml-1 text-indigo-700">確定すると金額がロックされます（訂正するときは「確定解除」）。</span>
            </p>
          </div>

          {/* 集計サマリー */}
          {payrolls.length > 0 && <PayrollSummaryStats payrolls={payrolls} />}

          {/* 計算エラー通知 */}
          {calcErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-red-700 text-sm mb-2">以下の社員の給与計算でエラーが発生しました</p>
                    <ul className="space-y-1.5">
                      {calcErrors.map((e) => (
                        <li key={e.employeeCode} className="text-sm text-red-700">
                          <span className="font-semibold">{e.employeeCode} {e.name}</span>
                          <span className="text-red-500 mx-1">—</span>
                          <span>{e.message}</span>
                          {e.message.includes("月次実績") && (
                            <Link href={`/monthly-input`} className="ml-2 inline-flex items-center text-xs font-semibold text-red-600 underline underline-offset-2 hover:text-red-800">
                              月次実績入力へ →
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button onClick={() => setCalcErrors([])} className="shrink-0 text-red-400 hover:text-red-600 transition-colors" aria-label="閉じる">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 2ペイン本体（詳細ペインは一覧ローディングでアンマウントされないよう常設。
             月切替の再取得中に AllowanceInputPanel が再マウントされ未保存編集が消えるのを防ぐ）── */}
        <div className="flex-1 min-h-0 flex md:gap-4">
          {/* 左ペイン: 給与リスト（ローディング/空はこのペイン内でのみ表示） */}
          <div className={`${selectedPayrollId !== null ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 shrink-0 flex-col min-h-0 rounded-xl border bg-card overflow-hidden`}>
            {payrollsLoading ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                読み込み中...
              </div>
            ) : payrolls.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm text-center px-4">
                <Receipt className="h-7 w-7 text-muted-foreground/40" />
                <p>{formatMonth(year, month)}の<br />給与データはありません</p>
              </div>
            ) : (
              <PayrollListPane
                payrolls={payrolls}
                filtered={filtered}
                selectedId={selectedPayrollId}
                onSelect={trySelectPayroll}
                search={search}
                onSearchChange={setSearch}
              />
            )}
          </div>

          {/* 右ペイン: 詳細 */}
            <div className={`${selectedPayrollId === null ? "hidden md:flex" : "flex"} flex-1 min-w-0 flex-col min-h-0`}>
              {selectedPayrollId !== null ? (
                <div className="flex flex-col h-full min-h-0 rounded-xl border bg-card overflow-hidden">
                  {/* 詳細ヘッダー */}
                  <div className="px-3 md:px-4 py-2.5 border-b shrink-0 bg-muted/20 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="md:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                      onClick={tryClosePanel}
                      aria-label="給与リストへ戻る"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base jp-tight truncate">{selectedPayroll?.employeeName ?? "—"}</span>
                        <span className="text-[11px] text-muted-foreground font-mono shrink-0">{selectedPayroll?.employeeCode}</span>
                        {selectedPayroll && (
                          selectedPayroll.status === "confirmed" ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">確定済</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">未確定</Badge>
                          )
                        )}
                      </div>
                    </div>
                    {selectedPayroll && (
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={calculating} onClick={recalcSelected}
                          title="この社員だけ、最新の月次実績で計算し直します。">
                          <Calculator className="h-3 w-3 mr-1" />再計算
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                          onClick={recalcManual}
                          title="月次実績（勤怠）を使わず、マスターの基本給＋固定手当だけで計算します。日給制・歩合など勤怠連動の社員には使わないでください。"
                        >
                          <Calculator className="h-3 w-3 mr-1" />手入力固定
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handlePrint}>
                          <FileText className="h-3.5 w-3.5 mr-1" />印刷
                        </Button>
                        {selectedPayroll.status !== "confirmed" ? (
                          <Button size="sm" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirm} disabled={confirmPayroll.isPending}
                            title="この明細の金額を締めてロックします。以後は再計算されません（訂正するときは「確定解除」）。">
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />確定
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs border-amber-300 text-amber-800 hover:bg-amber-50" onClick={handleUnconfirm} disabled={unconfirmPayroll.isPending}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />確定解除
                          </Button>
                        )}
                        <button onClick={tryClosePanel} className="hidden md:inline-flex p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 shrink-0" aria-label="閉じる">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 詳細本体 */}
                  <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-12 text-muted-foreground">読み込み中...</div>
                    ) : !selectedPayroll ? (
                      <div className="py-12 text-center text-muted-foreground">データが見つかりません</div>
                    ) : selectedEmployee ? (
                      <AllowanceInputPanel
                        key={selectedPayroll.id}
                        employee={selectedEmployee}
                        monthlyData={(() => {
                          const rec = monthlyRecords?.find(r => r.employeeId === selectedPayroll.employeeId);
                          return {
                            workDays: rec?.workDays ?? selectedPayroll.workDays ?? 0,
                            saturdayWorkDays: (rec as { saturdayWorkDays?: number } | undefined)?.saturdayWorkDays ?? 0,
                            sundayWorkDays: (rec as { sundayWorkDays?: number } | undefined)?.sundayWorkDays ?? 0,
                          };
                        })()}
                        onDirtyChange={setIsDirty}
                        year={year}
                        month={month}
                      />
                    ) : (
                      <div className="py-12 text-center text-muted-foreground">社員データが見つかりません</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-2 rounded-xl border bg-card text-muted-foreground">
                  <Receipt className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm">左のリストから給与明細を選択してください</p>
                </div>
              )}
            </div>
          </div>
      </div>

      {/* 未保存変更確認ダイアログ */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存していません</AlertDialogTitle>
            <AlertDialogDescription>変更が保存されていません。このまま移動すると変更内容が失われます。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                const action = pendingActionRef.current;
                pendingActionRef.current = null;
                setShowUnsavedDialog(false);
                action?.();
              }}
            >
              保存せずに移動
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 一括印刷ポータル ── */}
      {bulkPrintActive && payrolls.length > 0 && (
        <PayslipBulkPrint
          payrolls={[...payrolls].sort((a, b) => (a.employeeCode ?? "").localeCompare(b.employeeCode ?? "")) as unknown as Parameters<typeof PayslipBulkPrint>[0]["payrolls"]}
          companyName={company?.name ?? "三川運送株式会社"}
          employees={(employees ?? []) as unknown as Parameters<typeof PayslipBulkPrint>[0]["employees"]}
          company={company as Parameters<typeof PayslipBulkPrint>[0]["company"]}
          onDone={() => setBulkPrintActive(false)}
          year={year}
          month={month}
        />
      )}

      {/* ── 印刷専用ポータル（@media print で表示） ── */}
      {printPayroll && (
        <PayslipPrintClassic
          payroll={printPayroll as Parameters<typeof PayslipPrintClassic>[0]["payroll"]}
          companyName={company?.name ?? "三川運送株式会社"}
          employeeAllowances={printEmployeeAllowances as Parameters<typeof PayslipPrintClassic>[0]["employeeAllowances"]}
          employeeDeductions={printEmployeeDeductions as Parameters<typeof PayslipPrintClassic>[0]["employeeDeductions"]}
          employee={employees?.find(e => e.id === (printPayroll as Payroll).employeeId) as Parameters<typeof PayslipPrintClassic>[0]["employee"]}
          company={company as Parameters<typeof PayslipPrintClassic>[0]["company"]}
        />
      )}
    </AppLayout>
  );
}
