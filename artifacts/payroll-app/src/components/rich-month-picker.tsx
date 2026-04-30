import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

const MONTH_LABELS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

interface RichMonthPickerProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  minYear?: number;
  maxYear?: number;
}

function MonthPopup({
  year,
  month,
  onChange,
  onClose,
  pos,
  minYear,
  maxYear,
}: {
  year: number;
  month: number;
  onChange: (y: number, m: number) => void;
  onClose: () => void;
  pos: { top: number; left: number };
  minYear: number;
  maxYear: number;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const [viewYear, setViewYear] = useState(year);

  const canPrev = viewYear > minYear;
  const canNext = viewYear < maxYear;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 -translate-x-1/2"
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="w-[320px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          {/* ヘッダー */}
          <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => canPrev && setViewYear(y => y - 1)}
              disabled={!canPrev}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="text-white font-bold text-lg">{viewYear}年</p>
            <button
              type="button"
              onClick={() => canNext && setViewYear(y => y + 1)}
              disabled={!canNext}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* 月グリッド */}
          <div className="grid grid-cols-4 gap-2 p-4">
            {MONTH_LABELS.map((label, i) => {
              const m = i + 1;
              const isSelected = viewYear === year && m === month;
              const isCurrentMonth = viewYear === currentYear && m === currentMonth;
              const isFuture = viewYear > currentYear || (viewYear === currentYear && m > currentMonth);

              return (
                <button
                  key={m}
                  type="button"
                  disabled={isFuture}
                  onClick={() => { onChange(viewYear, m); onClose(); }}
                  className={`
                    h-12 rounded-xl text-sm font-semibold transition-all duration-100
                    flex flex-col items-center justify-center gap-0.5
                    ${isFuture ? "opacity-25 cursor-not-allowed" : "hover:scale-105 active:scale-95"}
                    ${isSelected
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                      : isCurrentMonth
                        ? "bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400 ring-offset-1"
                        : "text-slate-700 hover:bg-slate-100"}
                  `}
                >
                  <span>{label}</span>
                  {isCurrentMonth && !isSelected && (
                    <span className="w-1 h-1 rounded-full bg-indigo-400" />
                  )}
                </button>
              );
            })}
          </div>

          {/* フッター */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              選択中：<span className="text-slate-600 font-medium">{year}年{month}月</span>
            </span>
            <button
              type="button"
              onClick={() => { onChange(currentYear, currentMonth); onClose(); }}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              今月
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

export function RichMonthPicker({ year, month, onChange, minYear, maxYear }: RichMonthPickerProps) {
  const now = new Date();
  const resolvedMinYear = minYear ?? now.getFullYear() - 3;
  const resolvedMaxYear = maxYear ?? now.getFullYear();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleOpen = useCallback(() => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    setOpen(o => !o);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-indigo-300 transition-all shadow-sm text-sm font-semibold text-slate-700 min-w-[140px]"
      >
        <CalendarDays className="h-4 w-4 text-indigo-500 shrink-0" />
        <span>{year}年{month}月</span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400 ml-auto rotate-90" />
      </button>

      {open && (
        <MonthPopup
          year={year}
          month={month}
          onChange={onChange}
          onClose={() => setOpen(false)}
          pos={pos}
          minYear={resolvedMinYear}
          maxYear={resolvedMaxYear}
        />
      )}
    </>
  );
}
