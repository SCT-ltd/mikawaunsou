export const formatCurrency = (amount: number | undefined | null) => {
  if (amount === undefined || amount === null) return "¥0";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
  }).format(amount);
};

export const formatMonth = (year: number, month: number) => {
  return `${year}年${month}月`;
};

/**
 * 労働時間を「n時間m分」で表示する。
 * 残業を分単位（例: 10分単位）で入力する社員は内部的に時間へ換算して保持するため
 * 3.1666666666666665 のような小数になる。分に丸めて正確かつ読める形にする。
 */
export const formatHours = (hours: number | undefined | null) => {
  const totalMinutes = Math.round((hours ?? 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
};

export const formatDate = (dateStr: string | undefined | null) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};
