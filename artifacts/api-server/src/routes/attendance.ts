import { Router, type Response, type Request } from "express";
import {
  db, attendanceRecordsTable, employeesTable, absenceRecordsTable, liveLocationsTable, attendanceDraftsTable,
  attendanceRecordLogsTable, dailyInspectionsTable, inspectionHistoryTable, alcoholChecksTable, dailyReportsTable,
  attendanceCorrectionsTable,
} from "@workspace/db";
import { paramStr } from "../lib/params";
import { asc, eq, and, gte, lte, sql, inArray, desc } from "drizzle-orm";
import { ABSENCE_DAYS, isPaidLeave, isFullDayAbsence } from "./absences";
import { requireAdmin, requireOwnerOrAdmin, requireAttendanceRecordOwnerOrAdmin } from "../lib/auth-middleware";
import { driverAccess, PIN_REQUIRED_BODY } from "../lib/driver-token";
import { holidayName } from "../lib/jp-holidays";
import { isAdminReq } from "../lib/roles";
import {
  active, addDaysStr, currentShiftDate, currentShiftDates, jstDate, shiftDateForEvent, shiftRecords,
  stateOf, transitionError, sequenceError, shiftStats, EVENT_LABELS, type EventType, EVENT_TYPES,
} from "../lib/shift";
import { resolveActor, actorName, isUniqueViolation } from "../lib/attendance-auth";
import { getAttendanceSettings, roundsUpTo30 } from "../lib/attendance-settings";
import { daysFrom, type DayCompliance } from "../lib/compliance";
import { schedulesFor, comparePlan } from "../lib/schedules";
import { later, pushOnce, pushToOffice } from "../lib/push";

const router = Router();

// ── SSEクライアント管理 ────────────────────────────────
// クライアントごとに「自分が見るべき employeeId」を保持する。
//   null  → admin（全社員のスナップショットをそのまま受け取る）
//   number → driver（自分の employeeId のみにフィルタしたスナップショットを受け取る）
//   refreshOnly → QR の打刻ページ（ログインなし）。中身は送らず「取り直して」の合図だけ送る
//                 （自分の分が変わったときだけ。受け取った画面は暗証番号の確認に応じた範囲で取り直す）
interface SseClient { owner: number | null; refreshOnly: boolean; last?: string }
const sseClients = new Map<Response, SseClient>();

function flush(res: Response) {
  if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
    (res as unknown as { flush: () => void }).flush();
  }
}

type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;

function filterSnapshotForDriver(snapshot: Snapshot, employeeId: number): Snapshot {
  return snapshot.filter(item => item.employee.id === employeeId);
}

/** 「自分の分が変わったか」を見るための中身（いまの時刻で動く数字は除く） */
function keyOf(snapshot: Snapshot): string {
  return JSON.stringify(snapshot.map(s => [s.workDate, s.records, s.draft, s.inspection, s.alcohol, s.report]));
}

function broadcast(snapshot: Snapshot) {
  for (const [client, c] of sseClients) {
    if (c.refreshOnly && c.owner !== null) {
      const mine = keyOf(filterSnapshotForDriver(snapshot, c.owner));
      if (mine === c.last) continue;
      c.last = mine;
      client.write(`data: ${JSON.stringify({ type: "refresh" })}\n\n`);
      flush(client);
      continue;
    }
    const data = c.owner === null ? snapshot : filterSnapshotForDriver(snapshot, c.owner);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
    flush(client);
  }
}

/** 変わったことを開いている画面に知らせる（失敗しても打刻は止めない） */
export function notifyAttendanceChanged(): void {
  buildSnapshot().then(snapshot => broadcast(snapshot)).catch(() => {});
}

