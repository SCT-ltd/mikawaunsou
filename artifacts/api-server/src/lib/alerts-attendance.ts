import {
  db, employeesTable, attendanceRecordsTable, absenceRecordsTable, attendanceCorrectionsTable,
  dailyInspectionsTable, alcoholChecksTable, expenseClaimsTable, leaveRequestsTable,
} from "@workspace/db";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import type { EmployeeAlert } from "./alerts";
import { active, addDaysStr, jstDate, jstHour } from "./shift";
import { daysFrom, LIMITS } from "./compliance";
import { isFullDayAbsence } from "../routes/absences";
import { pushOnce, pushToEmployee } from "./push";
import { logger } from "./logger";
import { schedulesFor, comparePlan, planTimes } from "./schedules";
import { getAttendanceSettings } from "./attendance-settings";
import { purgeOldLocations } from "./geo";

/**
 * 勤怠まわりの「従業員のお知らせ」（右上のベル・ダッシュボード・PCのプッシュ通知）。
 * lib/alerts.ts の computeAlerts から呼ぶ。
 *   ・前の日から開いたままの勤務（退勤の打ち忘れ）・出勤の打ち忘れ
 *   ・改善基準告示の目安を超えた日（拘束13/15時間・休息11/9時間・連続4時間）と、月284時間・年3,300時間
 *   ・日常点検の「否」で、事務所がまだ判断していないもの
 *   ・アルコールの検知
 *   ・まだ決めていない打刻の修正申請
 *   ・1日休みなのに出勤もある日
 *   ・出勤の予定（シフト）を過ぎても出勤していない人（今日）
 */
const nameOf = (n: string) => n.replace(/[\s　]+/g, " ").trim();
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const hm = (m: number) => `${Math.floor(m / 60)}時間${String(Math.round(m % 60)).padStart(2, "0")}分`;

