import { Input } from "@/components/ui/input";
import {
  useGetEmployeeAllowances,
  getGetEmployeeAllowancesQueryKey,
} from "@workspace/api-client-react";
import {
  EmployeeExt,
  CompanySettings,
  RowData,
  computeQuickEstimate,
  computeBWCalc,
  formatYen,
} from "./estimate";

/**
 * 実績入力タブ。
 * 旧デザインの12列テーブル行を、大きな入力欄のセクション形式に置き換えたもの。
 * onChange は旧 handleEditChange(empId, field, value) と同じ変換規則
 * （notes は文字列、それ以外は Number(value) || 0）を親側で適用する。
 */

// ── セクション見出し ─────────────────────────────────────────────────────
function SectionHeader({
  color,
  title,
  description,
}: {
  color: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${color}`} />
        <h3 className="text-[15px] font-bold jp-tight">{title}</h3>
      </div>
      {description && (
        <p className="text-[11px] text-muted-foreground mt-0.5 ml-4.5 pl-0.5">{description}</p>
      )}
    </div>
  );
}

// ── ラベル付きフィールド ────────────────────────────────────────────────
function Field({
  label,
  unit,
  hint,
  children,
}: {
  label: string;
  unit?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="flex items-baseline gap-1 text-[13px] font-semibold jp-tight mb-1.5">
        <span>{label}</span>
        {unit && <span className="text-[11px] text-muted-foreground font-normal">({unit})</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/80 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

// ── BW A/B/C 計算プレビュー ─────────────────────────────────────────────
// 手当・控除タブで保存済みのカスタム手当を読み込み、B に加算する（旧 BWCalcPreview と同ロジック）。
function BWCalcCard({
  emp,
  rowData,
  company,
}: {
  emp: EmployeeExt;
  rowData: RowData;
  company: CompanySettings | undefined;
}) {
  const { data: customAllowances = [] } = useGetEmployeeAllowances(emp.id, {
    query: {
      queryKey: getGetEmployeeAllowancesQueryKey(emp.id),
      staleTime: 30_000,
    },
  });
  const customTotal = customAllowances.reduce((s, a) => s + (a.amount ?? 0), 0);
  const bw = computeBWCalc(emp, rowData, company, customTotal);

  if (!bw) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-violet-200 bg-violet-50/40 px-4 py-3 text-xs text-muted-foreground">
        BW売上を入力すると A / B / 業績手当 をリアルタイム計算します
      </div>
    );
  }

  const isPlus = bw.solutionC >= 0;
  return (
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 overflow-hidden">
      <div className="px-4 py-2 border-b border-violet-100 text-[11px] font-semibold text-violet-700 tracking-wide">
        BW計算プレビュー
      </div>
      <div className="px-4 py-2 space-y-1.5 text-sm">
        <div className="flex justify-between items-baseline">
          <span className="text-xs text-muted-foreground">
            A：調整歩率 × 売上
            <span className="ml-1 text-[10px] text-violet-500 tabular-nums">
              （歩率 {(bw.adjustedRate * 100).toFixed(1)}%）
            </span>
          </span>
          <span className="font-semibold amount">{formatYen(bw.solutionA)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-xs text-muted-foreground">B：基本給・手当ほか固定側</span>
          <span className="font-semibold amount">{formatYen(bw.solutionB)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-xs text-muted-foreground">超過残業代</span>
          <span className="amount text-xs">{formatYen(bw.actualOTPay)}</span>
        </div>
        <div
          className={`flex justify-between items-baseline border-t border-violet-100 pt-1.5 font-bold ${
            isPlus ? "text-emerald-700" : "text-red-600"
          }`}
        >
          <span className="text-xs">業績手当（A − B）</span>
          <span className="amount">
            {isPlus ? `+${formatYen(bw.perfAllowance)}` : "なし（B が A を上回っています）"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── メイン: 実績入力フォーム ────────────────────────────────────────────
export function RecordForm({
  employee,
  rowData,
  onChange,
  company,
}: {
  employee: EmployeeExt;
  rowData: RowData;
  onChange: (field: string, value: string) => void;
  company: CompanySettings | undefined;
}) {
  const isHourly = employee.salaryType === "hourly";
  const isBW = employee.useBluewingLogic === true;

  // 個人残業単位設定（分単位切り上げ×単価）
  const unitMinutes = employee.overtimeUnitMinutes ?? 0;
  const unitRate = employee.overtimeUnitRate ?? 0;
  const hasUnit = unitMinutes > 0 && unitRate > 0;

  const { gross, net } = computeQuickEstimate(employee, rowData, company);

  const numInput = (field: string, opts?: { max?: number; step?: string }) => {
    const val = rowData[field];
    const invalid = Number(val) < 0;
    return (
      <Input
        type="number"
        min="0"
        max={opts?.max}
        step={opts?.step ?? "0.5"}
        className={`h-10 w-full text-right text-base font-medium px-3 amount ${
          invalid ? "border-red-400 bg-red-50" : ""
        }`}
        value={Number(val) || ""}
        onChange={(e) => onChange(field, e.target.value)}
        onWheel={(e) => e.currentTarget.blur()}
        placeholder="0"
      />
    );
  };

  // 単位（回）入力: 表示は "回"、内部は時間で保持（旧 unitInput と同変換）
  const unitInput = (field: "overtimeHours" | "lateNightHours") => {
    const hours = Number(rowData[field]) || 0;
    const unitVal = hours > 0 ? Math.round((hours * 60) / unitMinutes) : "";
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min="0"
          step="1"
          className="h-10 w-full text-right text-base font-medium px-3 amount"
          value={unitVal}
          onChange={(e) => {
            const units = Number(e.target.value) || 0;
            onChange(field, String((units * unitMinutes) / 60));
          }}
          onWheel={(e) => e.currentTarget.blur()}
          placeholder="0"
        />
        <span className="text-sm text-muted-foreground shrink-0">回</span>
      </div>
    );
  };

  const unitHint = hasUnit
    ? `1回 = ${unitMinutes}分 / ${formatYen(unitRate)}`
    : undefined;

  return (
    <div className="space-y-4">
      {/* ── 勤怠・時間 ── */}
      <section className="rounded-xl border bg-card p-4">
        <SectionHeader
          color="bg-sky-400"
          title="勤怠・時間"
          description="出勤日数と残業・深夜時間。給与計算の基礎データになります"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-3.5">
          <Field label="平日出勤" unit="日">
            {numInput("workDays", { max: 31, step: "1" })}
          </Field>
          <Field label="土曜出勤" unit="日" hint="土曜日給（平日と別単価）で計算">
            {numInput("saturdayWorkDays", { max: 31, step: "1" })}
          </Field>
          <Field label="日曜・祝日" unit="日" hint="日当 ×1.35 で計算">
            {numInput("sundayWorkDays", { step: "1" })}
          </Field>
          <Field label="欠勤" unit="日">
            {numInput("absenceDays", { max: 31, step: "1" })}
          </Field>
          <Field label="残業" unit={hasUnit ? "回" : "h"} hint={unitHint}>
            {hasUnit ? unitInput("overtimeHours") : numInput("overtimeHours", { step: "0.5" })}
          </Field>
          <Field label="深夜" unit={hasUnit ? "回" : "h"} hint={unitHint ?? "深夜割増（+0.25）を加算"}>
            {hasUnit ? unitInput("lateNightHours") : numInput("lateNightHours", { step: "0.5" })}
          </Field>
        </div>
      </section>

      {/* ── 実働時間（時給制のみ）＋ 運行実績 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isHourly && (
          <section className="rounded-xl border bg-card p-4">
            <SectionHeader
              color="bg-indigo-400"
              title="実働時間"
              description="時給制（事務員）専用。時給 × 実働時間 ＝ 基本給"
            />
            <Field label="実働" unit="h" hint="30分単位切り上げ後の月間実働時間">
              {numInput("actualWorkHours", { step: "0.5" })}
            </Field>
          </section>
        )}
        <section className={`rounded-xl border bg-card p-4 ${isHourly ? "" : "sm:col-span-2"}`}>
          <SectionHeader
            color="bg-amber-400"
            title="運行実績"
            description="当月の総走行距離。走行距離手当の計算に使用します"
          />
          <div className={isHourly ? "" : "max-w-xs"}>
            <Field label="走行距離" unit="km">
              {numInput("drivingDistanceKm", { step: "0.1" })}
            </Field>
          </div>
        </section>
      </div>

      {/* ── BW売上（Bluewing社員のみ）── */}
      {isBW && (
        <section className="rounded-xl border bg-card p-4">
          <SectionHeader
            color="bg-violet-400"
            title="給与計算基礎（Bluewing）"
            description="BW計算方式の売上金額。通常の売上とは別に管理されます"
          />
          <div className="max-w-xs">
            <Field label="BW売上" unit="円">
              {numInput("bluewingSalesAmount", { step: "1" })}
            </Field>
          </div>
          <BWCalcCard emp={employee} rowData={rowData} company={company} />
        </section>
      )}

      {/* ── 備考 ── */}
      <section className="rounded-xl border bg-card p-4">
        <SectionHeader
          color="bg-slate-300"
          title="備考・摘要"
          description="メモ用。給与計算には影響しません"
        />
        <Input
          type="text"
          className="h-10 text-sm px-3 w-full"
          placeholder="メモ・摘要を入力"
          value={String(rowData.notes || "")}
          onChange={(e) => onChange("notes", e.target.value)}
        />
      </section>

      {/* ── 概算サマリー ── */}
      <section className="rounded-xl border-2 border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground jp-tight">総支給（概算）</div>
            <div className="text-2xl font-bold amount mt-0.5">
              {gross > 0 ? formatYen(gross) : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold text-muted-foreground jp-tight">手取り（概算）</div>
            <div
              className={`text-3xl font-extrabold amount mt-0.5 ${
                net >= 0 ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {gross > 0 ? formatYen(net) : "—"}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          ※ 基本給・残業代のみの概算です。手当・カスタム控除は「手当・控除」タブの設定を確定後、給与計算で反映されます
        </p>
      </section>
    </div>
  );
}