function statusOf(recs: Array<{ eventType: string }>): string {
  const s = stateOf(recs);
  return s === "none" ? "未出勤" : s === "working" ? "出勤中" : s === "break" ? "休憩中" : "退勤済";
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function inspectionView(row: typeof dailyInspectionsTable.$inferSelect | undefined | null) {
  if (!row) return null;
  return {
    id: row.id, workDate: row.workDate, vehicle: row.vehicle,
    items: parseJson<Record<string, string>>(row.items, {}),
    total: row.total, checked: row.checked, ng: parseJson<string[]>(row.ng, []),
    /** 全項目に答えたか（答えていなければ「未点検」） */
    complete: row.total > 0 && row.checked >= row.total,
    officeAction: row.officeAction, officeDecision: row.officeDecision,
    decidedBy: row.decidedBy, decidedAt: row.decidedAt, updatedAt: row.updatedAt,
  };
}

/**
 * 勤怠の一覧（社員ごとの状態）。
 * date を指定すると全員その日。指定しなければ社員ごとに「いまの勤務の日付」（深夜に前の日の勤務が
 * 続いていればその日）。以前は今日の日付だけで見ていたため、深夜は勤務中の人まで「未出勤」に見えた。
 */
async function buildSnapshot(date?: string) {
  const employees = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.isActive, true))
    .orderBy(asc(employeesTable.employeeCode));
  const ids = employees.map(e => e.id);

  const now = new Date();
  const dates = date ? new Map(ids.map(id => [id, date])) : await currentShiftDates(ids, now);
  const allDates = [...new Set(dates.values())];
  const minDate = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : jstDate(now);
  const maxDate = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : jstDate(now);

  const dateIn = (col: typeof attendanceRecordsTable.workDate) => allDates.length ? inArray(col, allDates) : sql`false`;
  const [allRecords, allDrafts, inspections, alcohols, reports, prevRecs, corrections] = await Promise.all([
    db.select().from(attendanceRecordsTable).where(and(dateIn(attendanceRecordsTable.workDate), active))
      .orderBy(attendanceRecordsTable.recordedAt, attendanceRecordsTable.id),
    db.select().from(attendanceDraftsTable).where(allDates.length ? inArray(attendanceDraftsTable.workDate, allDates) : sql`false`),
    db.select().from(dailyInspectionsTable).where(allDates.length ? inArray(dailyInspectionsTable.workDate, allDates) : sql`false`),
    db.select().from(alcoholChecksTable).where(allDates.length ? inArray(alcoholChecksTable.workDate, allDates) : sql`false`).orderBy(alcoholChecksTable.checkedAt),
    db.select().from(dailyReportsTable).where(allDates.length ? inArray(dailyReportsTable.workDate, allDates) : sql`false`),
    // 休息期間（前の勤務の退勤から）を出すため、前の3日分も読む
    db.select({ employeeId: attendanceRecordsTable.employeeId, eventType: attendanceRecordsTable.eventType, workDate: attendanceRecordsTable.workDate, recordedAt: attendanceRecordsTable.recordedAt })
      .from(attendanceRecordsTable).where(and(gte(attendanceRecordsTable.workDate, addDaysStr(minDate, -3)), lte(attendanceRecordsTable.workDate, maxDate), active)),
    db.select({ employeeId: attendanceCorrectionsTable.employeeId }).from(attendanceCorrectionsTable).where(eq(attendanceCorrectionsTable.status, "pending")),
  ]);
  // 出勤の予定（シフト）と、その日の休みの登録（予定と比べて遅刻・早退・出勤していないを出す）
  const [schedules, settings, dayAbsences] = await Promise.all([
    schedulesFor(ids, minDate, maxDate),
    getAttendanceSettings(),
    db.select({ employeeId: absenceRecordsTable.employeeId, workDate: absenceRecordsTable.workDate, absenceType: absenceRecordsTable.absenceType })
      .from(absenceRecordsTable).where(allDates.length ? inArray(absenceRecordsTable.workDate, allDates) : sql`false`),
  ]);
  const today = jstDate(now);

  return employees.map(emp => {
    const wd = dates.get(emp.id)!;
    const empRecords = allRecords.filter(r => r.employeeId === emp.id && r.workDate === wd);
    const draft = allDrafts.find(d => d.employeeId === emp.id && d.workDate === wd) ?? null;
    const clockIn = empRecords.find(r => r.eventType === "clock_in");
    let compliance: DayCompliance | null = null;
    try {
      compliance = daysFrom(prevRecs.filter(r => r.employeeId === emp.id && r.workDate <= wd), wd, wd, now.getTime()).find(d => d.date === wd) ?? null;
    } catch { compliance = null; }

    return {
      employee: {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: emp.name,
        department: emp.department,
        isOfficeStaff: emp.isOfficeStaff ?? false,
        qrKey: emp.qrKey ?? null,
      },
      /** この行の勤務日（深夜に前の日の勤務が続いていれば前の日） */
      workDate: wd,
      status: statusOf(empRecords),
      clockInTime: clockIn?.recordedAt ?? null,
      records: empRecords,
      draft,
      inspection: inspectionView(inspections.find(i => i.employeeId === emp.id && i.workDate === wd)),
      alcohol: alcohols.filter(a => a.employeeId === emp.id && a.workDate === wd),
      report: reports.find(r => r.employeeId === emp.id && r.workDate === wd) ?? null,
      compliance,
      pendingCorrections: corrections.filter(c => c.employeeId === emp.id).length,
      /** 出勤の予定（無ければ null） */
      schedule: schedules.get(`${emp.id}:${wd}`) ?? null,
      /** 予定との比べ（遅刻・早退の分、出勤していない、休みの日の出勤） */
      plan: comparePlan(wd, schedules.get(`${emp.id}:${wd}`), clockIn ? new Date(clockIn.recordedAt).getTime() : null,
        (() => { const o = [...empRecords].reverse().find(r => r.eventType === "clock_out"); return o ? new Date(o.recordedAt).getTime() : null; })(),
        { now: now.getTime(), today, graceMin: settings.lateGraceMinutes, noShowMin: settings.noShowAlertMinutes,
          hasFullDayAbsence: dayAbsences.some(a => a.employeeId === emp.id && a.workDate === wd && isFullDayAbsence(a.absenceType)) }),
    };
  });
}

// ── SSEストリーム ─────────────────────────────────────
router.get("/attendance/stream", async (req, res) => {
  // ── 接続時の認可判定 ─────────────────────────────────
  // admin: ownerEmployeeId = null（全社員データ受信）
  // driver: ownerEmployeeId = session.employeeId（自分の分のみ受信）
  //         driver が ?employeeId=他人 を指定した場合は 403
  // QR の打刻ページ（ログインなし）: ?employeeId= の本人。暗証番号を確かめた端末（未設定の人は従来どおり）。
  //         中身は送らず「取り直して」の合図だけ送る。
  let ownerEmployeeId: number | null;
  let refreshOnly = false;
  if (!req.session?.userId) {
    const requested = parseInt(String(req.query["employeeId"] ?? ""), 10);
    if (Number.isNaN(requested)) return res.status(401).json({ error: "ログインが必要です" });
    const access = await driverAccess(req, requested);
    if (access === "not-found") return res.status(404).json({ error: "社員が見つかりません。" });
    if (access === "denied") return res.status(401).json(PIN_REQUIRED_BODY);
    ownerEmployeeId = requested;
    refreshOnly = true;
  } else if (isAdminReq(req)) {
    ownerEmployeeId = null;
  } else {
    const sessionEmployeeId = req.session.employeeId;
    if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
      return res.status(403).json({ error: "権限がありません" });
    }
    const requestedRaw = req.query["employeeId"];
    if (requestedRaw !== undefined && requestedRaw !== "") {
      const requested = parseInt(String(requestedRaw), 10);
      if (!Number.isNaN(requested) && requested !== Number(sessionEmployeeId)) {
        return res.status(403).json({ error: "他の従業員のストリームにはアクセスできません" });
      }
    }
    ownerEmployeeId = Number(sessionEmployeeId);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client: SseClient = { owner: ownerEmployeeId, refreshOnly };
  try {
    const snapshot = await buildSnapshot();
    if (refreshOnly) {
      client.last = keyOf(filterSnapshotForDriver(snapshot, ownerEmployeeId!));
      res.write(`data: ${JSON.stringify({ type: "refresh" })}\n\n`);
    } else {
      const initial = ownerEmployeeId === null ? snapshot : filterSnapshotForDriver(snapshot, ownerEmployeeId);
      res.write(`data: ${JSON.stringify(initial)}\n\n`);
    }
    flush(res);
  } catch {
    // 初回送信失敗は無視
  }

  sseClients.set(res, client);

  // 接続維持用ハートビート（15秒ごと）。画面は ping が来なくなったら、切れたとみなしてつなぎ直す
  const heartbeat = setInterval(() => {
    res.write("event: ping\ndata: 1\n\n");
    flush(res);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
  return;
});

// ── 全社員の勤怠状況 ──
// date を省くと社員ごとに「いまの勤務の日付」。admin: 全社員、driver: 自分の分だけ
router.get("/attendance/today", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }
  const raw = req.query.date as string | undefined;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
  const snapshot = await buildSnapshot(date);

  if (isAdminReq(req)) {
    return res.json(snapshot);
  }

  const sessionEmployeeId = req.session.employeeId;
  if (sessionEmployeeId === null || sessionEmployeeId === undefined) {
    return res.status(403).json({ error: "権限がありません" });
  }
  return res.json(filterSnapshotForDriver(snapshot, Number(sessionEmployeeId)));
});

