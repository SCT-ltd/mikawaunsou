import { Router } from "express";
import { db, companyTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/company", async (req, res) => {
  const rows = await db.select().from(companyTable).limit(1);
  if (rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }
  return res.json(rows[0]);
});

router.put("/company", async (req, res) => {
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
      healthInsuranceEmployeeRate: body.healthInsuranceEmployeeRate ?? 0.0500,
      healthInsuranceEmployerRate: body.healthInsuranceEmployerRate ?? 0.0500,
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
      ...(body.pensionEmployeeRate !== undefined && { pensionEmployeeRate: body.pensionEmployeeRate }),
      ...(body.pensionEmployerRate !== undefined && { pensionEmployerRate: body.pensionEmployerRate }),
      ...(body.employmentInsuranceEmployerRate !== undefined && { employmentInsuranceEmployerRate: body.employmentInsuranceEmployerRate }),
      ...(body.overtimeRate !== undefined && { overtimeRate: body.overtimeRate }),
      ...(body.lateNightAdditionalRate !== undefined && { lateNightAdditionalRate: body.lateNightAdditionalRate }),
      ...(body.holidayRate !== undefined && { holidayRate: body.holidayRate }),
      ...(body.dailyWageWeekday !== undefined && { dailyWageWeekday: body.dailyWageWeekday }),
      ...(body.dailyWageSaturday !== undefined && { dailyWageSaturday: body.dailyWageSaturday }),
      ...(body.hourlyWageSunday !== undefined && { hourlyWageSunday: body.hourlyWageSunday }),
      updatedAt: new Date(),
    })
    .where(eq(companyTable.id, rows[0].id))
    .returning();
  return res.json(updated);
});

export default router;
