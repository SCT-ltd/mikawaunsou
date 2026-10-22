import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatMonth, formatHours } from "@/lib/format";
import { round50sen, HEALTH_EMPLOYEE_RATE_R8, HEALTH_WITH_CARE_EMPLOYEE_RATE_R8 } from "@/lib/tax-tables-reiwa8";

interface PayrollData {
  year: number;
  month: number;
  employeeName: string;
  employeeCode: string;
  status: string;
  baseSalary: number;
  overtimePay: number;
  lateNightPay: number;
  holidayPay: number;
  commissionPay: number;
  transportationAllowance: number;
  safetyDrivingAllowance: number;
  longDistanceAllowance: number;
  positionAllowance: number;
  familyAllowance?: number;
  earlyOvertimeAllowance?: number;
  customAllowancesTotal?: number;
  grossSalary: number;
  socialInsurance: number;
  childcareSupportContribution?: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  absenceDeduction: number;
  totalDeductions: number;
  netSalary: number;
  workDays: number;
  saturdayWorkDays?: number;
  overtimeHours: number;
  lateNightHours: number;
  holidayWorkHours?: number;
  /** 祝日の出勤日数（2026-10 から日曜と分けて記録） */
  publicHolidayWorkDays?: number;
  paidLeaveDays?: number;
  holidayWorkDays: number;
  employeeId?: number;
  notes?: string;
  /** 計算に使った標準報酬月額・料率（2026-09-14 より前の明細は null）*/
  appliedStandardRemuneration?: number | null;
  appliedHealthInsuranceRate?: number | null;
  appliedCareInsuranceRate?: number | null;
  [key: string]: unknown;
}

interface EmployeeAllowance {
  id: number;
  employeeId: number;
  allowanceDefinitionId: number;
  allowanceName: string;
  isTaxable: boolean;
  amount: number;
  sortOrder?: number;
}

interface EmployeeDeduction {
  id: number;
  employeeId: number;
  deductionDefinitionId: number;
  deductionName: string;
  amount: number;
  sortOrder?: number;
}

interface CompanyInfo {
  healthInsuranceEmployeeRate?: number;
  pensionEmployeeRate?: number;
  [key: string]: unknown;
}

interface EmployeeInfo {
  standardRemuneration?: number;
  careInsuranceApplied?: boolean;
  [key: string]: unknown;
}

export interface ClassicPayslipProps {
  payroll: PayrollData;
  companyName: string;
  employeeAllowances?: EmployeeAllowance[];
  employeeDeductions?: EmployeeDeduction[];
  employee?: EmployeeInfo;
  company?: CompanyInfo;
  /** 2人/A4（縦半分）に収めるための縮小表示。zoom で全体を比例縮小する（scale と違い見切れない）。 */
  compact?: boolean;
}

const C = "#7bb6d6";
const C_LIGHT = "#dff3fb";
const C_TOTAL_BG = "#cce8f4";

