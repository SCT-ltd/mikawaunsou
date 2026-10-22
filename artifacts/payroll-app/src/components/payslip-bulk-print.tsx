import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useMonthItems, toLegacyRows } from "@/lib/month-items";
import { ClassicContent } from "./payslip-print-classic";
import type { ClassicPayslipProps } from "./payslip-print-classic";

type PayrollItem = ClassicPayslipProps["payroll"];
type CompanyInfo = ClassicPayslipProps["company"];

interface AnyEmployee {
  id: number;
  [key: string]: unknown;
}

// ── 2人/A4 の自動拡大 ───────────────────────────────────────────────────
// A4縦（@page margin 6mm）の印刷可能高さ = 297 - 12 = 285mm。各明細は下に 5mm の
// 余白を持つので、2人/ページなら1明細あたりのスロットは最大 142.5mm。
// 明細の自然な高さはその半ページより短いことが多く、これまでは余白が余ったまま
// zoom 1.0 で刷っていた（＝文字が必要以上に小さい）。印刷直前に実寸を測り、
// スロットいっぱいまで zoom で比例拡大する。zoom は scale と違い版面ごと広がるので
// 見切れは起きず、収まらない明細は従来どおり単独ページへ流れる。
const MM_PRINTABLE_HEIGHT = 285;
const MM_HALF_PAGE = MM_PRINTABLE_HEIGHT / 2;
const MM_ITEM_GAP = 5;
/** A4縦（210mm）から左右余白 6mm ずつを引いた印刷可能幅。画面外計測時の版面幅に使う。 */
const MM_PRINTABLE_WIDTH = 198;
const PX_PER_MM = 96 / 25.4;
/** 拡大の上限。項目の極端に少ない明細で文字が大きくなりすぎるのを防ぐ。 */
const ZOOM_MAX = 1.6;
/** 縮小の下限。項目の多い明細で等倍でも欄からはみ出すときは、ここまで小さくして収める。 */
const ZOOM_MIN = 0.8;
/** 画面計測と実際の印刷でわずかに版面が違っても溢れないようにする安全率。 */
const ZOOM_SAFETY = 0.97;

/**
 * 各明細の実寸を測り、全明細で共通の拡大率を決めて適用する。
 *
 * 拡大率を明細ごとに変えると同じ紙の上で文字サイズがバラつくため、最も余裕のない明細に
 * 合わせて1つに揃える（等倍で半ページに収まらない明細は、元から単独ページなので
 * 1ページ分を上限として評価する）。
 *
 * zoom は「その要素を版面ごと拡大」する。幅 100% は自動的に補正されるため
 * （親幅 ÷ zoom で組んでから zoom 倍に戻る）横にはみ出さず、
 * getBoundingClientRect() も拡大後の実寸を返す。ただし組版幅が 1/zoom に狭まる分
 * 行が折り返して背が伸びるので、拡大率は「その倍率で実際に組んだ高さ」で二分探索する。
 * ＝ 版面の面積がほぼ保存されるため、拡大できるのは概ね √(高さの余裕) 倍まで。
 */
