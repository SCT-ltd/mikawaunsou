import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  useGetEmployeeAllowances,
  useGetEmployeeDeductions,
  getGetEmployeeAllowancesQueryKey,
  getGetEmployeeDeductionsQueryKey,
} from "@workspace/api-client-react";
import { ClassicContent } from "./payslip-print-classic";
import type { ClassicPayslipProps } from "./payslip-print-classic";

type PayrollItem = ClassicPayslipProps["payroll"];
type CompanyInfo = ClassicPayslipProps["company"];

interface AnyEmployee {
  id: number;
  [key: string]: unknown;
}

// 1人1ページの詳細明細。手当/控除の取得完了を onReady で通知。
// 面付け（複数枚を1ページ）が必要な場合は、印刷ダイアログの「1枚あたりのページ数」で
// 4 / 16 などを選ぶ（ブラウザ標準機能。1面と完全に同じ内容が縮小されて並ぶ）。
function BulkItem({
  payroll,
  companyName,
  employees,
  company,
  onReady,
  isLast,
  variant = "full",
}: {
  payroll: PayrollItem;
  companyName: string;
  employees: AnyEmployee[];
  company: CompanyInfo;
  onReady: () => void;
  isLast: boolean;
  /** full = 1人1ページ（A4横）、stack = A4縦に自然な高さで積む（ページに収まる分だけ自動で詰める） */
  variant?: "full" | "stack";
}) {
  const empId = (payroll.employeeId as number) ?? 0;
  const { data: allowances, isSuccess: aOk } = useGetEmployeeAllowances(empId, {
    query: { enabled: empId > 0, queryKey: getGetEmployeeAllowancesQueryKey(empId) },
  });
  const { data: deductions, isSuccess: dOk } = useGetEmployeeDeductions(empId, {
    query: { enabled: empId > 0, queryKey: getGetEmployeeDeductionsQueryKey(empId) },
  });
  const notifiedRef = useRef(false);

  useEffect(() => {
    if ((aOk || empId === 0) && (dOk || empId === 0) && !notifiedRef.current) {
      notifiedRef.current = true;
      onReady();
    }
  }, [aOk, dOk, empId, onReady]);

  const employee = employees.find((e) => e.id === empId) as ClassicPayslipProps["employee"] | undefined;

  // stack（2人/A4）: 明細ごとに自然な高さのブロックにし、break-inside:avoid で
  // 1明細が途中で分割されないようにする。ブラウザが1ページに収まる分だけ自動で詰めるので、
  // 項目の多い社員は次のページへ流れ（実質1人/ページ）、少ない社員は2人並ぶ。見切れは起きない。
  const style: CSSProperties = variant === "stack"
    ? {
        width: "100%",
        breakInside: "avoid",
        pageBreakInside: "avoid",
        marginBottom: "5mm",
        boxSizing: "border-box",
      }
    : {
        width: "100%",
        height: "100vh",
        pageBreakAfter: isLast ? "auto" : "always",
        breakAfter: isLast ? "auto" : "page",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      };

  return (
    <div style={style}>
      <ClassicContent
        payroll={payroll}
        companyName={companyName}
        employeeAllowances={allowances as ClassicPayslipProps["employeeAllowances"]}
        employeeDeductions={deductions as ClassicPayslipProps["employeeDeductions"]}
        employee={employee}
        company={company}
        compact={variant === "stack"}
      />
    </div>
  );
}

export function PayslipBulkPrint({
  payrolls,
  companyName,
  employees,
  company,
  onDone,
  year,
  month,
  layout = "1up",
}: {
  payrolls: PayrollItem[];
  companyName: string;
  employees: AnyEmployee[];
  company: CompanyInfo;
  onDone: () => void;
  year?: number;
  month?: number;
  /** "1up" = 1人1ページ（A4横）、"2up" = A4縦1枚に2人（上下） */
  layout?: "1up" | "2up";
}) {
  const [portalEl] = useState<HTMLDivElement>(() => {
    document.getElementById("payroll-print-root")?.remove();
    const el = document.createElement("div");
    el.id = "payroll-print-root";
    el.setAttribute("data-bulk-print", "true");
    el.setAttribute("data-print-mode", layout);
    document.body.appendChild(el);
    return el;
  });

  // 2up のときだけ用紙を A4縦にする。@page の size は要素セレクタで切り替えられないため、
  // 印刷中だけ portrait を指定する <style> を後ろに差し込んで既存の landscape を上書きする。
  useEffect(() => {
    if (layout !== "2up") return;
    const style = document.createElement("style");
    style.setAttribute("data-print-2up", "");
    style.textContent = "@media print { @page { size: A4 portrait; margin: 6mm; } }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [layout]);

  const printTriggeredRef = useRef(false);
  const [readyCount, setReadyCount] = useState(0);
  const handleReady = useCallback(() => setReadyCount((c) => c + 1), []);

  useEffect(() => {
    if (readyCount >= payrolls.length && !printTriggeredRef.current && payrolls.length > 0) {
      printTriggeredRef.current = true;
      const prevTitle = document.title;
      const y = year ?? payrolls[0]?.year;
      const m = month ?? payrolls[0]?.month;
      if (y && m) document.title = `一括_${y}年${m}月`;
      const restoreTitle = () => {
        document.title = prevTitle;
        window.removeEventListener("afterprint", restoreTitle);
      };
      window.addEventListener("afterprint", restoreTitle);
      requestAnimationFrame(() => window.print());
    }
  }, [readyCount, payrolls, year, month]);

  useEffect(() => {
    window.addEventListener("afterprint", onDone);
    return () => window.removeEventListener("afterprint", onDone);
  }, [onDone]);

  useEffect(() => {
    return () => {
      if (document.body.contains(portalEl)) document.body.removeChild(portalEl);
    };
  }, [portalEl]);

  if (layout === "2up") {
    // A4縦に明細を自然な高さで積む。各明細は break-inside:avoid なので途中で分割されず、
    // ブラウザが1ページに入る分だけ詰める（少ない社員は2人、多い社員は1人になる）。
    return createPortal(
      <>
        {payrolls.map((p, i) => (
          <BulkItem
            key={(p as { id?: number }).id ?? i}
            payroll={p}
            companyName={companyName}
            employees={employees}
            company={company}
            onReady={handleReady}
            isLast={i === payrolls.length - 1}
            variant="stack"
          />
        ))}
      </>,
      portalEl,
    );
  }

  return createPortal(
    <>
      {payrolls.map((p, i) => (
        <BulkItem
          key={(p as { id?: number }).id ?? i}
          payroll={p}
          companyName={companyName}
          employees={employees}
          company={company}
          onReady={handleReady}
          isLast={i === payrolls.length - 1}
        />
      ))}
    </>,
    portalEl,
  );
}
