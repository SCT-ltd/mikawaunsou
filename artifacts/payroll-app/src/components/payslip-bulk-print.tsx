import { useState, useEffect, useRef, useCallback } from "react";
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

function BulkItem({
  payroll,
  companyName,
  employees,
  company,
  onReady,
  isLast,
}: {
  payroll: PayrollItem;
  companyName: string;
  employees: AnyEmployee[];
  company: CompanyInfo;
  onReady: () => void;
  isLast: boolean;
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

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        pageBreakAfter: isLast ? "auto" : "always",
        breakAfter: isLast ? "auto" : "page",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <ClassicContent
        payroll={payroll}
        companyName={companyName}
        employeeAllowances={allowances as ClassicPayslipProps["employeeAllowances"]}
        employeeDeductions={deductions as ClassicPayslipProps["employeeDeductions"]}
        employee={employee}
        company={company}
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
}: {
  payrolls: PayrollItem[];
  companyName: string;
  employees: AnyEmployee[];
  company: CompanyInfo;
  onDone: () => void;
  year?: number;
  month?: number;
}) {
  const [portalEl] = useState<HTMLDivElement>(() => {
    const existing = document.getElementById("payroll-print-root");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "payroll-print-root";
    el.setAttribute("data-bulk-print", "true");
    document.body.appendChild(el);
    return el;
  });

  const [readyCount, setReadyCount] = useState(0);
  const printTriggeredRef = useRef(false);

  const handleReady = useCallback(() => {
    setReadyCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (readyCount >= payrolls.length && !printTriggeredRef.current && payrolls.length > 0) {
      printTriggeredRef.current = true;
      console.log("[PayslipBulkPrint] All items ready. Triggering print.", readyCount, "/", payrolls.length);
      const prevTitle = document.title;
      const y = year ?? payrolls[0]?.year;
      const m = month ?? payrolls[0]?.month;
      if (y && m) {
        document.title = `一括_${y}年${m}月`;
      }
      const restoreTitle = () => {
        document.title = prevTitle;
        window.removeEventListener("afterprint", restoreTitle);
      };
      window.addEventListener("afterprint", restoreTitle);
      requestAnimationFrame(() => {
        window.print();
      });
    }
  }, [readyCount, payrolls, year, month]);

  useEffect(() => {
    const cleanup = () => {
      console.log("[PayslipBulkPrint] afterprint: calling onDone.");
      onDone();
    };
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, [onDone]);

  useEffect(() => {
    return () => {
      if (document.body.contains(portalEl)) {
        document.body.removeChild(portalEl);
        console.log("[PayslipBulkPrint] Portal removed.");
      }
    };
  }, [portalEl]);

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
