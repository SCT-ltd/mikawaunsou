import { z, ZodIssueCode, type ZodErrorMap } from "zod";

/**
 * 入力チェック（zod）の決まりの文を日本語にする。
 * 項目ごとに文を書いていない欄（「0以上」など）は、英語のまま
 * 「Number must be greater than or equal to 0」と出ていた。
 * main.tsx で1回だけ読み込む（画面のすべての入力欄に効く）。
 */
const jaErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "入力してください" };
      if (issue.expected === "number" || issue.expected === "integer") return { message: "数字を入れてください" };
      if (issue.expected === "date") return { message: "日付を入れてください" };
      return { message: "入力の形が正しくありません" };
    case ZodIssueCode.too_small:
      if (issue.type === "string") return { message: Number(issue.minimum) <= 1 ? "入力してください" : `${issue.minimum}文字以上で入れてください` };
      if (issue.type === "number") return { message: `${issue.minimum}${issue.inclusive ? "以上" : "より大きい"}の数を入れてください` };
      if (issue.type === "array") return { message: `${issue.minimum}つ以上選んでください` };
      return { message: "小さすぎます" };
    case ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `${issue.maximum}文字までで入れてください` };
      if (issue.type === "number") return { message: `${issue.maximum}${issue.inclusive ? "以下" : "より小さい"}の数を入れてください` };
      return { message: "大きすぎます" };
    case ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "メールアドレスの形で入れてください" };
      return { message: "入力の形が正しくありません" };
    case ZodIssueCode.invalid_enum_value:
      return { message: "一覧から選んでください" };
    case ZodIssueCode.not_multiple_of:
      return { message: `${issue.multipleOf}の倍数で入れてください` };
    case ZodIssueCode.invalid_date:
      return { message: "日付が正しくありません" };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(jaErrorMap);
