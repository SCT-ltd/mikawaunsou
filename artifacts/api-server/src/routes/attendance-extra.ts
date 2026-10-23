import { Router } from "express";
import {
  db, attendanceRecordsTable, employeesTable, attendanceCorrectionsTable, attendanceRecordLogsTable,
  alcoholChecksTable, dailyReportsTable, dailyInspectionsTable, inspectionHistoryTable, placesTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import { paramStr } from "../lib/params";
import { requireAdmin } from "../lib/auth-middleware";
import { resolveActor, actorName, isUniqueViolation } from "../lib/attendance-auth";
import { getAttendanceSettings, saveAttendanceSettings } from "../lib/attendance-settings";
import { addDaysStr, currentShiftDate, jstDate, sequenceError, shiftRecords, EVENT_TYPES, EVENT_LABELS, type EventType } from "../lib/shift";
import { monthCompliance } from "../lib/compliance";
import { later, pushOnce, pushToOffice, pushToEmployee } from "../lib/push";
import { notifyAttendanceChanged, inspectionView } from "./attendance";
import { audit } from "../lib/audit";
import { ownFile } from "./staff";

/**
 * 勤怠まわりの追加の機能。
 *   設定             … GET /attendance/settings/public（打刻ページ用）・GET/PUT /attendance/settings（管理画面）
 *   打刻の修正申請   … POST /attendance/corrections（本人）・GET /attendance/corrections/mine/:id（本人）
 *                      GET /attendance/corrections（管理画面）・POST /attendance/corrections/:id/decide（承認／却下）
 *   アルコールチェック … POST /attendance/alcohol（本人）・GET /attendance/alcohol/:id/today（本人）
 *                      GET /attendance/alcohol・/attendance/alcohol.csv・PATCH /attendance/alcohol/:id（管理画面）
 *   日報             … GET /attendance/reports・PATCH /attendance/reports/:id（管理画面）
 *   日常点検の判断   … PATCH /attendance/inspections/:id（管理画面：処置と運行してよいか）
 *   改善基準の目安   … GET /attendance/compliance?year&month（管理画面）
 */
const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

// ── 設定 ─────────────────────────────────────────────
router.get("/attendance/settings/public", async (_req, res) => {
  const s = await getAttendanceSettings();
  // 日報の「荷主」で選べるように、取引先マスターの荷主の名前だけを返す（住所・電話は出さない）
  const shippers = (await db.select({ name: placesTable.name }).from(placesTable)
    .where(and(eq(placesTable.active, true), eq(placesTable.kind, "shipper"))).orderBy(placesTable.name)).map((r) => r.name);
  return res.json({ requireChecklist: s.requireChecklist, requireAlcohol: s.requireAlcohol, vehicles: s.vehicles, officeRounding: s.officeRounding, showUninspected: s.showUninspected, shippers, requirePermissions: s.requirePermissions, staffPayslip: s.staffPayslip });
});
router.get("/attendance/settings", requireAdmin, async (_req, res) => res.json(await getAttendanceSettings()));
router.put("/attendance/settings", requireAdmin, async (req, res) => {
  const before = await getAttendanceSettings();
  const after = await saveAttendanceSettings((req.body ?? {}) as Record<string, never>);
  await audit(req, "attendance.settings", "attendance_settings", { before, after });
  return res.json(after);
});

// ── 打刻の修正申請 ────────────────────────────────────
router.post("/attendance/corrections", async (req, res) => {
  const b = (req.body ?? {}) as { employeeId?: number; kind?: string; eventType?: string; recordId?: number; requestedAt?: string; workDate?: string; reason?: string; clientId?: string };
  const who = await resolveActor(req, res, b.employeeId);
  if (!who) return;
  const kind = b.kind;
  if (kind !== "add" && kind !== "change" && kind !== "cancel") return res.status(400).json({ error: "申請の種類を選んでください" });
  const reason = str(b.reason, 500);
  if (!reason) return res.status(400).json({ error: "理由を書いてください" });
  let workDate = typeof b.workDate === "string" && DATE_RE.test(b.workDate) ? b.workDate : null;
  let eventType: string | null = null;
  let recordId: number | null = null;
  let requestedAt: Date | null = null;
  if (kind === "change" || kind === "cancel") {
    const [rec] = Number.isInteger(b.recordId) ? await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, b.recordId!)) : [];
    if (!rec || rec.employeeId !== who.employeeId || rec.voidedAt) return res.status(400).json({ error: "直したい打刻を選んでください" });
    recordId = rec.id; workDate = rec.workDate; eventType = rec.eventType;
  }
  if (kind === "add") {
    if (!b.eventType || !EVENT_TYPES.includes(b.eventType as EventType)) return res.status(400).json({ error: "足したい打刻の種類を選んでください" });
    eventType = b.eventType;
  }
  if (kind === "add" || kind === "change") {
    requestedAt = b.requestedAt ? new Date(b.requestedAt) : null;
    if (!requestedAt || Number.isNaN(requestedAt.getTime())) return res.status(400).json({ error: "正しい時刻を入れてください" });
    if (requestedAt.getTime() > Date.now() + 60_000) return res.status(400).json({ error: "未来の時刻は申請できません" });
    if (requestedAt.getTime() < Date.now() - 62 * 24 * 3600_000) return res.status(400).json({ error: "2か月より前の打刻は事務所に直接相談してください" });
  }
  if (!workDate) workDate = requestedAt ? jstDate(requestedAt) : await currentShiftDate(who.employeeId);
  const clientId = typeof b.clientId === "string" && CLIENT_RE.test(b.clientId) ? b.clientId : null;
  try {
    const [row] = await db.insert(attendanceCorrectionsTable).values({
      employeeId: who.employeeId, workDate, kind, eventType, recordId, requestedAt, reason, clientId,
    }).returning();
    later(async () => {
      const [emp] = await db.select({ name: employeesTable.name }).from(employeesTable).where(eq(employeesTable.id, who.employeeId));
      await pushToOffice({ title: `打刻の修正申請：${emp?.name ?? "従業員"}`, body: `${workDate} ${kind === "add" ? "打ち忘れを足す" : kind === "change" ? "時刻を直す" : "取り消す"}（${eventType ? EVENT_LABELS[eventType as EventType] : ""}）：${reason.slice(0, 60)}`, url: "/attendance-records" });
    });
    notifyAttendanceChanged();
    return res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err) && clientId) {
      const [dup] = await db.select().from(attendanceCorrectionsTable).where(and(eq(attendanceCorrectionsTable.employeeId, who.employeeId), eq(attendanceCorrectionsTable.clientId, clientId)));
      if (dup) return res.status(200).json(dup);
    }
    throw err;
  }
});

