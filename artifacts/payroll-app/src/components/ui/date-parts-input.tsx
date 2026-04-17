import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface DatePartsInputProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onChange?: (value: string) => void;
}

function parseValue(v?: string) {
  if (!v) return { y: "", m: "", d: "" };
  const parts = v.split("-");
  return { y: parts[0] ?? "", m: parts[1] ?? "", d: parts[2] ?? "" };
}

export function DatePartsInput({ value, onChange, className, id, ...rest }: DatePartsInputProps) {
  const mmddRef = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState(() => parseValue(value));
  const isLocalChange = useRef(false);

  useEffect(() => {
    if (isLocalChange.current) {
      isLocalChange.current = false;
      return;
    }
    setParts(parseValue(value));
  }, [value]);

  // 月日を合成した生の4桁文字列（例: "0920"）
  const rawMmdd = parts.m + parts.d;

  // 表示用: 2桁を超えたら "/" を挿入して "09/20" のように見せる
  const displayMmdd = rawMmdd.length > 2
    ? `${rawMmdd.slice(0, 2)}/${rawMmdd.slice(2)}`
    : rawMmdd;

  const emit = (next: { y: string; m: string; d: string }) => {
    if (next.y.length === 4 && next.m.length === 2 && next.d.length >= 1) {
      const dd = next.d.padStart(2, "0");
      isLocalChange.current = true;
      onChange?.(`${next.y}-${next.m}-${dd}`);
    } else if (!next.y && !next.m && !next.d) {
      isLocalChange.current = true;
      onChange?.("");
    }
  };

  const handleYear = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    const next = { ...parts, y: digits };
    setParts(next);
    emit(next);
    if (digits.length === 4) mmddRef.current?.focus();
  };

  // 月日フィールド: "/" を取り除いて生の数字4桁として処理する
  const handleMmdd = (v: string) => {
    const raw = v.replace(/\D/g, "").slice(0, 4);
    const m = raw.slice(0, 2);
    const d = raw.slice(2, 4);
    const next = { y: parts.y, m, d };
    setParts(next);
    emit(next);
  };

  const handleMmddBlur = () => {
    // フォーカスを外したとき、日が1桁なら0埋めして確定
    if (parts.d.length === 1) {
      const next = { ...parts, d: parts.d.padStart(2, "0") };
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
        ref={mmddRef}
        type="text"
        inputMode="numeric"
        placeholder="MMDD"
        maxLength={5}
        value={displayMmdd}
        onChange={e => handleMmdd(e.target.value)}
        onBlur={handleMmddBlur}
        className={cn(inputCls, "w-14")}
      />
    </div>
  );
}
