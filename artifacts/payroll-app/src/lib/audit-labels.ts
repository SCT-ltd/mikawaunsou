/**
 * 操作の記録に出てくる項目名（データベースの列名）を日本語にする。
 * 列名は snake_case（共通の記録）と camelCase（窓口の中の記録）の両方で来るので、どちらでも引ける。
 * ここに無い項目は列名のまま出す。
 */
const FIELD: Record<string, string> = {
  // 共通
  name: "名前", name_kana: "フリガナ", employee_id: "社員", employee_code: "社員番号", employee_name: "社員名",
  year: "年", month: "月", date: "日付", work_date: "勤務日", note: "メモ", notes: "メモ", reason: "理由", status: "状態",
  amount: "金額", sort_order: "並び順", is_active: "有効", description: "説明", kind: "種類", data: "内容", items: "項目",
  // 打刻
  event_type: "打刻の種類", recorded_at: "打刻の時刻", source: "打刻の方法", latitude: "緯度", longitude: "経度", accuracy: "位置の精度",
  address: "住所", voided_at: "取り消した時刻", voided_by: "取り消した人", void_reason: "取り消しの理由", start_odometer: "出発時のメーター",
  end_odometer: "到着時のメーター", departure: "出発地", arrival: "到着地", checklist_ng_items: "点検の否の項目", vehicle: "車両", client_id: "端末の番号",
  // 修正申請・点検・アルコール・日報
  requested_at: "申請した時刻", decided_at: "判断した時刻", decided_by: "判断した人", decision_note: "判断のメモ", record_id: "対象の打刻",
  result_record_id: "直した後の打刻", value_mg: "アルコール濃度（mg）", checker: "確認した人", method: "確かめ方", phase: "乗る前／後",
  detected: "検知", shipper: "荷主", distance_km: "走行距離（km）", waiting_minutes: "待ち時間（分）", content: "本文",
  // 予定
  start_time: "始まり", end_time: "終わり", is_off: "休み", absence_type: "休みの種類",
  // 社員
  department: "部署", position: "役職", hire_date: "入社日", retirement_date: "退職日", retirement_reason: "退職の理由", date_of_birth: "生年月日",
  gender: "性別", phone: "電話番号", salary_type: "給与の形", base_salary: "基本給", daily_wage_weekday: "日当（平日）", daily_wage_saturday: "日当（土曜）",
  hourly_wage_sunday: "時給（日曜）", daily_rate_weekday: "日当（平日）", daily_rate_saturday: "日当（土曜）", daily_rate_override: "日当（個別）",
  overtime_hourly_rate: "残業の時給", late_night_hourly_rate: "深夜の時給", overtime_rate: "残業の割増率", holiday_rate: "休日の割増率",
  overtime_unit_minutes: "残業の単位（分）", overtime_unit_price: "残業の単価", overtime_unit_rate: "残業の単価の率",
  scheduled_work_start: "定時の開始", scheduled_work_end: "定時の終了", scheduled_hours_per_day: "1日の所定時間",
  weekly_scheduled_days: "週の所定日数", weekly_scheduled_hours: "週の所定時間", is_office_staff: "事務の人",
  standard_remuneration: "標準報酬月額", health_standard: "健康保険の標準報酬", pension_standard: "厚生年金の標準報酬",
  care_insurance_applied: "介護保険の対象", pension_applied: "厚生年金の対象", employment_insurance_applied: "雇用保険の対象",
  employment_insurance_exempt: "雇用保険の対象外", social_insurance_exempt: "社会保険の対象外", income_tax_exempt: "所得税の対象外", tax_exempt: "非課税",
  tax_column: "税の欄（甲・乙）", dependent_count: "扶養の人数", dependent_disability_count: "障害のある扶養の人数", has_spouse: "配偶者",
  disability: "障害者", widow: "寡婦", single_parent: "ひとり親", working_student: "勤労学生",
  health_insurance_mode: "健康保険の計算", health_insurance_monthly: "健康保険（月額・手入力）", pension_monthly: "厚生年金（月額・手入力）",
  income_tax_method: "所得税の計算", income_tax_monthly: "所得税（月額・手入力）", other_deduction_monthly: "その他の控除（月額）", resident_tax: "住民税",
  commute_method: "通勤の方法", commute_distance_km: "通勤の距離（km）", transportation_allowance: "通勤手当", commission_rate: "歩合の率",
  commission_rate_per_case: "1件の歩合", commission_rate_per_km: "1kmの歩合", use_bluewing_logic: "ブルーウイングの計算", use_mikawa_logic: "三川の計算",
  bluewing_commission_rate: "ブルーウイングの歩合率", mikawa_commission_rate: "三川の歩合率", job_type: "職種", fixed_overtime_hours: "固定残業の時間",
  // 月次実績
  work_days: "出勤日数", overtime_hours: "残業時間", late_night_hours: "深夜時間", holiday_work_days: "休日出勤の日数", holiday_work_hours: "休日出勤の時間",
  driving_distance_km: "走行距離（km）", delivery_cases: "配送件数", absence_days: "欠勤日数", paid_leave_days: "有給の日数",
  saturday_work_days: "土曜出勤の日数", sunday_work_days: "日曜出勤の日数", sunday_work_hours: "日曜出勤の時間", public_holiday_work_days: "祝日出勤の日数",
  rest_day_overtime_hours: "休日の残業時間", sales_amount: "売上", bluewing_sales_amount: "ブルーウイングの売上", actual_work_hours: "実際の労働時間",
  // 給与明細
  gross_salary: "総支給額", net_salary: "差引支給額", total_deductions: "控除の合計", overtime_pay: "残業手当", late_night_pay: "深夜手当",
  holiday_pay: "休日手当", saturday_pay: "土曜手当", commission_pay: "歩合", health_insurance: "健康保険", health_insurance_amount: "健康保険",
  pension: "厚生年金", pension_amount: "厚生年金", employment_insurance: "雇用保険", employment_insurance_override: "雇用保険（手入力）",
  income_tax: "所得税", social_insurance: "社会保険", childcare_support_contribution: "子ども・子育て支援金", custom_allowances_total: "手当の合計",
  custom_deductions_total: "控除の合計（その他）", performance_allowance: "業績手当", family_allowance: "家族手当", position_allowance: "役職手当",
  long_distance_allowance: "長距離手当", safety_driving_allowance: "安全運転手当", early_overtime_allowance: "早出残業手当", absence_deduction: "欠勤の控除",
  calculation_mode: "計算の方法", calc_warnings: "計算の注意", auto_values: "自動で入れた値",
  // 手当・控除の種類
  allowance_name: "手当の名前", deduction_name: "控除の名前", calculation_type: "計算の形", is_taxable: "課税",
  exclude_from_employment_insurance: "雇用保険の対象外", include_in_premium_base: "割増の基礎に入れる",
  // 会社・保険
  payment_day: "支払日", closing_day: "締め日", monthly_average_work_hours: "月の平均所定時間", employment_insurance_rate: "雇用保険料率（本人）",
  employment_insurance_employer_rate: "雇用保険料率（会社）", health_insurance_rate: "健康保険料率", health_insurance_employee_rate: "健康保険料率（本人）",
  health_insurance_employer_rate: "健康保険料率（会社）", pension_rate: "厚生年金保険料率", pension_employee_rate: "厚生年金保険料率（本人）",
  pension_employer_rate: "厚生年金保険料率（会社）", care_insurance_rate: "介護保険料率", childcare_support_rate: "子ども・子育て支援金の率",
  late_night_additional_rate: "深夜の割増率", minimum_wage_hourly: "最低賃金（時給）", minimum_wage_effective_date: "最低賃金の適用日",
  effective_year: "適用の年", effective_month: "適用の月", journal_date_basis: "仕訳の日付", date_str: "日付", is_red: "休日",
  // 振込・ユーザー
  bank_code: "銀行コード", branch_code: "支店コード", bank_name: "銀行名", branch_name: "支店名", account_type: "口座の種類", account_number: "口座番号",
  holder_kana: "口座の名義", consignor_code: "委託者コード", consignor_name: "委託者名", kind_code: "種別コード",
  username: "ユーザー名", display_name: "表示名", role: "権限",
  // 賞与・住民税・有給
  pay_date: "支払日", days: "日数", collect_year: "徴収の年", collect_month: "徴収の月", apply_year: "反映の年", apply_month: "反映の月",
  standard_bonus: "標準賞与額", total: "合計",
  // 地図の場所
  radius_m: "範囲（m）", contact: "担当者", geo_source: "位置の出どころ", geo_label: "位置（地名）", active: "使っている", place_name: "場所",
  map_track_only_on_duty: "勤務中だけ位置を残す", map_stale_minutes: "位置が届かないと知らせる分数", map_long_stop_minutes: "止まっていると知らせる分数", map_retention_days: "位置の記録を残す日数",
};

