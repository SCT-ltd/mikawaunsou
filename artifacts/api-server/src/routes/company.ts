import { Router } from "express";
import { db, companyTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

/**
 * 給与計算の切り替え（スイッチ）・最低賃金など、2026-10-24 に足した会社設定。
 * 型の合わないものは受け取らない（スイッチは true/false、数値は 0 以上）。
 */
const RULE_BOOLEANS = [
  "rulePremiumBaseIncludesAllowances", "ruleRestDayOvertime", "ruleOver60IncludesRestDays",
  "ruleBluewingPerformanceV2", "ruleBluewingOver60", "ruleCommissionPremium",
  "rulePaidLeaveBySalaryType", "ruleHourlyHolidayNoDouble", "ruleAbsenceDeduction",
] as const;
function pickRuleFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RULE_BOOLEANS) if (typeof body[k] === "boolean") out[k] = body[k];
  if (["fixed22", "monthlyAverage", "scheduledDays"].includes(String(body.absenceDeductionMethod))) out.absenceDeductionMethod = body.absenceDeductionMethod;
  if (["separate", "combined"].includes(String(body.healthChildcareRounding))) out.healthChildcareRounding = body.healthChildcareRounding;
  if (["closing", "payment"].includes(String(body.journalDateBasis))) out.journalDateBasis = body.journalDateBasis;
  for (const k of ["scheduledHoursPerDay", "minimumWageHourly", "childContributionRate"]) {
    const v = Number(body[k]);
    if (body[k] !== undefined && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  const sm = Number(body.overtimeYearStartMonth);
  if (Number.isInteger(sm) && sm >= 1 && sm <= 12) out.overtimeYearStartMonth = sm;
  if (body.minimumWageEffectiveDate !== undefined) {
    const d = String(body.minimumWageEffectiveDate ?? "");
    out.minimumWageEffectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (body.bonusTaxRateTable !== undefined) {
    // 形を確かめてから保存する（[{from:number, rates:number[8]}]）。空なら消す。
    const raw = body.bonusTaxRateTable;
    if (raw === null || raw === "") out.bonusTaxRateTable = null;
    else {
      try {
        const t = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(t) && t.every((r) => Number.isFinite(Number(r?.from)) && Array.isArray(r?.rates) && r.rates.length === 8 && r.rates.every((x: unknown) => Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) < 1))) {
          out.bonusTaxRateTable = JSON.stringify(t.map((r: { from: number; rates: number[] }) => ({ from: Number(r.from), rates: r.rates.map(Number) })));
        }
      } catch { /* 形が違うものは保存しない */ }
    }
  }
  return out;
}

router.get("/company", async (req, res) => {
  const rows = await db.select().from(companyTable).limit(1);
  if (rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }
  return res.json(rows[0]);
});

router.put("/company", requireAdmin, async (req, res) => {
  const rows = await db.select().from(companyTable).limit(1);
  const body = req.body;

  if (rows.length === 0) {
    const [created] = await db.insert(companyTable).values({
      name: body.name ?? "未設定",
      closingDay: body.closingDay ?? 31,
      paymentDay: body.paymentDay ?? 25,
      monthlyAverageWorkHours: body.monthlyAverageWorkHours ?? 160,
      socialInsuranceRate: body.socialInsuranceRate ?? 0.1495,
      employmentInsuranceRate: body.employmentInsuranceRate ?? 0.006,
      healthInsuranceEmployeeRate: body.healthInsuranceEmployeeRate ?? 0.04925,
      healthInsuranceEmployerRate: body.healthInsuranceEmployerRate ?? 0.04925,
      careInsuranceRate: body.careInsuranceRate ?? 0.0091,
      pensionEmployeeRate: body.pensionEmployeeRate ?? 0.0915,
      pensionEmployerRate: body.pensionEmployerRate ?? 0.0915,
      employmentInsuranceEmployerRate: body.employmentInsuranceEmployerRate ?? 0.0085,
      overtimeRate: body.overtimeRate ?? 1.25,
      lateNightAdditionalRate: body.lateNightAdditionalRate ?? 0.25,
      holidayRate: body.holidayRate ?? 1.35,
      dailyWageWeekday: body.dailyWageWeekday ?? 9808,
      dailyWageSaturday: body.dailyWageSaturday ?? 12260,
      hourlyWageSunday: body.hourlyWageSunday ?? 1655,
    }).returning();
    return res.json(created);
  }

  const [updated] = await db.update(companyTable)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.closingDay !== undefined && { closingDay: body.closingDay }),
      ...(body.paymentDay !== undefined && { paymentDay: body.paymentDay }),
      ...(body.monthlyAverageWorkHours !== undefined && { monthlyAverageWorkHours: body.monthlyAverageWorkHours }),
      ...(body.socialInsuranceRate !== undefined && { socialInsuranceRate: body.socialInsuranceRate }),
      ...(body.employmentInsuranceRate !== undefined && { employmentInsuranceRate: body.employmentInsuranceRate }),
      ...(body.healthInsuranceEmployeeRate !== undefined && { healthInsuranceEmployeeRate: body.healthInsuranceEmployeeRate }),
      ...(body.healthInsuranceEmployerRate !== undefined && { healthInsuranceEmployerRate: body.healthInsuranceEmployerRate }),
      ...(body.careInsuranceRate !== undefined && { careInsuranceRate: body.careInsuranceRate }),
      ...(body.pensionEmployeeRate !== undefined && { pensionEmployeeRate: body.pensionEmployeeRate }),
      ...(body.pensionEmployerRate !== undefined && { pensionEmployerRate: body.pensionEmployerRate }),
      ...(body.employmentInsuranceEmployerRate !== undefined && { employmentInsuranceEmployerRate: body.employmentInsuranceEmployerRate }),
      ...(body.overtimeRate !== undefined && { overtimeRate: body.overtimeRate }),
      ...(body.lateNightAdditionalRate !== undefined && { lateNightAdditionalRate: body.lateNightAdditionalRate }),
      ...(body.holidayRate !== undefined && { holidayRate: body.holidayRate }),
      ...(body.dailyWageWeekday !== undefined && { dailyWageWeekday: body.dailyWageWeekday }),
      ...(body.dailyWageSaturday !== undefined && { dailyWageSaturday: body.dailyWageSaturday }),
      ...(body.hourlyWageSunday !== undefined && { hourlyWageSunday: body.hourlyWageSunday }),
      ...pickRuleFields(body),
      updatedAt: new Date(),
    })
    .where(eq(companyTable.id, rows[0].id))
    .returning();
  return res.json(updated);
});

export default router;