router.get("/attendance/corrections/mine/:employeeId", async (req, res) => {
  const who = await resolveActor(req, res, parseInt(paramStr(req.params.employeeId), 10));
  if (!who) return;
  const rows = await db.select().from(attendanceCorrectionsTable).where(eq(attendanceCorrectionsTable.employeeId, who.employeeId))
    .orderBy(desc(attendanceCorrectionsTable.createdAt)).limit(20);
  return res.json(rows);
});

router.get("/attendance/corrections", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows = await db.select({ c: attendanceCorrectionsTable, name: employeesTable.name, code: employeesTable.employeeCode })
    .from(attendanceCorrectionsTable).leftJoin(employeesTable, eq(employeesTable.id, attendanceCorrectionsTable.employeeId))
    .where(status === "all" ? undefined : eq(attendanceCorrectionsTable.status, status))
    .orderBy(desc(attendanceCorrectionsTable.createdAt)).limit(300);
  const recIds = rows.map(r => r.c.recordId).filter((x): x is number => x != null);
  const recs = recIds.length ? await db.select().from(attendanceRecordsTable).where(inArray(attendanceRecordsTable.id, recIds)) : [];
  return res.json(rows.map(r => ({ ...r.c, employeeName: r.name, employeeCode: r.code, record: recs.find(x => x.id === r.c.recordId) ?? null })));
});

