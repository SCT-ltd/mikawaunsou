import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatMonth } from "@/lib/format";

/**
 * 印刷時は DB 保存値のみを使用し、社会保険料・所得税・住民税などの再計算は一切行わない。
 * 健保・厚年は payrolls.socialInsurance に合算保存されているため、
 * 「社会保険料（健保・厚年）」として一本表示し、子ども・子育て支援金のみ別行で表示する。
 * これにより payslip-print-classic.tsx と完全に同じデータソース・同じ控除一覧になる。
 */

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

interface Props {
  payroll: PayrollData;
  companyName: string;
  employeeAllowances?: EmployeeAllowance[];
  employeeDeductions?: EmployeeDeduction[];
  employee?: EmployeeInfo;
  company?: CompanyInfo;
}

const S: Record<string, React.CSSProperties> = {
  root: {
    width: "100%",
    backgroundColor: "#fff",
    color: "#000",
    fontFamily: '"Noto Sans JP", "Meiryo", "Yu Gothic", sans-serif',
    fontSize: "8.5pt",
    padding: "0",
    boxSizing: "border-box",
    lineHeight: 1.35,
  },
  titleBlock: {
    textAlign: "center",
    borderBottom: "3px double #000",
    paddingBottom: "6px",
    marginBottom: "7px",
  },
  titleText: {
    fontSize: "14pt",
    fontWeight: "bold",
    letterSpacing: "0.25em",
    marginBottom: "1px",
  },
  subTitle: { fontSize: "9.5pt" },
  metaTable: { width: "100%", borderCollapse: "collapse" as const, marginBottom: "7px", fontSize: "8pt" },
  netBox: {
    border: "2.5px solid #000",
    borderRadius: "4px",
    padding: "4px 12px",
    marginBottom: "7px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f4f4f4",
  },
  netLabel: { fontSize: "8.5pt", fontWeight: "bold" },
  netValue: { fontSize: "16pt", fontWeight: "bold" },
  sectionHeader: {
    padding: "2px 7px",
    textAlign: "left" as const,
    fontSize: "8pt",
    backgroundColor: "#222",
    color: "#fff",
    fontWeight: "bold",
  },
  cell: { padding: "2px 7px", borderBottom: "1px solid #eee" },
  totalRow: { padding: "3px 7px", fontWeight: "bold", borderTop: "2px solid #000", backgroundColor: "#eee" },
  row: { display: "flex", justifyContent: "space-between" },
  attendance: {
    padding: "2px 7px",
    borderRight: "1px solid #ddd",
    textAlign: "center" as const,
    width: "20%",
    boxSizing: "border-box" as const,
  },
  footer: {
    borderTop: "1px solid #bbb",
    paddingTop: "4px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    fontSize: "7pt",
    color: "#666",
    marginTop: "6px",
  },
};

function Row({ label, value, nonTaxable, indent }: { label: string; value: number; nonTaxable?: boolean; indent?: boolean }) {
  if (value === 0) return null;
  return (
    <tr style={{ backgroundColor: "inherit" }}>
      <td style={S.cell}>
        <div style={S.row}>
          <span style={{ color: indent ? "#555" : "#333", paddingLeft: indent ? "10px" : undefined }}>
            {label}
            {nonTaxable && <span style={{ fontSize: "6.5pt", color: "#888", marginLeft: "3px" }}>非課税</span>}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: "76px", textAlign: "right" }}>
            {formatCurrency(value)}
          </span>
        </div>
      </td>
    </tr>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td style={S.totalRow}>
        <div style={S.row}>
          <span>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: "76px", textAlign: "right" }}>
            {formatCurrency(value)}
          </span>
        </div>
      </td>
    </tr>
  );
}

