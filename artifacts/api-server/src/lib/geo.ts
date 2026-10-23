import { db, locationPointsTable, placesTable, placeVisitsTable, attendanceRecordsTable, liveLocationsTable, employeesTable } from "@workspace/db";
import { and, eq, gte, lte, lt, isNull, asc, desc, inArray } from "drizzle-orm";
import { active, addDaysStr, currentShiftDates, jstDate, stateOf } from "./shift";
import { getAttendanceSettings } from "./attendance-settings";
import { logger } from "./logger";
import type { EmployeeAlert } from "./alerts";

/**
 * リアルタイムマップの裏側：位置の記録・場所への到着と出発・1日の道すじ・走行距離の目安・長く止まっている場所。
 *
 *  - 打刻ページは勤務中だけ15秒ごとに位置を送る（POST /attendance/location/live）。
 *    そのうち「前に残した点から1分たった／30m動いた」ものだけを location_points に残す（毎回残すと1日6千点になる）。
 *  - 精度が悪い点（±200m超）は道すじにも到着の判定にも使わない（ビルの谷間などで飛ぶため）。
 *  - 場所は半径の中に入ったら到着、半径＋30m より外に出たら出発（境目でぱたぱた切り替わらないように）。
 *  - 走行距離は点と点の直線距離の合計＝目安（道なりではない）。止まっている間の小さな揺れは数えない。
 */

const R = 6371000;
export function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const MAX_ACC = 200;          // これより精度が悪い点は使わない（m）
const KEEP_EVERY_MS = 60_000; // 前に残した点から1分たったら残す
const KEEP_MOVE_M = 30;       // または30m動いたら残す
const LEAVE_MARGIN_M = 30;    // 半径＋この距離より外に出たら「出発」
const STOP_RADIUS_M = 80;     // この範囲にとどまっていたら「止まっている」

/** 社員ごとに前に残した点（毎回DBに聞かないように覚えておく） */
const lastKept = new Map<number, { lat: number; lng: number; at: number }>();

let placeCache: { at: number; rows: Array<typeof placesTable.$inferSelect> } | null = null;
export function forgetPlaces() { placeCache = null; }
async function activePlaces() {
  if (placeCache && Date.now() - placeCache.at < 60_000) return placeCache.rows;
  const rows = await db.select().from(placesTable).where(eq(placesTable.active, true));
  placeCache = { at: Date.now(), rows };
  return rows;
}

/** いま勤務中（出勤〜退勤）か。勤務の日付も返す */
export async function dutyOf(employeeIds: number[], at = new Date()): Promise<Map<number, { date: string; onDuty: boolean; state: string }>> {
  const dates = await currentShiftDates(employeeIds, at);
  const ds = [...new Set(dates.values())];
  const recs = ds.length === 0 ? [] : await db.select({ employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType, workDate: attendanceRecordsTable.workDate })
    .from(attendanceRecordsTable)
    .where(and(inArray(attendanceRecordsTable.workDate, ds), inArray(attendanceRecordsTable.employeeId, employeeIds), active))
    .orderBy(asc(attendanceRecordsTable.recordedAt), asc(attendanceRecordsTable.id));
  const out = new Map<number, { date: string; onDuty: boolean; state: string }>();
  for (const id of employeeIds) {
    const date = dates.get(id) ?? jstDate(at);
    const st = stateOf(recs.filter((r) => r.employeeId === id && r.workDate === date));
    out.set(id, { date, onDuty: st === "working" || st === "break", state: st });
  }
  return out;
}

/**
 * 届いた位置を受け取る。返り値の stored＝道すじに残したか。
 * 勤務時間の外（設定で「勤務中だけ」のとき）は、いまの位置も道すじも残さない。
 */