/** 承認すると打刻に反映する（足す／時刻を直す／取り消す）。打刻の順番が合わなければ force で確かめてから。 */
router.post("/attendance/corrections/:id/decide", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const { approve, note, force } = (req.body ?? {}) as { approve?: boolean; note?: string; force?: boolean };
  const actor = actorName(req);
  try {
    const out = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(attendanceCorrectionsTable).where(eq(attendanceCorrectionsTable.id, id));
      if (!c) return { status: 404, body: { error: "申請が見つかりません" } };
      if (c.status !== "pending") return { status: 409, body: { error: "この申請はもう決まっています" } };
      const decided = { decidedBy: actor, decidedAt: new Date(), decisionNote: str(note, 500) };
      if (!approve) {
        const [u] = await tx.update(attendanceCorrectionsTable).set({ ...decided, status: "rejected" }).where(eq(attendanceCorrectionsTable.id, id)).returning();
        return { status: 200, body: u };
      }
      const recs = await shiftRecords(c.employeeId, c.workDate, tx);
      const reason = `修正申請 #${c.id}：${c.reason}`;
      let resultRecordId: number | null = null;
      if (c.kind === "add") {
        const et = c.eventType as EventType;
        if ((et === "clock_in" || et === "clock_out") && recs.some(r => r.eventType === et)) {
          return { status: 409, body: { error: `${c.workDate} にすでに「${EVENT_LABELS[et]}」があります。時刻を直す申請として扱ってください。` } };
        }
        const seq = sequenceError([...recs, { eventType: et, recordedAt: c.requestedAt! }]);
        if (seq && !force) return { status: 409, body: { error: seq, code: "order", canForce: true } };
        const [r] = await tx.insert(attendanceRecordsTable).values({ employeeId: c.employeeId, eventType: et, workDate: c.workDate, recordedAt: c.requestedAt!, source: "correction" }).returning();
        resultRecordId = r!.id;
        await tx.insert(attendanceRecordLogsTable).values({ recordId: r!.id, employeeId: c.employeeId, workDate: c.workDate, action: "correction", after: JSON.stringify(r), actor, reason });
      } else {
        const [rec] = await tx.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, c.recordId!));
        if (!rec || rec.voidedAt) return { status: 409, body: { error: "直す打刻がもうありません（取り消されたかもしれません）" } };
        if (c.kind === "change") {
          const seq = sequenceError(recs.map(r => r.id === rec.id ? { ...r, recordedAt: c.requestedAt! } : r));
          if (seq && !force) return { status: 409, body: { error: seq, code: "order", canForce: true } };
          const [u] = await tx.update(attendanceRecordsTable).set({ recordedAt: c.requestedAt! }).where(eq(attendanceRecordsTable.id, rec.id)).returning();
          await tx.insert(attendanceRecordLogsTable).values({ recordId: rec.id, employeeId: c.employeeId, workDate: c.workDate, action: "correction", before: JSON.stringify(rec), after: JSON.stringify(u), actor, reason });
        } else {
          const [u] = await tx.update(attendanceRecordsTable).set({ voidedAt: new Date(), voidReason: reason, voidedBy: actor }).where(eq(attendanceRecordsTable.id, rec.id)).returning();
          await tx.insert(attendanceRecordLogsTable).values({ recordId: rec.id, employeeId: c.employeeId, workDate: c.workDate, action: "cancel", before: JSON.stringify(rec), after: JSON.stringify(u), actor, reason });
        }
        resultRecordId = rec.id;
      }
      const [u] = await tx.update(attendanceCorrectionsTable).set({ ...decided, status: "approved", resultRecordId }).where(eq(attendanceCorrectionsTable.id, id)).returning();
      return { status: 200, body: u };
    });
    if (out.status === 200) {
      notifyAttendanceChanged();
      const c = out.body as typeof attendanceCorrectionsTable.$inferSelect;
      later(() => pushToEmployee(c.employeeId, {
        title: c.status === "approved" ? "打刻の修正が承認されました" : "打刻の修正申請が見送られました",
        body: `${c.workDate} の申請${c.decisionNote ? `：${c.decisionNote}` : ""}`, url: `/driver/${c.employeeId}`,
      }));
    }
    return res.status(out.status).json(out.body);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: "同じ日に同じ種類の打刻がすでにあります" });
    throw err;
  }
});

