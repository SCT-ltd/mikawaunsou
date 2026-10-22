/**
 * 給与計算と法令まわりのお知らせ（lib/alerts.ts の computeAlerts から呼ぶ）。
 *   - 残業：運転者は年960時間（労基法140条・2024年4月〜）。月45時間・年6回／月100時間未満／複数月平均80時間は運転者には当てはまらない
 *   - 最低賃金を下回る明細・会社設定の単価
 *   - ブルーウィングの固定残業代が「固定時間 × 残業時給」に足りない
 *   - 有給の年5日の取得義務（労基法39条7項）
 *   - 算定基礎・月額変更の候補
 *   - 住民税の6月の切り替え
 */
import { db, employeesTable, monthlyRecordsTable, payrollsTable, companyTable, employeeMonthAllowancesTable, residentTaxSchedulesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { fixedOvertimeShortfall, payRulesFromCompany } from "@workspace/tax-tables-reiwa8/core";
import type { EmployeeAlert } from "./alerts";
import { paidLeaveFor } from "./paid-leave";
import { reviewCandidates } from "./remuneration-review";

type Emp = typeof employeesTable.$inferSelect;

const nameOf = (n: string) => n.replace(/[\s　]+/g, " ").trim();

/** 最低賃金をもとにした単価の1円未満：50銭未満切り捨て・50銭以上切り上げ（昭和63年3月14日 基発150号） */
const roundRate = (x: number) => Math.round(x);
const ymKey = (y: number, m: number) => y * 12 + (m - 1);
const DAY = 86_400_000;

/** 残業のお知らせ（いちばん新しい月の実績＋年の累計）。運転者と事務職で文を分ける。 */
export async function overtimeAlerts(emps: Emp[], today: Date): Promise<EmployeeAlert[]> {
  const out: EmployeeAlert[] = [];
  const ids = emps.map((e) => e.id);
  if (ids.length === 0) return out;
  const [company] = await db.select().from(companyTable).limit(1);
  const start = company?.overtimeYearStartMonth ?? 4;
  const recs = await db.select({
    employeeId: monthlyRecordsTable.employeeId, year: monthlyRecordsTable.year, month: monthlyRecordsTable.month,
    overtimeHours: monthlyRecordsTable.overtimeHours, restDayOvertimeHours: monthlyRecordsTable.restDayOvertimeHours,
  }).from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, ids));
  const latest = recs.reduce((m, r) => Math.max(m, ymKey(r.year, r.month)), -1);
  if (latest < 0) return out;
  const ly = Math.floor(latest / 12), lm = (latest % 12) + 1;
  const fyStart = ymKey(lm >= start ? ly : ly - 1, start);
  for (const e of emps) {
    const name = nameOf(e.name);
    const driver = !e.isOfficeStaff;
    const mine = recs.filter((r) => r.employeeId === e.id);
    const cur = mine.find((r) => r.year === ly && r.month === lm);
    const h = cur ? (cur.overtimeHours ?? 0) + (cur.restDayOvertimeHours ?? 0) : 0;
    const yearTotal = mine.filter((r) => ymKey(r.year, r.month) >= fyStart && ymKey(r.year, r.month) <= latest)
      .reduce((s, r) => s + (r.overtimeHours ?? 0) + (r.restDayOvertimeHours ?? 0), 0);
    const over45Count = mine.filter((r) => ymKey(r.year, r.month) >= fyStart && ymKey(r.year, r.month) <= latest && (r.overtimeHours ?? 0) + (r.restDayOvertimeHours ?? 0) > 45).length;
    const base = { employeeId: e.id, employeeName: name, href: "/monthly-input" };
    const yt = Math.round(yearTotal * 10) / 10;
    if (h > 45) {
      out.push({ ...base, key: `ot:${e.id}:${ly}-${lm}`, level: h > 80 ? "danger" : "warn",
        title: `${name}さんの${lm}月の残業が${h}時間です`,
        body: driver
          ? (h > 100
            ? `100時間を超えています。医師による面接指導（労働安全衛生法66条の8）の対象です。改善基準告示の拘束時間（1か月284時間など）も確かめてください。今年度の累計は${yt}時間（上限960時間）。`
            : h > 80
            ? `80時間を超えています。本人の申出があれば医師による面接指導が必要です（労働安全衛生法66条の8）。今年度の累計は${yt}時間（上限960時間）。`
            : `運転の仕事には「月45時間を超えるのは年6回まで」の決まりは当てはまりませんが、年960時間の上限があります（今年度の累計${yt}時間）。`)
          : (h >= 100
            ? "月100時間以上です。36協定の特別条項があっても超えられない上限です（労基法36条6項）。"
            : h > 80
            ? `80時間を超えています。2〜6か月の平均80時間以内・医師の面接指導を確かめてください。今年度に45時間を超えた月は${over45Count}回（年6回まで）。`
            : `月45時間を超えています（36協定の原則の上限）。特別条項の範囲か確かめてください。今年度に45時間を超えた月は${over45Count}回（年6回まで）。`) });
    }
    const limit = driver ? 960 : 720;
    if (yearTotal > limit * 0.8) {
      out.push({ ...base, key: `otyear:${e.id}:${fyStart}:${yearTotal > limit ? "over" : "near"}`, level: yearTotal > limit ? "danger" : "warn",
        title: `${name}さんの今年度の残業が${yt}時間です`,
        body: `${driver ? "運転者の年の上限は960時間（労基法140条）" : "年の上限は720時間（特別条項。原則は360時間）"}です。${yearTotal > limit ? "上限を超えています。" : "上限に近づいています。"}（${start}月起算・休日労働は含めていません）` });
    }
  }
  void today;
  return out;
}