const styles = {
  root: {
    width: "100%",
    height: "100%",
    backgroundColor: "#fff",
    color: "#111",
    fontFamily: '"Yu Gothic", "Meiryo", "MS PGothic", sans-serif',
    fontSize: "8pt",
    boxSizing: "border-box" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "3pt",
  },
  header: {
    border: `2px solid ${C}`,
    backgroundColor: C_LIGHT,
    padding: "4pt 8pt",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "stretch",
    gap: "6pt",
  },
  headerCenter: {
    textAlign: "center" as const,
    flex: 1,
  },
  headerTitle: {
    fontSize: "13pt",
    fontWeight: "bold",
    letterSpacing: "0.3em",
    color: "#003d6e",
  },
  headerMonth: {
    fontSize: "9pt",
    color: "#444",
    marginTop: "1pt",
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1pt",
    minWidth: "160pt",
  },
  headerRight: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "3pt",
    minWidth: "100pt",
    alignItems: "flex-end",
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    gap: "4pt",
    fontSize: "8pt",
  },
  infoLabel: { color: "#555", whiteSpace: "nowrap" as const, minWidth: "52pt" },
  infoValue: { fontWeight: "bold", color: "#111" },
  hankoBox: {
    border: `1px solid ${C}`,
    width: "36pt",
    height: "36pt",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "6pt",
    color: "#999",
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.55fr 1.45fr 1fr",
    gap: "3pt",
    flex: 1,
    minHeight: 0,
  },
  block: {
    border: `1px solid ${C}`,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  blockTitle: {
    backgroundColor: C_LIGHT,
    borderBottom: `1px solid ${C}`,
    padding: "2pt 5pt",
    fontWeight: "bold",
    fontSize: "8.5pt",
    color: "#003d6e",
    textAlign: "center" as const,
    letterSpacing: "0.1em",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    flex: 1,
  },
  td: {
    whiteSpace: "nowrap" as const,
    padding: "1.2pt 4pt",
    borderBottom: `1px solid #c5dff0`,
    verticalAlign: "middle" as const,
  },
  tdRight: {
    whiteSpace: "nowrap" as const,
    padding: "1.2pt 4pt",
    borderBottom: `1px solid #c5dff0`,
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
    verticalAlign: "middle" as const,
  },
  totalTd: {
    padding: "1.5pt 4pt",
    backgroundColor: C_TOTAL_BG,
    fontWeight: "bold",
    borderTop: `1.5px solid ${C}`,
    verticalAlign: "middle" as const,
  },
  totalTdRight: {
    padding: "1.5pt 4pt",
    backgroundColor: C_TOTAL_BG,
    fontWeight: "bold",
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
    borderTop: `1.5px solid ${C}`,
    verticalAlign: "middle" as const,
  },
  netBox: {
    border: `2px solid ${C}`,
    borderRadius: "2pt",
    backgroundColor: "#e0f4ff",
    padding: "6pt 8pt",
    margin: "6pt 4pt",
    textAlign: "center" as const,
  },
  netLabel: {
    fontSize: "8pt",
    color: "#003d6e",
    fontWeight: "bold",
    marginBottom: "2pt",
  },
  netValue: {
    whiteSpace: "nowrap" as const,
    fontSize: "16pt",
    fontWeight: "bold",
    color: "#003d6e",
    letterSpacing: "0.02em",
  },
  summaryTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    marginTop: "4pt",
  },
  summaryTd: {
    whiteSpace: "nowrap" as const,
    padding: "1.5pt 5pt",
    borderBottom: `1px solid #c5dff0`,
    fontSize: "8pt",
    verticalAlign: "middle" as const,
  },
  summaryTdRight: {
    whiteSpace: "nowrap" as const,
    padding: "1.5pt 5pt",
    borderBottom: `1px solid #c5dff0`,
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
    fontSize: "8pt",
    verticalAlign: "middle" as const,
  },
  footer: {
    border: `1px solid ${C}`,
    backgroundColor: C_LIGHT,
    padding: "3pt 8pt",
    fontSize: "7.5pt",
    color: "#444",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  nonTaxBadge: {
    fontSize: "5.5pt",
    color: "#777",
    border: "0.5pt solid #aaa",
    borderRadius: "1.5pt",
    padding: "0 1.5pt",
    marginLeft: "2pt",
    lineHeight: 1.2,
    verticalAlign: "middle" as const,
    display: "inline-block",
  },
};

