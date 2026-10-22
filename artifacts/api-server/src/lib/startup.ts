import { sql, eq, isNull, or } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { hashSecret, isHashed } from "./password";
import { newQrKey } from "./driver-token";
import { logger } from "./logger";

/**
 * 起動時の確認と後片付け。
 * 1. DB の変更（deploy/migrations の SQL）を当て忘れていないか、要る列・表があるかを確かめる。
 *    当て忘れたまま動くと、明細の一覧などが「column does not exist」で全部 500 になるため、起動を止めて知らせる。
 * 2. 平文で残っている暗証番号を、新しい保存形式（scrypt）に書き換える。
 * 3. QR の合言葉が無い社員に配る。
 */
const REQUIRED: Array<[string, string]> = [
  ["employee_month_sets", "auto_values"],
  ["employee_month_sets", "employment_insurance_override"],
  ["payrolls", "public_holiday_work_days"],
  ["alert_reads", "key"],
  ["alert_pushes", "key"],
  ["audit_logs", "action"],
  ["employees", "qr_key"],
  // 2026-10-24-batch-b.sql（ドライバー側と勤怠）
  ["attendance_records", "client_id"],
  ["attendance_records", "voided_at"],
  ["attendance_records", "source"],
  ["messages", "client_id"],
  ["attendance_record_logs", "action"],
  ["attendance_corrections", "status"],
  ["daily_inspections", "items"],
  ["inspection_history", "inspection_id"],
  ["alcohol_checks", "value_mg"],
  ["daily_reports", "shipper"],
  ["attendance_settings", "data"],
  // 2026-10-24-batch-c.sql（振込）
  ["employee_bank_accounts", "holder_kana"],
  ["transfer_settings", "consignor_code"],
  // 2026-10-25-schedules.sql（出勤の予定）
  ["work_schedules", "start_time"],
  ["schedule_patterns", "data"],
  // 2026-10-24-batch-d.sql（給与計算と法令）
  ["company", "rule_premium_base_includes_allowances"],
  ["company", "minimum_wage_hourly"],
  ["company", "bonus_tax_rate_table"],
  ["employees", "social_insurance_exempt"],
  ["employees", "health_insurance_mode"],
  ["employees", "tax_column"],
  ["employees", "retirement_date"],
  ["monthly_records", "rest_day_overtime_hours"],
  ["allowance_definitions", "include_in_premium_base"],
  ["payrolls", "health_insurance_amount"],
  ["payrolls", "calc_warnings"],
  ["resident_tax_schedules", "collect_month"],
  ["paid_leave_adjustments", "days"],
  ["bonus_payments", "income_tax"],
  ["yearend_declarations", "data"],
  ["employment_insurance_settlements", "apply_month"],
];

export async function startupChecks(): Promise<void> {
  const rows = await db.execute(sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`);
  const have = new Set((rows.rows as Array<{ table_name: string; column_name: string }>).map((r) => `${r.table_name}.${r.column_name}`));
  const missing = REQUIRED.filter(([t, c]) => !have.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);
  if (missing.length > 0) {
    logger.fatal({ missing }, "DB の変更が当たっていません。deploy/migrations の SQL を当ててから起動してください");
    throw new Error(`DB の変更が当たっていません: ${missing.join(", ")}`);
  }

  const emps = await db.select({ id: employeesTable.id, pin: employeesTable.pin, qrKey: employeesTable.qrKey }).from(employeesTable)
    .where(or(isNull(employeesTable.qrKey), sql`${employeesTable.pin} is not null and ${employeesTable.pin} not like 'scrypt$%'`));
  let pins = 0, keys = 0;
  for (const e of emps) {
    const set: Record<string, unknown> = {};
    if (e.pin && !isHashed(e.pin)) { set.pin = hashSecret(e.pin); pins++; }
    if (!e.qrKey) { set.qrKey = newQrKey(); keys++; }
    if (Object.keys(set).length) await db.update(employeesTable).set(set).where(eq(employeesTable.id, e.id));
  }
  if (pins || keys) logger.info({ pins, keys }, "暗証番号の保存形式の変更・QR の合言葉の配布をしました");
}