// ── 社員の「いまの勤務」の打刻一覧 ─────────────────────────────
router.get("/attendance/employee/:employeeId/today", async (req, res, next) => {
  if (req.session?.userId) {
    return requireOwnerOrAdmin(r => parseInt(paramStr(r.params.employeeId), 10))(req, res, next);
  }
  return next();
}, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  // 直近24時間以内に出勤して退勤していなければ、その勤務の打刻を返す（朝5時を過ぎても続けて押せるように）
  const today = await currentShiftDate(employeeId);
  // QR ページは暗証番号の入力前にもこの API で「いま出勤中か」を出している。
  // 本人確認の済んでいない端末には、状態の判定に要る項目（種別と時刻）だけを返す。
  const access = req.session?.userId ? "verified" : await driverAccess(req, employeeId);
  if (access === "not-found") return res.status(404).json({ error: "社員が見つかりません。" });

  const records = await shiftRecords(employeeId, today);
  res.setHeader("X-Shift-Date", today);

  if (access !== "verified") {
    return res.json(records.map(r => ({
      id: r.id, employeeId: r.employeeId, eventType: r.eventType, recordedAt: r.recordedAt, workDate: r.workDate,
    })));
  }
  return res.json(records);
});

function recJson(r: unknown): string { return JSON.stringify(r); }

async function logChange(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], v: {
  recordId: number | null; employeeId: number; workDate: string | null; action: string;
  before?: unknown; after?: unknown; actor: string; reason?: string | null;
}) {
  await tx.insert(attendanceRecordLogsTable).values({
    recordId: v.recordId, employeeId: v.employeeId, workDate: v.workDate, action: v.action,
    before: v.before === undefined ? null : recJson(v.before), after: v.after === undefined ? null : recJson(v.after),
    actor: v.actor, reason: v.reason ?? null,
  });
}

const ODO_MAX = 9_999_999;
function odoValue(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > ODO_MAX) return "bad";
  return Math.round(n * 10) / 10;
}

class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(String(body.error ?? "")); }
}

