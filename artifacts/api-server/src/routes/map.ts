import { Router } from "express";
import { db, placesTable, placeVisitsTable, attendanceRecordsTable, monthlyRecordsTable, employeesTable } from "@workspace/db";
import { and, eq, asc, desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";
import { active, jstDate } from "../lib/shift";
import { getAttendanceSettings } from "../lib/attendance-settings";
import { pointsOf, distanceKm, stopsOf, monthDistance, forgetPlaces, activePlaces } from "../lib/geo";
import { paramStr } from "../lib/params";
import { geocode } from "../lib/geocode";

/**
 * リアルタイムマップの窓口（管理画面だけ）。
 *   GET    /map/track?employeeId=&date=        … 1日の道すじ・走行距離の目安・止まっていたところ・場所への到着と出発・打刻
 *   GET    /map/track/month?employeeId=&ym=    … 月の走行距離の目安（日ごと）と、月次実績の走行距離
 *   GET    /map/visits?date=                   … その日の全員の到着・出発（日報の確認に）
 *   GET/POST/PUT/DELETE /map/places            … 取引先・よく行く場所（荷主・現場・営業所など。マスター管理の「取引先」と同じ）
 *   GET    /map/geocode?q=住所                  … 住所から位置を探す（国土地理院の住所検索）
 */
const router = Router();
router.use("/map", requireAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["site", "office", "shipper", "other"];

router.get("/map/track", async (req, res) => {
  const employeeId = Number(req.query["employeeId"]);
  const date = typeof req.query["date"] === "string" && DATE_RE.test(req.query["date"]) ? req.query["date"] : jstDate();
  if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ error: "社員を選んでください" });
  const s = await getAttendanceSettings();
  const [points, visits, events, places] = await Promise.all([
    pointsOf(employeeId, date),
    db.select().from(placeVisitsTable).where(and(eq(placeVisitsTable.employeeId, employeeId), eq(placeVisitsTable.workDate, date))).orderBy(asc(placeVisitsTable.arrivedAt)),
    db.select().from(attendanceRecordsTable).where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.workDate, date), active)).orderBy(asc(attendanceRecordsTable.recordedAt)),
    activePlaces(),
  ]);
  return res.json({
    date, points,
    distanceKm: distanceKm(points),
    stops: stopsOf(points, Math.max(10, s.mapLongStopMinutes || 15), places),
    visits: visits.map((v) => ({ id: v.id, placeId: v.placeId, placeName: v.placeName, arrivedAt: v.arrivedAt, leftAt: v.leftAt,
      minutes: Math.round(((v.leftAt ? new Date(v.leftAt).getTime() : Date.now()) - new Date(v.arrivedAt).getTime()) / 60000) })),
    events: events.map((r) => ({ eventType: r.eventType, recordedAt: r.recordedAt, latitude: r.latitude, longitude: r.longitude })),
    retentionDays: s.mapRetentionDays,
  });
});

router.get("/map/track/month", async (req, res) => {
  const employeeId = Number(req.query["employeeId"]);
  const ym = typeof req.query["ym"] === "string" && /^\d{4}-\d{2}$/.test(req.query["ym"]) ? req.query["ym"] : jstDate().slice(0, 7);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ error: "社員を選んでください" });
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const [days, [rec]] = await Promise.all([
    monthDistance(employeeId, ym),
    db.select({ km: monthlyRecordsTable.drivingDistanceKm }).from(monthlyRecordsTable)
      .where(and(eq(monthlyRecordsTable.employeeId, employeeId), eq(monthlyRecordsTable.year, y), eq(monthlyRecordsTable.month, m))),
  ]);
  const totalKm = Math.round(days.reduce((s, d) => s + d.km, 0) * 10) / 10;
  return res.json({ ym, days, totalKm, monthlyRecordKm: rec?.km ?? null });
});

router.get("/map/visits", async (req, res) => {
  const date = typeof req.query["date"] === "string" && DATE_RE.test(req.query["date"]) ? req.query["date"] : jstDate();
  const rows = await db.select({ v: placeVisitsTable, name: employeesTable.name }).from(placeVisitsTable)
    .leftJoin(employeesTable, eq(employeesTable.id, placeVisitsTable.employeeId))
    .where(eq(placeVisitsTable.workDate, date)).orderBy(desc(placeVisitsTable.arrivedAt));
  return res.json(rows.map(({ v, name }) => ({ ...v, employeeName: name })));
});

// ── 取引先・よく行く場所（マスター管理の「取引先」と地図の「場所」は同じもの） ──────────
// 位置の決め方：①地図で押した位置（latitude/longitude を送る） ②住所から国土地理院の住所検索で出す
//   PUT で位置を送らなければ、今の位置のまま（locate:"address" のときだけ住所から出し直す）。
type PlaceIn = { name?: unknown; kind?: unknown; latitude?: unknown; longitude?: unknown; geoSource?: unknown; geoLabel?: unknown; locate?: unknown;
  radiusM?: unknown; address?: unknown; note?: unknown; phone?: unknown; contact?: unknown };
