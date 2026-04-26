import React from "react";
import { formatCurrency } from "@/lib/format";

export interface PayrollViewModel {
  employeeCode: string;
  employeeName: string;
  targetYearMonth: string;
  payDate: string;
  earningItems: { label: string; amount: number; isTaxable?: boolean }[];
  deductionItems: { label: string; amount: number }[];
  totalEarnings: number;
  totalDeductions: number;
  netPayment: number;
  attendance: {
    workDays: number;
    overtimeHours: number;
    lateNightHours: number;
    holidayWorkDays: number;
  };
  notes: string;
  payrollId?: number;
}

interface PayrollPrintSlipProps {
  viewModel: PayrollViewModel;
}

export const PayrollPrintSlip: React.FC<PayrollPrintSlipProps> = ({ 
  viewModel
}) => {
  if (!viewModel) return null;

  const incomeTax = viewModel.deductionItems.find(i => i.label === "所得税")?.amount ?? 0;

  return (
    <div className="payroll-print-page" id={`payroll-slip-${viewModel.employeeCode}`}>
      {/* デバッグ表示: 画面には出るが印刷(CSS)では消える */}
      <div className="print-source-check" style={{ color: "red", fontSize: "11px", border: "1px solid red", padding: "2px", marginBottom: "5px", backgroundColor: "#fff" }}>
        PRINT_SOURCE_CHECK:
        {viewModel.employeeCode} / {viewModel.targetYearMonth} / 
        所得税 {incomeTax} / 差引 {viewModel.netPayment}
      </div>

      <div className="center bold" style={{ fontSize: "20px", marginBottom: "15px", borderBottom: "2px double #000", paddingBottom: "5px" }}>
        給与支払明細書
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "10px" }}>
        <table style={{ width: "65%", margin: 0 }}>
          <tbody>
            <tr style={{ height: "24px" }}>
              <th className="center" style={{ width: "20%", fontSize: "10px" }}>社員番号</th>
              <td className="center" style={{ width: "20%", fontSize: "10px" }}>{viewModel.employeeCode}</td>
              <th className="center" style={{ width: "15%", fontSize: "10px" }}>氏名</th>
              <td className="center" style={{ width: "45%", fontSize: "14px", fontWeight: "bold" }}>{viewModel.employeeName} 殿</td>
            </tr>
            <tr style={{ height: "24px" }}>
              <th className="center" style={{ width: "20%", fontSize: "10px" }}>対象年月</th>
              <td className="center" style={{ width: "20%", fontSize: "10px" }}>{viewModel.targetYearMonth}</td>
              <th className="center" style={{ width: "15%", fontSize: "10px" }}>支給日</th>
              <td className="center" style={{ width: "45%", fontSize: "10px" }}>{viewModel.payDate}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ width: "32%", border: "2.5px solid #000", padding: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "10px", marginBottom: "2px", borderBottom: "1px solid #ccc", paddingBottom: "2px" }}>差引支給額</div>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{formatCurrency(viewModel.netPayment)}</div>
        </div>
      </div>

      <table style={{ width: "100%", marginBottom: "10px" }}>
        <thead>
          <tr style={{ height: "24px" }}>
            <th colSpan={2} style={{ width: "50%", padding: "4px", fontSize: "10.5px" }}>支 給 項 目</th>
            <th colSpan={2} style={{ width: "50%", padding: "4px", fontSize: "10.5px" }}>控 除 項 目</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(viewModel.earningItems.length, viewModel.deductionItems.length, 11) }).map((_, i) => (
            <tr key={i} style={{ height: "23px" }}>
              <td style={{ width: "35%", fontSize: "10px" }}>
                {viewModel.earningItems[i]?.label || ""}
                {viewModel.earningItems[i]?.isTaxable === false && <span style={{ fontSize: "8px", marginLeft: "4px" }}>(非)</span>}
              </td>
              <td className="amount" style={{ width: "15%", fontSize: "10px" }}>{viewModel.earningItems[i] ? formatCurrency(viewModel.earningItems[i].amount) : ""}</td>
              <td style={{ width: "35%", fontSize: "10px" }}>{viewModel.deductionItems[i]?.label || ""}</td>
              <td className="amount" style={{ width: "15%", fontSize: "10px" }}>{viewModel.deductionItems[i] ? formatCurrency(viewModel.deductionItems[i].amount) : ""}</td>
            </tr>
          ))}
          <tr className="summary-row" style={{ height: "28px" }}>
            <td className="bold" style={{ fontSize: "10.5px" }}>支給合計 (A)</td>
            <td className="amount bold" style={{ fontSize: "10.5px" }}>{formatCurrency(viewModel.totalEarnings)}</td>
            <td className="bold" style={{ fontSize: "10.5px" }}>控除合計 (B)</td>
            <td className="amount bold" style={{ fontSize: "10.5px" }}>{formatCurrency(viewModel.totalDeductions)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
        <div style={{ flex: "1.2" }}>
          <table style={{ width: "100%", margin: 0 }}>
            <thead>
              <tr style={{ height: "24px" }}>
                <th colSpan={4} style={{ padding: "4px", fontSize: "10px" }}>勤 怠 実 績</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ height: "25px" }}>
                <th style={{ width: "25%", fontSize: "9px" }}>出勤日数</th>
                <td className="center" style={{ width: "25%", fontSize: "10px" }}>{viewModel.attendance.workDays} 日</td>
                <th style={{ width: "25%", fontSize: "9px" }}>休日出勤</th>
                <td className="center" style={{ width: "25%", fontSize: "10px" }}>{viewModel.attendance.holidayWorkDays} 日</td>
              </tr>
              <tr style={{ height: "25px" }}>
                <th style={{ width: "25%", fontSize: "9px" }}>時間外</th>
                <td className="center" style={{ width: "25%", fontSize: "10px" }}>{viewModel.attendance.overtimeHours} h</td>
                <th style={{ width: "25%", fontSize: "9px" }}>深夜時間</th>
                <td className="center" style={{ width: "25%", fontSize: "10px" }}>{viewModel.attendance.lateNightHours} h</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ flex: "1", border: "1px solid #000", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "2px", background: "#f2f2f2", textAlign: "center", fontWeight: "bold", borderBottom: "1px solid #000", fontSize: "9px" }}>備考</div>
          <div style={{ padding: "5px", flex: 1, fontSize: "9.5px", minHeight: "40px", lineHeight: "1.3" }}>
            {viewModel.notes}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: "5px" }}>
        <div style={{ fontSize: "11px", fontWeight: "bold" }}>
          株式会社 三河運送
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {["作成者", "承認印", "会社認印"].map((label) => (
            <div key={label} style={{ width: "75px", border: "1px solid #000" }}>
              <div style={{ background: "#f2f2f2", textAlign: "center", fontSize: "8px", padding: "1px", borderBottom: "1px solid #000" }}>{label}</div>
              <div style={{ height: "45px" }}></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