function applyStackZoom(portalEl: HTMLElement): number {
  const items = Array.from(portalEl.querySelectorAll<HTMLElement>("[data-stack-item]"));
  if (items.length === 0) return 1;

  /** 倍率 zoom で組んだときの、明細ごとの占有高さ（下余白込み・拡大後の実寸 mm）*/
  const layoutAt = (zoom: number): number[] => {
    items.forEach((el) => { el.style.zoom = zoom === 1 ? "" : String(zoom); });
    return items.map(
      (el) => el.getBoundingClientRect().height / PX_PER_MM + MM_ITEM_GAP * zoom,
    );
  };

  // 拡大すると組版幅が狭まる。欄の中身（金額・項目名）が横にはみ出すと、枠の overflow:hidden で
  // 文字が切れる（差引支給額の右端が欠けていた）。はみ出しが1つでもあれば「収まらない」とみなす。
  const boxes = items.flatMap((el) => Array.from(el.querySelectorAll<HTMLElement>("[data-fit-box]")));
  const noOverflow = () => boxes.every((b) => b.scrollWidth <= b.clientWidth + 1);

  // 等倍・実寸の版面で「半ページに収まる明細」と「元から1ページ使う明細」を分ける
  const budgets = layoutAt(1).map((mm) => (mm > MM_HALF_PAGE ? MM_PRINTABLE_HEIGHT : MM_HALF_PAGE));
  const fits = (zoom: number) =>
    layoutAt(zoom).every((mm, i) => mm <= budgets[i] * ZOOM_SAFETY) && noOverflow();

  let zoom = ZOOM_MAX;
  if (!fits(ZOOM_MAX)) {
    let lo = ZOOM_MIN;
    let hi = ZOOM_MAX;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    zoom = lo;
  }

  const heights = layoutAt(zoom); // 探索の最後に試した倍率とは限らないので、確定値で組み直す

  // ページ割りを自分で決めて、ページの頭になる明細に改ページを明示する。
  // break-inside:avoid だけに任せると、zoom を掛けた要素では Chrome が分割を避けきれず、
  // 3人目の見出しだけが1ページ目の下に載り、本体が次のページへ送られていた。
  let used = 0;
  let count = 0;
  const starts: boolean[] = [];
  items.forEach((el, i) => {
    const h = heights[i];
    const startNew = count > 0 && (count >= 2 || used + h > MM_PRINTABLE_HEIGHT * ZOOM_SAFETY);
    if (startNew) { used = 0; count = 0; }
    el.style.breakBefore = startNew ? "page" : "";
    el.style.pageBreakBefore = startNew ? "always" : "";
    starts.push(i === 0 || startNew);
    used += h;
    count += 1;
  });

  // 同じ紙に2人並ぶときは、2人目を用紙のちょうど半分から始める（上下の明細の間を空け、
  // 半分に切りやすくする）。以前は1人目のすぐ下に5mmで詰めて並べていたため、間が狭く
  // 紙の下半分が丸ごと余っていた。margin は zoom で拡大されるので zoom で割って指定する。
  items.forEach((el, i) => {
    const pairedBelow = i + 1 < items.length && !starts[i + 1];
    if (!pairedBelow) {
      el.style.marginBottom = `${MM_ITEM_GAP}mm`;
      delete el.dataset.cut;
      return;
    }
    const contentMm = heights[i] - MM_ITEM_GAP * zoom;
    const gapMm = Math.max(MM_ITEM_GAP * zoom, MM_HALF_PAGE - contentMm);
    el.style.marginBottom = `${(gapMm / zoom).toFixed(2)}mm`;
    // 切り取り線は上下の明細の間のまん中に引く（線と鋏の位置は印刷用の <style> が --cut を見て決める）
    el.dataset.cut = "1";
    el.style.setProperty("--cut", `${(gapMm / 2 / zoom).toFixed(2)}mm`);
  });
  return zoom;
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
  // 内訳は「その明細の月」の手当・控除から作る。
  // 以前は印刷した時点の手当を使っていたため、過去の月を刷り直すと内訳だけが今の金額になり、
  // 合計と合わなかった。印刷の直前に必ず取り直す（staleTime 0）。
  const { data: monthItems, isSuccess: aOk } = useMonthItems(empId, payroll.year, payroll.month, { staleTime: 0, refetchOnMount: "always" });
  const dOk = aOk;
  const { allowances, deductions } = toLegacyRows(monthItems, empId);
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
    <div style={style} data-stack-item={variant === "stack" ? "true" : undefined}>
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
    style.textContent =
      "@media print { @page { size: A4 portrait; margin: 6mm; } }" +
      // 2人が並ぶ紙の、上下の明細の間に引く切り取り線（点線＋鋏）
      "[data-stack-item][data-cut]{position:relative}" +
      "[data-stack-item][data-cut]::after{content:\"\";position:absolute;left:0;right:0;" +
      "bottom:calc(var(--cut) * -1);border-top:0.35mm dashed #8a8a8a}" +
      "[data-stack-item][data-cut]::before{content:\"✂ 切り取り線\";position:absolute;left:3mm;" +
      "bottom:calc(var(--cut) * -1 + 0.8mm);color:#7a7a7a;" +
      "font-size:3mm;line-height:3.8mm;white-space:nowrap}";
    document.head.appendChild(style);
    return () => style.remove();
  }, [layout]);

  const printTriggeredRef = useRef(false);
  const [readyCount, setReadyCount] = useState(0);
  const handleReady = useCallback(() => setReadyCount((c) => c + 1), []);

  useEffect(() => {
    if (readyCount < payrolls.length || printTriggeredRef.current || payrolls.length === 0) return;
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

    if (layout !== "2up") {
      requestAnimationFrame(() => window.print());
      return;
    }

    // ポータルは画面では display:none なので、そのままでは高さが測れない。
    // 印刷時と同じ版面幅で画面外に一瞬だけ実体化して測り、拡大率を当ててから元に戻す。
    portalEl.style.cssText =
      `display:block;position:fixed;left:-20000px;top:0;` +
      `width:${MM_PRINTABLE_WIDTH}mm;visibility:hidden;`;
    requestAnimationFrame(() => {
      applyStackZoom(portalEl);
      portalEl.removeAttribute("style");
      requestAnimationFrame(() => window.print());
    });
  }, [readyCount, payrolls, year, month, layout, portalEl]);

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
