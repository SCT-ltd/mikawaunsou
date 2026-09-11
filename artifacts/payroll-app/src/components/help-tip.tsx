import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * カーソルを置くと詳しい説明を出すツールチップ。
 *
 * ブラウザ標準の title 属性は、表示まで約1秒かかる・小さい・**押せない（disabled）ボタンでは
 * 出ない**、という弱点がある。「変更なし」で押せないボタンこそ理由を見せたいので、トリガーを
 * span で包む（disabled のボタンはポインターイベントを出さず、Radix の Tooltip が反応しないため）。
 *
 * 見た目はマスター管理の TipInput と揃える（最大幅・行間・改行を保持）。
 */
export function HelpTip({
  content,
  children,
  side = "bottom",
  align = "center",
}: {
  /** 説明文。文字列なら改行（\n）がそのまま改行になる */
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  // disableHoverableContent + pointer-events-none:
  // 説明文は読むだけでクリックする物は無いので、カーソルがボタンから離れたら即座に閉じ、
  // ツールチップ自体はマウスを遮らないようにする。Radix の既定（中身の上に移っても閉じない）
  // のままだと、幅の広い説明がすぐ下のボタン（前の社員／次の社員など）に重なって押せなくなり、
  // その間は隣のボタンのツールチップも開かなかった（実ブラウザ検証で確認）。
  return (
    <Tooltip delayDuration={200} disableHoverableContent>
      <TooltipTrigger asChild>
        {/* disabled の子でもホバーを拾えるよう、フォーカス可能な span で包む */}
        <span tabIndex={0} className="inline-flex shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className="pointer-events-none max-w-[340px] text-xs leading-relaxed whitespace-pre-line"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
