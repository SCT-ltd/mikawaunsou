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

export const formatDate = (dateStr: string | undefined | null) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};