/** 窓口の中の記録で使っている名前（camelCase）の読み替え */
const camelToSnake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

export function fieldLabel(k: string): string {
  if (k.includes(".")) {
    const [g, sub] = k.split(".", 2) as [string, string];
    return `${g}・${fieldLabel(sub)}`;
  }
  return FIELD[k] ?? FIELD[camelToSnake(k)] ?? k;
}

const EV: Record<string, string> = { clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了" };
const ROLE: Record<string, string> = { admin: "管理者", staff: "スタッフ", viewer: "閲覧のみ", driver: "ドライバー" };

/** 値を読める形にする（時刻は日本時間・真偽は はい/いいえ・空は（空）） */
export function fmtValue(v: unknown, key = ""): string {
  if (v === null || v === undefined || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) >= 1000 ? v.toLocaleString("ja-JP") : String(v);
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(v) ? v : v + "Z");
      if (!isNaN(d.getTime())) return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    if (/event_type|eventType/.test(key) && EV[v]) return EV[v];
    if (key === "role" && ROLE[v]) return ROLE[v];
    return v.length > 120 ? v.slice(0, 120) + "…" : v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "（なし）";
    return v.map((x) => {
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const nm = o["name"] ?? o["allowance_name"] ?? o["deduction_name"];
        if (nm !== undefined && "amount" in o) return `${nm} ${fmtValue(o["amount"])}円`;
        return Object.entries(o).filter(([k]) => k !== "id").slice(0, 4).map(([k, y]) => `${fieldLabel(k)}:${fmtValue(y, k)}`).join(" ");
      }
      return fmtValue(x);
    }).join("、");
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return String(v);
  }
}
