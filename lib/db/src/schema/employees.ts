import { pgTable, serial, text, integer, doublePrecision, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeCode: text("employee_code").notNull().unique(),
  name: text("name").notNull(),
  nameKana: text("name_kana").notNull(),
  department: text("department").notNull(),
  position: text("position").notNull().default(""),
  baseSalary: doublePrecision("base_salary").notNull(),
  transportationAllowance: doublePrecision("transportation_allowance").notNull().default(0),
  safetyDrivingAllowance: doublePrecision("safety_driving_allowance").notNull().default(0),
  longDistanceAllowance: doublePrecision("long_distance_allowance").notNull().default(0),
  positionAllowance: doublePrecision("position_allowance").notNull().default(0),
  familyAllowance: doublePrecision("family_allowance").notNull().default(0),
  earlyOvertimeAllowance: doublePrecision("early_overtime_allowance").notNull().default(0),
  commissionRatePerKm: doublePrecision("commission_rate_per_km").notNull().default(0),
  commissionRatePerCase: doublePrecision("commission_rate_per_case").notNull().default(0),
  mikawaCommissionRate: doublePrecision("mikawa_commission_rate").notNull().default(0),
  useBluewingLogic: boolean("use_bluewing_logic").notNull().default(false),
  bluewingCommissionRate: doublePrecision("bluewing_commission_rate").notNull().default(0),
  bluewingFixedOvertimeHours: doublePrecision("bluewing_fixed_overtime_hours").notNull().default(0),
  bluewingFixedOvertimeAmount: doublePrecision("bluewing_fixed_overtime_amount").notNull().default(0),
  dependentCount: integer("dependent_count").notNull().default(0),
  hasSpouse: boolean("has_spouse").notNull().default(false),
  standardRemuneration: doublePrecision("standard_remuneration").notNull().default(0),
  careInsuranceApplied: boolean("care_insurance_applied").notNull().default(false),
  healthInsuranceMonthly: doublePrecision("health_insurance_monthly").notNull().default(0),
  pensionMonthly: doublePrecision("pension_monthly").notNull().default(0),
  employmentInsuranceApplied: boolean("employment_insurance_applied").notNull().default(true),
  /** 厚生年金適用（null=生年月日から自動判定、true=強制ON、false=強制OFF）70歳以上は自動的にfalse */
  pensionApplied: boolean("pension_applied"),
  /** @deprecated 社保・雇用保険・源泉税をまとめて止める旧い印。下の3つに分けた（画面から変えると3つにも写す） */
  taxExempt: boolean("tax_exempt").notNull().default(false),
  /** 社会保険（健保・介護・子育て支援金・厚年）を引かない */
  socialInsuranceExempt: boolean("social_insurance_exempt").notNull().default(false),
  /** 雇用保険料を引かない */
  employmentInsuranceExempt: boolean("employment_insurance_exempt").notNull().default(false),
  /** 源泉所得税を引かない */
  incomeTaxExempt: boolean("income_tax_exempt").notNull().default(false),
  /** 健康保険の適用（auto＝75歳の誕生日の月から止める／applied＝適用／not_applied＝非適用） */
  healthInsuranceMode: text("health_insurance_mode").notNull().default("auto"),
  /** 扶養控除等申告書（kou＝提出あり・甲欄／otsu＝提出なし・乙欄） */
  taxColumn: text("tax_column").notNull().default("kou"),
  /** 本人の障害（none／general＝一般の障害者／special＝特別障害者） */
  disability: text("disability").notNull().default("none"),
  widow: boolean("widow").notNull().default(false),
  singleParent: boolean("single_parent").notNull().default(false),
  workingStudent: boolean("working_student").notNull().default(false),
  /** 扶養親族（配偶者を含む）のうち障害者の数（同居特別障害者は2として数える） */
  dependentDisabilityCount: integer("dependent_disability_count").notNull().default(0),
  /** 通勤の手段（none／public＝交通機関／car＝マイカー・自転車など）と片道の距離（km） */
  commuteMethod: text("commute_method"),
  commuteDistanceKm: doublePrecision("commute_distance_km"),
  /** 週の所定労働日数・時間（有給の比例付与の判定） */
  weeklyScheduledDays: doublePrecision("weekly_scheduled_days"),
  weeklyScheduledHours: doublePrecision("weekly_scheduled_hours"),
  /** 労働者名簿（労基法107条） */
  gender: text("gender"),
  address: text("address"),
  jobType: text("job_type"),
  retirementDate: date("retirement_date"),
  retirementReason: text("retirement_reason"),
  residentTax: doublePrecision("resident_tax").notNull().default(0),
  incomeTaxMonthly: doublePrecision("income_tax_monthly").notNull().default(0),
  otherDeductionMonthly: doublePrecision("other_deduction_monthly").notNull().default(0),
  dateOfBirth: date("date_of_birth"),
  hireDate: date("hire_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  salaryType: text("salary_type").notNull().default("fixed"),
  isOfficeStaff: boolean("is_office_staff").notNull().default(false),
  scheduledWorkStart: text("scheduled_work_start").default("08:00"),
  scheduledWorkEnd: text("scheduled_work_end").default("17:00"),
  /** 暗証番号（scrypt で保存。古い行は平文のまま残っていることがあり、照合のときに書き換える） */
  pin: text("pin"),
  /** QR の合言葉。QR の URL（/driver/:id?k=…）に入れ、ログインしていない打刻ページの本人確認に使う */
  qrKey: text("qr_key"),
  /** @deprecated dailyRateWeekday / dailyRateSaturday に置き換えられました。書き込みはしないが既存データ保護のため残存。 */
  dailyRateOverride: doublePrecision("daily_rate_override").default(0),
  /** 個人 平日日当（>0 の場合は会社共通の dailyWageWeekday を上書き） */
  dailyRateWeekday: doublePrecision("daily_rate_weekday").notNull().default(0),
  /** 個人 休日(土曜)日当（>0 の場合は会社共通の dailyWageSaturday を上書き） */
  dailyRateSaturday: doublePrecision("daily_rate_saturday").notNull().default(0),
  /** 個人 残業時給（>0 の場合は採用。残業時間 × この単価 で残業手当を直接計算（1.25倍はかけない） */
  overtimeHourlyRate: doublePrecision("overtime_hourly_rate").notNull().default(0),
  /** 個人 深夜単価（円/時）。>0 のときは 深夜時間 × この単価。0 は残業時給から自動（÷1.25×0.25） */
  lateNightHourlyRate: doublePrecision("late_night_hourly_rate").notNull().default(0),
  /** 残業を n 分単位で切り上げ計算する場合の単位（分）。null=標準計算 */
  overtimeUnitMinutes: integer("overtime_unit_minutes"),
  /** 残業単位あたり加算額（円）。overtimeUnitMinutes が設定されている場合のみ有効 */
  overtimeUnitRate: doublePrecision("overtime_unit_rate").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