function PrintContent({ payroll, companyName, employeeAllowances, employeeDeductions, employee: _employee, company: _company }: Props) {
  const isBW = !!(payroll.useBluewingLogic as boolean);
  const childcare = payroll.childcareSupportContribution ?? 0;

  const payItemsFixed: Array<{ label: string; value: number; nonTaxable?: boolean }> = [];
  const saturdayPayValue = Number((payroll as Record<string, unknown>).saturdayPay ?? 0);
  if (isBW) {
    if ((payroll.baseSalary ?? 0) > 0) payItemsFixed.push({ label: "基本給", value: payroll.baseSalary });
    if (saturdayPayValue > 0) payItemsFixed.push({ label: "土曜出勤手当", value: saturdayPayValue });
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
    if (saturdayPayValue > 0) payItemsFixed.push({ label: "土曜出勤手当", value: saturdayPayValue });
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

  const payItemsCustom: Array<{ label: string; value: number; nonTaxable?: boolean }> = (employeeAllowances ?? [])
    .filter(a => a.amount !== 0)
    .map(a => ({ label: a.allowanceName, value: a.amount, nonTaxable: !a.isTaxable }));

  const allPayItems = [...payItemsFixed, ...payItemsCustom];

  // 控除項目: DB 保存値のみを使用（再計算しない）
  const deductionItems: Array<{ label: string; value: number; indent?: boolean }> = [];
  const socialBase = (payroll.socialInsurance ?? 0) - childcare;
  if (socialBase > 0) deductionItems.push({ label: "社会保険料（健保・厚年）", value: socialBase });
  if (childcare > 0) deductionItems.push({ label: "子ども・子育て支援金", value: childcare });
  if ((payroll.employmentInsurance ?? 0) > 0) deductionItems.push({ label: "雇用保険料", value: payroll.employmentInsurance });
  if ((payroll.incomeTax ?? 0) > 0) deductionItems.push({ label: "源泉所得税", value: payroll.incomeTax });
  if ((payroll.residentTax ?? 0) > 0) deductionItems.push({ label: "市町村民税", value: payroll.residentTax });
  if ((payroll.absenceDeduction ?? 0) > 0) deductionItems.push({ label: "欠勤控除", value: payroll.absenceDeduction });
  (employeeDeductions ?? []).filter(d => d.amount !== 0).forEach(d => {
    deductionItems.push({ label: d.deductionName, value: d.amount });
  });

  const customDeductionsTotal = (employeeDeductions ?? []).reduce((s, d) => s + (d.amount ?? 0), 0);

  console.log("[PRINT_VALUES_SOURCE_CHECK]", {
    componentName: "PayrollSlipPrint",
    payrollId: (payroll as { id?: number }).id,
    grossSalary: payroll.grossSalary,
    healthInsurance: socialBase,
    childcareSupportContribution: childcare,
    pension: 0,
    employmentInsurance: payroll.employmentInsurance,
    incomeTax: payroll.incomeTax,
    residentTax: payroll.residentTax,
    customDeductionsTotal,
    totalDeductions: payroll.totalDeductions,
    netSalary: payroll.netSalary,
    source: "DB_SAVED_VALUES",
  });

  console.log("[PRINT_PAYSLIP_DATA]", {
    employeeName: payroll.employeeName,
    payrollMonth: `${payroll.year}年${payroll.month}月`,
    baseSalary: payroll.baseSalary,
    payItems: allPayItems,
    deductionItems,
    grossSalary: payroll.grossSalary,
    totalDeductions: payroll.totalDeductions,
    netSalary: payroll.netSalary,
  });

  const today = new Date();
  const issuedDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  const hasAttendance = (payroll.workDays ?? 0) > 0 || (payroll.overtimeHours ?? 0) > 0 ||
    (payroll.lateNightHours ?? 0) > 0 || (payroll.holidayWorkDays ?? 0) > 0 ||
    (payroll.saturdayWorkDays ?? 0) > 0;

  return (
    <div id="payroll-slip-print-content" style={S.root}>

      {/* ── タイトル ── */}
      <div style={S.titleBlock}>
        <div style={S.titleText}>給 与 支 給 明 細 書</div>
        <div style={S.subTitle}>{formatMonth(payroll.year, payroll.month)}分</div>
      </div>

      {/* ── 会社・社員情報 ── */}
      <table style={S.metaTable}>
        <tbody>
          <tr>
            <td style={{ width: "50%", verticalAlign: "top" }}>
              <table style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ color: "#666", paddingRight: "6px", whiteSpace: "nowrap" }}>会社名</td>
                    <td style={{ fontWeight: "bold" }}>{companyName}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "#666", paddingRight: "6px" }}>発行日</td>
                    <td>{issuedDate}</td>
                  </tr>
                </tbody>
              </table>
            </td>
            <td style={{ width: "50%", textAlign: "right", verticalAlign: "top" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ color: "#666" }}>社員番号</td>
                    <td style={{ textAlign: "right" }}>{payroll.employeeCode}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "#666" }}>氏名</td>
                    <td style={{ textAlign: "right", fontWeight: "bold", fontSize: "10.5pt" }}>
                      {payroll.employeeName}　殿
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── 差引支給額（強調） ── */}
      <div style={S.netBox}>
        <div style={S.netLabel}>差 引 支 給 額（手取り）</div>
        <div style={S.netValue}>{formatCurrency(payroll.netSalary)}</div>
      </div>

      {/* ── 支給・控除 横並び ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
        <thead>
          <tr>
            <th style={{ ...S.sectionHeader, borderRight: "2px solid #fff", width: "50%" }}>支 給 項 目</th>
            <th style={{ ...S.sectionHeader, width: "50%" }}>控 除 項 目</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* 支給列 */}
            <td style={{ verticalAlign: "top", borderRight: "1px solid #ccc", width: "50%" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {allPayItems.map((item, idx) => (
                    <Row
                      key={`pay-${idx}`}
                      label={item.label}
                      value={item.value}
                      nonTaxable={item.nonTaxable}
                    />
                  ))}
                  <TotalRow label="総支給額（A）" value={payroll.grossSalary} />
                </tbody>
              </table>
            </td>

            {/* 控除列 */}
            <td style={{ verticalAlign: "top", width: "50%" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {deductionItems.map((item, idx) => (
                    <Row
                      key={`ded-${idx}`}
                      label={item.label}
                      value={item.value}
                      indent={item.indent}
                    />
                  ))}
                  <TotalRow label="控除合計（B）" value={payroll.totalDeductions} />
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── 勤怠実績（データがある場合のみ） ── */}
      {hasAttendance && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
          <thead>
            <tr>
              <th colSpan={5} style={S.sectionHeader}>勤 怠 実 績</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ backgroundColor: "#f7f7f7" }}>
              {([
                ["出勤日数", `${payroll.workDays ?? 0} 日`],
                ["土曜出勤", `${payroll.saturdayWorkDays ?? 0} 日`],
                ["残業時間", `${payroll.overtimeHours ?? 0} 時間`],
                ["深夜時間", `${payroll.lateNightHours ?? 0} 時間`],
                ["休日出勤", `${payroll.holidayWorkDays ?? 0} 日`],
              ] as [string, string][]).map(([label, val]) => (
                <td key={label} style={S.attendance}>
                  <div style={{ color: "#777", fontSize: "7pt" }}>{label}</div>
                  <div style={{ fontWeight: "bold", marginTop: "1px" }}>{val}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}

      {/* ── フッター ── */}
      <div style={S.footer}>
        <div>※ 本明細書に関するお問い合わせは給与担当者までご連絡ください。</div>
        <div>{payroll.status === "confirmed" ? "【確定済】" : "【仮計算・未確定】"}</div>
      </div>
    </div>
  );
}

export function PayrollSlipPrint({ payroll, companyName, employeeAllowances, employeeDeductions, employee, company }: Props) {
  const [portalEl] = useState<HTMLDivElement>(() => {
    const existing = document.getElementById("payroll-print-root");
    if (existing) {
      console.log("[PayrollSlipPrint] Removed stale portal element.");
      existing.remove();
    }
    const el = document.createElement("div");
    el.id = "payroll-print-root";
    document.body.appendChild(el);
    console.log("[PayrollSlipPrint] Portal element created. Count:", document.querySelectorAll("#payroll-print-root").length);
    return el;
  });

  useEffect(() => {
    const count = document.querySelectorAll("#payroll-print-root").length;
    console.log("[PayrollSlipPrint] Mounted. #payroll-print-root count:", count);
    if (count > 1) {
      console.error("[PayrollSlipPrint] ERROR: Multiple print portals detected!");
    }
    return () => {
      if (document.body.contains(portalEl)) {
        document.body.removeChild(portalEl);
        console.log("[PayrollSlipPrint] Portal removed on unmount.");
      }
    };
  }, [portalEl]);

  return createPortal(
    <PrintContent
      payroll={payroll}
      companyName={companyName}
      employeeAllowances={employeeAllowances}
      employeeDeductions={employeeDeductions}
      employee={employee}
      company={company}
    />,
    portalEl,
  );
}
