import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatMonth } from "@/lib/format";

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
  [key: string]: unknown;
}

interface Props {
  payroll: PayrollData;
  companyName: string;
}

const S: Record<string, React.CSSProperties> = {
  root: {
    width: "100%",
    backgroundColor: "#fff",
    color: "#000",
    fontFamily: '"Noto Sans JP", "Meiryo", "Yu Gothic", sans-serif',
    fontSize: "9pt",
    padding: "0",
    boxSizing: "border-box",
    lineHeight: 1.4,
  },
  titleBlock: {
    textAlign: "center",
    borderBottom: "3px double #000",
    paddingBottom: "7px",
    marginBottom: "8px",
  },
  titleText: {
    fontSize: "15pt",
    fontWeight: "bold",
    letterSpacing: "0.25em",
    marginBottom: "2px",
  },
  subTitle: { fontSize: "10pt" },
  metaTable: { width: "100%", borderCollapse: "collapse" as const, marginBottom: "8px", fontSize: "8.5pt" },
  netBox: {
    border: "2.5px solid #000",
    borderRadius: "4px",
    padding: "5px 14px",
    marginBottom: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f4f4f4",
  },
  netLabel: { fontSize: "9pt", fontWeight: "bold" },
  netValue: { fontSize: "17pt", fontWeight: "bold" },
  sectionHeader: {
    padding: "3px 8px",
    textAlign: "left" as const,
    fontSize: "8.5pt",
    backgroundColor: "#222",
    color: "#fff",
    fontWeight: "bold",
  },
  cell: { padding: "2.5px 8px", borderBottom: "1px solid #eee" },
  totalRow: { padding: "4px 8px", fontWeight: "bold", borderTop: "2px solid #000", backgroundColor: "#eee" },
  row: { display: "flex", justifyContent: "space-between" },
  attendance: {
    padding: "3px 8px",
    borderRight: "1px solid #ddd",
    textAlign: "center" as const,
    width: "20%",
    boxSizing: "border-box" as const,
  },
  footer: {
    borderTop: "1px solid #bbb",
    paddingTop: "5px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    fontSize: "7.5pt",
    color: "#666",
    marginTop: "8px",
  },
};

function Row({ label, value, indent }: { label: string; value: number | string; indent?: boolean }) {
  const v = typeof value === "number" ? (value !== 0 ? formatCurrency(value) : "—") : value;
  return (
    <tr style={{ backgroundColor: "inherit" }}>
      <td style={S.cell}>
        <div style={S.row}>
          <span style={{ color: indent ? "#555" : "#333", paddingLeft: indent ? "10px" : undefined }}>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: "78px", textAlign: "right" }}>{v}</span>
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
          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: "78px", textAlign: "right" }}>{formatCurrency(value)}</span>
        </div>
      </td>
    </tr>
  );
}

