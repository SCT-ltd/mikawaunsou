import { db, attendanceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * 勤怠の設定（会社ごとに1つ）。
 *  - requireChecklist … 日常点検を全部終えないと出勤できないようにする（既定は「促すだけ」）
 *  - requireAlcohol   … 乗る前のアルコールチェックを記録しないと出勤できないようにする（既定は「促すだけ」）
 *  - vehicles         … 車両番号の一覧（点検・アルコールチェック・日報で選ぶ）
 *  - officeRounding   … 事務員の実働時間を30分単位で切り上げる相手
 *       'all_office'  … 事務員は全員（時給も月給も）＝これまでと同じ
 *       'hourly_only' … 時給の人だけ
 *       'none'        … 切り上げない
 *  - lateGraceMinutes   … 予定（シフト）より何分までの遅れ・早上がりは遅刻・早退にしないか（既定5分）
 *  - noShowAlertMinutes … 予定の始まりから何分たっても出勤していなければ知らせるか（既定15分）
 *  - noShowAlert        … 上の知らせを出すか（ベルとPCの通知）
 */
export interface AttendanceSettings {
  requireChecklist: boolean;
  requireAlcohol: boolean;
  vehicles: string[];
  officeRounding: "all_office" | "hourly_only" | "none";
  lateGraceMinutes: number;
  noShowAlertMinutes: number;
  noShowAlert: boolean;
  /** 一覧に「未点検」の札を出すか（日常点検を使っていなければ全員に付いて目障りなので消せる） */
  showUninspected: boolean;
  /** 地図：勤務中（出勤〜退勤）だけ位置を残す・見せる（勤務時間の外の位置は扱わない） */
  mapTrackOnlyOnDuty: boolean;
  /** 地図：勤務中なのに位置が◯分届かなければ知らせる */
  mapStaleMinutes: number;
  /** 地図：登録した場所の外で◯分以上止まっていたら知らせる（0＝知らせない） */
  mapLongStopMinutes: number;
  /** 地図：位置の記録を残す日数（過ぎたら消す。到着・出発の記録は残す） */
  mapRetentionDays: number;
}

export const DEFAULT_SETTINGS: AttendanceSettings = {
  requireChecklist: false,
  requireAlcohol: false,
  vehicles: [],
  officeRounding: "all_office",
  lateGraceMinutes: 5,
  noShowAlertMinutes: 15,
  noShowAlert: true,
  showUninspected: true,
  mapTrackOnlyOnDuty: true,
  mapStaleMinutes: 10,
  mapLongStopMinutes: 30,
  mapRetentionDays: 60,
};

let cache: { at: number; value: AttendanceSettings } | null = null;

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalize(raw: unknown): AttendanceSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const vehicles = Array.isArray(o.vehicles)
    ? [...new Set(o.vehicles.map(v => String(v ?? "").trim()).filter(v => v && v.length <= 40))].slice(0, 200)
    : [];
  const r = o.officeRounding;
  return {
    requireChecklist: o.requireChecklist === true,
    requireAlcohol: o.requireAlcohol === true,
    vehicles,
    officeRounding: r === "hourly_only" || r === "none" ? r : "all_office",
    lateGraceMinutes: clampInt(o.lateGraceMinutes, 0, 120, 5),
    noShowAlertMinutes: clampInt(o.noShowAlertMinutes, 0, 240, 15),
    noShowAlert: o.noShowAlert !== false,
    showUninspected: o.showUninspected !== false,
    mapTrackOnlyOnDuty: o.mapTrackOnlyOnDuty !== false,
    mapStaleMinutes: clampInt(o.mapStaleMinutes, 3, 120, 10),
    mapLongStopMinutes: clampInt(o.mapLongStopMinutes, 0, 480, 30),
    mapRetentionDays: clampInt(o.mapRetentionDays, 7, 400, 60),
  };
}

export async function getAttendanceSettings(): Promise<AttendanceSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [row] = await db.select().from(attendanceSettingsTable).where(eq(attendanceSettingsTable.id, 1));
  let parsed: unknown = {};
  try { parsed = row ? JSON.parse(row.data) : {}; } catch { parsed = {}; }
  const value = normalize(parsed);
  cache = { at: Date.now(), value };
  return value;
}

export async function saveAttendanceSettings(patch: Partial<AttendanceSettings>): Promise<AttendanceSettings> {
  const cur = await getAttendanceSettings();
  const value = normalize({ ...cur, ...patch });
  await db.insert(attendanceSettingsTable).values({ id: 1, data: JSON.stringify(value), updatedAt: new Date() })
    .onConflictDoUpdate({ target: attendanceSettingsTable.id, set: { data: JSON.stringify(value), updatedAt: new Date() } });
  cache = { at: Date.now(), value };
  return value;
}

/** 実働時間を30分単位で切り上げる社員か */
export function roundsUpTo30(s: AttendanceSettings, emp: { salaryType: string | null; isOfficeStaff: boolean | null }): boolean {
  if (s.officeRounding === "none") return false;
  if (s.officeRounding === "hourly_only") return emp.salaryType === "hourly";
  return emp.salaryType === "hourly" || emp.isOfficeStaff === true;
}
