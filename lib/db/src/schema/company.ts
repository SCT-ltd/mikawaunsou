import { pgTable, serial, text, integer, doublePrecision, timestamp, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companyTable = pgTable("company", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  closingDay: integer("closing_day").notNull().default(31),
  paymentDay: integer("payment_day").notNull().default(25),
  monthlyAverageWorkHours: doublePrecision("monthly_average_work_hours").notNull().default(160),
  socialInsuranceRate: doublePrecision("social_insurance_rate").notNull().default(0.1495),
  employmentInsuranceRate: doublePrecision("employment_insurance_rate").notNull().default(0.006),
  healthInsuranceEmployeeRate: doublePrecision("health_insurance_employee_rate").notNull().default(0.04925),
  healthInsuranceEmployerRate: doublePrecision("health_insurance_employer_rate").notNull().default(0.04925),
  careInsuranceRate: doublePrecision("care_insurance_rate").notNull().default(0.0091),
  pensionEmployeeRate: doublePrecision("pension_employee_rate").notNull().default(0.0915),
  pensionEmployerRate: doublePrecision("pension_employer_rate").notNull().default(0.0915),
  employmentInsuranceEmployerRate: doublePrecision("employment_insurance_employer_rate").notNull().default(0.0085),
  overtimeRate: doublePrecision("overtime_rate").notNull().default(1.25),
  lateNightAdditionalRate: doublePrecision("late_night_additional_rate").notNull().default(0.25),
  holidayRate: doublePrecision("holiday_rate").notNull().default(1.35),
  dailyWageWeekday: doublePrecision("daily_wage_weekday").notNull().default(9808),
  dailyWageSaturday: doublePrecision("daily_wage_saturday").notNull().default(12260),
  hourlyWageSunday: doublePrecision("hourly_wage_sunday").notNull().default(1655),
  // ── 給与計算の切り替え（社労士・税理士の確認が済むまで既定は OFF＝今までどおりの計算）──
  // 中身は lib/tax-tables-reiwa8/src/payroll-core.ts の PayRules を参照。
  /** ① 割増賃金の基礎に手当（手当マスターの「割増の基礎に入れる」）を入れる */
  rulePremiumBaseIncludesAllowances: boolean("rule_premium_base_includes_allowances").notNull().default(false),
  /** ② 土曜・祝日の8時間超を残業として払う（monthly_records.rest_day_overtime_hours） */
  ruleRestDayOvertime: boolean("rule_rest_day_overtime").notNull().default(false),
  /** ③ 月60時間超の判定に土曜・祝日の時間を含める */
  ruleOver60IncludesRestDays: boolean("rule_over60_includes_rest_days").notNull().default(false),
  /** ④ ブルーウィングの業績手当を新しい式（残業代を差し引かない）にする */
  ruleBluewingPerformanceV2: boolean("rule_bluewing_performance_v2").notNull().default(false),
  /** ⑤ ブルーウィングの月60時間超を5割増にする */
  ruleBluewingOver60: boolean("rule_bluewing_over60").notNull().default(false),
  /** ⑥ 歩合給（業績手当）の時間外の割増を払う */
  ruleCommissionPremium: boolean("rule_commission_premium").notNull().default(false),
  /** ⑦ 有給の日の賃金を給与の形ごとに出す */
  rulePaidLeaveBySalaryType: boolean("rule_paid_leave_by_salary_type").notNull().default(false),
  /** ⑧ 時給の人の土日の休日出勤手当を割増の分だけにする */
  ruleHourlyHolidayNoDouble: boolean("rule_hourly_holiday_no_double").notNull().default(false),
  /** ⑨ 月給の人の欠勤を差し引く */
  ruleAbsenceDeduction: boolean("rule_absence_deduction").notNull().default(false),
  /** ⑨ 欠勤控除の日割りの式（fixed22＝基本給÷22／monthlyAverage＝基本給÷月平均所定日数／scheduledDays＝基本給÷その月の所定日数） */
  absenceDeductionMethod: text("absence_deduction_method").notNull().default("fixed22"),
  /** 健康保険料と子ども・子育て支援金の端数処理（separate＝別々〔今まで〕／combined＝合わせて） */
  healthChildcareRounding: text("health_childcare_rounding").notNull().default("separate"),
  /** 1日の所定労働時間 */
  scheduledHoursPerDay: doublePrecision("scheduled_hours_per_day").notNull().default(8),
  /** 最低賃金（時間額）と発効日。既定は東京都の令和7年度（1,226円・2025年10月3日発効） */
  minimumWageHourly: doublePrecision("minimum_wage_hourly").notNull().default(1226),
  minimumWageEffectiveDate: date("minimum_wage_effective_date"),
  /** 仕訳の計上日（closing＝締め日／payment＝支払日） */
  journalDateBasis: text("journal_date_basis").notNull().default("closing"),
  /** 子ども・子育て拠出金率（会社だけが払う。厚生年金の標準報酬に掛ける） */
  childContributionRate: doublePrecision("child_contribution_rate").notNull().default(0.0036),
  /** 残業の年の累計を数え始める月（36協定の起算月） */
  overtimeYearStartMonth: integer("overtime_year_start_month").notNull().default(4),
  /** 賞与に対する源泉徴収税額の算出率の表（JSON。[{from, rates:[0人..7人]}]）。国税庁の表から入れる */
  bonusTaxRateTable: text("bonus_tax_rate_table"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companyTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companyTable.$inferSelect;
