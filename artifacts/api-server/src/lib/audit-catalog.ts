import type { Request } from "express";

/**
 * 操作の記録の「辞書」。どの窓口が何の操作か（日本語の名前・分類）と、
 * 変更の前後を取るための読み出し方をここに1か所でまとめる。
 *
 * - snap … 変更の前と後に同じ問い合わせを流して、変わった項目を残す（[前, 後]）。
 *          1件の行（one: true）か、行の一覧（社員の手当など）を返す。
 * - manual … 窓口の中で中身つきで記録している（暗証番号・振込口座など）。共通の記録では残さない。
 * - driver … QR の打刻ページ（ログインなし）からも来る。社員の名前で残す。
 * - throttleSec … 続けて何度も来る操作（点検の保存など）は、この秒数の間は1件にまとめる。
 * - quiet … 中身を残さない（位置など）。
 * ここに無い書き込みも「POST /パス」の名前で必ず残る（取りこぼさない）。
 */

export type AuditCategory = "勤怠" | "給与" | "社員" | "マスター" | "設定" | "ユーザー" | "メッセージ" | "ログイン" | "書き出し" | "その他";

export interface Snap {
  one?: boolean;
  sql: string;
  args: (m: RegExpExecArray, req: Request) => unknown[];
}

export interface AuditSpec {
  method: string;
  re: RegExp;
  label: string | ((req: Request, m: RegExpExecArray) => string);
  category: AuditCategory;
  snap?: Snap | Record<string, Snap>;
  emp?: (m: RegExpExecArray, req: Request) => number | null;
  manual?: boolean;
  skip?: boolean;
  driver?: boolean;
  throttleSec?: number;
  quiet?: boolean;
}

const EV: Record<string, string> = { clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了" };
const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const byId = (table: string, i = 1): Snap => ({ one: true, sql: `select * from ${table} where id = $1`, args: (m) => [Number(m[i])] });
const p1 = (m: RegExpExecArray) => n(m[1]);
const bodyEmp = (_m: RegExpExecArray, req: Request) => n((req.body as Record<string, unknown> | undefined)?.["employeeId"]);
const bodyYm = (req: Request) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  return [n(b["employeeId"]), n(b["year"]), n(b["month"])];
};

/** 年月（?year=&month= か、本文の year・month） */
const qYm = (req: Request): [number | null, number | null] => {
  const q = (req.query ?? {}) as Record<string, unknown>, b = (req.body ?? {}) as Record<string, unknown>;
  return [n(q["year"] ?? b["year"]), n(q["month"] ?? b["month"])];
};