export async function computeAttendanceAlerts(): Promise<EmployeeAlert[]> {
  const out: EmployeeAlert[] = [];
  const now = new Date();
  const today = jstDate(now);
  const weekAgo = addDaysStr(today, -7);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearFrom = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10);

  const emps = await db.select({ id: employeesTable.id, name: employeesTable.name, isOfficeStaff: employeesTable.isOfficeStaff })
    .from(employeesTable).where(eq(employeesTable.isActive, true));
  if (emps.length === 0) return out;
  const ids = emps.map(e => e.id);
  const empOf = (id: number) => emps.find(e => e.id === id);

  const [recs, absences, corrections, inspections, alcohols] = await Promise.all([
    db.select({ employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType, workDate: attendanceRecordsTable.workDate, recordedAt: attendanceRecordsTable.recordedAt })
      .from(attendanceRecordsTable).where(and(gte(attendanceRecordsTable.workDate, addDaysStr(yearFrom, -3)), lte(attendanceRecordsTable.workDate, today), active, inArray(attendanceRecordsTable.employeeId, ids))),
    db.select().from(absenceRecordsTable).where(and(gte(absenceRecordsTable.workDate, addDaysStr(today, -31)), lte(absenceRecordsTable.workDate, today))),
    db.select({ id: attendanceCorrectionsTable.id, employeeId: attendanceCorrectionsTable.employeeId }).from(attendanceCorrectionsTable).where(eq(attendanceCorrectionsTable.status, "pending")),
    db.select().from(dailyInspectionsTable).where(gte(dailyInspectionsTable.workDate, addDaysStr(today, -2))),
    db.select().from(alcoholChecksTable).where(and(gte(alcoholChecksTable.workDate, addDaysStr(today, -2)), eq(alcoholChecksTable.detected, true))),
  ]);

  for (const e of emps) {
    const name = nameOf(e.name);
    const base = { employeeId: e.id, employeeName: name, href: "/attendance" };
    const mine = recs.filter(r => r.employeeId === e.id);
    // ── 打ち忘れ（直近7日・今日の勤務は除く） ──
    const byDate = new Map<string, typeof mine>();
    for (const r of mine) if (r.workDate >= weekAgo) { if (!byDate.has(r.workDate)) byDate.set(r.workDate, []); byDate.get(r.workDate)!.push(r); }
    for (const [d, rs] of byDate) {
      const hasIn = rs.some(r => r.eventType === "clock_in"), hasOut = rs.some(r => r.eventType === "clock_out");
      if (hasIn && !hasOut) {
        const inAt = new Date(rs.find(r => r.eventType === "clock_in")!.recordedAt).getTime();
        // 出勤から16時間たっても退勤していない勤務だけ（いま働いている人は出さない）
        if (now.getTime() - inAt > 16 * 3600_000) {
          out.push({ ...base, key: `noout:${e.id}:${d}`, level: "warn", title: `${name}さんの${md(d)}の退勤がありません`,
            body: "退勤の打ち忘れの可能性があります。この日は0時間で数えています。勤怠管理で退勤を入れてください（翌日の時刻も入れられます）。", date: d });
        }
      } else if (!hasIn && rs.length > 0) {
        out.push({ ...base, key: `noin:${e.id}:${d}`, level: "warn", title: `${name}さんの${md(d)}の出勤がありません`,
          body: "休憩・退勤だけ打刻されています。この日は数えていません。勤怠管理で出勤を入れてください。", date: d });
      }
    }
    if (e.isOfficeStaff) continue;
    // ── 改善基準告示の目安 ──
    const days = daysFrom(mine, yearFrom, today, now.getTime());
    const cont: string[] = [];
    for (const d of days.filter(x => x.date >= weekAgo)) {
      for (const f of d.flags) {
        // 連続4時間は打刻（ふつうはお昼の休憩1回だけ）からの推定なので、日ごとに出さず1件にまとめる（以前は毎日・全員に出て、71件中57件がこれだった）
        if (f.code === "cont4") { cont.push(d.date); continue; }
        out.push({ ...base, key: `kaizen:${e.id}:${d.date}:${f.code}`, level: f.level, title: `${name}さんの${md(d.date)}：${f.text}`,
          body: "トラック運転者の改善基準告示の目安を超えています（打刻からの推定）。運行の組み方を見直してください。", date: d.date });
      }
    }
    if (cont.length > 0) {
      const last = cont.sort()[cont.length - 1]!;
      out.push({ ...base, key: `kaizen-cont:${e.id}:${last}`, level: "info", title: `${name}さんは直近7日のうち${cont.length}日、休憩なしで4時間を超えて働いています（推定）`,
        body: `対象の日：${cont.sort().map(md).join("・")}。打刻はふつうお昼の休憩1回なので推定です。運転の合間に30分（10分以上に分けても可）の休憩をとっているか確かめてください。`, date: last });
    }
    const monthMin = days.filter(d => d.date >= monthStart).reduce((s, d) => s + d.restraintMinutes, 0);
    if (monthMin > LIMITS.monthRestraint) {
      out.push({ ...base, key: `kaizen-month:${e.id}:${today.slice(0, 7)}`, level: "danger", title: `${name}さんの今月の拘束が${hm(monthMin)}です`,
        body: "1か月の拘束時間は284時間まで（労使協定があれば310時間まで）です。" });
    } else if (monthMin > LIMITS.monthRestraint * 0.85) {
      out.push({ ...base, key: `kaizen-month-near:${e.id}:${today.slice(0, 7)}`, level: "warn", title: `${name}さんの今月の拘束が${hm(monthMin)}です（284時間に近づいています）`,
        body: "このままだと1か月の拘束時間の上限を超えます。" });
    }
    const yearMin = days.reduce((s, d) => s + d.restraintMinutes, 0);
    if (yearMin > LIMITS.yearRestraint) {
      out.push({ ...base, key: `kaizen-year:${e.id}:${today.slice(0, 7)}`, level: "danger", title: `${name}さんの直近12か月の拘束が${hm(yearMin)}です`,
        body: "1年の拘束時間は3,300時間まで（労使協定があれば3,400時間まで）です。" });
    }
  }

  // ── 日常点検の「否」（事務所の判断がまだ） ──
  for (const i of inspections) {
    const ng = (() => { try { return JSON.parse(i.ng) as string[]; } catch { return []; } })();
    if (ng.length === 0 || i.officeDecision) continue;
    const e = empOf(i.employeeId); if (!e) continue;
    out.push({ employeeId: e.id, employeeName: nameOf(e.name), href: "/attendance", key: `inspng:${i.id}`, level: "danger",
      title: `${nameOf(e.name)}さんの日常点検に「否」があります（${md(i.workDate)}）`,
      body: `${ng.join("・")}${i.vehicle ? `（${i.vehicle}）` : ""}。処置と、運行してよいかの判断を勤怠管理で記録してください。`, date: i.workDate });
  }
  // ── アルコールの検知 ──
  for (const a of alcohols) {
    out.push({ employeeId: a.employeeId, employeeName: nameOf(a.employeeName), href: "/attendance-records", key: `alcohol:${a.id}`, level: "danger",
      title: `${nameOf(a.employeeName)}さんのアルコールチェックで検知（${md(a.workDate)}・${a.valueMg ?? "?"} mg/L）`,
      body: "乗務させないでください。対応を記録に残してください。", date: a.workDate });
  }
  // ── 修正申請 ──
  if (corrections.length > 0) {
    out.push({ key: `corrections:${corrections.map(c => c.id).join(",")}`.slice(0, 200), level: "warn", href: "/attendance-records",
      title: `打刻の修正申請が${corrections.length}件あります`, body: "内容を確かめて、承認するか見送ってください。" });
  }
  // ── スタッフの申請（経費・立替・休み） ──
  const [pendExp, pendLeave] = await Promise.all([
    db.select({ id: expenseClaimsTable.id, amount: expenseClaimsTable.amount }).from(expenseClaimsTable).where(eq(expenseClaimsTable.status, "pending")),
    db.select({ id: leaveRequestsTable.id }).from(leaveRequestsTable).where(eq(leaveRequestsTable.status, "pending")),
  ]);
  if (pendExp.length > 0) {
    out.push({ key: `expenses:${pendExp.map(c => c.id).join(",")}`.slice(0, 200), level: "warn", href: "/attendance-records?tab=expenses",
      title: `経費・立替の申請が${pendExp.length}件あります（合計${pendExp.reduce((t, c) => t + c.amount, 0).toLocaleString("ja-JP")}円）`,
      body: "レシートを確かめて、承認するか見送ってください。承認すると給与と一緒に払います。" });
  }
  if (pendLeave.length > 0) {
    out.push({ key: `leaves:${pendLeave.map(c => c.id).join(",")}`.slice(0, 200), level: "warn", href: "/attendance-records?tab=leaves",
      title: `休みの申請が${pendLeave.length}件あります`, body: "内容を確かめて、承認するか見送ってください。" });
  }
  // ── 予定（シフト）を過ぎても出勤していない（今日） ──
  try {
    const settings = await getAttendanceSettings();
    if (settings.noShowAlert) {
      const schedules = await schedulesFor(ids, today, today);
      for (const e of emps) {
        const sch = schedules.get(`${e.id}:${today}`);
        const t = planTimes(today, sch);
        if (!t) continue;
        const inRec = recs.find(r => r.employeeId === e.id && r.workDate === today && r.eventType === "clock_in");
        const cmp = comparePlan(today, sch, inRec ? new Date(inRec.recordedAt).getTime() : null, null, {
          now: now.getTime(), today, graceMin: settings.lateGraceMinutes, noShowMin: settings.noShowAlertMinutes,
          hasFullDayAbsence: absences.some(a => a.employeeId === e.id && a.workDate === today && isFullDayAbsence(a.absenceType)),
        });
        // 予定の終わりを過ぎたら出さない（その日はもう遅い）
        if (!cmp.noShow || now.getTime() > t.end) continue;
        const name = nameOf(e.name);
        out.push({ employeeId: e.id, employeeName: name, href: `/attendance?emp=${e.id}`, key: `noshow:${e.id}:${today}`, level: "warn",
          title: `${name}さんが出勤していません（予定 ${sch!.start}〜）`,
          body: `予定の始まりから${settings.noShowAlertMinutes}分たっても出勤の打刻がありません。連絡を取ってください（休みなら勤怠管理で「欠勤・休暇登録」を入れると消えます）。`, date: today });
      }
    }
  } catch (err) { logger.warn({ err }, "出勤の予定のお知らせを作れませんでした"); }
  // ── 1日休みなのに出勤もある ──
  for (const a of absences) {
    if (!isFullDayAbsence(a.absenceType)) continue;
    if (!recs.some(r => r.employeeId === a.employeeId && r.workDate === a.workDate && r.eventType === "clock_in")) continue;
    const e = empOf(a.employeeId); if (!e) continue;
    out.push({ employeeId: e.id, employeeName: nameOf(e.name), href: "/attendance", key: `absconflict:${a.id}`, level: "warn",
      title: `${nameOf(e.name)}さんの${md(a.workDate)}は休みと出勤の両方が入っています`, body: "どちらが正しいか確かめて、違う方を消してください。", date: a.workDate });
  }
  return out;
}