// ── アルコールチェック ─────────────────────────────────
const METHODS = ["face", "phone", "video", "other"] as const;

router.post("/attendance/alcohol", async (req, res) => {
  const b = (req.body ?? {}) as { employeeId?: number; phase?: string; valueMg?: unknown; detected?: boolean; method?: string; checker?: string; vehicle?: string; note?: string; clientId?: string; clientTime?: string; offline?: boolean; photoFileId?: unknown };
  const who = await resolveActor(req, res, b.employeeId);
  if (!who) return;
  if (b.phase !== "before" && b.phase !== "after") return res.status(400).json({ error: "乗る前か乗った後かを選んでください" });
  const value = b.valueMg === null || b.valueMg === undefined || b.valueMg === "" ? null : Number(b.valueMg);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 5)) return res.status(400).json({ error: "検知器の数値が正しくありません（0〜5 mg/L）" });
  if (value === null) return res.status(400).json({ error: "検知器の数値を入れてください（検知しなければ 0）" });
  const method = METHODS.includes(b.method as typeof METHODS[number]) ? b.method! : null;
  if (!method) return res.status(400).json({ error: "確認の方法（対面・電話など）を選んでください" });
  // 0.15 mg/L 以上は道路交通法の酒気帯び。0 より大きければ「検知あり」として扱う（会社として乗務させない）
  const detected = b.detected === true || value > 0;
  let at = new Date();
  if (b.offline && b.clientTime) {
    const t = new Date(b.clientTime);
    if (!Number.isNaN(t.getTime()) && t.getTime() <= Date.now() && t.getTime() > Date.now() - 24 * 3600_000) at = t;
  }
  const workDate = await currentShiftDate(who.employeeId, at);
  const [emp] = await db.select({ name: employeesTable.name }).from(employeesTable).where(eq(employeesTable.id, who.employeeId));
  const clientId = typeof b.clientId === "string" && CLIENT_RE.test(b.clientId) ? b.clientId : null;
  // 検知器の表示の写真（任意・本人が撮った物だけ）
  const photoFileId = b.photoFileId == null || b.photoFileId === "" ? null : await ownFile(who.employeeId, b.photoFileId, "alcohol");
  try {
    const [row] = await db.insert(alcoholChecksTable).values({ photoFileId,
      employeeId: who.employeeId, employeeName: emp?.name ?? "", workDate, phase: b.phase, checkedAt: at,
      valueMg: value, detected, method, checker: str(b.checker, 80), vehicle: str(b.vehicle, 40), note: str(b.note, 500), clientId,
    }).returning();
    if (detected) {
      later(() => pushOnce(`alcohol:${row!.id}`, () => pushToOffice({
        title: `アルコール検知：${emp?.name ?? "従業員"}`,
        body: `${b.phase === "before" ? "乗る前" : "乗った後"}のチェックで ${value} mg/L。乗務させないでください。`,
        url: "/attendance-records",
      })));
    }
    notifyAttendanceChanged();
    return res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err) && clientId) {
      const [dup] = await db.select().from(alcoholChecksTable).where(and(eq(alcoholChecksTable.employeeId, who.employeeId), eq(alcoholChecksTable.clientId, clientId)));
      if (dup) return res.status(200).json(dup);
    }
    throw err;
  }
});

