import { Router } from "express";
import { db, monthlyRecordsTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/monthly-records", async (req, res) => {
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);
  
  const records = await db.select({
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
    notes: monthlyRecordsTable.notes,
    createdAt: monthlyRecordsTable.createdAt,
    updatedAt: monthlyRecordsTable.updatedAt,
  })
    .from(monthlyRecordsTable)
    .innerJoin(employeesTable, eq(monthlyRecordsTable.employeeId, employeesTable.id))
    .where(and(eq(monthlyRecordsTable.year, year), eq(monthlyRecordsTable.month, month)));
  
  return res.json(records);
});

router.post("/monthly-records", async (req, res) => {
  const body = req.body;
  
  // Upsert: update if exists
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
      notes: body.notes ?? existing[0].notes,
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
    notes: body.notes,
  }).returning();
  return res.status(201).json(record);
});

router.get("/monthly-records/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [record] = await db.select({
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
    notes: monthlyRecordsTable.notes,
    createdAt: monthlyRecordsTable.createdAt,
    updatedAt: monthlyRecordsTable.updatedAt,
  })
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
    ...(body.notes !== undefined && { notes: body.notes }),
    updatedAt: new Date(),
  }).where(eq(monthlyRecordsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Record not found" });
  return res.json(updated);
});

export default router;