// 2人/A4（compact）では、明細全体を zoom で拡大して文字を大きくする。拡大率は「欄の中身が
// 横にはみ出さない」範囲で決まるので、横幅を食う所（差引支給額の大きな数字・セルの左右余白・
// 欄の幅の配分）を詰めておくと、その分だけ全体を大きく刷れる。
const compactStyles = {
  ...styles,
  mainGrid: { ...styles.mainGrid, gridTemplateColumns: "1.12fr 1.4fr 1.62fr 1.2fr", gap: "2pt" },
  td: { ...styles.td, padding: "1.2pt 2.5pt" },
  tdRight: { ...styles.tdRight, padding: "1.2pt 2.5pt" },
  totalTd: { ...styles.totalTd, padding: "1.5pt 2.5pt" },
  totalTdRight: { ...styles.totalTdRight, padding: "1.5pt 2.5pt" },
  summaryTd: { ...styles.summaryTd, padding: "1.5pt 2.5pt" },
  summaryTdRight: { ...styles.summaryTdRight, padding: "1.5pt 2.5pt" },
  netBox: { ...styles.netBox, padding: "4pt 3pt", margin: "4pt 3pt" },
  netValue: { ...styles.netValue, fontSize: "12.5pt", letterSpacing: "0" },
  headerLeft: { ...styles.headerLeft, minWidth: "130pt" },
  headerRight: { ...styles.headerRight, minWidth: "86pt" },
  // 末尾の一文は拡大すると2行に折り返すので、少し小さくして1行に収める
  footer: { ...styles.footer, fontSize: "6.5pt", padding: "2pt 6pt", gap: "6pt", whiteSpace: "nowrap" as const },
};