router.get("/attendance/alcohol/:employeeId/today", async (req, res) => {
  const who = await resolveActor(req, res, parseInt(paramStr(req.params.employeeId), 10));
  if (!who) return;
  const workDate = await currentShiftDate(who.employeeId);
  const rows = await db.select().from(alcoholChecksTable).where(and(eq(alcoholChecksTable.employeeId, who.employeeId), eq(alcoholChecksTable.workDate, workDate))).orderBy(alcoholChecksTable.checkedAt);
  // 確認した人の名前は次に入れやすいよう、いちばん新しいものを返す
  const [last] = await db.select({ checker: alcoholChecksTable.checker, method: alcoholChecksTable.method }).from(alcoholChecksTable)
    .where(eq(alcoholChecksTable.employeeId, who.employeeId)).orderBy(desc(alcoholChecksTable.checkedAt)).limit(1);
  return res.json({ workDate, items: rows, lastChecker: last?.checker ?? null, lastMethod: last?.method ?? null });
});

function rangeOf(q: Record<string, unknown>) {
  const to = typeof q.to === "string" && DATE_RE.test(q.to) ? q.to : jstDate();
  const from = typeof q.from === "string" && DATE_RE.test(q.from) ? q.from : addDaysStr(to, -31);
  return { from, to };
}

router.get("/attendance/alcohol", requireAdmin, async (req, res) => {
  const { from, to } = rangeOf(req.query);
  const rows = await db.select().from(alcoholChecksTable).where(and(gte(alcoholChecksTable.workDate, from), lte(alcoholChecksTable.workDate, to)))
    .orderBy(desc(alcoholChecksTable.checkedAt)).limit(5000);
  return res.json(rows);
});

