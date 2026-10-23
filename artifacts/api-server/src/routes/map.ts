import { Router } from "express";
import { db, placesTable, placeVisitsTable, attendanceRecordsTable, monthlyRecordsTable, employeesTable } from "@workspace/db";
import { and, eq, asc, desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";
import { active, jstDate } from "../lib/shift";
import { getAttendanceSettings } from "../lib/attendance-settings";
import { pointsOf, distanceKm, stopsOf, monthDistance, forgetPlaces } from "../lib/geo";
import { paramStr } from "../lib/params";

/**
 * リアルタイムマップの窓口（管理画面だけ）。
 *   GET    /map/track?employeeId=&date=        … 1日の道すじ・走行距離の目安・止まっていたところ・場所への到着と出発・打刻
 *   GET    /map/track/month?employeeId=&ym=    … 月の走行距離の目安（日ごと）と、月次実績の走行距離
 *   GET    /map/visits?date=                   … その日の全員の到着・出発（日報の確認に）
 *   GET/POST/PUT/DELETE /map/places            … よく行く場所（現場・営業所・荷主など）
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
    db.select().from(placesTable).where(eq(placesTable.active, true)),
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

// ── よく行く場所 ───────────────────────────────────────────
type PlaceIn = { name?: unknown; kind?: unknown; latitude?: unknown; longitude?: unknown; radiusM?: unknown; address?: unknown; note?: unknown };
function placeOf(b: PlaceIn): { ok: true; v: { name: string; kind: string; latitude: number; longitude: number; radiusM: number; address: string | null; note: string | null } } | { ok: false; error: string } {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 60) return { ok: false, error: "場所の名前を入れてください（60文字まで）" };
  const lat = Number(b.latitude), lng = Number(b.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: "地図で場所を選んでください" };
  const r = Math.round(Number(b.radiusM ?? 150));
  if (!Number.isFinite(r) || r < 30 || r > 2000) return { ok: false, error: "範囲は30〜2000mで入れてください" };
  const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : "site";
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  return { ok: true, v: { name, kind, latitude: lat, longitude: lng, radiusM: r, address: str(b.address, 200), note: str(b.note, 500) } };
}

router.get("/map/places", async (_req, res) => {
  res.json(await db.select().from(placesTable).where(eq(placesTable.active, true)).orderBy(asc(placesTable.name)));
});
router.post("/map/places", async (req, res) => {
  const p = placeOf((req.body ?? {}) as PlaceIn);
  if (!p.ok) return res.status(400).json({ error: p.error });
  const [row] = await db.insert(placesTable).values({ ...p.v, updatedAt: new Date(), createdAt: new Date() }).returning();
  forgetPlaces();
  return res.status(201).json(row);
});
router.put("/map/places/:id", async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const p = placeOf((req.body ?? {}) as PlaceIn);
  if (!p.ok) return res.status(400).json({ error: p.error });
  const [row] = await db.update(placesTable).set({ ...p.v, updatedAt: new Date() }).where(and(eq(placesTable.id, id), eq(placesTable.active, true))).returning();
  if (!row) return res.status(404).json({ error: "場所が見つかりません" });
  forgetPlaces();
  return res.json(row);
});
// 消しても、これまでの到着・出発の記録（名前つき）は残す
router.delete("/map/places/:id", async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const [row] = await db.update(placesTable).set({ active: false, updatedAt: new Date() }).where(eq(placesTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "場所が見つかりません" });
  forgetPlaces();
  return res.json({ ok: true });
});

export default router;