export function ClassicContent({ payroll, companyName, employeeAllowances, employeeDeductions, employee, compact }: ClassicPayslipProps) {
  const S = compact ? compactStyles : styles;
  const isBW = !!(payroll.useBluewingLogic as boolean);
  const childcare = payroll.childcareSupportContribution ?? 0;
  const isTaxExempt = !!(employee as Record<string, unknown> | undefined)?.taxExempt;

  const payItemsFixed: Array<{ label: string; value: number; nonTaxable?: boolean }> = [];
  const saturdayPayValue = Number((payroll as Record<string, unknown>).saturdayPay ?? 0);
  if (isBW) {
    if ((payroll.baseSalary ?? 0) > 0) payItemsFixed.push({ label: "基本給", value: payroll.baseSalary });
    if (saturdayPayValue > 0) payItemsFixed.push({ label: "土曜出勤手当", value: saturdayPayValue });
    if ((payroll.overtimePay ?? 0) > 0) payItemsFixed.push({ label: "早出残業手当", value: payroll.overtimePay });
    if ((payroll.earlyOvertimeAllowance ?? 0) > 0) payItemsFixed.push({ label: "職務手当", value: payroll.earlyOvertimeAllowance ?? 0 });
    if ((payroll.holidayPay ?? 0) > 0) payItemsFixed.push({ label: "休日出勤手当", value: payroll.holidayPay });
    if ((payroll.lateNightPay ?? 0) > 0) payItemsFixed.push({ label: "深夜手当", value: payroll.lateNightPay });
  } else {
    if ((payroll.baseSalary ?? 0) > 0) payItemsFixed.push({ label: "基本給", value: payroll.baseSalary });
    if (saturdayPayValue > 0) payItemsFixed.push({ label: "土曜出勤手当", value: saturdayPayValue });
    if ((payroll.overtimePay ?? 0) > 0) payItemsFixed.push({ label: "時間外手当", value: payroll.overtimePay });
    if ((payroll.lateNightPay ?? 0) > 0) payItemsFixed.push({ label: "深夜手当", value: payroll.lateNightPay });
    if ((payroll.holidayPay ?? 0) > 0) payItemsFixed.push({ label: "休日出勤手当", value: payroll.holidayPay });
    if ((payroll.commissionPay ?? 0) > 0) payItemsFixed.push({ label: "歩合給", value: payroll.commissionPay });
    if ((payroll.earlyOvertimeAllowance ?? 0) > 0) payItemsFixed.push({ label: "固定残業代", value: payroll.earlyOvertimeAllowance ?? 0 });
  }

  // 業績手当（ブルーウィングの解答C）。総支給に含まれるため必ず行として出す。
  const performanceValue = Number((payroll as Record<string, unknown>).performanceAllowance ?? 0);
  if (performanceValue > 0) payItemsFixed.push({ label: "業績手当", value: performanceValue });

  // 自動計算される支給項目（早出残業・職務手当・休日出勤等）と同名のカスタム手当は
  // 二重表示になるため除外する（BW社員で同名のカスタム手当が登録されているケース対策）。
  const fixedLabels = new Set(payItemsFixed.map(i => i.label));
  const payItemsCustom = (employeeAllowances ?? [])
    .filter(a => a.amount !== 0)
    .filter(a => !fixedLabels.has(a.allowanceName))
    .map(a => ({ label: a.allowanceName, value: a.amount, nonTaxable: !a.isTaxable }));

  const allPayItems = [...payItemsFixed, ...payItemsCustom];

  // 控除項目：DBに保存された値をそのまま使用（再計算しない）
  const deductionItems: Array<{ label: string; value: number; exempt?: boolean }> = [];
  const socialBase = (payroll.socialInsurance ?? 0) - childcare;
  // 健康保険と厚生年金を分けて表示する。payroll には合算値しか保存されていないため、
  // 標準報酬月額×健保料率で健保分を求め、残り（社保合計−健保）を厚年分とする
  // （合計は必ず socialBase に一致）。
  // 2026-09-14 以降に計算した明細は「計算に使った標準報酬月額・料率」を持っているのでそれを使う
  // （料率・標準報酬月額は履歴で月ごとに変わるため、社員マスタの今の値だと過去の明細の内訳がずれる）。
  // それより前の明細は従来どおり社員マスタの値×令和8年料率で求める。
  const empRec = employee as Record<string, unknown> | undefined;
  const appliedStd = payroll.appliedStandardRemuneration;
  const appliedHealth = payroll.appliedHealthInsuranceRate;
  let healthAmt: number;
  if (appliedStd != null && appliedHealth != null) {
    const healthRateTotal = appliedHealth + (payroll.appliedCareInsuranceRate ?? 0);
    healthAmt = Math.min(socialBase, round50sen(appliedStd * (Math.round((healthRateTotal / 2) * 1e10) / 1e10)));
  } else {
    const stdRem = Number(empRec?.standardRemuneration ?? 0);
    const insBase = stdRem > 0 ? stdRem : (payroll.grossSalary ?? 0);
    const healthRate = empRec?.careInsuranceApplied ? HEALTH_WITH_CARE_EMPLOYEE_RATE_R8 : HEALTH_EMPLOYEE_RATE_R8;
    healthAmt = Math.min(socialBase, round50sen(insBase * healthRate));
  }
  const pensionAmt = Math.max(0, socialBase - healthAmt);
  if (isTaxExempt) {
    deductionItems.push({ label: "健康保険料", value: 0, exempt: true });
    deductionItems.push({ label: "厚生年金保険料", value: 0, exempt: true });
    deductionItems.push({ label: "雇用保険料", value: 0, exempt: true });
    deductionItems.push({ label: "源泉所得税", value: 0, exempt: true });
  } else {
    if (healthAmt > 0) deductionItems.push({ label: "健康保険料", value: healthAmt });
    if (pensionAmt > 0) deductionItems.push({ label: "厚生年金保険料", value: pensionAmt });
    if (childcare > 0) deductionItems.push({ label: "子ども・子育て支援金", value: childcare });
    if ((payroll.employmentInsurance ?? 0) > 0) deductionItems.push({ label: "雇用保険料", value: payroll.employmentInsurance });
    if ((payroll.incomeTax ?? 0) > 0) deductionItems.push({ label: "源泉所得税", value: payroll.incomeTax });
  }
  if ((payroll.residentTax ?? 0) > 0) deductionItems.push({ label: "市町村民税", value: payroll.residentTax });
  if ((payroll.absenceDeduction ?? 0) > 0) deductionItems.push({ label: "欠勤控除", value: payroll.absenceDeduction });
  (employeeDeductions ?? []).filter(d => d.amount !== 0).forEach(d => {
    deductionItems.push({ label: d.deductionName, value: d.amount });
  });

  const attendanceItems = [
    { label: "平日日数", value: `${payroll.workDays ?? 0}日` },
    { label: "土曜出勤", value: `${payroll.saturdayWorkDays ?? 0}日` },
    // 日曜出勤は 2026-08 から時間管理。過去分（時間0で日数のみ）は従来どおり日数で出す。
    // 祝日は 2026-10 から日曜と分けて日数で記録（あるときだけ下に足す）。
    (payroll.holidayWorkHours ?? 0) > 0
      ? { label: "休日出勤", value: formatHours(payroll.holidayWorkHours ?? 0) }
      : { label: "休日出勤", value: `${payroll.holidayWorkDays ?? 0}日` },
    { label: "残業時間", value: formatHours(payroll.overtimeHours) },
    { label: "深夜時間", value: formatHours(payroll.lateNightHours) },
  ];
  if ((payroll.publicHolidayWorkDays ?? 0) > 0) {
    attendanceItems.push({ label: "祝日出勤", value: `${payroll.publicHolidayWorkDays}日` });
  }
  if ((payroll.paidLeaveDays ?? 0) > 0) {
    attendanceItems.push({ label: "有給", value: `${payroll.paidLeaveDays}日` });
  }

  const department = "";
  const today = new Date();
  const issuedDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const payrollMonthStr = formatMonth(payroll.year, payroll.month);


  const taxableTotal = allPayItems
    .filter(i => !i.nonTaxable)
    .reduce((s, i) => s + i.value, 0);
  const nonTaxableTotal = allPayItems
    .filter(i => i.nonTaxable)
    .reduce((s, i) => s + i.value, 0);

  return (
    <div
      data-print-target="payslip-classic"
      style={compact ? { ...S.root, height: "auto" } : S.root}
    >
      {/* ── ヘッダー ── */}
      <div style={S.header} data-fit-box>
        <div style={S.headerLeft}>
          <div style={{ ...S.infoRow, marginBottom: "2pt" }}>
            <span style={{ ...S.infoLabel, minWidth: "40pt" }}>会社名</span>
            <span style={{ ...S.infoValue, fontSize: "9pt" }}>{companyName}</span>
          </div>
          <div style={S.infoRow}>
            <span style={S.infoLabel}>氏名</span>
            <span style={{ ...S.infoValue, fontSize: "10pt" }}>{payroll.employeeName}　様</span>
          </div>
          <div style={S.infoRow}>
            <span style={S.infoLabel}>社員番号</span>
            <span style={S.infoValue}>{payroll.employeeCode}</span>
          </div>
          {!(compact && !department) && (
            <div style={S.infoRow}>
              <span style={S.infoLabel}>所属</span>
              <span style={S.infoValue}>{department || "—"}</span>
            </div>
          )}
          <div style={{ ...S.infoRow, marginTop: "1pt" }}>
            <span style={{ fontSize: "7pt", color: "#888" }}>
              {payroll.status === "confirmed" ? "【確定済】" : "【仮計算・未確定】"}
            </span>
          </div>
        </div>

        <div style={S.headerCenter}>
          <div style={S.headerMonth}>{payrollMonthStr}分</div>
          <div style={S.headerTitle}>給 与 支 給 明 細 書</div>
        </div>

        <div style={S.headerRight}>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: "2pt", alignItems: "flex-end" }}>
            <div style={S.infoRow}>
              <span style={{ ...S.infoLabel, minWidth: "40pt" }}>発行日</span>
              <span style={S.infoValue}>{issuedDate}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "4pt", marginTop: "2pt" }}>
            <span style={{ fontSize: "7pt", color: "#888" }}>受領印</span>
            <div style={S.hankoBox}></div>
          </div>
        </div>
      </div>

      {/* ── メイン 4 カラム ── */}
      <div style={S.mainGrid}>

        {/* A. 勤怠欄 */}
        <div style={S.block} data-fit-box>
          <div style={S.blockTitle}>勤　怠</div>
          <table style={S.table}>
            <tbody>
              {attendanceItems.map(item => (
                <tr key={item.label}>
                  <td style={S.td}>{item.label}</td>
                  <td style={{ ...S.tdRight, fontWeight: "bold" }}>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* B. 支給欄 */}
        <div style={S.block} data-fit-box>
          <div style={S.blockTitle}>支　給</div>
          <table style={S.table}>
            <tbody>
              {allPayItems.map((item, idx) => (
                <tr key={`pay-${idx}`}>
                  <td style={S.td}>
                    {item.label}
                    {item.nonTaxable && <span style={S.nonTaxBadge}>非課税</span>}
                  </td>
                  <td style={S.tdRight}>{formatCurrency(item.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={S.totalTd}>支給合計</td>
                <td style={S.totalTdRight}>{formatCurrency(payroll.grossSalary)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* C. 控除欄 */}
        <div style={S.block} data-fit-box>
          <div style={S.blockTitle}>控　除</div>
          <table style={S.table}>
            <tbody>
              {deductionItems.map((item, idx) => (
                <tr key={`ded-${idx}`}>
                  <td style={S.td}>{item.label}</td>
                  <td style={S.tdRight}>
                    {item.exempt
                      ? <span style={S.nonTaxBadge}>非課税</span>
                      : formatCurrency(item.value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={S.totalTd}>控除合計</td>
                <td style={S.totalTdRight}>{formatCurrency(payroll.totalDeductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* D. 集計欄 */}
        <div style={S.block} data-fit-box>
          <div style={S.blockTitle}>集　計</div>

          <div style={S.netBox}>
            <div style={S.netLabel}>差 引 支 給 額</div>
            <div style={S.netValue}>{formatCurrency(payroll.netSalary)}</div>
          </div>

          <table style={S.summaryTable}>
            <tbody>
              <tr>
                <td style={S.summaryTd}>支給合計</td>
                <td style={{ ...S.summaryTdRight, fontWeight: "bold" }}>{formatCurrency(payroll.grossSalary)}</td>
              </tr>
              <tr>
                <td style={S.summaryTd}>控除合計</td>
                <td style={{ ...S.summaryTdRight, fontWeight: "bold" }}>{formatCurrency(payroll.totalDeductions)}</td>
              </tr>
              <tr>
                <td style={S.summaryTd}>課税支給額</td>
                <td style={S.summaryTdRight}>{formatCurrency(taxableTotal)}</td>
              </tr>
              {nonTaxableTotal > 0 && (
                <tr>
                  <td style={S.summaryTd}>非課税支給額</td>
                  <td style={S.summaryTdRight}>{formatCurrency(nonTaxableTotal)}</td>
                </tr>
              )}
              <tr>
                <td style={S.summaryTd}>振込支給額</td>
                <td style={{ ...S.summaryTdRight, fontWeight: "bold" }}>{formatCurrency(payroll.netSalary)}</td>
              </tr>
            </tbody>
          </table>

          {payroll.notes && (
            <div style={{ padding: "4pt 5pt", fontSize: "7pt", color: "#555", borderTop: `1px solid ${C}`, marginTop: "4pt" }}>
              <span style={{ color: "#003d6e", fontWeight: "bold" }}>備考: </span>
              {String(payroll.notes)}
            </div>
          )}
        </div>
      </div>

      {/* ── フッター ── */}
      <div style={S.footer} data-fit-box>
        <span>今月もお疲れさまでした。本明細書に関するお問い合わせは給与担当者までご連絡ください。</span>
        <span style={{ fontSize: compact ? "6pt" : "7pt", color: "#888" }}>三川運送株式会社　給与システム</span>
      </div>
    </div>
  );
}

export function PayslipPrintClassic(props: ClassicPayslipProps) {
  const [portalEl] = useState<HTMLDivElement>(() => {
    // 残存ポータル（前回の印刷が afterprint 不発で残った等）を掃除してから作り直す
    document.getElementById("payroll-print-root")?.remove();
    const el = document.createElement("div");
    el.id = "payroll-print-root";
    document.body.appendChild(el);
    return el;
  });

  useEffect(() => {
    return () => {
      if (document.body.contains(portalEl)) {
        document.body.removeChild(portalEl);
      }
    };
  }, [portalEl]);

  return createPortal(
    <ClassicContent {...props} />,
    portalEl,
  );
}
