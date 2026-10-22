import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListPayrolls,
  useCalculatePayroll,
  useListEmployees,
  getListPayrollsQueryKey,
  useGetPayroll,
  getGetPayrollQueryKey,
  useConfirmPayroll,
  useListMonthlyRecords,
  getListMonthlyRecordsQueryKey,
  useGetCompany,
  Payroll,
} from "@workspace/api-client-react";
import { PayslipPrintClassic } from "@/components/payslip-print-classic";
import { PayslipBulkPrint } from "@/components/payslip-bulk-print";
import { useMonthItems, toLegacyRows } from "@/lib/month-items";
import { RichMonthPicker } from "@/components/rich-month-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AllowanceInputPanel } from "@/components/allowance-input-panel";
import { PayrollWarnings } from "@/components/payroll/payroll-warnings";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { formatMonth } from "@/lib/format";
import {
  Calculator, Download, AlertCircle, X, CheckCircle2, FileText, Printer, ArrowLeft, Wallet, Receipt, RotateCcw, Info, Landmark, CheckCheck, RefreshCw, ExternalLink,
} from "lucide-react";
import { PayrollSummaryStats } from "@/components/payroll/summary-stats";
import { PayrollListPane, filterPayrolls, type PrevDiff } from "@/components/payroll/payroll-list-pane";
import { ChecklistCard, buildChecklist, useChecklistAck, type ChecklistIssue } from "@/components/payroll/checklist";
import { PrintDialog, type PrintFormat, type PrintTarget } from "@/components/payroll/print-dialog";
import { TransferDialog } from "@/components/payroll/transfer-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SaveStatus, type SaveState } from "@/components/save-status";
import { useNavigationGuard } from "@/context/navigation-guard-context";
import { useWorkMonth } from "@/lib/work-month";
import { useCanWrite } from "@/lib/use-can-write";
import { useMonthStatus, recalcPayrolls, unconfirmPayroll, MONTH_STATUS_KEY, DRAFT_PAYROLLS_KEY } from "@/lib/office-tools";

interface CalcError {
  employeeCode: string;
  name: string;
  message: string;
}

/** 一括計算の結果。実績が無い人（休職など）は「エラー」ではなく「対象外」として分けて出す */
interface CalcResult {
  ok: number;
  skippedConfirmed: number;
  notApplicable: string[];
  errors: CalcError[];
}

/** 印刷の仕事（1件＝印刷ダイアログ1回）*/
interface PrintJob {
  key: string;
  payrolls: Payroll[];
  layout: "1up" | "2up";
  title?: string;
  /** 1人ずつ保存のとき：残りの人（次に刷る人）*/
  rest?: Payroll[];
  /** 1人ずつ保存のとき：全体の人数と何人目か */
  each?: { index: number; total: number };
}

/** 給与明細まわりの読み込みをまとめて取り直す */
function refreshPayrollQueries(qc: QueryClient) {
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/payroll") });
  qc.invalidateQueries({ queryKey: ["month-items"] });
  qc.invalidateQueries({ queryKey: [MONTH_STATUS_KEY] });
  qc.invalidateQueries({ queryKey: [DRAFT_PAYROLLS_KEY] });
}

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

