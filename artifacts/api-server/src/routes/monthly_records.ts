import { Router } from "express";
import { db, monthlyRecordsTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

const RECORD_FIELDS = {
  id: monthlyRecordsTable.id,
  employeeId: monthlyRecordsTable.employeeId,
  employeeName: employeesTable.name,
  year: monthlyRecordsTable.year,
  month: monthlyRecordsTable.month,
  workDays: monthlyRecordsTable.workDays,
  overtimeHours: monthlyRecordsTable.overtimeHours,
  lateNightHours: monthlyRecordsTable.lateNightHours,
  holidayWorkDays: monthlyRecordsTable.holidayWorkDays,
  drivingDistanceKm: monthlyRecordsTable.drivingDistanceKm,
  deliveryCases: monthlyRecordsTable.deliveryCases,
  absenceDays: monthlyRecordsTable.absenceDays,
  saturdayWorkDays: monthlyRecordsTable.saturdayWorkDays,
  sundayWorkHours: monthlyRecordsTable.sundayWorkHours,
  notes: monthlyRecordsTable.notes,
  salesAmount: monthlyRecordsTable.salesAmount,
  commissionRate: monthlyRecordsTable.commissionRate,
  fixedOvertimeHours: monthlyRecordsTable.fixedOvertimeHours,
  overtimeUnitPrice: monthlyRecordsTable.overtimeUnitPrice,
  createdAt: monthlyRecordsTable.createdAt,
  updatedAt: monthlyRecordsTable.updatedAt,
};

router.get("/monthly-records", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

  const records = await db.select(RECORD_FIELDS)
    .from(monthlyRecordsTable)
    .innerJoin(employeesTable, eq(monthlyRecordsTable.employeeId, employeesTable.id))
    .where(and(eq(monthlyRecordsTable.year, year), eq(monthlyRecordsTable.month, month)));

  return res.json(records);
});

router.post("/monthly-records", async (req, res) => {
  const body = req.body;

  const existing = await db.select().from(monthlyRecordsTable)
    .where(and(
      eq(monthlyRecordsTable.employeeId, body.employeeId),
      eq(monthlyRecordsTable.year, body.year),
      eq(monthlyRecordsTable.month, body.month)
    )).limit(1);

  if (existing.length > 0) {
    const [updated] = await db.update(monthlyRecordsTable).set({
      workDays: body.workDays ?? existing[0].workDays,
      overtimeHours: body.overtimeHours ?? existing[0].overtimeHours,
      lateNightHours: body.lateNightHours ?? existing[0].lateNightHours,
      holidayWorkDays: body.holidayWorkDays ?? existing[0].holidayWorkDays,
      drivingDistanceKm: body.drivingDistanceKm ?? existing[0].drivingDistanceKm,
      deliveryCases: body.deliveryCases ?? existing[0].deliveryCases,
      absenceDays: body.absenceDays ?? existing[0].absenceDays,
      saturdayWorkDays: body.saturdayWorkDays ?? existing[0].saturdayWorkDays,
      sundayWorkHours: body.sundayWorkHours ?? existing[0].sundayWorkHours,
      notes: body.notes ?? existing[0].notes,
      salesAmount: body.salesAmount ?? existing[0].salesAmount,
      commissionRate: body.commissionRate ?? existing[0].commissionRate,
      fixedOvertimeHours: body.fixedOvertimeHours ?? existing[0].fixedOvertimeHours,
      overtimeUnitPrice: body.overtimeUnitPrice ?? existing[0].overtimeUnitPrice,
      updatedAt: new Date(),
    }).where(eq(monthlyRecordsTable.id, existing[0].id)).returning();
    return res.status(201).json(updated);
  }

  const [record] = await db.insert(monthlyRecordsTable).values({
    employeeId: body.employeeId,
    year: body.year,
    month: body.month,
    workDays: body.workDays ?? 0,
    overtimeHours: body.overtimeHours ?? 0,
    lateNightHours: body.lateNightHours ?? 0,
    holidayWorkDays: body.holidayWorkDays ?? 0,
    drivingDistanceKm: body.drivingDistanceKm ?? 0,
    deliveryCases: body.deliveryCases ?? 0,
    absenceDays: body.absenceDays ?? 0,
    saturdayWorkDays: body.saturdayWorkDays ?? 0,
    sundayWorkHours: body.sundayWorkHours ?? 0,
    notes: body.notes,
    salesAmount: body.salesAmount ?? 0,
    commissionRate: body.commissionRate ?? 0,
    fixedOvertimeHours: body.fixedOvertimeHours ?? 0,
    overtimeUnitPrice: body.overtimeUnitPrice ?? 2111,
  }).returning();
  return res.status(201).json(record);
});

router.get("/monthly-records/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [record] = await db.select(RECORD_FIELDS)
    .from(monthlyRecordsTable)
    .innerJoin(employeesTable, eq(monthlyRecordsTable.employeeId, employeesTable.id))
    .where(eq(monthlyRecordsTable.id, id));
  if (!record) return res.status(404).json({ error: "Record not found" });
  return res.json(record);
});

router.put("/monthly-records/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  const [updated] = await db.update(monthlyRecordsTable).set({
    ...(body.workDays !== undefined && { workDays: body.workDays }),
    ...(body.overtimeHours !== undefined && { overtimeHours: body.overtimeHours }),
    ...(body.lateNightHours !== undefined && { lateNightHours: body.lateNightHours }),
    ...(body.holidayWorkDays !== undefined && { holidayWorkDays: body.holidayWorkDays }),
    ...(body.drivingDistanceKm !== undefined && { drivingDistanceKm: body.drivingDistanceKm }),
    ...(body.deliveryCases !== undefined && { deliveryCases: body.deliveryCases }),
    ...(body.absenceDays !== undefined && { absenceDays: body.absenceDays }),
    ...(body.saturdayWorkDays !== undefined && { saturdayWorkDays: body.saturdayWorkDays }),
    ...(body.sundayWorkHours !== undefined && { sundayWorkHours: body.sundayWorkHours }),
    ...(body.notes !== undefined && { notes: body.notes }),
    ...(body.salesAmount !== undefined && { salesAmount: body.salesAmount }),
    ...(body.commissionRate !== undefined && { commissionRate: body.commissionRate }),
    ...(body.fixedOvertimeHours !== undefined && { fixedOvertimeHours: body.fixedOvertimeHours }),
    ...(body.overtimeUnitPrice !== undefined && { overtimeUnitPrice: body.overtimeUnitPrice }),
    updatedAt: new Date(),
  }).where(eq(monthlyRecordsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Record not found" });
  return res.json(updated);
});

export default router;