// ── 打刻記録（POST → SSEブロードキャスト） ──────────
// QR（ログインなし）: 暗証番号を確かめた端末の本人。時刻はサーバーが受け取った時刻（電波が戻ってから
//                    送った打刻だけ、24時間以内なら端末で押した時刻）。
// 管理画面: 本文の employeeId・時刻・勤務日をそのまま使う（順番が合わないときは確かめてから force で保存）
// driver アカウント: 自分だけ
router.post("/attendance/record", async (req, res) => {
  const body = (req.body ?? {}) as {
    employeeId?: number; eventType?: string; note?: string | null;
    startOdometer?: unknown; endOdometer?: unknown;
    recordedAt?: string; workDate?: string;
    latitude?: number | null; longitude?: number | null;
    checklistNgItems?: string | null;
    clientId?: string; clientTime?: string; offline?: boolean; force?: boolean;
    report?: { shipper?: string | null; waitingMinutes?: unknown; note?: string | null; vehicle?: string | null; departure?: string | null; arrival?: string | null } | null;
  };
  const eventType = body.eventType as EventType | undefined;
  if (!eventType || !EVENT_TYPES.includes(eventType)) {
    return res.status(400).json({ error: "eventType は必須です" });
  }

  const who = await resolveActor(req, res, body.employeeId);
  if (!who) return;
  const { employeeId, admin } = who;

  const clientId = typeof body.clientId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientId) ? body.clientId : null;
  // 同じ番号の打刻がすでに入っていれば、それを返す（電波が悪くて送り直したとき）
  if (clientId) {
    const [dup] = await db.select().from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.clientId, clientId)));
    if (dup) return res.status(200).json({ ...dup, duplicate: true });
  }

  // ── 時刻 ──
  let at: Date;
  if (admin && body.recordedAt) {
    at = new Date(body.recordedAt);
  } else if (!admin && body.offline && body.clientTime) {
    // 電波が無いあいだ端末に溜めておいた打刻。端末で押した時刻が24時間以内なら、その時刻で記録する。
    at = new Date(body.clientTime);
    if (!Number.isNaN(at.getTime()) && at.getTime() < Date.now() - 24 * 3600_000) {
      return res.status(400).json({ error: "24時間より前の打刻は送れません。事務所に修正を頼むか、修正申請をしてください。", code: "too-old" });
    }
    if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now()) at = new Date();
  } else {
    at = new Date();
  }
  if (Number.isNaN(at.getTime())) return res.status(400).json({ error: "打刻の日時が正しくありません" });
  if (at.getTime() > Date.now() + 60 * 1000) return res.status(400).json({ error: "未来の時刻で打刻することはできません" });

  const startOdo = odoValue(body.startOdometer);
  const endOdo = odoValue(body.endOdometer);
  if (startOdo === "bad" || endOdo === "bad") return res.status(400).json({ error: "メーターの値が正しくありません（0〜9,999,999 km）" });
  if (startOdo !== null && endOdo !== null && endOdo < startOdo) {
    return res.status(400).json({ error: "帰着のメーターが出発のメーターより小さくなっています。数字を確かめてください。", code: "odometer" });
  }
  const adminWorkDate = admin && typeof body.workDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.workDate) ? body.workDate : null;
  const settings = await getAttendanceSettings();
  const source = admin ? "admin" : body.offline ? "offline" : "qr";

  try {
    const result = await db.transaction(async (tx) => {
      // 同じ人の打刻を同時に2つ処理しない（調べてから入れるまでの間に割り込まれないように）
      await tx.execute(sql`select pg_advisory_xact_lock(7001, ${employeeId})`);
      const workDate = adminWorkDate ?? await shiftDateForEvent(employeeId, eventType, at, tx);
      const existing = await shiftRecords(employeeId, workDate, tx);
      const [emp] = await tx.select({ name: employeesTable.name, isOfficeStaff: employeesTable.isOfficeStaff }).from(employeesTable).where(eq(employeesTable.id, employeeId));
      let autoBreakEnd: typeof existing[number] | null = null;

      if (!admin) {
        const later_ = existing.filter(r => new Date(r.recordedAt).getTime() > at.getTime() + 1000);
        if (later_.length > 0) {
          throw new HttpError(409, { error: "あとの時刻の打刻がすでに入っています。画面を読み込み直してください。", code: "order" });
        }
        const state = stateOf(existing);
        const err = transitionError(state, eventType);
        if (err) throw new HttpError(409, { error: err, code: "order" });
        if (eventType === "clock_in" && !emp?.isOfficeStaff) {
          if (settings.requireChecklist) {
            const [ins] = await tx.select().from(dailyInspectionsTable).where(and(eq(dailyInspectionsTable.employeeId, employeeId), eq(dailyInspectionsTable.workDate, workDate)));
            if (!ins || ins.total === 0 || ins.checked < ins.total) {
              throw new HttpError(409, { error: "日常点検がまだ終わっていません。チェックリストを全部つけてから出勤してください。", code: "checklist-required" });
            }
          }
          if (settings.requireAlcohol) {
            const [alc] = await tx.select({ id: alcoholChecksTable.id }).from(alcoholChecksTable).where(and(eq(alcoholChecksTable.employeeId, employeeId), eq(alcoholChecksTable.workDate, workDate), eq(alcoholChecksTable.phase, "before")));
            if (!alc) throw new HttpError(409, { error: "乗る前のアルコールチェックを記録してから出勤してください。", code: "alcohol-required" });
          }
        }
        // 帰着のメーターが、この勤務の出発のメーターより小さくないか
        if (endOdo !== null) {
          const firstStart = existing.find(r => r.startOdometer != null)?.startOdometer ?? startOdo;
          if (firstStart != null && endOdo < firstStart) {
            throw new HttpError(400, { error: "帰着のメーターが出発のメーターより小さくなっています。数字を確かめてください。", code: "odometer" });
          }
        }
        // 休憩中に退勤したら、休憩終了を自動で入れる（その1秒前）
        if (eventType === "clock_out" && state === "break") {
          const [be] = await tx.insert(attendanceRecordsTable).values({
            employeeId, eventType: "break_end", workDate, recordedAt: new Date(at.getTime() - 1000), source: "auto",
          }).returning();
          autoBreakEnd = be!;
          await logChange(tx, { recordId: be!.id, employeeId, workDate, action: "auto_break_end", after: be, actor: "システム", reason: "休憩中に退勤したため休憩終了を自動で入れました" });
        }
      } else {
        // 管理画面：同じ種類が重ならないか（出勤・退勤は1日1つ）と、順番を確かめる
        if ((eventType === "clock_in" || eventType === "clock_out") && existing.some(r => r.eventType === eventType)) {
          throw new HttpError(409, { error: `${workDate} にすでに「${EVENT_LABELS[eventType]}」の打刻があります` });
        }
        const seqErr = sequenceError([...existing, { eventType, recordedAt: at }]);
        if (seqErr && !body.force) throw new HttpError(409, { error: seqErr, code: "order", canForce: true });
      }

      // 出勤のときは、その日の点検の内容も打刻に写しておく（以前の画面の表示のため）
      let checklist = body.checklistNgItems ?? null;
      if (eventType === "clock_in" && !checklist) {
        const [ins] = await tx.select().from(dailyInspectionsTable).where(and(eq(dailyInspectionsTable.employeeId, employeeId), eq(dailyInspectionsTable.workDate, workDate)));
        if (ins) checklist = JSON.stringify({ total: ins.total, checked: ins.checked, ng: parseJson(ins.ng, []), items: parseJson(ins.items, {}) });
      }

      const [record] = await tx.insert(attendanceRecordsTable).values({
        employeeId, eventType, workDate, recordedAt: at,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        startOdometer: startOdo, endOdometer: endOdo,
        latitude: typeof body.latitude === "number" ? body.latitude : null,
        longitude: typeof body.longitude === "number" ? body.longitude : null,
        checklistNgItems: eventType === "clock_in" ? checklist : null,
        clientId, source,
        // 取り消せる1分を数えるため、サーバーの時刻で入れる
        createdAt: new Date(),
      }).returning();
      if (admin) await logChange(tx, { recordId: record!.id, employeeId, workDate, action: "add", after: record, actor: who.actor });

      // 退勤のとき：日報をまとめて残し、入力中の下書きを消す（15秒後に古い発着地が戻らないように）
      if (eventType === "clock_out") {
        const all = [...existing, record!];
        const [draft] = await tx.select().from(attendanceDraftsTable).where(and(eq(attendanceDraftsTable.employeeId, employeeId), eq(attendanceDraftsTable.workDate, workDate)));
        const rep = body.report ?? {};
        const s = all.find(r => r.startOdometer != null)?.startOdometer ?? draft?.startOdometer ?? null;
        const e = [...all].reverse().find(r => r.endOdometer != null)?.endOdometer ?? draft?.endOdometer ?? null;
        const waiting = rep.waitingMinutes === undefined || rep.waitingMinutes === null || rep.waitingMinutes === "" ? null : Math.max(0, Math.min(1440, Math.round(Number(rep.waitingMinutes)) || 0));
        const str = (v: unknown, n = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
        const values = {
          vehicle: str(rep.vehicle, 40),
          departure: str(rep.departure) ?? draft?.departure ?? null,
          arrival: str(rep.arrival) ?? draft?.arrival ?? null,
          startOdometer: s, endOdometer: e,
          distanceKm: s != null && e != null && e >= s ? Math.round((e - s) * 10) / 10 : null,
          shipper: str(rep.shipper, 200), waitingMinutes: waiting, note: str(rep.note, 1000),
          updatedAt: new Date(),
        };
        await tx.insert(dailyReportsTable).values({ employeeId, workDate, ...values })
          .onConflictDoUpdate({ target: [dailyReportsTable.employeeId, dailyReportsTable.workDate], set: values });
        if (!admin) await tx.delete(attendanceDraftsTable).where(and(eq(attendanceDraftsTable.employeeId, employeeId), eq(attendanceDraftsTable.workDate, workDate)));
      }
      return { record: record!, autoBreakEnd, workDate };
    });

    notifyAttendanceChanged();
    return res.status(201).json({ ...result.record, autoBreakEnd: result.autoBreakEnd });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (isUniqueViolation(err, "attendance_records_client_unique") && clientId) {
      const [dup] = await db.select().from(attendanceRecordsTable)
        .where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.clientId, clientId)));
      if (dup) return res.status(200).json({ ...dup, duplicate: true });
    }
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: `この日にすでに「${EVENT_LABELS[eventType]}」の打刻が登録されています`, code: "duplicate" });
    }
    throw err;
  }
});

