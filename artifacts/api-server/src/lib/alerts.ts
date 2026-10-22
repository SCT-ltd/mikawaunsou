import webpush from "web-push";
import {
  db,
  employeesTable,
  monthlyRecordsTable,
  payrollsTable,
  standardRemunerationHistoryTable,
  pushSubscriptionsTable,
  alertPushesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { computeAttendanceAlerts } from "./alerts-attendance";
import fs from "fs/promises";
import path from "path";

/**
 * 従業員のお知らせ。社員マスター・月次実績・明細から、事務所が対応しておくべきことを作る。
 * 保存はせず毎回作り直す（読んだ印とプッシュ済みの印だけ DB に持つ）。
 *
 * 年齢の節目は「その歳になる日の前日（＝法律上の年齢到達日）」の月で切り替わる。
 *   40歳：その月分から介護保険料がかかる
 *   65歳：その月分から介護保険料がかからない
 *   70歳：その月分から厚生年金保険料を引かない（雇用保険・健康保険は続く）
 *   75歳：その月分から健康保険（協会けんぽ）を外れ、後期高齢者医療制度へ
 */

export type AlertLevel = "danger" | "warn" | "info";

export interface EmployeeAlert {
  key: string;
  level: AlertLevel;
  title: string;
  body: string;
  employeeId?: number;
  employeeName?: string;
  /** 押したときに開く画面 */
  href: string;
  /** 期日（年齢の節目など）。並べ替えと「あと◯日」に使う */
  date?: string;
  daysLeft?: number;
}

const DAY = 86_400_000;
/** 節目のお知らせを出し始める日数（前）と、出し続ける日数（後） */
const BEFORE_DAYS = 60;
const AFTER_DAYS = 45;

/** 日本時間の今日（UTC の 0時で表す） */
function jstToday(): Date {
  const now = new Date(Date.now() + 9 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseDob(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const p = s.split(/[-/]/).map(Number);
  if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
  return { y: p[0]!, m: p[1]!, d: p[2]! };
}

/** その歳になる日の前日（年齢到達日） */
export function reachDate(dob: string | null | undefined, age: number): Date | null {
  const b = parseDob(dob);
  if (!b) return null;
  const r = new Date(Date.UTC(b.y + age, b.m - 1, b.d));
  r.setUTCDate(r.getUTCDate() - 1);
  return r;
}

const ymOf = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const fmtDate = (d: Date) => `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
const fmtMonth = (d: Date) => `${d.getUTCMonth() + 1}月分`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const nameOf = (n: string) => n.replace(/[\s　]+/g, " ").trim();

const LEVEL_ORDER: Record<AlertLevel, number> = { danger: 0, warn: 1, info: 2 };

export async function computeAlerts(): Promise<EmployeeAlert[]> {
  const today = jstToday();
  const nowYm = ymOf(today);
  const [emps, history] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.isActive, true)),
    db.select({ employeeId: standardRemunerationHistoryTable.employeeId }).from(standardRemunerationHistoryTable),
  ]);
  const hasHistory = new Set(history.map((h) => h.employeeId));
  const out: EmployeeAlert[] = [];
  const MASTER = "/allowances";

  for (const e of emps) {
    const name = nameOf(e.name);
    // お知らせから、その社員の編集をそのまま開く（社員マスターは ?emp= で開く）
    const base = { employeeId: e.id, employeeName: name, href: `${MASTER}?emp=${e.id}` };

    if (!parseDob(e.dateOfBirth)) {
      out.push({ ...base, key: `nodob:${e.id}`, level: "info", title: `${name}さんの生年月日が未入力です`,
        body: "介護保険（40歳・65歳）や厚生年金（70歳）の切り替えをお知らせできません。社員マスターに入れてください。" });
    }
    if ((e.standardRemuneration ?? 0) <= 0 && !hasHistory.has(e.id) && !e.taxExempt) {
      out.push({ ...base, key: `nostd:${e.id}`, level: "warn", title: `${name}さんの標準報酬月額が未設定です`,
        body: "保険料が総支給額から計算されています。決定通知書の金額を社員マスターに入れてください。" });
    }

    const r40 = reachDate(e.dateOfBirth, 40);
    const r65 = reachDate(e.dateOfBirth, 65);
    const r70 = reachDate(e.dateOfBirth, 70);
    const r75 = reachDate(e.dateOfBirth, 75);
    if (!r40 || !r65 || !r70 || !r75) continue;

    const careShould = nowYm >= ymOf(r40) && nowYm < ymOf(r65);
    const careOn = e.careInsuranceApplied === true;
    let careNoticed = false;

    const milestone = (age: number, r: Date, make: (left: number, when: string) => Omit<EmployeeAlert, "key" | "date" | "daysLeft" | "employeeId" | "employeeName" | "href">) => {
      const left = Math.round((r.getTime() - today.getTime()) / DAY);
      if (left > BEFORE_DAYS || left < -AFTER_DAYS) return false;
      const when = left > 0 ? `あと${left}日で${age}歳` : left === 0 ? `今日で${age}歳` : `${age}歳になりました`;
      out.push({ ...base, key: `age${age}:${e.id}:${iso(r)}`, date: iso(r), daysLeft: left, ...make(left, when) });
      return true;
    };

    if (milestone(40, r40, (_l, when) => ({
      level: careOn ? "info" : "warn",
      title: `${name}さんは${when}（${fmtDate(r40)}）`,
      body: `${fmtMonth(r40)}から介護保険料がかかります。` + (careOn
        ? "社員マスターの「介護保険」はONになっています。"
        : `${fmtMonth(r40)}の給与を計算する前に、社員マスターの「介護保険」をONにしてください。`),
    }))) careNoticed = true;

    if (milestone(65, r65, (_l, when) => ({
      level: careOn ? "warn" : "info",
      title: `${name}さんは${when}（${fmtDate(r65)}）`,
      body: `${fmtMonth(r65)}から介護保険料がかからなくなります。` + (careOn
        ? `${fmtMonth(r65)}の給与を計算する前に、社員マスターの「介護保険」をOFFにしてください。`
        : "社員マスターの「介護保険」はOFFになっています。"),
    }))) careNoticed = true;

    const pensionForced = e.pensionApplied === true;
    milestone(70, r70, (_l, when) => ({
      level: pensionForced ? "warn" : "info",
      title: `${name}さんは${when}（${fmtDate(r70)}）`,
      body: `${fmtMonth(r70)}から厚生年金保険料を引きません。` + (pensionForced
        ? "社員マスターの「厚生年金」が「適用する」に固定されているため止まりません。「自動」に戻してください。"
        : "システムが自動で止めます。") + "雇用保険・健康保険はそのまま続きます。",
    }));

    milestone(75, r75, (_l, when) => ({
      level: "warn",
      title: `${name}さんは${when}（${fmtDate(r75)}）`,
      body: `${fmtMonth(r75)}から健康保険（協会けんぽ）を外れ、後期高齢者医療制度に移ります。` +
        "このシステムは健康保険料を自動では止めません。手続きと控除の扱いを社労士に確認してください。",
    }));

    // 節目のお知らせが出ていない人で、介護保険の設定が年齢と合わないもの
    if (!careNoticed && careOn !== careShould) {
      out.push({ ...base, key: `care:${e.id}:${careShould ? "on" : "off"}`, level: "warn",
        title: `${name}さんの介護保険の設定を確認してください`,
        body: careShould
          ? "40歳以上65歳未満ですが、社員マスターの「介護保険」がOFFです。"
          : "40歳未満または65歳以上ですが、社員マスターの「介護保険」がONです。介護保険料が引かれています。" });
    }
    if (pensionForced && nowYm >= ymOf(r70) && !(Math.abs(r70.getTime() - today.getTime()) / DAY <= BEFORE_DAYS)) {
      out.push({ ...base, key: `pension70:${e.id}`, level: "warn", title: `${name}さんの厚生年金の設定を確認してください`,
        body: "70歳以上ですが、社員マスターの「厚生年金」が「適用する」に固定されています。" });
    }
    if (nowYm >= ymOf(r75) && Math.round((today.getTime() - r75.getTime()) / DAY) > AFTER_DAYS) {
      out.push({ ...base, key: `age75over:${e.id}`, level: "warn", title: `${name}さんは75歳以上です`,
        body: "健康保険（協会けんぽ）の対象外です。健康保険料を引いていないか確認してください。" });
    }
  }

  // ── バックアップが取れているか（api に BACKUP_DIR が渡されているときだけ）──
  // 以前は失敗しても誰にも届かず、次の日まで取り直さなかった。36時間取れていなければ至急で知らせる。
  const dir = process.env["BACKUP_DIR"];
  if (dir) {
    let newest = 0;
    try {
      for (const name of await fs.readdir(dir)) {
        if (!/^mikawa-d{8}-d{6}.dump$/.test(name)) continue;
        const st = await fs.stat(path.join(dir, name));
        if (st.size > 1024) newest = Math.max(newest, st.mtimeMs);
      }
    } catch { /* フォルダが読めない＝取れていない扱い */ }
    const hours = newest ? Math.floor((Date.now() - newest) / 3_600_000) : Infinity;
    if (hours > 36) {
      out.push({ key: `backup:${iso(today)}`, level: "danger", href: "/",
        title: newest ? `データのバックアップが${hours}時間取れていません` : "データのバックアップが見つかりません",
        body: "毎日3時に自動で取っています。NAS の db-backup の記録を確かめてください。直るまで、給与の確定などの大きな作業は控えてください。" });
    }
  }

  // ── 暗証番号が未設定（QR の打刻ページでメッセージ・スマホの通知が使えない）──
  const noPin = emps.filter((e) => !e.pin);
  if (noPin.length > 0) {
    const names = noPin.map((e) => nameOf(e.name).split(" ")[0]).slice(0, 6).join("・");
    out.push({ key: `nopin:${noPin.map((e) => e.id).join(",")}`, level: "info", href: MASTER,
      title: `暗証番号が未設定の人が${noPin.length}人います`,
      body: `${names}${noPin.length > 6 ? " ほか" : ""}。打刻はできますが、事務所とのメッセージとスマホの通知が使えません。社員マスターで設定してください。` });
  }

  // ── 残業（いちばん新しい月の実績）──
  const empIds = emps.map((e) => e.id);
  if (empIds.length > 0) {
    const recs = await db.select({
      employeeId: monthlyRecordsTable.employeeId, year: monthlyRecordsTable.year, month: monthlyRecordsTable.month,
      overtimeHours: monthlyRecordsTable.overtimeHours,
    }).from(monthlyRecordsTable).where(inArray(monthlyRecordsTable.employeeId, empIds));
    const latest = recs.reduce((m, r) => Math.max(m, r.year * 12 + r.month - 1), -1);
    if (latest >= 0) {
      const ly = Math.floor(latest / 12), lm = (latest % 12) + 1;
      for (const r of recs.filter((x) => x.year === ly && x.month === lm)) {
        const h = r.overtimeHours ?? 0;
        if (h <= 45) continue;
        const e = emps.find((x) => x.id === r.employeeId)!;
        const name = nameOf(e.name);
        out.push({ key: `ot:${e.id}:${ly}-${lm}`, level: h > 80 ? "danger" : "warn", employeeId: e.id, employeeName: name, href: `/monthly-input?y=${ly}&m=${lm}&emp=${e.id}`,
          title: `${name}さんの${lm}月の残業が${h}時間です`,
          body: h > 80
            ? "80時間を超えています。長時間労働の面談（医師の面接指導）の対象になりえます。"
            : "月45時間を超えています（36協定の原則の上限）。年6回までの特別条項の範囲か確認してください。" });
      }
    }
  }

  // ── 先月分の明細が確定していない ──
  const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1;
  const drafts = await db.select({ id: payrollsTable.id }).from(payrollsTable)
    .where(and(eq(payrollsTable.year, py), eq(payrollsTable.month, pm), eq(payrollsTable.status, "draft")));
  if (drafts.length > 0) {
    out.push({ key: `drafts:${py}-${pm}`, level: "info", href: `/payroll?y=${py}&m=${pm}`,
      title: `${pm}月分の給与明細が${drafts.length}件、未確定です`,
      body: "金額を確かめて「確定」してください。" });
  }

  out.push(...(await computeAttendanceAlerts().catch((err) => { logger.warn({ err }, "勤怠のお知らせを作れませんでした"); return []; })));

  return out.sort((a, b) =>
    LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
    (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) ||
    a.key.localeCompare(b.key));
}

// ── PCのプッシュ通知（事務所の購読へ）──────────────────────────────────
// 1時間ごとに作り直し、まだ送っていない「要対応（warn/danger）」があれば1通にまとめて送る。
async function pushNewAlerts(): Promise<void> {
  const vapidPublicKey = process.env["VAPID_PUBLIC_KEY"];
  const vapidPrivateKey = process.env["VAPID_PRIVATE_KEY"];
  if (!vapidPublicKey || !vapidPrivateKey) return;
  const alerts = (await computeAlerts()).filter((a) => a.level !== "info");
  if (alerts.length === 0) return;
  const sent = await db.select({ key: alertPushesTable.key }).from(alertPushesTable)
    .where(inArray(alertPushesTable.key, alerts.map((a) => a.key)));
  const sentKeys = new Set(sent.map((s) => s.key));
  const fresh = alerts.filter((a) => !sentKeys.has(a.key));
  if (fresh.length === 0) return;

  const subs = await db.select().from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.role, "office"), eq(pushSubscriptionsTable.active, true)));
  const payload = JSON.stringify({
    title: fresh.length === 1 ? "従業員のお知らせ" : `従業員のお知らせ（${fresh.length}件）`,
    body: fresh.slice(0, 2).map((a) => a.title).join("\n") + (fresh.length > 2 ? `\nほか${fresh.length - 2}件` : ""),
    url: "/",
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db.update(pushSubscriptionsTable).set({ active: false }).where(eq(pushSubscriptionsTable.id, sub.id));
      }
    }
  }
  // 購読がまだ無くても「送った」にする（あとで購読したときに古いお知らせがまとめて届かないように）
  await db.insert(alertPushesTable).values(fresh.map((a) => ({ key: a.key }))).onConflictDoNothing();
  logger.info({ count: fresh.length, subscribers: subs.length }, "従業員のお知らせをプッシュ通知しました");
}

let started = false;
export function startAlertJob(): void {
  if (started) return;
  started = true;
  const run = () => { pushNewAlerts().catch((err) => logger.warn({ err }, "従業員のお知らせのプッシュ通知に失敗")); };
  setTimeout(run, 60_000);
  setInterval(run, 60 * 60_000);
}