// ── 毎朝：前の日から開いたままの勤務を本人のスマホに知らせる ──────────────────
// 事務所へは「従業員のお知らせ」（ベルとPCのプッシュ）で届く（alerts.ts の1時間ごとの見直し）。
async function morningOpenShiftPush(): Promise<void> {
  const now = new Date();
  if (jstHour(now) < 7) return;
  const today = jstDate(now);
  const recs = await db.select({ employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType, workDate: attendanceRecordsTable.workDate, recordedAt: attendanceRecordsTable.recordedAt })
    .from(attendanceRecordsTable).where(and(gte(attendanceRecordsTable.workDate, addDaysStr(today, -2)), lte(attendanceRecordsTable.workDate, addDaysStr(today, -1)), active));
  const seen = new Set<string>();
  for (const r of recs.filter(x => x.eventType === "clock_in")) {
    const key = `${r.employeeId}:${r.workDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (recs.some(x => x.employeeId === r.employeeId && x.workDate === r.workDate && x.eventType === "clock_out")) continue;
    if (now.getTime() - new Date(r.recordedAt).getTime() < 16 * 3600_000) continue; // まだ働いているかもしれない
    await pushOnce(`emp-noout:${r.employeeId}:${r.workDate}`, () => pushToEmployee(r.employeeId, {
      title: `${md(r.workDate)}の退勤が押されていません`,
      body: "退勤の打ち忘れの可能性があります。打刻ページの「打刻の修正を申請」から、退勤した時刻を申請してください。",
      url: `/driver/${r.employeeId}`,
    }));
  }
}

let started = false;
export function startAttendanceJobs(): void {
  if (started) return;
  started = true;
  const run = () => {
    morningOpenShiftPush().catch((err) => logger.warn({ err }, "退勤の打ち忘れの知らせに失敗"));
    // 地図：残す日数を過ぎた位置の記録を消す（中で1日1回に絞っている）
    purgeOldLocations().catch((err) => logger.warn({ err }, "古い位置の記録を消せませんでした"));
  };
  setTimeout(run, 90_000);
  setInterval(run, 30 * 60_000);
}