export const SPECS: AuditSpec[] = [
  // ── 勤怠 ───────────────────────────────────────────
  { method: "POST", re: /^\/attendance\/record$/, category: "勤怠", driver: true, emp: bodyEmp,
    label: (req) => { const e = EV[String((req.body as Record<string, unknown>)?.["eventType"])] ?? ""; return req.session?.userId ? `打刻を追加（${e}）` : `打刻（${e}）`; } },
  { method: "POST", re: /^\/attendance\/records\/(\d+)\/cancel$/, category: "勤怠", driver: true, label: "打刻を取り消し（押した直後）", snap: byId("attendance_records") },
  { method: "PATCH", re: /^\/attendance\/records\/(\d+)\/location$/, category: "勤怠", driver: true, quiet: true, label: "打刻の場所を付け足し", snap: byId("attendance_records") },
  { method: "PATCH", re: /^\/attendance\/records\/(\d+)$/, category: "勤怠", label: "打刻を修正", snap: byId("attendance_records") },
  { method: "POST", re: /^\/attendance\/records\/swap$/, category: "勤怠", label: "打刻の順番を入れ替え",
    snap: { sql: "select * from attendance_records where id = any($1::int[]) order by id", args: (_m, req) => { const b = (req.body ?? {}) as Record<string, unknown>; return [[n(b["a"]) ?? 0, n(b["b"]) ?? 0]]; } } },
  { method: "DELETE", re: /^\/attendance\/records\/(\d+)$/, category: "勤怠", label: "打刻を削除", snap: byId("attendance_records") },
  { method: "PATCH", re: /^\/attendance\/checklist\/(\d+)$/, category: "勤怠", driver: true, throttleSec: 600, emp: p1, label: "日常点検を記録" },
  { method: "PATCH", re: /^\/attendance\/draft\/\d+$/, category: "勤怠", skip: true, label: "" },
  { method: "POST", re: /^\/attendance\/location\/live$/, category: "勤怠", skip: true, label: "" },
  { method: "POST", re: /^\/absences$/, category: "勤怠", emp: bodyEmp, label: "欠勤・休暇を登録" },
  { method: "DELETE", re: /^\/absences\/(\d+)$/, category: "勤怠", label: "欠勤・休暇を取り消し", snap: byId("absence_records") },
  { method: "PUT", re: /^\/attendance\/settings$/, category: "設定", manual: true, label: "勤怠の設定を変更" },
  { method: "POST", re: /^\/attendance\/corrections$/, category: "勤怠", driver: true, emp: bodyEmp, label: "打刻の修正を申請" },
  { method: "POST", re: /^\/attendance\/corrections\/(\d+)\/decide$/, category: "勤怠", snap: byId("attendance_corrections"),
    label: (req) => ((req.body as Record<string, unknown>)?.["approve"] ? "打刻の修正申請を承認" : "打刻の修正申請を却下") },
  { method: "POST", re: /^\/attendance\/alcohol$/, category: "勤怠", driver: true, emp: bodyEmp, label: "アルコールチェックを記録" },
  { method: "PATCH", re: /^\/attendance\/alcohol\/(\d+)$/, category: "勤怠", label: "アルコールチェックを直す", snap: byId("alcohol_checks") },
  { method: "PATCH", re: /^\/attendance\/reports\/(\d+)$/, category: "勤怠", label: "日報を直す", snap: byId("daily_reports") },
  { method: "PATCH", re: /^\/attendance\/inspections\/(\d+)$/, category: "勤怠", label: "日常点検を直す", snap: byId("daily_inspections") },
  { method: "PUT", re: /^\/attendance\/schedule-patterns\/(\d+)$/, category: "勤怠", emp: p1, label: "出勤の予定の型を変更",
    snap: { one: true, sql: "select * from schedule_patterns where employee_id = $1", args: (m) => [Number(m[1])] } },
  { method: "PUT", re: /^\/attendance\/schedules\/(\d+)\/([\d-]+)$/, category: "勤怠", emp: p1, label: (_r, m) => `出勤の予定を変更（${m[2]}）`,
    snap: { one: true, sql: "select * from work_schedules where employee_id = $1 and work_date = $2", args: (m) => [Number(m[1]), m[2]] } },
  { method: "DELETE", re: /^\/attendance\/schedules\/(\d+)\/([\d-]+)$/, category: "勤怠", emp: p1, label: (_r, m) => `出勤の予定を消去（${m[2]}）`,
    snap: { one: true, sql: "select * from work_schedules where employee_id = $1 and work_date = $2", args: (m) => [Number(m[1]), m[2]] } },
  { method: "PUT", re: /^\/attendance\/month-checks\/(\d+)\/([\d-]+)$/, category: "勤怠", emp: p1, label: (_r, m) => `月の勤怠を確認済みにする（${m[2]}）` },
  { method: "DELETE", re: /^\/attendance\/month-checks\/(\d+)\/([\d-]+)$/, category: "勤怠", emp: p1, label: (_r, m) => `月の勤怠の確認済みを外す（${m[2]}）` },

  // ── 給与 ───────────────────────────────────────────
  { method: "POST", re: /^\/payroll\/calculate$/, category: "給与", emp: bodyEmp, label: (req) => { const [, y, mo] = bodyYm(req); return y && mo ? `給与を計算（${y}年${mo}月）` : "給与を計算"; },
    snap: { one: true, sql: "select * from payrolls where employee_id = $1 and year = $2 and month = $3", args: (_m, req) => bodyYm(req) } },
  { method: "PUT", re: /^\/payroll\/(\d+)$/, category: "給与", label: "給与明細を手で直す", snap: byId("payrolls") },
  { method: "POST", re: /^\/payroll\/(\d+)\/(confirm|unconfirm)$/, category: "給与", manual: true, label: "" },
  { method: "POST", re: /^\/monthly-records$/, category: "給与", emp: bodyEmp, label: (req) => { const [, y, mo] = bodyYm(req); return y && mo ? `月次実績を保存（${y}年${mo}月）` : "月次実績を保存"; },
    snap: { one: true, sql: "select * from monthly_records where employee_id = $1 and year = $2 and month = $3", args: (_m, req) => bodyYm(req) } },
  { method: "PUT", re: /^\/monthly-records\/(\d+)$/, category: "給与", label: "月次実績を保存", snap: byId("monthly_records") },
  { method: "PUT", re: /^\/employees\/(\d+)\/month-items$/, category: "給与", emp: p1,
    label: (req) => { const [y, mo] = qYm(req); return y && mo ? `その月の手当・控除を保存（${y}年${mo}月）` : "その月の手当・控除を保存"; },
    snap: {
      その月: { one: true, sql: "select base_salary, employment_insurance_override from employee_month_sets where employee_id = $1 and year = $2 and month = $3", args: (m, req) => [Number(m[1]), ...qYm(req)] },
      手当: { sql: "select allowance_name, amount from employee_month_allowances where employee_id = $1 and year = $2 and month = $3 order by sort_order, id", args: (m, req) => [Number(m[1]), ...qYm(req)] },
      控除: { sql: "select deduction_name, amount from employee_month_deductions where employee_id = $1 and year = $2 and month = $3 order by sort_order, id", args: (m, req) => [Number(m[1]), ...qYm(req)] },
    } },
  { method: "POST", re: /^\/journal-entries\/generate$/, category: "給与", label: "仕訳を作り直し" },
  { method: "PUT", re: /^\/payroll-law\/employees\/(\d+)$/, category: "社員", manual: true, label: "" },
  { method: "PUT", re: /^\/payroll-law\/resident-tax\/(\d+)$/, category: "給与", manual: true, label: "" },
  { method: "POST", re: /^\/payroll-law\/paid-leave\/adjustments$/, category: "勤怠", manual: true, label: "" },
  { method: "DELETE", re: /^\/payroll-law\/paid-leave\/adjustments\/\d+$/, category: "勤怠", manual: true, label: "" },
  { method: "POST", re: /^\/payroll-law\/remuneration-review\/apply$/, category: "社員", manual: true, label: "" },
  { method: "PUT", re: /^\/payroll-law\/yearend\/declarations\/\d+$/, category: "給与", manual: true, label: "" },
  { method: "POST", re: /^\/payroll-law\/bonuses\/preview$/, category: "給与", skip: true, label: "" },
  { method: "POST", re: /^\/payroll-law\/bonuses$/, category: "給与", manual: true, label: "" },
  { method: "PUT", re: /^\/payroll-law\/bonuses\/(\d+)$/, category: "給与", label: "賞与を直す", snap: byId("bonus_payments") },
  { method: "POST", re: /^\/payroll-law\/bonuses\/\d+\/(confirm|unconfirm)$/, category: "給与", manual: true, label: "" },
  { method: "DELETE", re: /^\/payroll-law\/bonuses\/\d+$/, category: "給与", manual: true, label: "" },
  { method: "POST", re: /^\/payroll-law\/ei-shortfall\/settle$/, category: "給与", manual: true, label: "" },

  // ── 社員 ───────────────────────────────────────────
  { method: "POST", re: /^\/employees$/, category: "社員", label: "社員を追加" },
  { method: "PUT", re: /^\/employees\/(\d+)$/, category: "社員", label: "社員情報を変更", snap: byId("employees") },
  { method: "DELETE", re: /^\/employees\/(\d+)$/, category: "社員", manual: true, label: "" },
  { method: "PUT", re: /^\/employees\/\d+\/pin$/, category: "社員", manual: true, label: "" },
  { method: "DELETE", re: /^\/employees\/\d+\/pin$/, category: "社員", manual: true, label: "" },
  { method: "POST", re: /^\/employees\/\d+\/pin\/setup$/, category: "社員", manual: true, label: "" },
  { method: "POST", re: /^\/employees\/\d+\/qr-key\/rotate$/, category: "社員", manual: true, label: "" },
  { method: "POST", re: /^\/employees\/(\d+)\/pin\/verify$/, category: "ログイン", driver: true, emp: p1, throttleSec: 3600, label: "暗証番号で本人確認（QR打刻ページ）" },
  { method: "PUT", re: /^\/employees\/(\d+)\/allowances$/, category: "社員", emp: p1, label: "社員の手当を変更",
    snap: { sql: "select d.name, a.amount from employee_allowances a left join allowance_definitions d on d.id = a.allowance_definition_id where a.employee_id = $1 order by a.id", args: (m) => [Number(m[1])] } },
  { method: "PUT", re: /^\/employees\/(\d+)\/deductions$/, category: "社員", emp: p1, label: "社員の控除を変更",
    snap: { sql: "select d.name, a.amount from employee_deductions a left join deduction_definitions d on d.id = a.deduction_definition_id where a.employee_id = $1 order by a.id", args: (m) => [Number(m[1])] } },
  { method: "PUT", re: /^\/office-tools\/bank-accounts\/\d+$/, category: "社員", manual: true, label: "" },
  { method: "POST", re: /^\/employees\/(\d+)\/standard-remuneration-history$/, category: "社員", emp: p1, label: "標準報酬月額の履歴を追加" },
  { method: "DELETE", re: /^\/employees\/(\d+)\/standard-remuneration-history\/(\d+)$/, category: "社員", emp: p1, label: "標準報酬月額の履歴を削除", snap: byId("standard_remuneration_history", 2) },
  { method: "POST", re: /^\/standard-remuneration\/bulk$/, category: "社員", label: "標準報酬月額をまとめて設定" },

  // ── マスター ─────────────────────────────────────────
  { method: "POST", re: /^\/allowance-definitions$/, category: "マスター", label: "手当の種類を追加" },
  { method: "PUT", re: /^\/allowance-definitions\/(\d+)$/, category: "マスター", label: "手当の種類を変更", snap: byId("allowance_definitions") },
  { method: "DELETE", re: /^\/allowance-definitions\/(\d+)$/, category: "マスター", label: "手当の種類を削除", snap: byId("allowance_definitions") },
  { method: "POST", re: /^\/deduction-definitions$/, category: "マスター", label: "控除の種類を追加" },
  { method: "PUT", re: /^\/deduction-definitions\/(\d+)$/, category: "マスター", label: "控除の種類を変更", snap: byId("deduction_definitions") },
  { method: "DELETE", re: /^\/deduction-definitions\/(\d+)$/, category: "マスター", label: "控除の種類を削除", snap: byId("deduction_definitions") },
  { method: "POST", re: /^\/insurance-rate-periods$/, category: "マスター", label: "保険料率（年度）を追加" },
  { method: "PUT", re: /^\/insurance-rate-periods\/(\d+)$/, category: "マスター", label: "保険料率（年度）を変更", snap: byId("insurance_rate_periods") },
  { method: "DELETE", re: /^\/insurance-rate-periods\/(\d+)$/, category: "マスター", label: "保険料率（年度）を削除", snap: byId("insurance_rate_periods") },

  // ── 取引先・よく行く場所（マスター管理・地図） ─────────────────────────────────
  { method: "POST", re: /^\/map\/places$/, category: "設定", label: (req) => `取引先・場所を登録（${String((req.body as Record<string, unknown>)?.["name"] ?? "")}）` },
  { method: "PUT", re: /^\/map\/places\/(\d+)$/, category: "設定", label: "取引先・場所を変更", snap: byId("places") },
  { method: "DELETE", re: /^\/map\/places\/(\d+)$/, category: "設定", label: "取引先・場所を削除", snap: byId("places") },

  // ── 設定 ───────────────────────────────────────────
  { method: "PUT", re: /^\/company$/, category: "設定", label: "会社設定を変更", snap: { one: true, sql: "select * from company order by id limit 1", args: () => [] } },
  { method: "POST", re: /^\/calendar\/overrides\/([\d-]+)$/, category: "設定", label: (_r, m) => `カレンダーの休日を変更（${m[1]}）`,
    snap: { one: true, sql: "select * from calendar_overrides where date_str = $1", args: (m) => [m[1]] } },
  { method: "DELETE", re: /^\/calendar\/overrides$/, category: "設定", label: "カレンダーの休日をまとめて消去" },
  { method: "PUT", re: /^\/office-tools\/transfer-settings$/, category: "設定", manual: true, label: "" },

  // ── メッセージ（本文は残さず、文字数だけ） ───────────────────
  { method: "POST", re: /^\/messages$/, category: "メッセージ", driver: true, emp: bodyEmp, label: (req) => (req.session?.userId ? "メッセージを送信" : "事務所へメッセージを送信") },
  { method: "POST", re: /^\/messages\/broadcast$/, category: "メッセージ", label: "一斉にメッセージを送信" },
  { method: "POST", re: /^\/messages\/\d+\/read$/, category: "メッセージ", skip: true, label: "" },
  { method: "POST", re: /^\/push\/subscribe$/, category: "その他", skip: true, label: "" },
  { method: "POST", re: /^\/alerts\/read(-all)?$/, category: "その他", skip: true, label: "" },
  { method: "POST", re: /^\/auth\//, category: "ログイン", manual: true, label: "" },
  { method: "POST", re: /^\/users$/, category: "ユーザー", manual: true, label: "" },
  { method: "PATCH", re: /^\/users\/\d+$/, category: "ユーザー", manual: true, label: "" },
  { method: "DELETE", re: /^\/users\/\d+$/, category: "ユーザー", manual: true, label: "" },

  // ── 書き出し（個人の情報やお金が入ったファイルを、だれがいつ持ち出したか） ─────
  { method: "GET", re: /^\/payrolls\/export\/csv$/, category: "書き出し", label: "給与の一覧をCSVで書き出し" },
  { method: "GET", re: /^\/payroll\/(\d+)\/csv$/, category: "書き出し", label: "給与明細をCSVで書き出し", snap: byId("payrolls") },
  { method: "GET", re: /^\/payroll-law\/paid-leave\.csv$/, category: "書き出し", label: "有給休暇の一覧をCSVで書き出し" },
  { method: "GET", re: /^\/payroll-law\/yearend\.csv$/, category: "書き出し", label: "年末調整の資料をCSVで書き出し" },
  { method: "GET", re: /^\/payroll-law\/bonuses\/report\.csv$/, category: "書き出し", label: "賞与の届けの資料をCSVで書き出し" },
  { method: "GET", re: /^\/payroll-law\/wage-ledger\.csv$/, category: "書き出し", label: "賃金台帳をCSVで書き出し" },
  { method: "GET", re: /^\/payroll-law\/worker-roster\.csv$/, category: "書き出し", label: "労働者名簿をCSVで書き出し" },
];

/** 窓口の中で記録している操作の名前（共通の記録と同じ見え方にする） */
export const MANUAL_LABELS: Record<string, [string, AuditCategory]> = {
  "auth.login": ["ログイン", "ログイン"],
  "auth.login.fail": ["ログインに失敗", "ログイン"],
  "auth.logout": ["ログアウト", "ログイン"],
  "payroll.confirm": ["給与明細を確定", "給与"],
  "payroll.unconfirm": ["給与明細の確定を解除", "給与"],
  "user.create": ["ユーザーを追加", "ユーザー"],
  "user.update": ["ユーザーを変更", "ユーザー"],
  "user.delete": ["ユーザーを削除", "ユーザー"],
  "pin.set": ["暗証番号を設定", "社員"],
  "pin.clear": ["暗証番号を消去", "社員"],
  "pin.self-set": ["暗証番号を本人が設定（QR打刻ページ）", "社員"],
  "qrkey.rotate": ["QRコードを作り直し", "社員"],
  "employee.delete": ["社員を削除", "社員"],
  "employee.legal": ["社員の法令の項目を変更", "社員"],
  "attendance.settings": ["勤怠の設定を変更", "設定"],
  "alcohol.csv": ["アルコールチェックをCSVで書き出し", "書き出し"],
  "bank.update": ["振込口座を変更", "社員"],
  "transfer-settings.update": ["振込元を変更", "設定"],
  "transfer.export": ["振込データ（全銀）を書き出し", "書き出し"],
  "resident_tax.save": ["住民税を保存", "給与"],
  "paid_leave.adjust": ["有給休暇を手で足し引き", "勤怠"],
  "paid_leave.adjust.delete": ["有給休暇の足し引きを取り消し", "勤怠"],
  "standard_remuneration.add": ["標準報酬月額を変更（算定・月変）", "社員"],
  "yearend.declaration": ["年末調整の申告を保存", "給与"],
  "bonus.create": ["賞与を登録", "給与"],
  "bonus.confirm": ["賞与を確定", "給与"],
  "bonus.unconfirm": ["賞与の確定を解除", "給与"],
  "bonus.delete": ["賞与を削除", "給与"],
  "ei_shortfall.settle": ["雇用保険の不足を精算", "給与"],
};

export function findSpec(method: string, path: string): { spec: AuditSpec; m: RegExpExecArray } | null {
  for (const spec of SPECS) {
    if (spec.method !== method) continue;
    const m = spec.re.exec(path);
    if (m) return { spec, m };
  }
  return null;
}