function PrintContent({ payroll, companyName }: Props) {
  const isBW = payroll.useBluewingLogic as boolean;
  const childcare = payroll.childcareSupportContribution ?? 0;

  const miscDeduction =
    payroll.totalDeductions
    - (payroll.socialInsurance ?? 0)
    - (payroll.employmentInsurance ?? 0)
    - (payroll.incomeTax ?? 0)
    - (payroll.residentTax ?? 0)
    - (payroll.absenceDeduction ?? 0);

  const today = new Date();
  const issuedDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

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
                    <td style={{ textAlign: "right", fontWeight: "bold", fontSize: "11pt" }}>
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
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
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
                  {isBW ? (
                    <>
                      <Row label="基本給" value={payroll.baseSalary} />
                      {payroll.overtimePay !== 0 && <Row label="時間外手当（超過分）" value={payroll.overtimePay} />}
                      {(payroll.earlyOvertimeAllowance ?? 0) !== 0 && <Row label="固定残業代（職務手当）" value={payroll.earlyOvertimeAllowance ?? 0} />}
                      {payroll.holidayPay !== 0 && <Row label="休日出勤手当" value={payroll.holidayPay} />}
                      {payroll.transportationAllowance !== 0 && <Row label="通勤手当" value={payroll.transportationAllowance} />}
                      {payroll.safetyDrivingAllowance !== 0 && <Row label="無事故手当" value={payroll.safetyDrivingAllowance} />}
                      {payroll.longDistanceAllowance !== 0 && <Row label="長距離手当" value={payroll.longDistanceAllowance} />}
                      {payroll.positionAllowance !== 0 && <Row label="役職手当" value={payroll.positionAllowance} />}
                      {(payroll.customAllowancesTotal ?? 0) > 0 && <Row label="その他手当" value={payroll.customAllowancesTotal ?? 0} />}
                      {(payroll.bluewingPerformanceAllowance as number ?? 0) > 0 && <Row label="業績手当（BW）" value={payroll.bluewingPerformanceAllowance as number} />}
                    </>
                  ) : (
                    <>
                      <Row label="基本給" value={payroll.baseSalary} />
                      <Row label="時間外手当" value={payroll.overtimePay} />
                      <Row label="深夜手当" value={payroll.lateNightPay} />
                      <Row label="休日出勤手当" value={payroll.holidayPay} />
                      <Row label="歩合給" value={payroll.commissionPay} />
                      <Row label="通勤手当" value={payroll.transportationAllowance} />
                      <Row label="無事故手当" value={payroll.safetyDrivingAllowance} />
                      <Row label="長距離手当" value={payroll.longDistanceAllowance} />
                      <Row label="役職手当" value={payroll.positionAllowance} />
                      {(payroll.customAllowancesTotal ?? 0) > 0 && <Row label="その他手当" value={payroll.customAllowancesTotal ?? 0} />}
                    </>
                  )}
                  <TotalRow label="総支給額（A）" value={payroll.grossSalary} />
                </tbody>
              </table>
            </td>

            {/* 控除列 */}
            <td style={{ verticalAlign: "top", width: "50%" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <Row label="社会保険料（健保・子育て・厚年）" value={payroll.socialInsurance} />
                  {childcare > 0 && <Row label="うち 子ども・子育て支援金" value={childcare} indent />}
                  <Row label="雇用保険料" value={payroll.employmentInsurance} />
                  <Row label="源泉所得税" value={payroll.incomeTax} />
                  <Row label="市県民税" value={payroll.residentTax} />
                  {payroll.absenceDeduction > 0 && <Row label="欠勤控除" value={payroll.absenceDeduction} />}
                  {miscDeduction > 0 && <Row label="積立金・その他" value={miscDeduction} />}
                  <TotalRow label="控除合計（B）" value={payroll.totalDeductions} />
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── 勤怠実績 ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
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
                <div style={{ color: "#777", fontSize: "7.5pt" }}>{label}</div>
                <div style={{ fontWeight: "bold", marginTop: "1px" }}>{val}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* ── フッター ── */}
      <div style={S.footer}>
        <div>※ 本明細書に関するお問い合わせは給与担当者までご連絡ください。</div>
        <div>{payroll.status === "confirmed" ? "【確定済】" : "【仮計算・未確定】"}</div>
      </div>
    </div>
  );
}

export function PayrollSlipPrint({ payroll, companyName }: Props) {
  const [portalEl] = useState<HTMLDivElement>(() => {
    const existing = document.getElementById("payroll-print-root");
    if (existing) {
      console.log("[PayrollSlipPrint] Removed stale portal element.");
      existing.remove();
    }
    const el = document.createElement("div");
    el.id = "payroll-print-root";
    document.body.appendChild(el);
    console.log("[PayrollSlipPrint] Portal element created. Total #payroll-print-root:", document.querySelectorAll("#payroll-print-root").length);
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
    <PrintContent payroll={payroll} companyName={companyName} />,
    portalEl,
  );
}
