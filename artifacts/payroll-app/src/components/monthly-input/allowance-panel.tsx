import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  useListAllowanceDefinitions,
  getListAllowanceDefinitionsQueryKey,
  useListDeductionDefinitions,
  getListDeductionDefinitionsQueryKey,
  useGetCompany,
  getListEmployeesQueryKey,
  useListPayrolls,
  getListPayrollsQueryKey,
  // 自動保存はアンマウント時（社員切替）にも書き込むため、フックではなく素の関数を使う
  calculatePayroll as apiCalculatePayroll,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X, GripVertical, ChevronDown, ChevronUp, Loader2, Check, AlertCircle, Lock } from "lucide-react";
import {
  EmployeeExt,
  CompanySettings,
  roundJapanese,
  resolvePensionApplied,
  calculateIncomeTaxFromOfficialTable,
  lateNightRateFor,
} from "./estimate";
import { round50sen } from "@/lib/tax-tables-reiwa8";
import { formatRatePercent, useMonthInsurance } from "@/lib/insurance-rates";
import { useMonthItems, saveMonthItems, monthItemsQueryKey, toLegacyRows, MonthItemsError } from "@/lib/month-items";

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
  autoNote,
}: {
  row: AllowanceRow;
  definitions: { id: number; name: string; isTaxable: boolean }[];
  onChange: (uid: string, field: "defId" | "amount", value: number | null) => void;
  onRemove: (uid: string) => void;
  /** 金額が勤怠から自動で入る手当（有給など）の注記 */
  autoNote?: string;
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
        {autoNote && (
          <div className="text-[10px] text-muted-foreground px-1">{autoNote}</div>
        )}
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
  year,
  month,
  hasMonthlyRecord = false,
}: {
  employee: EmployeeExt;
  /**
   * この社員のこの月の月次実績が保存済みか。未保存の月は、開いただけでは自動反映も
   * 自動保存もしない（勤怠が全部0なので、0円で手当マスタを上書きしてしまうため）。
   */
  hasMonthlyRecord?: boolean;
  /** 再計算する対象月。省略すると保存しても給与明細は更新されない */
  year?: number;
  month?: number;
  monthlyData?: {
    workDays: number;
    saturdayWorkDays: number;
    sundayWorkHours: number;
    /** 祝日の出勤日数（土曜と同じ日当＝1.25倍で計算） */
    holidayWorkDays?: number;
    paidLeaveDays: number;
    overtimeHours: number;
    lateNightHours: number;
    /** 時給制の実働時間（月合計）。時給 × これ が基本給になる。 */
    actualWorkHours?: number;
  };
}) {
  const queryClient = useQueryClient();
  const employeeId = employee.id;
  // 手当・控除は「この月」の内容を読み書きする（ほかの月の内容を書き換えない）
  const targetYear = year ?? new Date().getFullYear();
  const targetMonth = month ?? new Date().getMonth() + 1;
  // 取り直しが済むまでは使わない。手元に残っている古い内容で行を作ると、保存した直後に
  // ほかの社員へ移って戻ったとき、保存前の金額に巻き戻って見えていた。
  const { data: monthItemsRaw, isFetchedAfterMount } = useMonthItems(employeeId, targetYear, targetMonth, { staleTime: 0, refetchOnMount: "always" });
  const monthItems = isFetchedAfterMount ? monthItemsRaw : undefined;
  const legacyRows = useMemo(() => toLegacyRows(monthItems, employeeId), [monthItems, employeeId]);
  const employeeAllowances = legacyRows.allowances;
  const employeeDeductions = legacyRows.deductions;

  const { data: allowanceDefinitions = [], isLoading: isAllowDefsLoading } = useListAllowanceDefinitions(
    { activeOnly: true },
    { query: { queryKey: getListAllowanceDefinitionsQueryKey({ activeOnly: true }), staleTime: 0, refetchOnMount: true } }
  );
  const { data: deductionDefinitions = [], isLoading: isDedDefsLoading } = useListDeductionDefinitions(
    { activeOnly: true },
    { query: { queryKey: getListDeductionDefinitionsQueryKey({ activeOnly: true }), staleTime: 0, refetchOnMount: true } }
  );
  const { data: companyData } = useGetCompany();
  const company = companyData as CompanySettings | undefined;
  const monthInsurance = useMonthInsurance(
    year ?? new Date().getFullYear(),
    month ?? new Date().getMonth() + 1,
  );
  // この月の給与明細が確定済みか。確定済みの月は手当・控除を「表示のみ」にする。
  // 手当は年月を持たない社員マスタの1レコードなので、自動保存のまま過去の確定月を
  // 開くと、その月の勤怠から計算した金額でマスタが上書きされ、未確定の月が壊れる。
  const payrollParams = { year: year ?? 0, month: month ?? 0 };
  const { data: monthPayrolls, isSuccess: payrollsLoaded } = useListPayrolls(payrollParams, {
    query: { enabled: year != null && month != null, queryKey: getListPayrollsQueryKey(payrollParams) },
  });
  const payrollStatusKnown = year == null || month == null || payrollsLoaded;
  const isConfirmed = !!monthItems?.locked || !!monthPayrolls?.some(
    (p) => p.employeeId === employeeId && p.status === "confirmed"
  );

  // 画面を開いただけで書き込まないための判定。
  // 手当は月をまたいで共有されるので、実績未入力の月を開いただけで勤怠0から計算した
  // 0円が自動保存されると、今月分の手当が消える。
  //
  // 「勤怠から金額を出す（自動反映）」と「保存する」は条件を分ける。
  // 手当を1つ手で直しただけで自動反映まで走ると、実績の無い月では勤怠連動の手当が
  // 全部0円→行ごと削除になる（実ブラウザ検証で発覚）。
  //   - 自動反映してよい : その月の実績が保存済み、またはこの画面で勤怠を変更した
  //   - 保存してよい     : 上記に加えて、手当・控除を手で変更したとき
  const [touchedAttendance, setTouchedAttendance] = useState(false);
  const [touchedManual, setTouchedManual] = useState(false);
  const allowAutoFill = hasMonthlyRecord || touchedAttendance;
  const allowWrite = allowAutoFill || touchedManual;

  const [rows, setRows] = useState<AllowanceRow[]>([{ uid: genUid(), defId: null, amount: 0 }]);
  const [baseSalaryInput, setBaseSalaryInput] = useState(0);
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([{ uid: genUid(), defId: null, amount: 0 }]);
  const [showInsuranceDetail, setShowInsuranceDetail] = useState(false);
  // 手当行の初期化（データ到着後）が済んだかどうか。全データ＋この初期化が揃うまでスケルトン表示
  const [rowsReady, setRowsReady] = useState(false);

  const isDaily = employee.salaryType === "daily";
  const isHourly = employee.salaryType === "hourly";
  // 実効単価（個人単価があればそれ、無ければ会社共通）
  const rateWeekday = (employee.dailyRateWeekday ?? 0) > 0
    ? (employee.dailyRateWeekday ?? 0)
    : (company?.dailyWageWeekday ?? 9808);
  const rateSaturday = (employee.dailyRateSaturday ?? 0) > 0
    ? (employee.dailyRateSaturday ?? 0)
    : (company?.dailyWageSaturday ?? 12260);
  const rateSundayHour = company?.hourlyWageSunday ?? 1655;

  // 基本給は「平日日数 × 平日日当」だけ。土曜・日曜分は休日出勤手当に入れる。
  // 本番データで裏付け済み: 岡田 平日17d×9,808=166,736、玉川 平日18d×9,808=176,544 が
  // それぞれ実際の基本給と一致する（給与明細一覧側の手当パネルと同じ式）。
  // 以前ここだけ土曜・日曜も足していたため、明細一覧側で保存した場合と金額が食い違い、
  // かつ休日出勤手当と土曜分が二重計上になっていた。
  const computedDailyBaseSalary =
    isDaily && company
      ? Math.round((monthlyData?.workDays ?? 0) * rateWeekday)
      : null;

  // ── 勤怠から金額が決まる手当の自動反映 ──────────────────────────────
  // 事務所は「時間（日数）× 単価」を電卓で出して金額欄に手入力していた。手当は年月を
  // 持たない社員マスタの1レコードなので、翌月も前月の金額が残り続ける（実際に7月分の
  // 早出残業手当85,496円・深夜手当1,266円が8月にそのまま残り、クライアントから
  // 「残業39.5h×2,111=83,385のはずが85,496になる」と報告された）。
  // 月次実績から金額を導出して、手計算と持ち越しの両方を無くす。
  const paidLeaveDays  = monthlyData?.paidLeaveDays  ?? 0;
  const overtimeHours  = monthlyData?.overtimeHours  ?? 0;
  const lateNightHours = monthlyData?.lateNightHours ?? 0;

  function defIdOfName(keyword: string): number | null {
    return allowanceDefinitions.find((d) => d.name.includes(keyword))?.id ?? null;
  }

  // 有給の単価は平日日当と同じ
  const paidLeaveRate = rateWeekday;
  // 残業の単価: 社員マスタの「残業 時給（円/時）」。未設定(0)の社員は自動反映しない
  // （0円で上書きして手入力を消さないため）。
  const overtimeRate = employee.overtimeHourlyRate ?? 0;
  // 深夜の単価: 社員マスタの「深夜 単価」があればそれ。無ければ残業時給から自動（÷1.25×0.25）。
  const personalNightRate = (employee as { lateNightHourlyRate?: number }).lateNightHourlyRate ?? 0;
  const overtimeDefId = defIdOfName("早出残業手当");
  const lateNightDefId = defIdOfName("深夜手当");

  const defIdOf = defIdOfName;

  /** 勤怠から金額が決まる手当。defId が null（手当が未定義）のものは対象外。 */
  const autoRows = useMemo(() => {
    const rowsOut: { defId: number; amount: number; note: string }[] = [];
    const push = (defId: number | null, amount: number, note: string) => {
      if (defId !== null) rowsOut.push({ defId, amount, note });
    };

    push(
      defIdOf("有給"),
      Math.round(paidLeaveRate * paidLeaveDays),
      `勤怠の有給 ${paidLeaveDays}日 × ${paidLeaveRate.toLocaleString("ja-JP")}円（自動）`
    );

    // 休日出勤手当 = 土曜日数 × 土曜日当 ＋ 日曜・祝日時間 × 日曜時給。
    // 本番データで裏付け済み: 岡田 2d×12,260+0h = 24,520、
    // 玉川 2d×12,260+5.5h×1,655 = 33,623 が、いずれも事務所の手入力額と一致する。
    // 割増は日曜だけ1.35倍、土曜と祝日は1.25倍（会社の決まり・2026-10）。
    // 祝日は土曜と同じ日当（平日日当×1.25）で日数を掛ける。以前は祝日も日曜の時給で数えていた。
    const saturdayDays = monthlyData?.saturdayWorkDays ?? 0;
    const sundayHours = monthlyData?.sundayWorkHours ?? 0;
    const holidayDays = monthlyData?.holidayWorkDays ?? 0;
    push(
      defIdOf("休日出勤手当"),
      Math.round((saturdayDays + holidayDays) * rateSaturday + sundayHours * rateSundayHour),
      `勤怠の土曜 ${saturdayDays}日` + (holidayDays > 0 ? `＋祝日 ${holidayDays}日` : "") +
        ` × ${rateSaturday.toLocaleString("ja-JP")}円` +
        ` ＋ 日曜 ${sundayHours}h × ${rateSundayHour.toLocaleString("ja-JP")}円（自動）`
    );

    if (overtimeRate > 0) {
      // 残業手当 = 残業時間 × 残業時給。労基法37条3項に合わせ60時間超は ×1.20 追加。
      const OT_THRESHOLD = 60;
      const overtimePay = overtimeHours <= OT_THRESHOLD
        ? Math.round(overtimeRate * overtimeHours)
        : Math.round(overtimeRate * OT_THRESHOLD) +
          Math.round(overtimeRate * 1.20 * (overtimeHours - OT_THRESHOLD));
      push(
        defIdOf("早出残業手当"),
        overtimePay,
        `勤怠の残業 ${overtimeHours}h × ${overtimeRate.toLocaleString("ja-JP")}円（自動）`
      );

    }
    if (overtimeRate > 0 || personalNightRate > 0) {
      // 深夜手当 = 深夜時間 × 深夜単価（個人の深夜単価。無ければ 残業時給 ÷ 1.25 × 0.25）
      const perHour = lateNightRateFor(personalNightRate, overtimeRate);
      push(
        defIdOf("深夜手当"),
        Math.round(perHour * lateNightHours),
        `勤怠の深夜 ${lateNightHours}h × ${perHour.toLocaleString("ja-JP")}円（自動）`
      );
    }
    return rowsOut;
  }, [
    allowanceDefinitions, paidLeaveRate, paidLeaveDays,
    monthlyData?.saturdayWorkDays, monthlyData?.sundayWorkHours, monthlyData?.holidayWorkDays, rateSaturday, rateSundayHour,
    overtimeRate, overtimeHours, lateNightHours, personalNightRate,
  ]);

  /** 自動反映の対象と金額が変わったときだけ effect を走らせるための安定キー */
  const autoRowsKey = autoRows.map((r) => `${r.defId}:${r.amount}`).join(",");

  // pinned な手当IDを安定した文字列キーにして依存を安定化する。
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

  // 行の初期化は、手当データと手当定義が揃った時点で1回だけ確定する。
  // 自動保存のたびに手当を再取得するので、毎回作り直すと入力中の行が新しい uid で
  // 置き換わり、フォーカスが外れて打鍵が消える。
  const rowsInitRef = useRef(false);
  useEffect(() => {
    if (rowsInitRef.current) return;
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
    // 手当データと手当定義（固定表示の手当）が揃ってから ready にし、以後は作り直さない
    if (employeeAllowances !== undefined && !isAllowDefsLoading) {
      setRowsReady(true);
      rowsInitRef.current = true;
    }
  }, [employeeAllowances, employeeId, pinnedIdsKey, isAllowDefsLoading]);

  // 勤怠が変わったら対象手当の金額を入れ直す（時間・日数が0なら0にする＝持ち越しを断つ）。
  // 依存は autoRowsKey（対象と金額）だけなので、金額欄を手で直した後に再レンダーしても
  // 上書きしない。
  useEffect(() => {
    if (!rowsReady || !payrollStatusKnown || isConfirmed || !allowAutoFill || autoRows.length === 0) return;
    setRows((prev) => {
      let next = prev;
      for (const auto of autoRows) {
        const idx = next.findIndex((r) => r.defId === auto.defId);
        if (idx >= 0) {
          if (next[idx].amount === auto.amount) continue;
          if (next === prev) next = [...prev];
          next[idx] = { ...next[idx], amount: auto.amount };
          continue;
        }
        if (auto.amount === 0) continue;
        // 行がまだ無ければ足す（空行しか無い場合はその行を使う）
        if (next === prev) next = [...prev];
        const row = { uid: genUid(), defId: auto.defId, amount: auto.amount };
        const blank = next.findIndex((r) => r.defId === null && !r.amount);
        if (blank >= 0) next[blank] = row;
        else next.push(row);
      }
      return next;
    });
    // autoRows は autoRowsKey から導出されるので依存はキーだけでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsReady, payrollStatusKnown, isConfirmed, allowAutoFill, autoRowsKey]);

  const dedInitRef = useRef(false);
  useEffect(() => {
    if (dedInitRef.current || employeeDeductions === undefined) return;
    if (employeeDeductions.length > 0) {
      setDeductionRows(employeeDeductions.map((d) => ({ uid: genUid(), defId: d.deductionDefinitionId, amount: d.amount })));
    } else {
      setDeductionRows([{ uid: genUid(), defId: null, amount: 0 }]);
    }
    dedInitRef.current = true;
  }, [employeeDeductions, employeeId]);

  const baseInitRef = useRef(false);
  useEffect(() => {
    // 日給制は勤怠（平日日数）から導出する表示専用の値なので、常に追従させる。
    // ただし確定済みの月は保存されている値をそのまま見せる。
    if (isDaily && computedDailyBaseSalary !== null && payrollStatusKnown && !isConfirmed && allowAutoFill) {
      setBaseSalaryInput(computedDailyBaseSalary);
      return;
    }
    // 時給制は「時給 × 実働時間」を見せるだけ（マスターの基本給欄は時給そのもの。
    // そのまま出すと時給が1か月分の基本給に見え、打ち替えるとマスターの時給が書き換わっていた）。
    if (isHourly) {
      setBaseSalaryInput(Math.round((employee.baseSalary ?? 0) * (monthlyData?.actualWorkHours ?? 0)));
      return;
    }
    // 月給は手入力なので、初回だけDBの値を入れる（自動保存後の再取得で上書きしない）。
    // 日給で確定済み・実績未入力の月は、その月に保存してある基本給を見せる。
    if (baseInitRef.current) return;
    if (monthItems === undefined) return;
    setBaseSalaryInput(isDaily ? (monthItems.baseSalary ?? employee.baseSalary ?? 0) : (employee.baseSalary ?? 0));
    baseInitRef.current = true;
  }, [employee.baseSalary, isDaily, isHourly, computedDailyBaseSalary, payrollStatusKnown, isConfirmed, allowAutoFill, monthItems, monthlyData?.actualWorkHours]);

  const handleAllowanceChange = useCallback(
    (uid: string, field: "defId" | "amount", value: number | null) => {
      setTouchedManual(true);
      setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value ?? 0 } : r)));
    },
    []
  );
  const handleRemoveAllowance = useCallback((uid: string) => {
    setTouchedManual(true);
    setRows((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  const handleDeductionChange = useCallback(
    (uid: string, field: "defId" | "amount", value: number | null) => {
      setTouchedManual(true);
      setDeductionRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value ?? 0 } : r)));
    },
    []
  );
  const handleRemoveDeduction = useCallback((uid: string) => {
    setTouchedManual(true);
    setDeductionRows((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  // ── 計算（旧 AllowanceSidebar と同一）─────────────────────────────────
  const allowancesTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = baseSalaryInput + allowancesTotal;
  const nonTaxableAllowancesTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions.find(d => d.id === r.defId);
    return s + (def && !def.isTaxable ? (r.amount || 0) : 0);
  }, 0);

  // 保険料はサーバの手入力固定（manual）計算と同じ式: 標準報酬月額（未設定なら総支給）× その月の料率。
  // 料率・標準報酬月額はマスターの履歴から「この明細の年月」に効く値を使う。
  // （以前は会社設定の古い料率 × 総支給で概算しており、明細の金額と合っていなかった）
  const { rates: monthRates } = monthInsurance;
  const healthRate = employee.careInsuranceApplied ? monthRates.healthWithCareEmployeeRate : monthRates.healthEmployeeRate;
  const pensionRate = monthRates.pensionEmployeeRate;
  const eiRate = monthRates.employmentInsuranceRate;
  const isInsuranceExempt = employee.taxExempt === true;
  const stdRemuneration = monthInsurance.standardRemunerationOf(employee.id, employee.standardRemuneration);
  const insBase = stdRemuneration > 0 ? stdRemuneration : grandTotal;

  const isPensionApplied = resolvePensionApplied(employee, year, month);
  const healthInsurance = isInsuranceExempt ? 0 : round50sen(insBase * healthRate);
  const childcareSupport = isInsuranceExempt ? 0 : round50sen(insBase * monthRates.childcareEmployeeRate);
  const pensionInsurance = isInsuranceExempt || !isPensionApplied
    ? 0
    : round50sen(Math.min(insBase, monthRates.pensionMaxStandard) * pensionRate);
  // 雇用保険の計算基礎から除外する手当合計（「雇用保険の対象外」ON の手当のみ。交通費は含めない）
  const empInsExcludedTotal = rows.reduce((s, r) => {
    const def = allowanceDefinitions.find(d => d.id === r.defId);
    return s + (def?.excludeFromEmploymentInsurance ? (r.amount || 0) : 0);
  }, 0);
  // 雇用保険: （総支給 − 除外対象手当）× 料率。携帯代等の実費手当のみ計算基礎から除く。
  // 給与明細の右パネルで雇用保険料を手で決めてあれば、その額（ここでは変えない・保存でも送らない）
  const empInsOverride = monthItems?.employmentInsuranceOverride ?? null;
  const employmentInsurance = empInsOverride != null
    ? empInsOverride
    : !isInsuranceExempt && employee.employmentInsuranceApplied !== false
      ? round50sen((grandTotal - empInsExcludedTotal) * eiRate)
      : 0;
  const totalInsurance = healthInsurance + childcareSupport + pensionInsurance + employmentInsurance;

  const afterInsuranceSalary = Math.max(0, grandTotal - totalInsurance - nonTaxableAllowancesTotal);
  const incomeTax = isInsuranceExempt ? 0 : calculateIncomeTaxFromOfficialTable(
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

  // ── 自動保存 ─────────────────────────────────────────────────────
  // 「手当・控除を保存」ボタンは廃止。画面に出ている内容＝保存されている内容、にする。
  // 手入力の変更も、勤怠からの自動反映も、最後の変更から少し待ってまとめて保存し、
  // 続けて manual モードで給与明細を再計算する。
  const AUTOSAVE_DELAY_MS = 800;

  /** 今の画面の内容を、保存APIに送る形にしたもの */
  const payload = useMemo(() => ({
    allowances: rows
      .filter((r) => r.defId !== null && r.amount > 0)
      .map((r) => ({ allowanceDefinitionId: r.defId!, amount: r.amount })),
    deductions: deductionRows
      .filter((r) => r.defId !== null)
      .map((r) => ({ deductionDefinitionId: r.defId!, amount: r.amount || 0 })),
    // 時給制の基本給は計算結果の表示なので、保存の対象にしない（0で固定して差分に出さない）
    baseSalary: isHourly ? 0 : baseSalaryInput,
  }), [rows, deductionRows, baseSalaryInput, isHourly]);
  const snapshot = useMemo(() => JSON.stringify(payload), [payload]);

  const [baselineReady, setBaselineReady] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [recalcNote, setRecalcNote] = useState<string | null>(null);

  /** 最後に保存が成功した内容（初期値はDBの内容）。これと画面が違えば保存する */
  const lastSavedRef = useRef<string | null>(null);
  const latestRef = useRef({ payload, snapshot });
  latestRef.current = { payload, snapshot };
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  // DBの内容を「保存済み」の基準にする（payload と同じキー順で組み立てること）。
  // 画面を開いた直後に勤怠からの自動反映で金額が変わった場合も、基準と違うので保存される。
  useEffect(() => {
    if (lastSavedRef.current !== null) return;
    if (employeeAllowances === undefined || employeeDeductions === undefined) return;
    lastSavedRef.current = JSON.stringify({
      allowances: employeeAllowances
        .filter((a) => a.amount > 0)
        .map((a) => ({ allowanceDefinitionId: a.allowanceDefinitionId, amount: a.amount })),
      deductions: employeeDeductions
        .map((d) => ({ deductionDefinitionId: d.deductionDefinitionId, amount: d.amount || 0 })),
      baseSalary: isHourly ? 0 : isDaily ? (monthItems?.baseSalary ?? employee.baseSalary ?? 0) : (employee.baseSalary ?? 0),
    });
    setBaselineReady(true);
  }, [employeeAllowances, employeeDeductions, employee.baseSalary, isHourly, isDaily, monthItems]);

  const canAutoSave = rowsReady && baselineReady && payrollStatusKnown && !isConfirmed && allowWrite;

  // 「実績入力」タブで勤怠を変えた場合も、この画面での変更として扱う（自動反映→保存させる）。
  // 基準は、パネルの準備が済んだ時点の勤怠。
  const monthlyKey = JSON.stringify(monthlyData ?? {});
  const firstMonthlyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!rowsReady || !baselineReady || !payrollStatusKnown) return;
    if (firstMonthlyKeyRef.current === null) {
      firstMonthlyKeyRef.current = monthlyKey;
      return;
    }
    if (monthlyKey !== firstMonthlyKeyRef.current) setTouchedAttendance(true);
  }, [monthlyKey, rowsReady, baselineReady, payrollStatusKnown]);

  const runSave = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return; // 保存中に来た変更は、終わった後に拾い直す
    const { payload: p, snapshot: snap } = latestRef.current;
    if (snap === lastSavedRef.current) {
      setSaveState("saved");
      return;
    }
    inFlightRef.current = true;
    setSaveState("saving");
    let ok = false;
    try {
      // 手当・控除・基本給を、この月の内容として1回で保存する（途中で失敗して半端に残らない）
      const saved = await saveMonthItems(employeeId, targetYear, targetMonth, {
        allowances: p.allowances,
        deductions: p.deductions,
        ...(isHourly ? {} : { baseSalary: p.baseSalary }),
      });
      // 保存した内容を手元の控えにもすぐ入れる（このパネルが外れた後でも古い内容が残らない）
      queryClient.setQueryData(monthItemsQueryKey(employeeId, targetYear, targetMonth), saved);
      lastSavedRef.current = snap;
      ok = true;

      if (year != null && month != null) {
        try {
          await apiCalculatePayroll({ employeeId, year, month, calculationMode: "manual" });
          setRecalcNote(null);
        } catch (e) {
          const status = (e as { status?: number }).status;
          setRecalcNote(
            status === 404 ? "この月の月次実績が未保存のため、給与明細はまだ作られていません"
            : status === 409 ? "給与明細が確定済みのため、明細は再計算されていません"
            : "手当は保存しましたが、給与明細の再計算に失敗しました"
          );
        }
        queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      }
      queryClient.invalidateQueries({ queryKey: monthItemsQueryKey(employeeId, targetYear, targetMonth) });
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey({ active: true }) });
      setSavedAt(new Date());
    } catch (e) {
      // 409 ＝ ほかの人がこの月を確定した。取り直して「確定済み」の表示に切り替える。
      if (e instanceof MonthItemsError && e.status === 409) {
        queryClient.invalidateQueries({ queryKey: monthItemsQueryKey(employeeId, targetYear, targetMonth) });
        if (year != null && month != null) queryClient.invalidateQueries({ queryKey: getListPayrollsQueryKey({ year, month }) });
      }
      setSaveState("error");
    } finally {
      inFlightRef.current = false;
    }
    if (!ok) return;
    // 保存中にさらに編集されていたら、続けてもう一度保存する
    if (latestRef.current.snapshot !== lastSavedRef.current) {
      void runSaveRef.current();
    } else {
      setSaveState("saved");
    }
  }, [employeeId, year, month, targetYear, targetMonth, isHourly, queryClient]);
  const runSaveRef = useRef(runSave);
  runSaveRef.current = runSave;

  // 画面の内容が保存済みと違ったら、最後の変更から少し待って保存する
  useEffect(() => {
    if (!canAutoSave) return;
    if (snapshot === lastSavedRef.current) return;
    setSaveState((st) => (st === "saving" ? st : "pending"));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void runSaveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, [snapshot, canAutoSave]);

  // 社員を切り替える（＝このパネルが外れる）ときは、待ち中の保存をすぐ実行する
  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void runSaveRef.current();
    }
  }, []);

  // 保存待ち・保存中にタブを閉じようとしたら警告する
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (timerRef.current !== null || inFlightRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // 全データ（手当・控除・両定義・会社設定）が揃い、かつ行初期化が済むまでスケルトン表示。
  // 社員切替時の途中状態（金額が順次入る）を見せず、完全に読み込んでから表示する。
  const panelLoading =
    employeeAllowances === undefined ||
    employeeDeductions === undefined ||
    companyData === undefined ||
    isAllowDefsLoading ||
    isDedDefsLoading ||
    !rowsReady ||
    !payrollStatusKnown;

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

  const savedAtLabel = savedAt
    ? `${String(savedAt.getHours()).padStart(2, "0")}:${String(savedAt.getMinutes()).padStart(2, "0")}`
    : null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden max-w-2xl mx-auto">
      {isConfirmed && (
        <div className="px-4 py-2.5 flex items-start gap-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30">
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <div className="font-semibold">この月の給与明細は確定済みのため、表示のみです</div>
            <div className="mt-0.5">手当・控除を変更するには、給与明細画面で確定を解除してください。</div>
          </div>
        </div>
      )}

      {/* 確定済みの月は入力・並べ替え・行の追加削除をすべて無効にする */}
      <fieldset
        disabled={isConfirmed}
        className={`m-0 p-0 border-0 min-w-0 ${isConfirmed ? "pointer-events-none opacity-70" : ""}`}
      >
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
            {isHourly && (
              <div className="text-[10px] text-muted-foreground">
                時給 {(employee.baseSalary ?? 0).toLocaleString("ja-JP")}円 × 実働 {monthlyData?.actualWorkHours ?? 0}時間
              </div>
            )}
          </div>
          <span className="shrink-0 w-10 text-center px-1 py-0.5 rounded border text-[10px] bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
            課税
          </span>
          {isDaily || isHourly ? (
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
                setTouchedManual(true);
                setBaseSalaryInput(isNaN(v) ? 0 : v);
              }}
              placeholder="0"
            />
          )}
          <span className="w-6 shrink-0" />
        </div>

        {/* 残業時給が未設定の社員への案内。古い月の金額が気付かれずに残るのを防ぐ */}
        {overtimeRate <= 0 &&
          (overtimeHours > 0 ||
            lateNightHours > 0 ||
            rows.some((r) => (r.defId === overtimeDefId || r.defId === lateNightDefId) && r.amount > 0)) && (
            <div className="px-4 py-2 border-b border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200">
              <div className="font-semibold">残業時給が未設定のため、早出残業手当・深夜手当は勤怠から自動計算されていません</div>
              <div className="mt-0.5">
                マスター管理 → この社員 →「給与設定」タブの「残業 時給（円/時）」を設定すると、
                残業{overtimeHours}h・深夜{lateNightHours}hから自動で入るようになります。
              </div>
            </div>
          )}

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
        <Reorder.Group axis="y" values={rows} onReorder={(next) => { setTouchedManual(true); setRows(next); }} className="select-none">
          {rows.map((row) => (
            <AllowanceReorderItem
              key={row.uid}
              row={row}
              definitions={allowanceDefinitions}
              onChange={handleAllowanceChange}
              onRemove={handleRemoveAllowance}
              autoNote={
                autoRows.find((a) => a.defId === row.defId)?.note ??
                (overtimeRate <= 0 && row.defId !== null && (row.defId === overtimeDefId || row.defId === lateNightDefId)
                  ? "残業時給が未設定のため自動計算されていません（手入力の金額です）"
                  : undefined)
              }
            />
          ))}
        </Reorder.Group>

        <div className="px-4 py-2 border-b border-border/60">
          <button
            type="button"
            onClick={() => { setTouchedManual(true); setRows((prev) => [...prev, { uid: genUid(), defId: null, amount: 0 }]); }}
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
              { label: `健康保険料 (${formatRatePercent(healthRate)}${employee.careInsuranceApplied ? "・介護込み" : ""})`, value: healthInsurance },
              { label: `子ども・子育て支援金 (${formatRatePercent(monthRates.childcareEmployeeRate)})`, value: childcareSupport },
              { label: `厚生年金保険料 (${formatRatePercent(pensionRate)})`, value: pensionInsurance },
              { label: `雇用保険料 (${formatRatePercent(eiRate)})`, value: employmentInsurance },
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
        <Reorder.Group axis="y" values={deductionRows} onReorder={(next) => { setTouchedManual(true); setDeductionRows(next); }} className="select-none">
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
            onClick={() => { setTouchedManual(true); setDeductionRows((prev) => [...prev, { uid: genUid(), defId: null, amount: 0 }]); }}
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

      </fieldset>

      {/* ── 自動保存の状態（保存ボタンは廃止） ── */}
      <div className="border-t px-4 py-2.5 bg-card flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          {isConfirmed ? (
            <>
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">確定済み（表示のみ）</span>
            </>
          ) : saveState === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              <span className="text-blue-700 dark:text-blue-300">保存中…</span>
            </>
          ) : saveState === "pending" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">変更を保存します…</span>
            </>
          ) : saveState === "error" ? (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-400 font-semibold">保存に失敗しました</span>
            </>
          ) : saveState === "saved" ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-700 dark:text-emerald-300">
                自動保存しました{savedAtLabel ? `（${savedAtLabel}）` : ""}
              </span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">変更は自動で保存されます</span>
            </>
          )}
        </div>
        {saveState === "error" && !isConfirmed && (
          <Button size="sm" variant="outline" className="h-7" onClick={() => void runSaveRef.current()}>
            再試行
          </Button>
        )}
      </div>
      {recalcNote && !isConfirmed && (
        <div className="px-4 pb-2.5 text-[11px] text-muted-foreground">{recalcNote}</div>
      )}
    </div>
  );
}