export async function payrollLawAlerts(emps: Emp[], today: Date): Promise<EmployeeAlert[]> {
  const out: EmployeeAlert[] = [];
  const ids = emps.map((e) => e.id);
  if (ids.length === 0) return out;
  const [company] = await db.select().from(companyTable).limit(1);
  const rules = payRulesFromCompany(company as never);
  const todayIso = today.toISOString().slice(0, 10);

  // ── 最低賃金（会社設定の単価）──
  const minWage = company?.minimumWageHourly ?? 0;
  if (minWage > 0) {
    const hpd = rules.scheduledHoursPerDay;
    const bad = [
      (company?.dailyWageWeekday ?? 0) < roundRate(minWage * hpd) && `平日の日当 ${company?.dailyWageWeekday}円（${roundRate(minWage * hpd)}円以上）`,
      (company?.dailyWageSaturday ?? 0) < roundRate(minWage * hpd * 1.25) && `土曜の日当 ${company?.dailyWageSaturday}円（${roundRate(minWage * hpd * 1.25)}円以上）`,
      (company?.hourlyWageSunday ?? 0) < roundRate(minWage * 1.35) && `日曜の時給 ${company?.hourlyWageSunday}円（${roundRate(minWage * 1.35)}円以上）`,
    ].filter(Boolean);
    if (bad.length) {
      out.push({ key: `minwage:company:${minWage}`, level: "danger", href: "/settings",
        title: "会社設定の単価が最低賃金をもとにした額より低くなっています",
        body: `最低賃金 ${minWage.toLocaleString("ja-JP")}円で数えると足りません：${bad.join("、")}。会社設定を直してください。` });
    }
  }

  // ── いちばん新しい月の明細の注意（最低賃金など）──
  const pays = await db.select().from(payrollsTable).where(inArray(payrollsTable.employeeId, ids));
  const latest = pays.reduce((m, p) => Math.max(m, ymKey(p.year, p.month)), -1);
  if (latest >= 0) {
    const ly = Math.floor(latest / 12), lm = (latest % 12) + 1;
    for (const p of pays.filter((x) => x.year === ly && x.month === lm && x.calcWarnings)) {
      const e = emps.find((x) => x.id === p.employeeId);
      if (!e) continue;
      let w: string[] = [];
      try { w = JSON.parse(p.calcWarnings!); } catch { /* 壊れた値は無視 */ }
      for (const msg of w.filter((m) => m.startsWith("最低賃金"))) {
        out.push({ key: `minwage:${e.id}:${ly}-${lm}`, level: "danger", employeeId: e.id, employeeName: nameOf(e.name), href: `/payroll/${p.id}`,
          title: `${nameOf(e.name)}さんの${lm}月分が最低賃金を下回っています`, body: msg });
      }
    }

    // ── ブルーウィングの固定残業代 ──
    const allows = await db.select().from(employeeMonthAllowancesTable).where(inArray(employeeMonthAllowancesTable.employeeId, ids));
    const recs = await db.select().from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, ids));
    for (const e of emps.filter((x) => x.useBluewingLogic && (x.bluewingFixedOvertimeHours ?? 0) > 0)) {
      const job = allows.filter((a) => a.employeeId === e.id && a.year === ly && a.month === lm && a.allowanceName.includes("職務手当")).reduce((s, a) => s + a.amount, 0);
      const fixedAmount = job > 0 ? job : (e.bluewingFixedOvertimeAmount ?? 0);
      const rec = recs.find((r) => r.employeeId === e.id && r.year === ly && r.month === lm);
      const rate = (e.overtimeHourlyRate ?? 0) > 0 ? e.overtimeHourlyRate! : (rec?.overtimeUnitPrice ?? 0);
      const short = fixedOvertimeShortfall(fixedAmount, e.bluewingFixedOvertimeHours ?? 0, rate);
      if (short > 0) {
        out.push({ key: `bwfixed:${e.id}:${ly}-${lm}:${fixedAmount}:${rate}`, level: "warn", employeeId: e.id, employeeName: nameOf(e.name), href: "/allowances",
          title: `${nameOf(e.name)}さんの固定残業代が足りません`,
          body: `固定残業代（職務手当）${fixedAmount.toLocaleString("ja-JP")}円は、${e.bluewingFixedOvertimeHours}時間 × 残業時給 ${rate.toLocaleString("ja-JP")}円 = ${Math.round((e.bluewingFixedOvertimeHours ?? 0) * rate).toLocaleString("ja-JP")}円に ${short.toLocaleString("ja-JP")}円 足りません。足りない固定残業代は、残業代を払ったことにならないおそれがあります。社労士に確認してください。` });
      }
    }
  }

  // ── 有給の年5日 ──
  // 勤怠の記録が始まる前の付与は、取得日数が分からないので知らせない（入社日が仮の値の人で全員に出てしまうため）
  try {
    const firstRec = await db.select({ employeeId: monthlyRecordsTable.employeeId, year: monthlyRecordsTable.year, month: monthlyRecordsTable.month })
      .from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, ids));
    for (const x of await paidLeaveFor(emps, todayIso)) {
      const first = firstRec.filter((r) => r.employeeId === x.employeeId).reduce((m, r) => Math.min(m, ymKey(r.year, r.month)), Infinity);
      for (const o of x.ledger.obligations) {
        if (!(ymKey(Number(o.grantDate.slice(0, 4)), Number(o.grantDate.slice(5, 7))) >= first)) continue;
        const left = Math.round((Date.parse(o.deadline) - today.getTime()) / DAY);
        if (o.shortage <= 0 || left > 90 || left < -60) continue;
        out.push({ key: `leave5:${x.employeeId}:${o.grantDate}`, level: left < 0 ? "danger" : "warn", employeeId: x.employeeId, employeeName: nameOf(x.employeeName), href: "/payroll-law",
          title: `${nameOf(x.employeeName)}さんの有給があと${o.shortage}日足りません（年5日）`,
          body: `${o.grantDate}に付与した有給は、${o.deadline}の前日までに5日取らせる必要があります（労基法39条7項）。いまは${o.taken}日。${left < 0 ? "期限を過ぎています。" : `期限まであと${left}日。`}入社日・週の所定日数が正しいか、社員の法令の情報も確かめてください。` });
      }
    }
  } catch { /* 有給の計算に失敗してもほかのお知らせは出す */ }

  // ── 算定基礎・月額変更の候補 ──
  try {
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth() + 1;
    for (const c of await reviewCandidates(emps, y)) {
      if (c.alreadyRegistered || c.standard === c.current) continue;
      if (c.kind === "teiji" && !(m >= 7 && m <= 9)) continue;
      out.push({ key: `review:${c.kind}:${c.employeeId}:${c.effectiveYear}-${c.effectiveMonth}:${c.standard}`, level: c.kind === "zuiji" ? "warn" : "info",
        employeeId: c.employeeId, employeeName: nameOf(c.employeeName), href: "/payroll-law",
        title: `${nameOf(c.employeeName)}さんの標準報酬月額の${c.kind === "teiji" ? "算定基礎（定時決定）" : "月額変更（随時改定）"}の候補があります`,
        body: `平均 ${c.average.toLocaleString("ja-JP")}円 → ${c.standard.toLocaleString("ja-JP")}円（いまは${c.current.toLocaleString("ja-JP")}円）。${c.effectiveYear}年${c.effectiveMonth}月分から。決めるのは年金事務所の決定通知です。法令の画面から履歴に入れられます。` });
    }
  } catch { /* 候補の計算に失敗してもほかのお知らせは出す */ }

  // ── 住民税の6月の切り替え（5〜6月）──
  const mm = today.getUTCMonth() + 1;
  if (mm === 5 || mm === 6) {
    const fy = today.getUTCFullYear();
    const rows = await db.select().from(residentTaxSchedulesTable).where(inArray(residentTaxSchedulesTable.employeeId, ids));
    const missing = emps.filter((e) => (e.residentTax ?? 0) > 0 && !rows.some((r) => r.employeeId === e.id && r.collectYear === fy && r.collectMonth === 6));
    if (missing.length) {
      out.push({ key: `residenttax:${fy}:${missing.length}`, level: "info", href: "/payroll-law",
        title: `6月から住民税の額が変わります（${missing.length}人がまだ）`,
        body: `特別徴収税額の決定通知書の12か月分（6月〜翌5月）を法令の画面に入れてください。6月分は「6月に払う給与」＝5月分の明細から引きます。${missing.map((e) => nameOf(e.name).split(" ")[0]).slice(0, 6).join("・")}` });
    }
  }

  // ── 乙欄・退職 ──
  for (const e of emps) {
    if (e.retirementDate && String(e.retirementDate) <= todayIso && e.isActive) {
      out.push({ key: `retired:${e.id}:${e.retirementDate}`, level: "info", employeeId: e.id, employeeName: nameOf(e.name), href: "/payroll-law",
        title: `${nameOf(e.name)}さんは${e.retirementDate}に退職しています`,
        body: "最後の明細の社会保険料・住民税の一括徴収・源泉徴収票（退職後1か月以内に本人へ）を確かめてください。社員マスターを「在籍していない」にするとお知らせが止まります。" });
    }
  }
  return out;
}
