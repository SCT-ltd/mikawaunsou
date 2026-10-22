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
 */
export interface AttendanceSettings {
  requireChecklist: boolean;
  requireAlcohol: boolean;
  vehicles: string[];
  officeRounding: "all_office" | "hourly_only" | "none";
}

export const DEFAULT_SETTINGS: AttendanceSettings = {
  requireChecklist: false,
  requireAlcohol: false,
  vehicles: [],
  officeRounding: "all_office",
};

let cache: { at: number; value: AttendanceSettings } | null = null;

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