// ── 押して1分以内なら、自分で取り消せる（消さずに「取り消し」の印を付けて残す） ──
router.post("/attendance/records/:id/cancel", async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "id が不正です" });
  const [rec] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
  if (!rec || rec.voidedAt) return res.status(404).json({ error: "打刻が見つかりません（すでに取り消したかもしれません）" });
  const who = await resolveActor(req, res, rec.employeeId);
  if (!who) return;
  if (who.employeeId !== rec.employeeId) return res.status(403).json({ error: "他の人の打刻は取り消せません" });
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? String((req.body as { reason: string }).reason).slice(0, 300) : null;
  if (!who.admin) {
    if (Date.now() - new Date(rec.createdAt).getTime() > 70_000) {
      return res.status(409).json({ error: "取り消せるのは押してから1分以内です。あとからは「打刻の修正を申請」で直してください。", code: "too-late" });
    }
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7001, ${rec.employeeId})`);
    const recs = await shiftRecords(rec.employeeId, rec.workDate, tx);
    const last = recs[recs.length - 1];
    // 本人が取り消せるのは、いちばん新しい打刻だけ（退勤と一緒に自動で入れた休憩終了は一緒に取り消す）
    const targets = [rec];
    if (!who.admin && last && last.id !== rec.id) throw new HttpError(409, { error: "取り消せるのはいちばん新しい打刻だけです。" });
    if (rec.eventType === "clock_out") {
      const auto = recs.find(r => r.source === "auto" && r.eventType === "break_end" && Math.abs(new Date(r.recordedAt).getTime() - (new Date(rec.recordedAt).getTime() - 1000)) < 1500);
      if (auto) targets.push(auto);
    }
    for (const t of targets) {
      const [u] = await tx.update(attendanceRecordsTable).set({ voidedAt: new Date(), voidReason: reason ?? "押し間違いの取り消し", voidedBy: who.actor })
        .where(eq(attendanceRecordsTable.id, t.id)).returning();
      await logChange(tx, { recordId: t.id, employeeId: t.employeeId, workDate: t.workDate, action: "cancel", before: t, after: u, actor: who.actor, reason: reason ?? "押し間違いの取り消し" });
    }
    return targets.map(t => t.id);
  }).catch((e) => { if (e instanceof HttpError) return e; throw e; });
  if (result instanceof HttpError) return res.status(result.status).json(result.body);
  notifyAttendanceChanged();
  return res.json({ ok: true, canceled: result });
});

// ── 打刻の場所をあとから付け足す（先に打刻を送り、位置が取れたら送る） ──
router.patch("/attendance/records/:id/location", async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const { latitude, longitude } = (req.body ?? {}) as { latitude?: unknown; longitude?: unknown };
  if (Number.isNaN(id) || typeof latitude !== "number" || typeof longitude !== "number" || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ error: "位置が正しくありません" });
  }
  const [rec] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
  if (!rec) return res.status(404).json({ error: "打刻が見つかりません" });
  const who = await resolveActor(req, res, rec.employeeId);
  if (!who) return;
  if (who.employeeId !== rec.employeeId) return res.status(403).json({ error: "他の人の打刻です" });
  if (rec.latitude != null) return res.json({ ok: true, skipped: true });
  if (Date.now() - new Date(rec.createdAt).getTime() > 15 * 60_000) return res.status(409).json({ error: "時間がたちすぎています" });
  await db.update(attendanceRecordsTable).set({ latitude, longitude }).where(eq(attendanceRecordsTable.id, id));
  notifyAttendanceChanged();
  return res.json({ ok: true });
});

// ── 打刻レコード修正（管理画面） ─────────────────────────────────
// 時刻・種類・勤務日を直す。同じ種類（出勤・退勤）が重ならないか、順番が合うかを確かめる。
// 順番が合わないときは 409（code: order）を返し、画面で確かめてから force: true で保存する。
router.patch("/attendance/records/:id", requireAttendanceRecordOwnerOrAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const { eventType, recordedAt, workDate, force, reason } = req.body as {
    eventType?: EventType; recordedAt?: string; workDate?: string; force?: boolean; reason?: string;
  };
  if (!eventType && !recordedAt && !workDate) {
    return res.status(400).json({ error: "eventType・recordedAt・workDate のいずれかが必要です" });
  }
  if (eventType && !EVENT_TYPES.includes(eventType)) return res.status(400).json({ error: "eventType が不正です" });
  if (workDate && !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ error: "workDate が不正です" });
  if (recordedAt && Number.isNaN(new Date(recordedAt).getTime())) return res.status(400).json({ error: "時刻が不正です" });

  try {
    const updated = await db.transaction(async (tx) => {
      const [target] = await tx.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
      if (!target || target.voidedAt) throw new HttpError(404, { error: "レコードが見つかりません" });
      await tx.execute(sql`select pg_advisory_xact_lock(7001, ${target.employeeId})`);
      const next = {
        eventType: eventType ?? target.eventType,
        recordedAt: recordedAt ? new Date(recordedAt) : target.recordedAt,
        workDate: workDate ?? target.workDate,
      };
      if (next.recordedAt.getTime() > Date.now() + 60_000) throw new HttpError(400, { error: "未来の時刻は登録できません" });
      const others = (await shiftRecords(target.employeeId, next.workDate, tx)).filter(r => r.id !== id);
      if ((next.eventType === "clock_in" || next.eventType === "clock_out") && others.some(r => r.eventType === next.eventType)) {
        throw new HttpError(409, { error: `${next.workDate} にすでに「${EVENT_LABELS[next.eventType as EventType]}」の打刻があります` });
      }
      const seqErr = sequenceError([...others, next]);
      if (seqErr && !force) throw new HttpError(409, { error: seqErr, code: "order", canForce: true });
      const [u] = await tx.update(attendanceRecordsTable).set(next).where(eq(attendanceRecordsTable.id, id)).returning();
      await logChange(tx, { recordId: id, employeeId: target.employeeId, workDate: next.workDate, action: "edit", before: target, after: u, actor: actorName(req), reason: typeof reason === "string" ? reason.slice(0, 300) : null });
      return u;
    });
    notifyAttendanceChanged();
    return res.json(updated);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (isUniqueViolation(err)) return res.status(409).json({ error: "同じ日に同じ種類の打刻がすでにあります" });
    throw err;
  }
});

// ── 2つの打刻の時刻を入れ替える（管理画面のドラッグ並べ替え）。1回で確かめて入れ替える ──
router.post("/attendance/records/swap", requireAdmin, async (req, res) => {
  const { a, b, force } = (req.body ?? {}) as { a?: number; b?: number; force?: boolean };
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return res.status(400).json({ error: "入れ替える打刻を2つ指定してください" });
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(attendanceRecordsTable).where(inArray(attendanceRecordsTable.id, [a!, b!]));
      const ra = rows.find(r => r.id === a), rb = rows.find(r => r.id === b);
      if (!ra || !rb || ra.voidedAt || rb.voidedAt) throw new HttpError(404, { error: "打刻が見つかりません" });
      if (ra.employeeId !== rb.employeeId || ra.workDate !== rb.workDate) throw new HttpError(400, { error: "同じ人・同じ日の打刻だけ入れ替えられます" });
      await tx.execute(sql`select pg_advisory_xact_lock(7001, ${ra.employeeId})`);
      const all = await shiftRecords(ra.employeeId, ra.workDate, tx);
      const swapped = all.map(r => r.id === ra.id ? { ...r, recordedAt: rb.recordedAt } : r.id === rb.id ? { ...r, recordedAt: ra.recordedAt } : r);
      const seqErr = sequenceError(swapped);
      if (seqErr && !force) throw new HttpError(409, { error: seqErr, code: "order", canForce: true });
      await tx.update(attendanceRecordsTable).set({ recordedAt: rb.recordedAt }).where(eq(attendanceRecordsTable.id, ra.id));
      await tx.update(attendanceRecordsTable).set({ recordedAt: ra.recordedAt }).where(eq(attendanceRecordsTable.id, rb.id));
      await logChange(tx, { recordId: ra.id, employeeId: ra.employeeId, workDate: ra.workDate, action: "edit", before: ra, after: { ...ra, recordedAt: rb.recordedAt }, actor: actorName(req), reason: "並べ替え" });
      await logChange(tx, { recordId: rb.id, employeeId: rb.employeeId, workDate: rb.workDate, action: "edit", before: rb, after: { ...rb, recordedAt: ra.recordedAt }, actor: actorName(req), reason: "並べ替え" });
    });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    throw err;
  }
  notifyAttendanceChanged();
  return res.json({ ok: true });
});

// ── 打刻レコード削除（管理画面） ─────────────────────────────────
// 消さずに「取り消し」の印を付けて残す（だれが・いつ・なぜを記録）
router.delete("/attendance/records/:id", requireAttendanceRecordOwnerOrAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const reason = typeof req.query.reason === "string" ? req.query.reason.slice(0, 300) : "管理画面で削除";
  const [rec] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
  if (!rec || rec.voidedAt) return res.status(404).json({ error: "レコードが見つかりません" });
  await db.transaction(async (tx) => {
    const [u] = await tx.update(attendanceRecordsTable).set({ voidedAt: new Date(), voidReason: reason, voidedBy: actorName(req) })
      .where(eq(attendanceRecordsTable.id, id)).returning();
    await logChange(tx, { recordId: id, employeeId: rec.employeeId, workDate: rec.workDate, action: "delete", before: rec, after: u, actor: actorName(req), reason });
  });
  notifyAttendanceChanged();
  return res.status(204).send();
});

// ── 日常点検（チェックリスト）取得（復元用） ────────────────
// いまの勤務の日付の点検を返す（深夜に日付をまたいでも同じ点検のまま）
router.get("/attendance/checklist/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params.employeeId), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const workDate = await currentShiftDate(employeeId);
  const [row] = await db.select().from(dailyInspectionsTable)
    .where(and(eq(dailyInspectionsTable.employeeId, employeeId), eq(dailyInspectionsTable.workDate, workDate)));
  const view = inspectionView(row);
  return res.json({
    workDate,
    checklistNgItems: view ? JSON.stringify({ total: view.total, checked: view.checked, ng: view.ng, items: view.items }) : null,
    inspection: view,
  });
});

// ── 日常点検のリアルタイム保存（出勤の前でも保存する） ────────────────
router.patch("/attendance/checklist/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params.employeeId), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const { checklistNgItems, vehicle } = (req.body ?? {}) as { checklistNgItems?: string; vehicle?: string | null };
  if (!checklistNgItems || typeof checklistNgItems !== "string" || checklistNgItems.length > 10_000) {
    return res.status(400).json({ error: "checklistNgItems が必要です" });
  }
  const parsed = parseJson<{ total?: number; ng?: string[]; items?: Record<string, string> }>(checklistNgItems, {});
  const items: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.items ?? {})) if ((v === "良" || v === "否") && k.length <= 40) items[k] = v;
  const total = Math.max(0, Math.min(200, Math.round(Number(parsed.total) || 0)));
  const ng = Array.isArray(parsed.ng) ? parsed.ng.map(x => String(x).slice(0, 80)).slice(0, 100) : [];
  const checked = Object.keys(items).length;
  const workDate = await currentShiftDate(employeeId);
  const veh = typeof vehicle === "string" ? vehicle.trim().slice(0, 40) || null : undefined;

  const { row, before } = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(dailyInspectionsTable)
      .where(and(eq(dailyInspectionsTable.employeeId, employeeId), eq(dailyInspectionsTable.workDate, workDate)));
    const set = { items: JSON.stringify(items), total, checked, ng: JSON.stringify(ng), updatedAt: new Date(), ...(veh !== undefined ? { vehicle: veh } : {}) };
    const [row] = await tx.insert(dailyInspectionsTable).values({ employeeId, workDate, ...set })
      .onConflictDoUpdate({ target: [dailyInspectionsTable.employeeId, dailyInspectionsTable.workDate], set }).returning();
    // 出勤したあとに書き換えたら履歴を残す
    const [clockIn] = await tx.select().from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.workDate, workDate), eq(attendanceRecordsTable.eventType, "clock_in"), active));
    if (clockIn) {
      if (before && (before.items !== row!.items || (before.vehicle ?? null) !== (row!.vehicle ?? null))) {
        await tx.insert(inspectionHistoryTable).values({ inspectionId: row!.id, employeeId, workDate, before: JSON.stringify({ items: parseJson(before.items, {}), vehicle: before.vehicle }), after: JSON.stringify({ items, vehicle: row!.vehicle }), actor: actorName(req) });
      }
      await tx.update(attendanceRecordsTable).set({ checklistNgItems: JSON.stringify({ total, checked, ng, items }) }).where(eq(attendanceRecordsTable.id, clockIn.id));
    }
    return { row: row!, before };
  });

  // 「否」が新しく付いたら事務所へすぐ知らせる
  const prevNg = before ? parseJson<string[]>(before.ng, []) : [];
  const fresh = ng.filter(x => !prevNg.includes(x));
  if (fresh.length > 0) {
    later(async () => {
      const [emp] = await db.select({ name: employeesTable.name }).from(employeesTable).where(eq(employeesTable.id, employeeId));
      await pushOnce(`inspng:${employeeId}:${workDate}:${[...ng].sort().join("|")}`.slice(0, 200), () => pushToOffice({
        title: `日常点検で「否」：${emp?.name ?? "従業員"}`,
        body: `${fresh.join("・")}${row.vehicle ? `（${row.vehicle}）` : ""}。処置と運行してよいかを勤怠管理で記録してください。`,
        url: "/attendance",
      }));
    });
  }
  notifyAttendanceChanged();
  return res.json(inspectionView(row));
});

// ── 入力ドラフト 取得 ─────────────────────────────────
router.get("/attendance/draft/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params.employeeId), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const workDate = await currentShiftDate(employeeId);
  const [draft] = await db.select().from(attendanceDraftsTable)
    .where(and(eq(attendanceDraftsTable.employeeId, employeeId), eq(attendanceDraftsTable.workDate, workDate))).limit(1);
  return res.json(draft ?? null);
});

// ── 入力ドラフト 保存（upsert）。送られてきた項目だけ書き換える ───────────────────────
router.patch("/attendance/draft/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params.employeeId), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if ("departure" in b) set.departure = typeof b.departure === "string" ? b.departure.slice(0, 1000) : null;
  if ("arrival" in b) set.arrival = typeof b.arrival === "string" ? b.arrival.slice(0, 1000) : null;
  for (const k of ["startOdometer", "endOdometer"] as const) {
    if (!(k in b)) continue;
    const v = odoValue(b[k]);
    if (v === "bad") return res.status(400).json({ error: "メーターの値が正しくありません" });
    set[k] = v;
  }
  const workDate = await currentShiftDate(employeeId);
  const [upserted] = await db.insert(attendanceDraftsTable)
    .values({ employeeId, workDate, ...set } as typeof attendanceDraftsTable.$inferInsert)
    .onConflictDoUpdate({ target: [attendanceDraftsTable.employeeId, attendanceDraftsTable.workDate], set })
    .returning();
  notifyAttendanceChanged();
  return res.json(upserted);
});

// ── 社員の打刻履歴（日付指定） ───────────────────────
router.get("/attendance/employee/:employeeId", requireOwnerOrAdmin(req => parseInt(paramStr(req.params.employeeId), 10)), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const { date } = req.query;
  const targetDate = typeof date === "string" && date ? date : await currentShiftDate(employeeId);
  return res.json(await shiftRecords(employeeId, targetDate));
});

// ── 社員の月間打刻履歴 ───────────────────────────────
router.get("/attendance/employee/:employeeId/month", requireOwnerOrAdmin(req => parseInt(paramStr(req.params.employeeId), 10), { requirePin: true }), async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.employeeId), 10);
  const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const records = await db.select().from(attendanceRecordsTable)
    .where(and(eq(attendanceRecordsTable.employeeId, employeeId), gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, to), active))
    .orderBy(attendanceRecordsTable.workDate, attendanceRecordsTable.recordedAt);
  return res.json(records);
});

/**
 * 月の勤怠集計の中身（月次実績への取り込み用）。lib/alerts-attendance.ts からも使う。
 *
 * 数え方：
 *   実働   … 出勤〜退勤から休憩を引いた時間。1日に2回出退勤していれば全部足す。分のまま足して月の合計で丸める。
 *   残業   … 平日に8時間を超えた分（overtimeHours）。土曜・日曜・祝日に8時間を超えた分は別（restDayOvertimeHours）。
 *            以前は1日ごとに0.1時間で丸めてから足していた。いまは分のまま足し、月の合計を0.1時間単位で四捨五入する。
 *   深夜   … 22時〜翌5時に働いた時間（休憩を除く）。
 *   打ち忘れ … 退勤が無い日（その日は0時間）・出勤が無い日を一覧で返す。
 */
export async function monthlySummary(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const allRecords = await db.select().from(attendanceRecordsTable)
    .where(and(gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, to), active))
    .orderBy(attendanceRecordsTable.employeeId, attendanceRecordsTable.workDate, attendanceRecordsTable.recordedAt);

  const byEmpDate = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    const key = `${r.employeeId}:${r.workDate}`;
    if (!byEmpDate.has(key)) byEmpDate.set(key, []);
    byEmpDate.get(key)!.push(r);
  }

  // 1日分の走行距離：その日の打刻で最初に出発の値があるもの〜最後に帰着の値があるもの
  // （以前は出勤の打刻の出発メーターしか見ず、出勤の後に入れると0kmになっていた）
  function calcDrivingKm(recs: typeof allRecords): number {
    const start = recs.find(r => r.startOdometer != null);
    const end = [...recs].reverse().find(r => r.endOdometer != null);
    if (start?.startOdometer != null && end?.endOdometer != null) return Math.max(0, end.endOdometer - start.startOdometer);
    return 0;
  }

  const allEmployees = await db.select({ id: employeesTable.id, salaryType: employeesTable.salaryType, isOfficeStaff: employeesTable.isOfficeStaff }).from(employeesTable);
  const empInfoMap = new Map(allEmployees.map(e => [e.id, e]));
  const settings = await getAttendanceSettings();

  interface Acc {
    workDays: number; saturdayWorkDays: number; sundayWorkDays: number; holidayWorkDays: number;
    sundayMin: number; overtimeMin: number; restDayOvertimeMin: number; nightMin: number; billingMin: number; km: number;
    missingClockOut: string[]; missingClockIn: string[]; attendDates: string[];
  }
  const acc = new Map<number, Acc>();
  const get = (id: number) => {
    if (!acc.has(id)) acc.set(id, { workDays: 0, saturdayWorkDays: 0, sundayWorkDays: 0, holidayWorkDays: 0, sundayMin: 0, overtimeMin: 0, restDayOvertimeMin: 0, nightMin: 0, billingMin: 0, km: 0, missingClockOut: [], missingClockIn: [], attendDates: [] });
    return acc.get(id)!;
  };

  for (const [key, recs] of byEmpDate.entries()) {
    const [empIdStr, dateStr] = key.split(":") as [string, string];
    const empId = parseInt(empIdStr, 10);
    const s = get(empId);
    if (!recs.some(r => r.eventType === "clock_in")) { s.missingClockIn.push(dateStr); continue; }
    if (!recs.some(r => r.eventType === "clock_out")) s.missingClockOut.push(dateStr);
    s.attendDates.push(dateStr);

    const st = shiftStats(recs);
    const work = st.workMinutes;
    s.nightMin += st.nightMinutes;
    s.km += calcDrivingKm(recs);
    const info = empInfoMap.get(empId);
    s.billingMin += info && roundsUpTo30(settings, info) ? Math.ceil(work / 30) * 30 : work;

    const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=日, 6=土
    const over = Math.max(0, work - 480);
    if (dow === 0) {
      s.sundayWorkDays += 1;
      s.sundayMin += work;
      s.restDayOvertimeMin += over;
    } else if (dow === 6) {
      s.saturdayWorkDays += 1;
      s.restDayOvertimeMin += over;
    } else if (holidayName(dateStr)) {
      // 平日の祝日は「祝日出勤」（土曜と同じ1.25倍の日当）。8時間を超えた分は休日の残業として別に数える。
      s.holidayWorkDays += 1;
      s.restDayOvertimeMin += over;
    } else {
      s.workDays += 1;
      s.overtimeMin += over;
    }
  }

  const absenceRecs = await db.select().from(absenceRecordsTable)
    .where(and(gte(absenceRecordsTable.workDate, from), lte(absenceRecordsTable.workDate, to)));
  // 有給休暇（半日の有給を含む）は「休んでも賃金が出る」ので欠勤控除の対象にしない（paidLeaveDays に分ける）
  const absenceSummary = new Map<number, number>();
  const paidLeaveSummary = new Map<number, number>();
  const conflicts = new Map<number, string[]>();
  for (const a of absenceRecs) {
    const days = ABSENCE_DAYS[a.absenceType] ?? 1.0;
    const target = isPaidLeave(a.absenceType) ? paidLeaveSummary : absenceSummary;
    target.set(a.employeeId, (target.get(a.employeeId) ?? 0) + days);
    get(a.employeeId);
    // 1日休みなのに出勤がある日
    if (isFullDayAbsence(a.absenceType) && acc.get(a.employeeId)!.attendDates.includes(a.workDate)) {
      conflicts.set(a.employeeId, [...(conflicts.get(a.employeeId) ?? []), a.workDate]);
    }
  }

  const r1 = (min: number) => Math.round(min / 6) / 10;
  return Array.from(acc.entries()).map(([employeeId, s]) => ({
    employeeId,
    workDays: s.workDays,
    saturdayWorkDays: s.saturdayWorkDays,
    sundayWorkDays: s.sundayWorkDays,
    sundayWorkHours: r1(s.sundayMin),
    holidayWorkDays: s.holidayWorkDays,
    overtimeHours: r1(s.overtimeMin),
    /** 土曜・日曜・祝日に8時間を超えた分（給与にどう使うかは給与計算の側で決める） */
    restDayOvertimeHours: r1(s.restDayOvertimeMin),
    /** 深夜（22時〜翌5時）の時間 */
    lateNightHours: r1(s.nightMin),
    drivingDistanceKm: Math.round(s.km * 10) / 10,
    actualWorkHours: Math.round((s.billingMin / 60) * 100) / 100,
    absenceDays: Math.round((absenceSummary.get(employeeId) ?? 0) * 10) / 10,
    paidLeaveDays: Math.round((paidLeaveSummary.get(employeeId) ?? 0) * 10) / 10,
    /** 退勤が無い日（その日の実働は0時間で数えている） */
    missingClockOut: s.missingClockOut.sort(),
    /** 出勤が無いのに休憩・退勤だけある日（数えていない） */
    missingClockIn: s.missingClockIn.sort(),
    /** 1日休み（欠勤・有給など）なのに出勤もある日 */
    absenceConflicts: (conflicts.get(employeeId) ?? []).sort(),
  }));
}

// ── 全社員の月間勤怠集計（月次実績入力への取り込み用） ──
router.get("/attendance/monthly-summary", requireAdmin, async (req, res) => {
  const year  = parseInt(req.query.year  as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);
  return res.json(await monthlySummary(year, month));
});

// ── ライブ位置情報 更新（ドライバーから定期送信） ────────────
router.post("/attendance/location/live", requireOwnerOrAdmin(req => Number((req.body as { employeeId?: number })?.employeeId)), async (req, res) => {
  const { employeeId: bodyEmployeeId, latitude, longitude, accuracy } = req.body as {
    employeeId: number; latitude: number; longitude: number; accuracy?: number;
  };
  const employeeId = req.session?.role === "driver" ? Number(req.session.employeeId) : Number(bodyEmployeeId);
  if (!employeeId || typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "employeeId, latitude, longitude は必須です" });
  }
  await db.insert(liveLocationsTable)
    .values({ employeeId, latitude, longitude, accuracy: accuracy ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({ target: liveLocationsTable.employeeId, set: { latitude, longitude, accuracy: accuracy ?? null, updatedAt: new Date() } });
  return res.status(200).json({ ok: true });
});

/** 社員ごとの「いまの勤務」の打刻（地図用） */
async function currentShiftRecordsAll(employeeIds: number[]) {
  const dates = await currentShiftDates(employeeIds);
  const ds = [...new Set(dates.values())];
  const recs = ds.length === 0 ? [] : await db.select().from(attendanceRecordsTable)
    .where(and(inArray(attendanceRecordsTable.workDate, ds), active))
    .orderBy(attendanceRecordsTable.recordedAt, attendanceRecordsTable.id);
  return { dates, recs };
}

// ── ライブ位置情報 全社員取得（マップ表示用） ─────────────
router.get("/attendance/location/live", requireAdmin, async (_req, res) => {
  const [employees, liveRows] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.isActive, true)).orderBy(asc(employeesTable.employeeCode)),
    db.select().from(liveLocationsTable),
  ]);
  const { dates, recs } = await currentShiftRecordsAll(employees.map(e => e.id));
  const liveMap = new Map(liveRows.map(r => [r.employeeId, r]));

  return res.json(employees.map(emp => {
    const empRecords = recs.filter(r => r.employeeId === emp.id && r.workDate === dates.get(emp.id));
    const live = liveMap.get(emp.id);
    const isRecent = live ? (Date.now() - new Date(live.updatedAt).getTime()) < 5 * 60 * 1000 : false;
    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: emp.department,
      workDate: dates.get(emp.id),
      status: statusOf(empRecords),
      latitude: isRecent ? live!.latitude : null,
      longitude: isRecent ? live!.longitude : null,
      accuracy: isRecent ? (live!.accuracy ?? null) : null,
      lastUpdated: isRecent ? live!.updatedAt : null,
      eventLocations: empRecords.filter(r => r.latitude != null && r.longitude != null).map(r => ({
        eventType: r.eventType, recordedAt: r.recordedAt, latitude: r.latitude as number, longitude: r.longitude as number,
      })),
    };
  }));
});

// ── 全社員の最新GPS位置情報（リアルタイムマップ用） ────────
router.get("/attendance/gps-locations", requireAdmin, async (_req, res) => {
  const employees = await db.select().from(employeesTable).where(eq(employeesTable.isActive, true)).orderBy(asc(employeesTable.employeeCode));
  const { dates, recs } = await currentShiftRecordsAll(employees.map(e => e.id));
  return res.json(employees.map(emp => {
    const empRecords = recs.filter(r => r.employeeId === emp.id && r.workDate === dates.get(emp.id));
    const latestGps = [...empRecords].reverse().find(r => r.latitude != null && r.longitude != null);
    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: emp.department,
      status: statusOf(empRecords),
      latitude: latestGps?.latitude ?? null,
      longitude: latestGps?.longitude ?? null,
      lastEventType: latestGps?.eventType ?? null,
      lastGpsTime: latestGps?.recordedAt ?? null,
    };
  }));
});

// ── 打刻の変更の記録（管理画面） ─────────────────────────────
router.get("/attendance/logs", requireAdmin, async (req: Request, res) => {
  const employeeId = parseInt(String(req.query.employeeId ?? ""), 10);
  const from = typeof req.query.from === "string" ? req.query.from : addDaysStr(jstDate(), -31);
  const to = typeof req.query.to === "string" ? req.query.to : jstDate();
  const conds = [gte(attendanceRecordLogsTable.workDate, from), lte(attendanceRecordLogsTable.workDate, to)];
  if (!Number.isNaN(employeeId)) conds.push(eq(attendanceRecordLogsTable.employeeId, employeeId));
  const rows = await db.select().from(attendanceRecordLogsTable).where(and(...conds)).orderBy(desc(attendanceRecordLogsTable.at)).limit(500);
  return res.json(rows);
});

export default router;
