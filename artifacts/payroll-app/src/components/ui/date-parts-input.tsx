import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface DatePartsInputProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onChange?: (value: string) => void;
}

function parseValue(v?: string) {
  if (!v) return { y: "", m: "", d: "" };
  const [y = "", m = "", d = ""] = v.split("-");
  return { y, m, d };
}

export function DatePartsInput({ value, onChange, className, id, ...rest }: DatePartsInputProps) {
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState(() => parseValue(value));
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setParts(parseValue(value));
    setInitialized(true);
  }, [value]);

  useEffect(() => {
    if (!initialized) return;
    setParts(parseValue(value));
  }, [initialized, value]);

  const emit = (next: { y: string; m: string; d: string }) => {
    if (next.y.length === 4 && next.m.length === 2 && next.d.length === 2) {
      onChange?.(`${next.y}-${next.m}-${next.d}`);
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
    if (digits.length === 1 && Number(digits) > 1) digits = digits.padStart(2, "0");
    if (Number(digits) > 12) digits = "12";
    const next = { ...parts, m: digits };
    setParts(next);
    emit(next);
    if (digits.length === 2) dayRef.current?.focus();
  };

  const handleDay = (v: string) => {
    let digits = v.replace(/\D/g, "").slice(0, 2);
    if (digits.length === 1 && Number(digits) > 3) digits = digits.padStart(2, "0");
    if (Number(digits) > 31) digits = "31";
    const next = { ...parts, d: digits };
    setParts(next);
    emit(next);
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
        className={cn(inputCls, "w-6")}
      />
    </div>
  );
}