export default function PayrollList() {
  const wm = useWorkMonth();
  const { year, month, setWorkMonth, setEmpInUrl } = wm;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const canWrite = useCanWrite();
  const [, navigate] = useLocation();
  const { setIsDirty: setGlobalDirty, requestNavigate } = useNavigationGuard();

  const params = { year, month };
  const { data: payrollsData, isLoading: payrollsLoadingRaw } = useListPayrolls(params, {
    query: { enabled: wm.ready, queryKey: getListPayrollsQueryKey(params) },
  });
  const payrollsLoading = payrollsLoadingRaw || !wm.ready;
  const { data: employees } = useListEmployees({ active: true });
  const { data: company } = useGetCompany();
  const calculatePayroll = useCalculatePayroll();
  const { data: monthStatus, isLoading: statusLoading } = useMonthStatus(year, month, wm.ready);

  const payrolls: Payroll[] = useMemo(() => payrollsData ?? [], [payrollsData]);

  const [calculating, setCalculating] = useState(false);
  const [calcProgress, setCalcProgress] = useState<string | null>(null);
  const [printPayroll, setPrintPayroll] = useState<NonNullable<ReturnType<typeof useGetPayroll>["data"]> | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [selectedPayrollId, setSelectedPayrollId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [unconfirmOpen, setUnconfirmOpen] = useState(false);
  const [unconfirmReason, setUnconfirmReason] = useState("");
  /** 右のパネルの見込み（総支給・差引）と、保存の状態 */
  const [estimate, setEstimate] = useState<{ gross: number; net: number } | null>(null);
  const [panelSave, setPanelSave] = useState<SaveState>({ kind: "idle" });
  const panelSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const { acked, toggle: toggleAck } = useChecklistAck(year, month);

  // 未保存変更ガード
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  // 右のパネルの未保存を、画面全体の確認（左のメニュー・お知らせのベル・ログアウト）にもつなぐ。
  // 以前はこの画面の中の移動だけを止めていて、左のメニューで移ると確認なしで消えていた。
  useEffect(() => { setGlobalDirty(isDirty); }, [isDirty, setGlobalDirty]);
  useEffect(() => () => setGlobalDirty(false), [setGlobalDirty]);

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

  const selectPayroll = useCallback((id: number | null) => {
    setSelectedPayrollId(id);
    setEstimate(null);
    setPanelSave({ kind: "idle" });
    const p = id == null ? null : payrolls.find((x) => x.id === id);
    setEmpInUrl(p ? p.employeeId : null);
  }, [payrolls, setEmpInUrl]);

  const tryClosePanel = useCallback(() => {
    requestAction(() => {
      selectPayroll(null);
      setIsDirty(false);
    });
  }, [requestAction, selectPayroll]);

  const trySelectPayroll = useCallback((id: number) => {
    if (selectedPayrollId === id) return;
    requestAction(() => {
      selectPayroll(id);
      setIsDirty(false);
    });
  }, [requestAction, selectedPayrollId, selectPayroll]);

  const recordsParams = { year, month };
  const { data: monthlyRecords } = useListMonthlyRecords(recordsParams, {
    query: { enabled: wm.ready, queryKey: getListMonthlyRecordsQueryKey(recordsParams) },
  });

  const { data: selectedPayroll, isLoading: detailLoading, refetch: refetchSelected } = useGetPayroll(
    selectedPayrollId ?? 0,
    { query: { enabled: !!selectedPayrollId, queryKey: getGetPayrollQueryKey(selectedPayrollId ?? 0), staleTime: 0, refetchOnMount: "always" } }
  );
  const confirmPayroll = useConfirmPayroll();

  const selectedEmployeeId = selectedPayroll?.employeeId ?? 0;
  // 印刷の内訳は「その明細の月」の手当・控除（右パネルの保存で同じキャッシュが更新される）
  const { data: printMonthItems, isFetching: allowancesFetching } = useMonthItems(
    selectedEmployeeId, selectedPayroll?.year, selectedPayroll?.month,
    { enabled: !!selectedPayroll?.employeeId },
  );
  const { allowances: printEmployeeAllowances, deductions: printEmployeeDeductions } = toLegacyRows(printMonthItems, selectedEmployeeId);

  // 最初に開く明細：アドレスの ?emp= があればその社員、無ければ（デスクトップのみ）先頭
  const didInitSelectRef = useRef(false);
  const sortedPayrolls = useMemo(() => filterPayrolls(payrolls, ""), [payrolls]);
  useEffect(() => {
    if (didInitSelectRef.current || payrollsLoading) return;
    if (sortedPayrolls.length === 0) return;
    didInitSelectRef.current = true;
    const fromUrl = wm.empFromUrl != null ? sortedPayrolls.find((p) => p.employeeId === wm.empFromUrl) : undefined;
    if (fromUrl) {
      setSelectedPayrollId(fromUrl.id);
    } else if (selectedPayrollId === null && window.matchMedia("(min-width: 768px)").matches) {
      setSelectedPayrollId(sortedPayrolls[0].id);
    }
  }, [sortedPayrolls, selectedPayrollId, payrollsLoading, wm.empFromUrl]);

  const filtered = useMemo(() => filterPayrolls(payrolls, search), [payrolls, search]);

  // ── 前月との差・再計算が要りそうな人 ──
  const statusRows = useMemo(() => monthStatus?.rows ?? [], [monthStatus]);
  const diffs = useMemo(() => {
    const m = new Map<number, PrevDiff | null>();
    for (const r of statusRows) {
      if (!r.payroll || !r.prev) { m.set(r.employeeId, null); continue; }
      m.set(r.employeeId, {
        grossDiff: Math.round(r.payroll.grossSalary - r.prev.grossSalary),
        netDiff: Math.round(r.payroll.netSalary - r.prev.netSalary),
        netPct: r.prev.netSalary > 0 ? ((r.payroll.netSalary - r.prev.netSalary) / r.prev.netSalary) * 100 : null,
        grossPct: r.prev.grossSalary > 0 ? ((r.payroll.grossSalary - r.prev.grossSalary) / r.prev.grossSalary) * 100 : null,
      });
    }
    return m;
  }, [statusRows]);
  const needsRecalcRows = useMemo(() => statusRows.filter((r) => r.payroll && r.payroll.status !== "confirmed" && r.needsRecalc), [statusRows]);
  const needsRecalcIds = useMemo(() => new Set(needsRecalcRows.map((r) => r.employeeId)), [needsRecalcRows]);

  // ── 確定前チェックリスト ──
  const issues = useMemo(
    () => buildChecklist(statusRows, year, month, { dirtyEmployeeId: isDirty ? selectedEmployeeId || null : null }),
    [statusRows, year, month, isDirty, selectedEmployeeId]
  );
  const blocking = issues.filter((i) => i.level === "must").length + issues.filter((i) => i.level === "check" && !acked.has(i.key)).length;
  const draftPayrolls = payrolls.filter((p) => p.status !== "confirmed");
  const draftNetTotal = draftPayrolls.reduce((s, p) => s + (p.netSalary ?? 0), 0);

  const openIssue = (i: ChecklistIssue) => {
    const p = payrolls.find((x) => x.employeeId === i.employeeId);
    if (i.href) {
      requestNavigate(i.href, navigate);
    } else if (p) {
      trySelectPayroll(p.id);
    }
  };

  // ── 確定 ────────────────────────────────────────────────────────────
  // 以前は右のパネルに保存していない変更があっても「確定」が押せ、古い金額のまま確定できた。
  // いまは先に保存（＝計算し直し）してから、明細の実際の金額を見せて確かめる。
  const handleConfirm = async () => {
    if (!selectedPayrollId || !selectedPayroll || busy) return;
    if (isDirty) {
      const go = await confirm({
        title: "保存していない変更があります",
        description: "右のパネルの手当・控除がまだ保存されていません。\n保存して計算し直してから確定します。",
        okLabel: "保存して次へ",
        cancelLabel: "やめる",
      });
      if (!go) return;
      setBusy("save");
      const saved = await panelSaveRef.current?.();
      setBusy(null);
      if (!saved) return;
    }
    setBusy("confirm");
    const fresh = (await refetchSelected()).data ?? selectedPayroll;
    setBusy(null);
    const recalc = needsRecalcIds.has(fresh.employeeId);
    const ok = await confirm({
      title: `${fresh.employeeName}さんの${month}月の給与明細を確定します`,
      description: (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-0.5 text-muted-foreground">総支給額</td><td className="py-0.5 text-right amount font-semibold">{yen(fresh.grossSalary)}</td></tr>
              <tr><td className="py-0.5 text-muted-foreground">控除合計</td><td className="py-0.5 text-right amount">{yen(fresh.totalDeductions)}</td></tr>
              <tr className="border-t"><td className="py-0.5 font-semibold text-foreground">差引支給額</td><td className="py-0.5 text-right amount font-bold text-foreground">{yen(fresh.netSalary)}</td></tr>
            </tbody>
          </table>
          {recalc && <p className="text-red-600 font-semibold">計算したあとで勤怠・手当・単価などが変わっています。先に「再計算」をしたほうが安全です。</p>}
          <p>確定すると金額がロックされ、勤怠・手当も変更できなくなります（直すときは「確定解除」）。</p>
        </div>
      ),
      okLabel: "確定する",
      cancelLabel: "やめる",
    });
    if (!ok) return;
    setBusy("confirm");
    try {
      await confirmPayroll.mutateAsync({ id: fresh.id });
      refreshPayrollQueries(queryClient);
      toast({ title: "給与確定", description: `${fresh.employeeName}さんの明細を確定しました（差引 ${yen(fresh.netSalary)}）。` });
    } catch {
      toast({ title: "エラー", description: "確定に失敗しました。", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // 確定解除。理由を入れてもらい、操作の記録に残す。
  const handleUnconfirm = async () => {
    if (!selectedPayrollId || busy) return;
    setBusy("unconfirm");
    try {
      await unconfirmPayroll(selectedPayrollId, unconfirmReason.trim());
      refreshPayrollQueries(queryClient);
      setUnconfirmOpen(false);
      setUnconfirmReason("");
      toast({ title: "確定を解除しました", description: "未確定に戻しました。再計算・訂正ができます（理由は操作の記録に残りました）。" });
    } catch (e) {
      toast({ title: "エラー", description: e instanceof Error ? e.message : "確定解除に失敗しました。", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // ── 一括確定 ────────────────────────────────────────────────────────
  const handleConfirmAll = async () => {
    if (busy || blocking > 0 || draftPayrolls.length === 0) return;
    const ok = await confirm({
      title: `${month}月の給与明細をまとめて確定します`,
      description: `${draftPayrolls.length}名・差引支給額の合計 ${yen(draftNetTotal)} を確定します。\n確定すると金額がロックされます（直すときは1人ずつ「確定解除」）。`,
      okLabel: `${draftPayrolls.length}名を確定する`,
      cancelLabel: "やめる",
    });
    if (!ok) return;
    setBusy("confirmAll");
    let done = 0;
    const failed: string[] = [];
    for (const p of draftPayrolls) {
      try {
        await confirmPayroll.mutateAsync({ id: p.id });
        done++;
      } catch {
        failed.push(p.employeeName ?? `明細${p.id}`);
      }
      setCalcProgress(`確定しています… ${done + failed.length} / ${draftPayrolls.length}`);
    }
    setCalcProgress(null);
    setBusy(null);
    refreshPayrollQueries(queryClient);
    toast({
      title: failed.length ? `${done}名を確定しました（${failed.length}名はできませんでした）` : `${done}名の給与明細を確定しました`,
      description: failed.length ? `確定できなかった人：${failed.join("、")}` : `差引支給額の合計 ${yen(draftNetTotal)}`,
      variant: failed.length ? "destructive" : undefined,
    });
  };

  // ── 印刷 ────────────────────────────────────────────────────────────
  const doPrintSingle = useCallback((p: NonNullable<typeof selectedPayroll>) => {
    setPrintPayroll(p);
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
        document.title = `${p.employeeName}_${p.year}年${p.month}月`;
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
  }, [toast]);

  const handlePrint = useCallback(async () => {
    if (!selectedPayroll) return;
    let target = selectedPayroll;
    // 右のパネルに保存していない変更があると、印刷には入らない（印刷は保存した内容で作る）
    if (isDirty) {
      const go = await confirm({
        title: "保存していない変更は印刷に入りません",
        description: "右のパネルの手当・控除がまだ保存されていません。\n保存して計算し直してから印刷します。",
        okLabel: "保存して印刷",
        cancelLabel: "やめる",
      });
      if (!go) return;
      const saved = await panelSaveRef.current?.();
      if (!saved) return;
      target = (await refetchSelected()).data ?? selectedPayroll;
    }
    // 手当・控除の取得が終わっていないと明細に載らないため、完了を待つ
    if (allowancesFetching) {
      toast({ title: "データ取得中", description: "手当・控除の読み込み中です。少し待ってから再度お試しください。" });
      return;
    }
    doPrintSingle(target);
  }, [selectedPayroll, isDirty, confirm, refetchSelected, allowancesFetching, toast, doPrintSingle]);

  const sortByCode = (list: Payroll[]) => [...list].sort((a, b) => (a.employeeCode ?? "").localeCompare(b.employeeCode ?? ""));
  const pickTarget = useCallback((t: PrintTarget) => {
    const list = sortByCode(payrolls);
    if (t === "confirmed") return list.filter((p) => p.status === "confirmed");
    if (t === "checked") return list.filter((p) => checked.has(p.id));
    return list;
  }, [payrolls, checked]);

  const startPrint = async (target: PrintTarget, format: PrintFormat) => {
    const list = pickTarget(target);
    if (list.length === 0) return;
    if (isDirty && list.some((p) => p.id === selectedPayrollId)) {
      const go = await confirm({
        title: "保存していない変更は印刷に入りません",
        description: "右のパネルの手当・控除がまだ保存されていません。保存した内容で印刷します。",
        okLabel: "保存して印刷",
        cancelLabel: "やめる",
      });
      if (!go) return;
      const saved = await panelSaveRef.current?.();
      if (!saved) return;
    }
    setPrintDialogOpen(false);
    if (format === "each") {
      const [first, ...rest] = list;
      setPrintJob({
        key: `each-${first!.id}-${Date.now()}`,
        payrolls: [first!],
        layout: "1up",
        title: `${first!.employeeName}_${first!.year}年${first!.month}月`,
        rest,
        each: { index: 1, total: list.length },
      });
    } else {
      setPrintJob({ key: `bulk-${Date.now()}`, payrolls: list, layout: format });
    }
  };

  // 1枚刷り終わったら、1人ずつ保存のときは次の人へ
  const onPrintDone = useCallback(() => {
    setPrintJob((job) => {
      if (!job?.rest || job.rest.length === 0 || !job.each) return null;
      const [next, ...rest] = job.rest;
      return {
        key: `each-${next!.id}-${Date.now()}`,
        payrolls: [next!],
        layout: "1up",
        title: `${next!.employeeName}_${next!.year}年${next!.month}月`,
        rest,
        each: { index: job.each.index + 1, total: job.each.total },
      };
    });
  }, []);
  const onPrintFailed = useCallback((names: string[]) => {
    toast({ title: "手当・控除を読み込めなかった人がいます", description: `${names.join("、")}さんの明細は、手当・控除の内訳が空欄で印刷された可能性があります。もう一度印刷してください。`, variant: "destructive" });
  }, [toast]);
  const onPrintTimeout = useCallback(() => {
    setPrintJob(null);
    toast({ title: "印刷の準備が終わりませんでした", description: "15秒たっても手当・控除を読み込めなかったため、印刷をやめました。通信を確かめて、もう一度お試しください。", variant: "destructive" });
  }, [toast]);

  // ── 一括計算 ────────────────────────────────────────────────────────
  const handleCalculateAll = async () => {
    if (!employees || calculating) return;
    setCalculating(true);
    setCalcResult(null);
    let success = 0;
    let skippedConfirmed = 0;
    const notApplicable: string[] = [];
    const errorList: CalcError[] = [];
    const hasRecord = new Set((monthlyRecords ?? []).map((r) => r.employeeId));

    try {
      for (let i = 0; i < employees.length; i++) {
        const emp = employees[i]!;
        setCalcProgress(`計算しています… ${i + 1} / ${employees.length}`);
        const existing = payrolls.find(p => p.employeeId === emp.id);
        if (existing?.status === "confirmed") { skippedConfirmed++; continue; }
        // この月の実績が無い人（休職・入社前など）は計算できない。エラーではなく「対象外」として分ける
        if (!hasRecord.has(emp.id)) { notApplicable.push(emp.name); continue; }

        try {
          // 明細がまだ無い社員は、月次実績入力の「保存して計算」と同じ手入力固定で作る。
          // 既にある明細は、作ったときの計算方法のまま計算し直す（方法を送らなければサーバーが引き継ぐ）。
          await calculatePayroll.mutateAsync({
            data: existing ? { employeeId: emp.id, year, month } : { employeeId: emp.id, year, month, calculationMode: "manual" },
          });
          success++;
        } catch (err: unknown) {
          let msg = "不明なエラー";
          const e = err as { data?: { error?: string }; message?: string; status?: number } | null;
          const apiMsg = e?.data?.error ?? e?.message ?? "";
          if (e?.status === 404 && apiMsg.includes("月次実績")) { notApplicable.push(emp.name); continue; }
          if (e?.status === 409) { skippedConfirmed++; continue; }
          if (apiMsg) msg = apiMsg;
          errorList.push({ employeeCode: emp.employeeCode, name: emp.name, message: msg });
        }
      }

      refreshPayrollQueries(queryClient);
      setCalcResult({ ok: success, skippedConfirmed, notApplicable, errors: errorList });
      toast({
        title: errorList.length > 0 ? `${success}件を計算しました（${errorList.length}件はエラー）` : `${success}件の給与を計算しました`,
        description: [
          skippedConfirmed > 0 ? `確定済みの${skippedConfirmed}名は計算していません。` : "",
          notApplicable.length > 0 ? `この月の実績が無い${notApplicable.length}名は対象外です。` : "",
          errorList.length > 0 ? "エラーの人は下の詳細を確認してください。" : "",
        ].filter(Boolean).join("") || undefined,
        variant: errorList.length > 0 ? "destructive" : undefined,
      });
    } finally {
      setCalculating(false);
      setCalcProgress(null);
    }
  };

  // 計算のあとで勤怠・単価などが変わった人だけをまとめて計算し直す
  const handleRecalcStale = async () => {
    if (busy || needsRecalcRows.length === 0) return;
    setBusy("recalcStale");
    const r = await recalcPayrolls(needsRecalcRows.map((x) => ({ employeeId: x.employeeId, year, month })),
      (d, t) => setCalcProgress(`計算し直しています… ${d} / ${t}`));
    setCalcProgress(null);
    setBusy(null);
    refreshPayrollQueries(queryClient);
    toast({
      title: r.failed.length ? `${r.ok}名を計算し直しました（${r.failed.length}名はできませんでした）` : `${r.ok}名の明細を計算し直しました`,
      variant: r.failed.length ? "destructive" : undefined,
    });
  };

  const handleExportCsv = async () => {
    // 以前は送り先がサーバーに無く、エラーの中身を CSV として保存したうえで「開始しました」と出していた
    const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/payrolls/export/csv?year=${year}&month=${month}`, { credentials: "include" });
    if (!res.ok) {
      toast({ title: "CSVを作れませんでした", description: `もう一度お試しください（${res.status}）`, variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `給与明細データ_${year}${String(month).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast({ title: "CSVを保存しました", description: `${year}年${month}月分` });
  };

  // この社員だけ再計算（この明細を作ったときと同じ方法）。二度押しで2回計算しない。
  const recalcWith = async (mode: "same" | "manual") => {
    if (!selectedPayroll || busy || calculatePayroll.isPending) return;
    if (isDirty) {
      await confirm({
        title: "先に「保存」を押してください",
        description: "右のパネルに保存していない変更があります。保存すると、その内容で計算し直されます。",
        okLabel: "わかりました",
        cancelLabel: null,
      });
      return;
    }
    setBusy(mode === "manual" ? "manual" : "recalc");
    try {
      await calculatePayroll.mutateAsync({
        data: mode === "manual"
          ? { employeeId: selectedPayroll.employeeId, year, month, calculationMode: "manual" }
          : { employeeId: selectedPayroll.employeeId, year, month },
      });
      refreshPayrollQueries(queryClient);
      toast(mode === "manual"
        ? { title: "手入力固定で計算しました", description: "基本給＋手当・控除の行の金額で計算し直しました。" }
        : { title: "計算完了", description: `${selectedPayroll.employeeName}の給与計算が完了しました。` });
    } catch (err) {
      const msg = (err as { data?: { error?: string } } | null)?.data?.error;
      toast({ title: "エラー", description: msg ?? "計算に失敗しました。月次実績を確認してください。", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const selectedEmployee = employees?.find(e => e.id === selectedPayroll?.employeeId);
  const selectedMode = (selectedPayroll as { calculationMode?: string | null } | undefined)?.calculationMode ?? null;
  const selectedIsBw = !!(selectedEmployee as { useBluewingLogic?: boolean } | undefined)?.useBluewingLogic;

  // ── 右のパネルの見込みと、明細（サーバーで計算した金額）のずれ ──
  const serverGross = Math.round(selectedPayroll?.grossSalary ?? 0);
  const serverNet = Math.round(selectedPayroll?.netSalary ?? 0);
  const estGross = estimate ? Math.round(estimate.gross) : null;
  const estNet = estimate ? Math.round(estimate.net) : null;
  const comparable = selectedMode === "manual" && !selectedIsBw;
  const mismatch = comparable && estGross !== null && estNet !== null && (Math.abs(estGross - serverGross) > 1 || Math.abs(estNet - serverNet) > 1);

  // 振込日の初期値（会社設定の支払日。翌月払いの会社は翌月）※推測：締め日より支払日が前なら翌月払い
  const defaultTransferDate = useMemo(() => {
    const c = company as { closingDay?: number; paymentDay?: number } | undefined;
    const pay = c?.paymentDay ?? 25;
    const close = c?.closingDay ?? 31;
    const d = new Date(year, month - 1 + (pay <= close ? 1 : 0), 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return `${String(d.getMonth() + 1).padStart(2, "0")}${String(Math.min(pay, lastDay)).padStart(2, "0")}`;
  }, [company, year, month]);

  return (
    <AppLayout fullWidth>
      <div className="flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-5.5rem)]">
        {/* ── ツールバー ── */}
        <div className="shrink-0 pb-3 space-y-2.5">
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
                  setWorkMonth(y, m);
                  selectPayroll(null);
                  setChecked(new Set());
                  setCalcResult(null);
                  didInitSelectRef.current = false;
                  setIsDirty(false);
                })}
              />
              {canWrite && (
                <Button variant="secondary" size="sm" onClick={handleCalculateAll} disabled={calculating || !!busy || !employees?.length}
                  title="保存済みの月次実績をもとに、全社員の給与を計算します（確定済みは対象外）。">
                  <Calculator className="mr-1.5 h-4 w-4" />
                  {calculating ? "計算中..." : "一括計算"}
                </Button>
              )}
              {canWrite && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleConfirmAll}
                  disabled={!!busy || calculating || blocking > 0 || draftPayrolls.length === 0 || statusLoading}
                  title={blocking > 0 ? "「確定前チェック」の要対応・確認がすべて済むと押せます。" : draftPayrolls.length === 0 ? "未確定の明細がありません。" : `未確定の${draftPayrolls.length}名をまとめて確定します。`}
                >
                  <CheckCheck className="mr-1.5 h-4 w-4" />
                  {busy === "confirmAll" ? "確定中..." : "一括確定"}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={payrolls.length === 0}>
                <Download className="mr-1.5 h-4 w-4" />CSV出力
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)} disabled={payrolls.length === 0}
                title="差引支給額と振込先の一覧。全銀協フォーマットで書き出せます。">
                <Landmark className="mr-1.5 h-4 w-4" />振込一覧
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrintDialogOpen(true)}
                disabled={payrolls.length === 0 || !!printJob}
                title="全員・確定済みだけ・チェックした人を選んで印刷します（2人/A4・1人1ページ・1人ずつPDF）。"
              >
                <Printer className="mr-1.5 h-4 w-4" />
                {printJob ? "印刷準備中..." : "印刷…"}
              </Button>
            </div>
          </div>

          {/* 使い方ガイド（常時表示） */}
          <div className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 dark:bg-indigo-500/10 dark:border-indigo-500/30 px-3 py-2 text-xs text-indigo-900 dark:text-indigo-100">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-300" />
            <p className="leading-relaxed">
              <span className="font-semibold">給与の流れ：</span>
              ①「月次実績入力」で入力して<strong>「保存して計算」</strong> → ② ここで金額を見直す（直すときは右のパネルで<strong>「保存」</strong>、または<strong>「再計算」</strong>）→ ③ <strong>「確定」</strong>（全員そろったら「一括確定」）→ ④ <strong>「印刷…」</strong>。
              <span className="ml-1 text-indigo-700 dark:text-indigo-300">確定すると金額がロックされます（訂正するときは「確定解除」）。</span>
            </p>
          </div>

          {/* 確定前チェック */}
          {payrolls.length > 0 && (
            <ChecklistCard issues={issues} acked={acked} onToggleAck={toggleAck} onOpen={openIssue} loading={statusLoading} />
          )}

          {/* 単価・勤怠などが変わったあと、まだ計算し直していない人 */}
          {needsRecalcRows.length > 0 && (
            <div role="status" data-testid="stale-banner" className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 min-w-0">
                未確定の明細<strong>{needsRecalcRows.length}件</strong>は、計算したあとで勤怠・手当・単価などが変わっています。反映するには再計算が必要です。
              </span>
              {canWrite && (
                <Button size="sm" variant="outline" className="h-7 border-amber-400" onClick={handleRecalcStale} disabled={!!busy || calculating}>
                  {busy === "recalcStale" ? "計算中…" : `${needsRecalcRows.length}件を一括再計算`}
                </Button>
              )}
            </div>
          )}

          {calcProgress && <p className="text-xs text-muted-foreground" role="status">{calcProgress}</p>}

          {/* 集計サマリー */}
          {payrolls.length > 0 && <PayrollSummaryStats payrolls={payrolls} />}

          {/* 一括計算の結果（対象外とエラーを分けて出す） */}
          {calcResult && (calcResult.errors.length > 0 || calcResult.notApplicable.length > 0 || calcResult.skippedConfirmed > 0) && (
            <div className={`rounded-lg border p-3 ${calcResult.errors.length > 0 ? "border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/40" : "border-border bg-muted/40"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5 text-sm">
                  <p className="font-semibold">一括計算の結果：{calcResult.ok}件を計算しました</p>
                  {calcResult.skippedConfirmed > 0 && (
                    <p className="text-xs text-muted-foreground">確定済みのため計算していない人：{calcResult.skippedConfirmed}名</p>
                  )}
                  {calcResult.notApplicable.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      対象外（この月の実績が無い人。休職など）：{calcResult.notApplicable.join("、")}
                    </p>
                  )}
                  {calcResult.errors.length > 0 && (
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <ul className="space-y-1">
                        {calcResult.errors.map((e) => (
                          <li key={e.employeeCode} className="text-sm text-red-700 dark:text-red-300">
                            <span className="font-semibold">{e.employeeCode} {e.name}</span>
                            <span className="text-red-500 mx-1">—</span>
                            <span>{e.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button onClick={() => setCalcResult(null)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" aria-label="閉じる">
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
                <Link href={`/monthly-input?y=${year}&m=${month}`} className="text-xs text-primary underline">月次実績入力へ →</Link>
              </div>
            ) : (
              <PayrollListPane
                payrolls={payrolls}
                filtered={filtered}
                selectedId={selectedPayrollId}
                onSelect={trySelectPayroll}
                search={search}
                onSearchChange={setSearch}
                diffs={diffs}
                needsRecalc={needsRecalcIds}
                checked={checked}
                onCheckedChange={setChecked}
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base jp-tight truncate">{selectedPayroll?.employeeName ?? "—"}</span>
                        <span className="text-[11px] text-muted-foreground font-mono shrink-0">{selectedPayroll?.employeeCode}</span>
                        {selectedPayroll && (
                          selectedPayroll.status === "confirmed" ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40 text-[10px] px-1.5 py-0">確定済</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40 text-[10px] px-1.5 py-0">未確定</Badge>
                          )
                        )}
                        <SaveStatus state={panelSave} />
                        {selectedPayroll && (
                          <button type="button" onClick={() => requestNavigate(`/payroll/${selectedPayroll.id}`, navigate)} className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5" title="明細の詳細（1枚の表示）を開きます">
                            <ExternalLink className="h-3 w-3" />詳細
                          </button>
                        )}
                      </div>
                    </div>
                    {selectedPayroll && (
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {canWrite && selectedPayroll.status !== "confirmed" && (
                          <>
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={calculating || !!busy || calculatePayroll.isPending} onClick={() => recalcWith("same")}
                              title="この明細を作ったときと同じ計算方法で、最新の月次実績・手当・単価を使って計算し直します。">
                              <Calculator className="h-3 w-3 mr-1" />{busy === "recalc" ? "計算中…" : "再計算"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs border-amber-300 text-amber-800 hover:bg-amber-50 dark:text-amber-200 dark:border-amber-500/50 dark:hover:bg-amber-500/10"
                              onClick={() => recalcWith("manual")}
                              disabled={calculating || !!busy || calculatePayroll.isPending}
                              title={"「基本給（日給制は勤怠から）＋右の手当・控除の行の金額」で計算し直します。\n月次実績入力の「保存して計算」と同じ方法で、事務所はふだんこの方法です。\n残業代などをシステムが出す「自動計算」で作られた明細を、この方法に切り替えるときにも使います（切り替えると、自動で出ていた時間外手当などは手当の行の金額だけになります）。"}
                            >
                              <Calculator className="h-3 w-3 mr-1" />{busy === "manual" ? "計算中…" : "手入力固定"}
                            </Button>
                          </>
                        )}
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => { void handlePrint(); }} disabled={!!busy}>
                          <FileText className="h-3.5 w-3.5 mr-1" />印刷
                        </Button>
                        {canWrite && (selectedPayroll.status !== "confirmed" ? (
                          <Button size="sm" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { void handleConfirm(); }} disabled={!!busy || confirmPayroll.isPending}
                            title={isDirty ? "保存していない変更があります。押すと、保存してから確定します。" : "この明細の金額を締めてロックします。以後は再計算されません（訂正するときは「確定解除」）。"}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />{isDirty ? "保存して確定" : busy === "confirm" ? "確定中…" : "確定"}
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs border-amber-300 text-amber-800 hover:bg-amber-50 dark:text-amber-200 dark:border-amber-500/50" onClick={() => setUnconfirmOpen(true)} disabled={!!busy}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />確定解除
                          </Button>
                        ))}
                        <button onClick={tryClosePanel} className="hidden md:inline-flex p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0" aria-label="閉じる">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 明細の金額（サーバーで計算した金額）と、右のパネルの見込みのずれ */}
                  {selectedPayroll && (
                    <div
                      data-testid="amount-check"
                      className={`px-3 md:px-4 py-2 border-b text-xs flex flex-wrap items-center gap-x-4 gap-y-1 ${mismatch && !isDirty ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/40" : "bg-muted/10"}`}
                    >
                      <span className="text-muted-foreground">明細の金額（左の一覧と同じ）：</span>
                      <span>総支給 <strong className="amount">{yen(serverGross)}</strong></span>
                      <span>差引 <strong className="amount">{yen(serverNet)}</strong></span>
                      {estGross !== null && estNet !== null && comparable && (
                        isDirty ? (
                          <span className="text-amber-700 dark:text-amber-300">保存していない変更があるため、下の見込み（総支給 {yen(estGross)}・差引 {yen(estNet)}）と違います。「保存」すると計算し直されます。</span>
                        ) : mismatch ? (
                          <span className="text-red-700 dark:text-red-300 font-semibold">
                            下の見込み（総支給 {yen(estGross)}・差引 {yen(estNet)}）とずれています（差 {estNet - serverNet > 0 ? "+" : ""}{(estNet - serverNet).toLocaleString("ja-JP")}円）。「再計算」を押してください。
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-300">下の見込みと一致しています</span>
                        )
                      )}
                      {!comparable && selectedMode && (
                        <span className="text-muted-foreground">
                          {selectedIsBw ? "BW社員は時間外手当・業績手当をサーバーで計算するため、下の見込みとは一致しません。" : "自動計算で作られた明細のため、下の見込みとは一致しません。"}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 詳細本体 */}
                  <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-12 text-muted-foreground">読み込み中...</div>
                    ) : !selectedPayroll ? (
                      <div className="py-12 text-center text-muted-foreground">データが見つかりません</div>
                    ) : selectedEmployee ? (
                      <>
                      <PayrollWarnings payroll={selectedPayroll} />
                      <AllowanceInputPanel
                        key={selectedPayroll.id}
                        employee={selectedEmployee}
                        monthlyData={(() => {
                          const rec = monthlyRecords?.find(r => r.employeeId === selectedPayroll.employeeId);
                          return {
                            workDays: rec?.workDays ?? selectedPayroll.workDays ?? 0,
                            saturdayWorkDays: (rec as { saturdayWorkDays?: number } | undefined)?.saturdayWorkDays ?? 0,
                            sundayWorkHours: (rec as { sundayWorkHours?: number } | undefined)?.sundayWorkHours ?? 0,
                            paidLeaveDays: (rec as { paidLeaveDays?: number } | undefined)?.paidLeaveDays ?? 0,
                            overtimeHours: rec?.overtimeHours ?? selectedPayroll.overtimeHours ?? 0,
                            lateNightHours: rec?.lateNightHours ?? selectedPayroll.lateNightHours ?? 0,
                            actualWorkHours: (rec as { actualWorkHours?: number } | undefined)?.actualWorkHours ?? 0,
                          };
                        })()}
                        onDirtyChange={setIsDirty}
                        year={year}
                        month={month}
                        calculationMode={selectedMode}
                        saveRef={panelSaveRef}
                        onEstimateChange={setEstimate}
                        onSaveStateChange={setPanelSave}
                        readOnly={!canWrite}
                      />
                      </>
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
            <AlertDialogCancel>キャンセル（入力を続ける）</AlertDialogCancel>
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

      {/* 確定解除（理由を残す） */}
      <AlertDialog open={unconfirmOpen} onOpenChange={(v) => { if (!busy) setUnconfirmOpen(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedPayroll?.employeeName}さんの確定を解除します</AlertDialogTitle>
            <AlertDialogDescription>
              未確定に戻すと、勤怠・手当の修正と再計算ができるようになります。
              なぜ解除するのかを入れてください（操作の記録に残ります）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="text-sm font-medium" htmlFor="unconfirm-reason">解除する理由</label>
          <Textarea
            id="unconfirm-reason"
            value={unconfirmReason}
            onChange={(e) => setUnconfirmReason(e.target.value.slice(0, 200))}
            placeholder="例：残業時間の入力まちがいを直すため"
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>やめる</AlertDialogCancel>
            <Button
              onClick={() => { void handleUnconfirm(); }}
              disabled={!!busy || unconfirmReason.trim().length === 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {busy === "unconfirm" ? "解除中…" : "確定を解除する"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PrintDialog
        open={printDialogOpen}
        onOpenChange={setPrintDialogOpen}
        counts={{
          all: payrolls.length,
          confirmed: payrolls.filter((p) => p.status === "confirmed").length,
          checked: payrolls.filter((p) => checked.has(p.id)).length,
          draftIn: (t) => pickTarget(t).filter((p) => p.status !== "confirmed").length,
        }}
        onStart={(t, f) => { void startPrint(t, f); }}
      />

      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} year={year} month={month} defaultDate={defaultTransferDate} />

      {/* 印刷の準備中（画面に出す。印刷には出ない） */}
      {printJob && (
        <div role="status" data-testid="print-overlay" className="fixed bottom-4 right-4 z-50 print:hidden rounded-xl border bg-card shadow-xl px-4 py-3 flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>
            {printJob.each ? `1人ずつ保存：${printJob.each.index} / ${printJob.each.total}人目（${printJob.payrolls[0]?.employeeName}）` : `印刷の準備中…（${printJob.payrolls.length}人分）`}
          </span>
          <Button size="sm" variant="outline" onClick={() => setPrintJob(null)}>中止</Button>
        </div>
      )}

      {/* ── 一括印刷ポータル ── */}
      {printJob && (
        <PayslipBulkPrint
          key={printJob.key}
          payrolls={printJob.payrolls as unknown as Parameters<typeof PayslipBulkPrint>[0]["payrolls"]}
          companyName={company?.name ?? "三川運送株式会社"}
          employees={(employees ?? []) as unknown as Parameters<typeof PayslipBulkPrint>[0]["employees"]}
          company={company as Parameters<typeof PayslipBulkPrint>[0]["company"]}
          onDone={onPrintDone}
          onFailed={onPrintFailed}
          onTimeout={onPrintTimeout}
          year={year}
          month={month}
          layout={printJob.layout}
          title={printJob.title}
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
      {confirmDialog}
    </AppLayout>
  );
}