export async function ingestLocation(employeeId: number, lat: number, lng: number, acc: number | null, at = new Date()): Promise<{ accepted: boolean; stored: boolean }> {
  const s = await getAttendanceSettings();
  const duty = (await dutyOf([employeeId], at)).get(employeeId)!;
  if (s.mapTrackOnlyOnDuty && !duty.onDuty) return { accepted: false, stored: false };
  await db.insert(liveLocationsTable)
    .values({ employeeId, latitude: lat, longitude: lng, accuracy: acc, updatedAt: at })
    .onConflictDoUpdate({ target: liveLocationsTable.employeeId, set: { latitude: lat, longitude: lng, accuracy: acc, updatedAt: at } });
  if (acc != null && acc > MAX_ACC) return { accepted: true, stored: false };

  let stored = false;
  let last = lastKept.get(employeeId);
  if (!last) {
    // サーバーを立ち上げ直した直後は覚えていないので、その日の最後の点を読む
    const [lp] = await db.select().from(locationPointsTable)
      .where(and(eq(locationPointsTable.employeeId, employeeId), eq(locationPointsTable.workDate, duty.date)))
      .orderBy(desc(locationPointsTable.recordedAt)).limit(1);
    if (lp) last = { lat: lp.latitude, lng: lp.longitude, at: new Date(lp.recordedAt).getTime() };
  }
  if (!last || at.getTime() - last.at >= KEEP_EVERY_MS || distM(last.lat, last.lng, lat, lng) >= KEEP_MOVE_M) {
    await db.insert(locationPointsTable).values({ employeeId, workDate: duty.date, latitude: lat, longitude: lng, accuracy: acc, recordedAt: at });
    lastKept.set(employeeId, { lat, lng, at: at.getTime() });
    stored = true;
  }

  // ── 場所への到着・出発 ──
  try {
    const places = await activePlaces();
    const open = await db.select().from(placeVisitsTable).where(and(eq(placeVisitsTable.employeeId, employeeId), isNull(placeVisitsTable.leftAt)));
    for (const v of open) {
      const p = places.find((x) => x.id === v.placeId);
      if (!p || distM(p.latitude, p.longitude, lat, lng) > p.radiusM + LEAVE_MARGIN_M) {
        await db.update(placeVisitsTable).set({ leftAt: at }).where(eq(placeVisitsTable.id, v.id));
      }
    }
    for (const p of places) {
      if (distM(p.latitude, p.longitude, lat, lng) > p.radiusM) continue;
      if (open.some((v) => v.placeId === p.id)) continue;
      await db.insert(placeVisitsTable).values({ employeeId, placeId: p.id, placeName: p.name, workDate: duty.date, arrivedAt: at });
    }
  } catch (err) { logger.warn({ err }, "場所への到着・出発を残せませんでした"); }
  return { accepted: true, stored };
}

/** 退勤したら、開いたままの到着を閉じる（打刻の処理から呼ぶ） */
export async function closeVisits(employeeId: number, at = new Date()): Promise<void> {
  await db.update(placeVisitsTable).set({ leftAt: at }).where(and(eq(placeVisitsTable.employeeId, employeeId), isNull(placeVisitsTable.leftAt)));
  lastKept.delete(employeeId);
}

export interface TrackPoint { lat: number; lng: number; at: string; acc: number | null }
export interface Stop { lat: number; lng: number; from: string; to: string; minutes: number; place: string | null; ongoing: boolean }

/** 点の並びから走行距離の目安（km）。止まっている間の揺れ（精度より小さい動き）は数えない */
export function distanceKm(points: TrackPoint[]): number {
  let m = 0;
  let prev: TrackPoint | null = null;
  for (const p of points) {
    if (prev) {
      const d = distM(prev.lat, prev.lng, p.lat, p.lng);
      const noise = Math.max(25, (prev.acc ?? 0) + (p.acc ?? 0));
      if (d < noise) continue; // 揺れ：前の点を据え置き、次と比べる
      m += d;
    }
    prev = p;
  }
  return Math.round(m / 100) / 10;
}

/** 止まっていたところ（80m以内に◯分以上） */
export function stopsOf(points: TrackPoint[], minMinutes: number, places: Array<{ name: string; latitude: number; longitude: number; radiusM: number }>, now = Date.now()): Stop[] {
  const out: Stop[] = [];
  if (minMinutes <= 0 || points.length === 0) return out;
  let i = 0;
  while (i < points.length) {
    const a = points[i]!;
    let j = i;
    while (j + 1 < points.length && distM(a.lat, a.lng, points[j + 1]!.lat, points[j + 1]!.lng) <= STOP_RADIUS_M) j++;
    const from = new Date(a.at).getTime();
    const last = j === points.length - 1;
    // 最後の点のあとも動いていなければ、いままで止まっている
    const to = last ? Math.max(new Date(points[j]!.at).getTime(), Math.min(now, new Date(points[j]!.at).getTime() + 5 * 60_000)) : new Date(points[j]!.at).getTime();
    const minutes = Math.round((to - from) / 60000);
    if (minutes >= minMinutes) {
      const place = places.find((p) => distM(p.latitude, p.longitude, a.lat, a.lng) <= p.radiusM + LEAVE_MARGIN_M)?.name ?? null;
      out.push({ lat: a.lat, lng: a.lng, from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes, place, ongoing: last && now - new Date(points[j]!.at).getTime() < 10 * 60_000 });
    }
    i = j + 1;
  }
  return out;
}

