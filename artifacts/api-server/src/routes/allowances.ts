import { Router } from "express";
import { db, allowanceDefinitionsTable, employeeAllowancesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/allowance-definitions", async (req, res) => {
  const { activeOnly } = req.query;
  let rows = await db.select().from(allowanceDefinitionsTable).orderBy(allowanceDefinitionsTable.sortOrder);
  if (activeOnly === "true") {
    rows = rows.filter(r => r.isActive);
  }
  return res.json(rows);
});

router.post("/allowance-definitions", async (req, res) => {
  const body = req.body;
  const existing = await db.select().from(allowanceDefinitionsTable).orderBy(allowanceDefinitionsTable.sortOrder);
  const maxSort = existing.length > 0 ? Math.max(...existing.map(e => e.sortOrder)) : 0;

  const [created] = await db.insert(allowanceDefinitionsTable).values({
    name: body.name,
    description: body.description ?? null,
    isTaxable: body.isTaxable ?? true,
    sortOrder: body.sortOrder ?? (maxSort + 1),
    isActive: true,
  }).returning();
  return res.status(201).json(created);
});

router.put("/allowance-definitions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  const [updated] = await db.update(allowanceDefinitionsTable).set({
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.isTaxable !== undefined && { isTaxable: body.isTaxable }),
    ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
    updatedAt: new Date(),
  }).where(eq(allowanceDefinitionsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  return res.json(updated);
});

router.delete("/allowance-definitions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.update(allowanceDefinitionsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(allowanceDefinitionsTable.id, id));
  return res.status(204).send();
});

router.get("/employees/:id/allowances", async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);

  const definitions = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true))
    .orderBy(allowanceDefinitionsTable.sortOrder);

  const empAllowances = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId));

  const result = definitions.map(def => {
    const existing = empAllowances.find(a => a.allowanceDefinitionId === def.id);
    return {
      id: existing?.id ?? 0,
      employeeId,
      allowanceDefinitionId: def.id,
      allowanceName: def.name,
      isTaxable: def.isTaxable,
      amount: existing?.amount ?? 0,
      sortOrder: def.sortOrder,
    };
  });

  return res.json(result);
});

router.put("/employees/:id/allowances", async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  const { allowances } = req.body as { allowances: Array<{ allowanceDefinitionId: number; amount: number }> };

  for (const item of allowances) {
    const existing = await db.select().from(employeeAllowancesTable)
      .where(and(
        eq(employeeAllowancesTable.employeeId, employeeId),
        eq(employeeAllowancesTable.allowanceDefinitionId, item.allowanceDefinitionId)
      )).limit(1);

    if (existing.length > 0) {
      await db.update(employeeAllowancesTable).set({
        amount: item.amount,
        updatedAt: new Date(),
      }).where(eq(employeeAllowancesTable.id, existing[0].id));
    } else {
      await db.insert(employeeAllowancesTable).values({
        employeeId,
        allowanceDefinitionId: item.allowanceDefinitionId,
        amount: item.amount,
      });
    }
  }

  // Return updated list
  const definitions = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true))
    .orderBy(allowanceDefinitionsTable.sortOrder);

  const empAllowances = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId));

  const result = definitions.map(def => {
    const existing = empAllowances.find(a => a.allowanceDefinitionId === def.id);
    return {
      id: existing?.id ?? 0,
      employeeId,
      allowanceDefinitionId: def.id,
      allowanceName: def.name,
      isTaxable: def.isTaxable,
      amount: existing?.amount ?? 0,
      sortOrder: def.sortOrder,
    };
  });

  return res.json(result);
});

export default router;
