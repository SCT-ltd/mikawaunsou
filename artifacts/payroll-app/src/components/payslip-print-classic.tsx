import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatMonth } from "@/lib/format";
import { calculateInsuranceByGrade } from "@/lib/tax-tables-reiwa8";

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
  holidayWorkDays: number;
  employeeId?: number;
  notes?: string;
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
    padding: "1.2pt 4pt",
    borderBottom: `1px solid #c5dff0`,
    verticalAlign: "middle" as const,
  },
  tdRight: {
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
    padding: "1.5pt 5pt",
    borderBottom: `1px solid #c5dff0`,
    fontSize: "8pt",
    verticalAlign: "middle" as const,
  },
  summaryTdRight: {
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

export function ClassicContent({ payroll, companyName, employeeAllowances, employeeDeductions, employee, company }: ClassicPayslipProps) {
  const isBW = !!(payroll.useBluewingLogic as boolean);
  const childcare = payroll.childcareSupportContribution ?? 0;

  const stdRemun = employee?.standardRemuneration ?? 0;
  const healthRate = (company?.healthInsuranceEmployeeRate as number | undefined) ?? 0.04925;
  const pensionRate = (company?.pensionEmployeeRate as number | undefined) ?? 0.0915;
  const { healthInsurance: computedHealth, pension: computedPension } =
    stdRemun > 0
      ? calculateInsuranceByGrade(stdRemun, healthRate, pensionRate)
      : { healthInsurance: 0, pension: 0 };

  const payItemsFixed: Array<{ label: string; value: number; nonTaxable?: boolean }> = [];
  if (isBW) {
    if ((payroll.baseSalary ?? 0) > 0) payItemsFixed.push({ label: "基本給", value: payroll.baseSalary });
    if ((payroll.overtimePay ?? 0) > 0) payItemsFixed.push({ label: "早出残業手当", value: payroll.overtimePay });
    if ((payroll.earlyOvertimeAllowance ?? 0) > 0) payItemsFixed.push({ label: "職務手当", value: payroll.earlyOvertimeAllowance ?? 0 });
    if ((payroll.holidayPay ?? 0) > 0) payItemsFixed.push({ label: "休日出勤手当", value: payroll.holidayPay });
    if ((payroll.transportationAllowance ?? 0) > 0) payItemsFixed.push({ label: "交通費", value: payroll.transportationAllowance, nonTaxable: true });
    if ((payroll.safetyDrivingAllowance ?? 0) > 0) payItemsFixed.push({ label: "無事故手当", value: payroll.safetyDrivingAllowance });
    if ((payroll.longDistanceAllowance ?? 0) > 0) payItemsFixed.push({ label: "長距離手当", value: payroll.longDistanceAllowance });
    if ((payroll.positionAllowance ?? 0) > 0) payItemsFixed.push({ label: "役職手当", value: payroll.positionAllowance });
    if ((payroll.familyAllowance ?? 0) > 0) payItemsFixed.push({ label: "家族手当", value: payroll.familyAllowance ?? 0 });
    if ((payroll.lateNightPay ?? 0) > 0) payItemsFixed.push({ label: "深夜手当", value: payroll.lateNightPay });
  } else {
    if ((payroll.baseSalary ?? 0) > 0) payItemsFixed.push({ label: "基本給", value: payroll.baseSalary });
    if ((payroll.overtimePay ?? 0) > 0) payItemsFixed.push({ label: "時間外手当", value: payroll.overtimePay });
    if ((payroll.lateNightPay ?? 0) > 0) payItemsFixed.push({ label: "深夜手当", value: payroll.lateNightPay });
    if ((payroll.holidayPay ?? 0) > 0) payItemsFixed.push({ label: "休日出勤手当", value: payroll.holidayPay });
    if ((payroll.commissionPay ?? 0) > 0) payItemsFixed.push({ label: "歩合給", value: payroll.commissionPay });
    if ((payroll.transportationAllowance ?? 0) > 0) payItemsFixed.push({ label: "交通費", value: payroll.transportationAllowance, nonTaxable: true });
    if ((payroll.safetyDrivingAllowance ?? 0) > 0) payItemsFixed.push({ label: "無事故手当", value: payroll.safetyDrivingAllowance });
    if ((payroll.longDistanceAllowance ?? 0) > 0) payItemsFixed.push({ label: "長距離手当", value: payroll.longDistanceAllowance });
    if ((payroll.positionAllowance ?? 0) > 0) payItemsFixed.push({ label: "役職手当", value: payroll.positionAllowance });
    if ((payroll.familyAllowance ?? 0) > 0) payItemsFixed.push({ label: "家族手当", value: payroll.familyAllowance ?? 0 });
    if ((payroll.earlyOvertimeAllowance ?? 0) > 0) payItemsFixed.push({ label: "固定残業代", value: payroll.earlyOvertimeAllowance ?? 0 });
  }

  const payItemsCustom = (employeeAllowances ?? [])
    .filter(a => a.amount !== 0)
    .map(a => ({ label: a.allowanceName, value: a.amount, nonTaxable: !a.isTaxable }));

  const allPayItems = [...payItemsFixed, ...payItemsCustom];

  const deductionItems: Array<{ label: string; value: number }> = [];
  if (stdRemun > 0) {
    if (computedHealth > 0) deductionItems.push({ label: "健康保険料", value: computedHealth });
    if (childcare > 0) deductionItems.push({ label: "子ども・子育て支援金", value: childcare });
    if (computedPension > 0) deductionItems.push({ label: "厚生年金保険料", value: computedPension });
  } else {
    const socialBase = (payroll.socialInsurance ?? 0) - childcare;
    if (socialBase > 0) deductionItems.push({ label: "社会保険料（健保・厚年）", value: socialBase });
    if (childcare > 0) deductionItems.push({ label: "子ども・子育て支援金", value: childcare });
  }
  if ((payroll.employmentInsurance ?? 0) > 0) deductionItems.push({ label: "雇用保険料", value: payroll.employmentInsurance });
  if ((payroll.incomeTax ?? 0) > 0) deductionItems.push({ label: "源泉所得税", value: payroll.incomeTax });
  if ((payroll.residentTax ?? 0) > 0) deductionItems.push({ label: "市町村民税", value: payroll.residentTax });
  if ((payroll.absenceDeduction ?? 0) > 0) deductionItems.push({ label: "欠勤控除", value: payroll.absenceDeduction });
  (employeeDeductions ?? []).filter(d => d.amount !== 0).forEach(d => {
    deductionItems.push({ label: d.deductionName, value: d.amount });
  });

  const attendanceItems = [
    { label: "出勤日数", value: `${payroll.workDays ?? 0}日` },
    { label: "土曜出勤", value: `${payroll.saturdayWorkDays ?? 0}日` },
    { label: "休日出勤", value: `${payroll.holidayWorkDays ?? 0}日` },
    { label: "残業時間", value: `${payroll.overtimeHours ?? 0}時間` },
    { label: "深夜時間", value: `${payroll.lateNightHours ?? 0}時間` },
  ];

  const department = "";
  const today = new Date();
  const issuedDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const payrollMonthStr = formatMonth(payroll.year, payroll.month);

  console.log("[CLASSIC_PAYSLIP_PRINT_DATA]", {
    employeeName: payroll.employeeName,
    employeeCode: payroll.employeeCode,
    department,
    payrollMonth: payrollMonthStr,
    paymentDate: issuedDate,
    companyName,
    attendanceItems,
    payItems: allPayItems,
    deductionItems,
    grossSalary: payroll.grossSalary,
    totalDeductions: payroll.totalDeductions,
    netSalary: payroll.netSalary,
  });

  const taxableTotal = allPayItems
    .filter(i => !i.nonTaxable)
    .reduce((s, i) => s + i.value, 0);
  const nonTaxableTotal = allPayItems
    .filter(i => i.nonTaxable)
    .reduce((s, i) => s + i.value, 0);

  return (
    <div
      data-print-target="payslip-classic"
      style={styles.root}
    >
      {/* ── ヘッダー ── */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={{ ...styles.infoRow, marginBottom: "2pt" }}>
            <span style={{ ...styles.infoLabel, minWidth: "40pt" }}>会社名</span>
            <span style={{ ...styles.infoValue, fontSize: "9pt" }}>{companyName}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>氏名</span>
            <span style={{ ...styles.infoValue, fontSize: "10pt" }}>{payroll.employeeName}　様</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>社員番号</span>
            <span style={styles.infoValue}>{payroll.employeeCode}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>所属</span>
            <span style={styles.infoValue}>{department || "—"}</span>
          </div>
          <div style={{ ...styles.infoRow, marginTop: "1pt" }}>
            <span style={{ fontSize: "7pt", color: "#888" }}>
              {payroll.status === "confirmed" ? "【確定済】" : "【仮計算・未確定】"}
            </span>
          </div>
        </div>

        <div style={styles.headerCenter}>
          <div style={styles.headerMonth}>{payrollMonthStr}分</div>
          <div style={styles.headerTitle}>給 与 支 給 明 細 書</div>
        </div>

        <div style={styles.headerRight}>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: "2pt", alignItems: "flex-end" }}>
            <div style={styles.infoRow}>
              <span style={{ ...styles.infoLabel, minWidth: "40pt" }}>発行日</span>
              <span style={styles.infoValue}>{issuedDate}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "4pt", marginTop: "2pt" }}>
            <span style={{ fontSize: "7pt", color: "#888" }}>受領印</span>
            <div style={styles.hankoBox}></div>
          </div>
        </div>
      </div>

      {/* ── メイン 4 カラム ── */}
      <div style={styles.mainGrid}>

        {/* A. 勤怠欄 */}
        <div style={styles.block}>
          <div style={styles.blockTitle}>勤　怠</div>
          <table style={styles.table}>
            <tbody>
              {attendanceItems.map(item => (
                <tr key={item.label}>
                  <td style={styles.td}>{item.label}</td>
                  <td style={{ ...styles.tdRight, fontWeight: "bold" }}>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* B. 支給欄 */}
        <div style={styles.block}>
          <div style={styles.blockTitle}>支　給</div>
          <table style={styles.table}>
            <tbody>
              {allPayItems.map((item, idx) => (
                <tr key={`pay-${idx}`}>
                  <td style={styles.td}>
                    {item.label}
                    {item.nonTaxable && <span style={styles.nonTaxBadge}>非課税</span>}
                  </td>
                  <td style={styles.tdRight}>{formatCurrency(item.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={styles.totalTd}>支給合計</td>
                <td style={styles.totalTdRight}>{formatCurrency(payroll.grossSalary)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* C. 控除欄 */}
        <div style={styles.block}>
          <div style={styles.blockTitle}>控　除</div>
          <table style={styles.table}>
            <tbody>
              {deductionItems.map((item, idx) => (
                <tr key={`ded-${idx}`}>
                  <td style={styles.td}>{item.label}</td>
                  <td style={styles.tdRight}>{formatCurrency(item.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={styles.totalTd}>控除合計</td>
                <td style={styles.totalTdRight}>{formatCurrency(payroll.totalDeductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* D. 集計欄 */}
        <div style={styles.block}>
          <div style={styles.blockTitle}>集　計</div>

          <div style={styles.netBox}>
            <div style={styles.netLabel}>差 引 支 給 額</div>
            <div style={styles.netValue}>{formatCurrency(payroll.netSalary)}</div>
          </div>

          <table style={styles.summaryTable}>
            <tbody>
              <tr>
                <td style={styles.summaryTd}>支給合計</td>
                <td style={{ ...styles.summaryTdRight, fontWeight: "bold" }}>{formatCurrency(payroll.grossSalary)}</td>
              </tr>
              <tr>
                <td style={styles.summaryTd}>控除合計</td>
                <td style={{ ...styles.summaryTdRight, fontWeight: "bold" }}>{formatCurrency(payroll.totalDeductions)}</td>
              </tr>
              <tr>
                <td style={styles.summaryTd}>課税支給額</td>
                <td style={styles.summaryTdRight}>{formatCurrency(taxableTotal)}</td>
              </tr>
              {nonTaxableTotal > 0 && (
                <tr>
                  <td style={styles.summaryTd}>非課税支給額</td>
                  <td style={styles.summaryTdRight}>{formatCurrency(nonTaxableTotal)}</td>
                </tr>
              )}
              <tr>
                <td style={styles.summaryTd}>振込支給額</td>
                <td style={{ ...styles.summaryTdRight, fontWeight: "bold" }}>{formatCurrency(payroll.netSalary)}</td>
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
      <div style={styles.footer}>
        <span>今月もお疲れさまでした。本明細書に関するお問い合わせは給与担当者までご連絡ください。</span>
        <span style={{ fontSize: "7pt", color: "#888" }}>三川運送株式会社　給与システム</span>
      </div>
    </div>
  );
}

export function PayslipPrintClassic(props: ClassicPayslipProps) {
  const [portalEl] = useState<HTMLDivElement>(() => {
    const existing = document.getElementById("payroll-print-root");
    if (existing) {
      console.log("[PayslipPrintClassic] Removed stale portal element.");
      existing.remove();
    }
    const el = document.createElement("div");
    el.id = "payroll-print-root";
    document.body.appendChild(el);
    console.log("[PayslipPrintClassic] Portal created. Count:", document.querySelectorAll("#payroll-print-root").length);
    return el;
  });

  useEffect(() => {
    const count = document.querySelectorAll("#payroll-print-root").length;
    console.log("[PayslipPrintClassic] Mounted. Count:", count);
    if (count > 1) console.error("[PayslipPrintClassic] ERROR: Multiple portals!");
    return () => {
      if (document.body.contains(portalEl)) {
        document.body.removeChild(portalEl);
        console.log("[PayslipPrintClassic] Portal removed.");
      }
    };
  }, [portalEl]);

  return createPortal(
    <ClassicContent {...props} />,
    portalEl,
  );
}