export async function pointsOf(employeeId: number, date: string): Promise<TrackPoint[]> {
  const rows = await db.select().from(locationPointsTable)
    .where(and(eq(locationPointsTable.employeeId, employeeId), eq(locationPointsTable.workDate, date)))
    .orderBy(asc(locationPointsTable.recordedAt));
  return rows.map((r) => ({ lat: r.latitude, lng: r.longitude, at: new Date(r.recordedAt).toISOString(), acc: r.accuracy }));
}

// ── お知らせ（右上のベル）：位置が届かない・長く止まっている ─────────────────
export async function computeMapAlerts(): Promise<EmployeeAlert[]> {
  const out: EmployeeAlert[] = [];
  const s = await getAttendanceSettings();
  const emps = await db.select({ id: employeesTable.id, name: employeesTable.name, isOfficeStaff: employeesTable.isOfficeStaff })
    .from(employeesTable).where(eq(employeesTable.isActive, true));
  // 事務員は位置を送らないので対象にしない
  const drivers = emps.filter((e) => !e.isOfficeStaff);
  if (drivers.length === 0) return out;
  const duty = await dutyOf(drivers.map((e) => e.id));
  const onDuty = drivers.filter((e) => duty.get(e.id)?.onDuty);
  if (onDuty.length === 0) return out;
  const live = await db.select().from(liveLocationsTable).where(inArray(liveLocationsTable.employeeId, onDuty.map((e) => e.id)));
  const places = await activePlaces();
  const now = Date.now();
  for (const e of onDuty) {
    const name = e.name.replace(/[\s　]+/g, " ").trim();
    const l = live.find((x) => x.employeeId === e.id);
    const date = duty.get(e.id)!.date;
    // 勤務中なのに位置が届かない（電池切れ・電波なし・打刻ページを閉じた）
    const age = l ? (now - new Date(l.updatedAt).getTime()) / 60000 : Infinity;
    if (age >= s.mapStaleMinutes) {
      out.push({ employeeId: e.id, employeeName: name, href: `/realtime-map?emp=${e.id}`, key: `map-stale:${e.id}:${date}`, level: "warn",
        title: `${name}さんの位置が${Number.isFinite(age) ? `${Math.round(age)}分` : "今日まだ"}届いていません`,
        body: "勤務中ですが、スマホの位置が届いていません。電池切れ・電波なし・打刻ページを閉じた可能性があります。連絡を取ってください。", date });
      continue;
    }
    // 登録した場所の外で長く止まっている
    if (s.mapLongStopMinutes > 0) {
      const stops = stopsOf(await pointsOf(e.id, date), s.mapLongStopMinutes, places, now);
      const cur = stops.at(-1);
      if (cur && cur.ongoing && !cur.place) {
        out.push({ employeeId: e.id, employeeName: name, href: `/realtime-map?emp=${e.id}`, key: `map-stop:${e.id}:${cur.from}`, level: "info",
          title: `${name}さんが同じ場所で${cur.minutes}分止まっています`,
          body: "登録した場所の外で長く止まっています。予定どおりか確かめてください（よく行く場所なら、地図で「場所」に登録すると知らせなくなります）。", date });
      }
    }
  }
  return out;
}

// ── 残す日数を過ぎた位置の記録を消す（1日1回） ─────────────────────────
let lastPurge = 0;
export async function purgeOldLocations(): Promise<number> {
  if (Date.now() - lastPurge < 12 * 3600_000) return 0;
  lastPurge = Date.now();
  const s = await getAttendanceSettings();
  const cutoff = addDaysStr(jstDate(), -s.mapRetentionDays);
  const del = await db.delete(locationPointsTable).where(lt(locationPointsTable.workDate, cutoff)).returning({ id: locationPointsTable.id });
  if (del.length) logger.info({ count: del.length, cutoff }, "残す日数を過ぎた位置の記録を消しました");
  return del.length;
}

/** 月の走行距離の目安（日ごと）と、月次実績に入っている走行距離 */
export async function monthDistance(employeeId: number, ym: string): Promise<Array<{ date: string; km: number }>> {
  const from = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows = await db.select().from(locationPointsTable)
    .where(and(eq(locationPointsTable.employeeId, employeeId), gte(locationPointsTable.workDate, from), lte(locationPointsTable.workDate, to)))
    .orderBy(asc(locationPointsTable.recordedAt));
  const byDay = new Map<string, TrackPoint[]>();
  for (const r of rows) {
    const d = String(r.workDate);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push({ lat: r.latitude, lng: r.longitude, at: new Date(r.recordedAt).toISOString(), acc: r.accuracy });
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, pts]) => ({ date, km: distanceKm(pts) }));
}