const METHOD_LABEL: Record<string, string> = { face: "対面", phone: "電話", video: "ビデオ通話", other: "その他" };
router.get("/attendance/alcohol.csv", requireAdmin, async (req, res) => {
  const { from, to } = rangeOf(req.query);
  const rows = await db.select().from(alcoholChecksTable).where(and(gte(alcoholChecksTable.workDate, from), lte(alcoholChecksTable.workDate, to)))
    .orderBy(alcoholChecksTable.checkedAt);
  // 表計算ソフトで式として動かないように、先頭が = + - @ の値には ' を付ける
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const fmt = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  const lines = [["勤務日", "確認日時", "社員番号", "氏名", "乗る前/後", "検知器の数値(mg/L)", "酒気帯び", "確認の方法", "確認した人", "車両", "備考"].map(cell).join(",")];
  for (const r of rows) {
    lines.push([r.workDate, fmt(r.checkedAt), r.employeeId, r.employeeName, r.phase === "before" ? "乗る前" : "乗った後", r.valueMg ?? "", r.detected ? "あり" : "なし", METHOD_LABEL[r.method] ?? r.method, r.checker ?? "", r.vehicle ?? "", r.note ?? ""].map(cell).join(","));
  }
  await audit(req, "alcohol.csv", "alcohol_checks", { from, to, count: rows.length });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="alcohol-checks-${from}-${to}.csv"`);
  return res.send("﻿" + lines.join("\r\n"));
});

// 事務所が「確認した人」「方法」「備考」を直す（数値と検知の有無は直さない＝記録の改ざんを防ぐ）
router.patch("/attendance/alcohol/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const b = (req.body ?? {}) as { checker?: string; method?: string; note?: string };
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorName(req) };
  if ("checker" in b) set.checker = str(b.checker, 80);
  if ("note" in b) set.note = str(b.note, 500);
  if ("method" in b) { if (!METHODS.includes(b.method as typeof METHODS[number])) return res.status(400).json({ error: "方法が正しくありません" }); set.method = b.method; }
  const [u] = await db.update(alcoholChecksTable).set(set).where(eq(alcoholChecksTable.id, id)).returning();
  if (!u) return res.status(404).json({ error: "見つかりません" });
  notifyAttendanceChanged();
  return res.json(u);
});

// ── 日報 ─────────────────────────────────────────────
router.get("/attendance/reports", requireAdmin, async (req, res) => {
  const { from, to } = rangeOf(req.query);
  const rows = await db.select({ r: dailyReportsTable, name: employeesTable.name, code: employeesTable.employeeCode })
    .from(dailyReportsTable).leftJoin(employeesTable, eq(employeesTable.id, dailyReportsTable.employeeId))
    .where(and(gte(dailyReportsTable.workDate, from), lte(dailyReportsTable.workDate, to)))
    .orderBy(desc(dailyReportsTable.workDate)).limit(3000);
  return res.json(rows.map(x => ({ ...x.r, employeeName: x.name, employeeCode: x.code })));
});

router.patch("/attendance/reports/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, n] of [["vehicle", 40], ["departure", 1000], ["arrival", 1000], ["shipper", 200], ["note", 1000]] as const) if (k in b) set[k] = str(b[k], n);
  if ("waitingMinutes" in b) set.waitingMinutes = b.waitingMinutes === null || b.waitingMinutes === "" ? null : Math.max(0, Math.min(1440, Math.round(Number(b.waitingMinutes)) || 0));
  const [u] = await db.update(dailyReportsTable).set(set).where(eq(dailyReportsTable.id, id)).returning();
  if (!u) return res.status(404).json({ error: "見つかりません" });
  notifyAttendanceChanged();
  return res.json(u);
});

// ── 日常点検：事務所の処置と判断 ─────────────────────────
router.patch("/attendance/inspections/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const b = (req.body ?? {}) as { officeAction?: string; officeDecision?: string | null };
  const [before] = await db.select().from(dailyInspectionsTable).where(eq(dailyInspectionsTable.id, id));
  if (!before) return res.status(404).json({ error: "見つかりません" });
  const set: Record<string, unknown> = { decidedBy: actorName(req), decidedAt: new Date() };
  if ("officeAction" in b) set.officeAction = str(b.officeAction, 1000);
  if ("officeDecision" in b) {
    if (b.officeDecision !== "ok" && b.officeDecision !== "ng" && b.officeDecision !== null) return res.status(400).json({ error: "判断が正しくありません" });
    set.officeDecision = b.officeDecision;
  }
  const [u] = await db.update(dailyInspectionsTable).set(set).where(eq(dailyInspectionsTable.id, id)).returning();
  await db.insert(inspectionHistoryTable).values({ inspectionId: id, employeeId: before.employeeId, workDate: before.workDate,
    before: JSON.stringify({ officeAction: before.officeAction, officeDecision: before.officeDecision }),
    after: JSON.stringify({ officeAction: u!.officeAction, officeDecision: u!.officeDecision }), actor: actorName(req) });
  if (u!.officeDecision && u!.officeDecision !== before.officeDecision) {
    later(() => pushToEmployee(before.employeeId, {
      title: u!.officeDecision === "ok" ? "点検の結果：運行してよいです" : "点検の結果：運行しないでください",
      body: u!.officeAction ?? "事務所の判断が出ました。", url: `/driver/${before.employeeId}`,
    }));
  }
  notifyAttendanceChanged();
  return res.json(inspectionView(u));
});

router.get("/attendance/inspections/:id/history", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  return res.json(await db.select().from(inspectionHistoryTable).where(eq(inspectionHistoryTable.inspectionId, id)).orderBy(desc(inspectionHistoryTable.at)));
});

// ── 改善基準告示の目安（月） ─────────────────────────────
router.get("/attendance/compliance", requireAdmin, async (req, res) => {
  const year = parseInt(String(req.query.year), 10) || new Date().getFullYear();
  const month = parseInt(String(req.query.month), 10) || new Date().getMonth() + 1;
  const emps = await db.select({ id: employeesTable.id, name: employeesTable.name, code: employeesTable.employeeCode, isOfficeStaff: employeesTable.isOfficeStaff, isActive: employeesTable.isActive }).from(employeesTable);
  const rows = await monthCompliance(year, month);
  return res.json(rows.map(r => {
    const e = emps.find(x => x.id === r.employeeId);
    return { ...r, employeeName: e?.name ?? "", employeeCode: e?.code ?? "", isOfficeStaff: e?.isOfficeStaff ?? false };
  }).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)));
});

export default router;
