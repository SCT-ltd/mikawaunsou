/**
 * 日本の祝日（国民の祝日・振替休日・国民の休日）。勤怠からの月の集計で「祝日出勤」を見分けるのに使う。
 * カレンダー画面（payroll-app/src/pages/calendar.tsx）と同じ決まりに、国民の休日（祝日に挟まれた平日）を足したもの。
 * 春分・秋分は計算式による（官報の発表と食い違う年が出たらここを直す）。日付はすべて "YYYY-MM-DD"。
 */
const cache = new Map<number, Map<string, string>>();

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1, d!)); };
const fmt = (d: Date) => ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const dow = (s: string) => parse(s).getUTCDay();

export function japaneseHolidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const nthMonday = (m: number, n: number) => {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(Date.UTC(year, m - 1, day));
      if (dt.getUTCMonth() !== m - 1) break;
      if (dt.getUTCDay() === 1 && ++count === n) return ymd(year, m, day);
    }
    return "";
  };
  const vernal = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumnal = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

  const h = new Map<string, string>([
    [ymd(year, 1, 1), "元日"],
    [ymd(year, 2, 11), "建国記念の日"],
    [ymd(year, 2, 23), "天皇誕生日"],
    [ymd(year, 3, vernal), "春分の日"],
    [ymd(year, 4, 29), "昭和の日"],
    [ymd(year, 5, 3), "憲法記念日"],
    [ymd(year, 5, 4), "みどりの日"],
    [ymd(year, 5, 5), "こどもの日"],
    [ymd(year, 8, 11), "山の日"],
    [ymd(year, 9, autumnal), "秋分の日"],
    [ymd(year, 11, 3), "文化の日"],
    [ymd(year, 11, 23), "勤労感謝の日"],
  ]);
  for (const [k, v] of [[nthMonday(1, 2), "成人の日"], [nthMonday(7, 3), "海の日"], [nthMonday(9, 3), "敬老の日"], [nthMonday(10, 2), "スポーツの日"]] as const) {
    if (k) h.set(k, v);
  }

  // 国民の休日：前の日と次の日がどちらも国民の祝日で、その日自体は祝日でも日曜でもない日
  const national = [...h.keys()];
  for (const k of national) {
    const mid = addDays(k, 1);
    if (!h.has(mid) && h.has(addDays(k, 2)) && dow(mid) !== 0) h.set(mid, "国民の休日");
  }
  // 振替休日：祝日が日曜なら、その後の最初の祝日でない日
  for (const k of national) {
    if (dow(k) !== 0) continue;
    let next = addDays(k, 1);
    while (h.has(next)) next = addDays(next, 1);
    h.set(next, "振替休日");
  }

  cache.set(year, h);
  return h;
}

/** その日が祝日（振替休日・国民の休日を含む）なら名前、違えば null */
export function holidayName(date: string): string | null {
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? japaneseHolidays(y).get(date) ?? null : null;
}
