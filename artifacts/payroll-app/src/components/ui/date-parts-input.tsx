import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface DatePartsInputProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onChange?: (value: string) => void;
}

function parseValue(v?: string) {
  if (!v) return { y: "", m: "", d: "" };
  const parts = v.split("-");
  const y = parts[0] ?? "";
  const m = parts[1] ?? "";
  const d = parts[2] ?? "";
  return { y, m, d };
}

export function DatePartsInput({ value, onChange, className, id, ...rest }: DatePartsInputProps) {
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState(() => parseValue(value));

  // 外部 value が変わったとき（社員切り替え・フォームリセット）に同期する
  useEffect(() => {
    setParts(parseValue(value));
  }, [value]);

  const emit = (next: { y: string; m: string; d: string }) => {
    // y が4桁、m/d が1桁以上あれば emit（両方ゼロパディングして送る）
    if (next.y.length === 4 && next.m.length >= 1 && next.d.length >= 1) {
      const mm = next.m.padStart(2, "0");
      const dd = next.d.padStart(2, "0");
      onChange?.(`${next.y}-${mm}-${dd}`);
    } else if (!next.y && !next.m && !next.d) {
      onChange?.("");
    }
  };

  const handleYear = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    const next = { ...parts, y: digits };
    setParts(next);
    emit(next);
    if (digits.length === 4) monthRef.current?.focus();
  };

  const handleMonth = (v: string) => {
    let digits = v.replace(/\D/g, "").slice(0, 2);
    // 2以上の1桁は自動で2桁にパディング（例: "3" → "03"）
    if (digits.length === 1 && Number(digits) > 1) digits = digits.padStart(2, "0");
    if (Number(digits) > 12) digits = "12";
    const next = { ...parts, m: digits };
    setParts(next);
    emit(next);
    if (digits.length === 2) dayRef.current?.focus();
  };

  const handleDay = (v: string) => {
    let digits = v.replace(/\D/g, "").slice(0, 2);
    // 4以上の1桁は自動で2桁にパディング（例: "5" → "05"）
    if (digits.length === 1 && Number(digits) > 3) digits = digits.padStart(2, "0");
    if (Number(digits) > 31) digits = "31";
    const next = { ...parts, d: digits };
    setParts(next);
    emit(next);
  };

  const handleDayBlur = () => {
    // フォーカスが外れたとき、1〜3の1桁も2桁にパディングして確定
    if (parts.d.length === 1) {
      const padded = parts.d.padStart(2, "0");
      const next = { ...parts, d: padded };
      setParts(next);
      emit(next);
    }
  };

  const handleMonthBlur = () => {
    // フォーカスが外れたとき、1の1桁も2桁にパディングして確定
    if (parts.m.length === 1) {
      const padded = parts.m.padStart(2, "0");
      const next = { ...parts, m: padded };
      setParts(next);
      emit(next);
    }
  };

  const inputCls = "border-0 bg-transparent text-center focus:outline-none focus:ring-0 p-0";

  return (
    <div
      id={id}
      {...rest}
      className={cn(
        "flex items-center gap-0.5 h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring",
        className
      )}
    >
      <input
        id={id ? `${id}-y` : undefined}
        type="text"
        inputMode="numeric"
        placeholder="YYYY"
        maxLength={4}
        value={parts.y}
        onChange={e => handleYear(e.target.value)}
        className={cn(inputCls, "w-10")}
      />
      <span className="text-muted-foreground select-none">/</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        placeholder="MM"
        maxLength={2}
        value={parts.m}
        onChange={e => handleMonth(e.target.value)}
        onBlur={handleMonthBlur}
        className={cn(inputCls, "w-6")}
      />
      <span className="text-muted-foreground select-none">/</span>
      <input
        ref={dayRef}
        type="text"
        inputMode="numeric"
        placeholder="DD"
        maxLength={2}
        value={parts.d}
        onChange={e => handleDay(e.target.value)}
        onBlur={handleDayBlur}
        className={cn(inputCls, "w-6")}
      />
    </div>
  );
}