type PlaceVals = { name: string; kind: string; radiusM: number; address: string | null; note: string | null; phone: string | null; contact: string | null };
function placeOf(b: PlaceIn): { ok: true; v: PlaceVals; at: { lat: number; lng: number; source: string; label: string | null } | null } | { ok: false; error: string } {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 60) return { ok: false, error: "名前を入れてください（60文字まで）" };
  const r = Math.round(Number(b.radiusM ?? 150));
  if (!Number.isFinite(r) || r < 30 || r > 2000) return { ok: false, error: "範囲は30〜2000mで入れてください" };
  const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : "site";
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const phone = str(b.phone, 20);
  if (phone && !/^[0-9０-９+\-（）() ー−]{6,20}$/.test(phone)) return { ok: false, error: "電話番号は数字とハイフンで入れてください" };
  let at: { lat: number; lng: number; source: string; label: string | null } | null = null;
  if (b.latitude != null && b.longitude != null && b.latitude !== "" && b.longitude !== "") {
    const lat = Number(b.latitude), lng = Number(b.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: "位置が正しくありません" };
    at = { lat, lng, source: b.geoSource === "gsi" ? "gsi" : "manual", label: str(b.geoLabel, 120) };
  }
  return { ok: true, at, v: { name, kind, radiusM: r, address: str(b.address, 200), note: str(b.note, 500), phone, contact: str(b.contact, 60) } };
}
/** 住所から位置を出す。出せなければ null（取引先は位置なしで登録する） */
async function locateByAddress(address: string | null) {
  if (!address) return null;
  const hit = await geocode(address);
  return hit ? { lat: hit.lat, lng: hit.lng, source: "gsi", label: hit.label } : null;
}
const geoCols = (at: { lat: number; lng: number; source: string; label: string | null } | null) =>
  at ? { latitude: at.lat, longitude: at.lng, geoSource: at.source, geoLabel: at.label } : { latitude: null, longitude: null, geoSource: null, geoLabel: null };

router.get("/map/places", async (_req, res) => {
  res.json(await db.select().from(placesTable).where(eq(placesTable.active, true)).orderBy(asc(placesTable.name)));
});
// 住所から位置を探す（登録の前に確かめる用）
router.get("/map/geocode", async (req, res) => {
  const q = typeof req.query["q"] === "string" ? req.query["q"].slice(0, 200) : "";
  if (!q.trim()) return res.status(400).json({ error: "住所を入れてください" });
  const hit = await geocode(q);
  if (!hit) return res.status(404).json({ error: "住所から位置が見つかりませんでした。都道府県から入れ直すか、地図で位置を決めてください。" });
  return res.json(hit);
});
router.post("/map/places", async (req, res) => {
  const p = placeOf((req.body ?? {}) as PlaceIn);
  if (!p.ok) return res.status(400).json({ error: p.error });
  const at = p.at ?? (await locateByAddress(p.v.address));
  const [row] = await db.insert(placesTable).values({ ...p.v, ...geoCols(at), updatedAt: new Date(), createdAt: new Date() }).returning();
  forgetPlaces();
  return res.status(201).json({ ...row, located: !!at });
});
router.put("/map/places/:id", async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const b = (req.body ?? {}) as PlaceIn;
  const p = placeOf(b);
  if (!p.ok) return res.status(400).json({ error: p.error });
  const [cur] = await db.select().from(placesTable).where(and(eq(placesTable.id, id), eq(placesTable.active, true)));
  if (!cur) return res.status(404).json({ error: "見つかりません" });
  // 送られてこなかった項目は今のまま（地図の「場所」から直したとき、電話・担当者を消さないように）
  const vals: Record<string, unknown> = { ...p.v };
  for (const k of ["address", "note", "phone", "contact", "radiusM", "kind"] as const) if (!(k in b)) delete vals[k];
  let set: Record<string, unknown> = { ...vals, updatedAt: new Date() };
  if (p.at) set = { ...set, ...geoCols(p.at) };
  else if (b.locate === "address") set = { ...set, ...geoCols(await locateByAddress(p.v.address)) };
  const [row] = await db.update(placesTable).set(set).where(eq(placesTable.id, id)).returning();
  forgetPlaces();
  return res.json({ ...row, located: row!.latitude != null });
});
// 消しても、これまでの到着・出発の記録（名前つき）は残す
router.delete("/map/places/:id", async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const [row] = await db.update(placesTable).set({ active: false, updatedAt: new Date() }).where(eq(placesTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "見つかりません" });
  forgetPlaces();
  return res.json({ ok: true });
});

export default router;
