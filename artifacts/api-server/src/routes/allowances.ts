import { Router } from "express";
import { db, allowanceDefinitionsTable, employeeAllowancesTable, deductionDefinitionsTable, employeeDeductionsTable } from "@workspace/db";
import { paramStr } from "../lib/params";
import { eq, and, ne } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

router.get("/allowance-definitions", async (req, res) => {
  const { activeOnly } = req.query;
  let rows = await db.select().from(allowanceDefinitionsTable).orderBy(allowanceDefinitionsTable.sortOrder);
  if (activeOnly === "true") {
    rows = rows.filter(r => r.isActive);
  }
  return res.json(rows);
});

router.post("/allowance-definitions", requireAdmin, async (req, res) => {
  const body = req.body;
  const existing = await db.select().from(allowanceDefinitionsTable).orderBy(allowanceDefinitionsTable.sortOrder);
  const maxSort = existing.length > 0 ? Math.max(0, ...existing.map(e => e.sortOrder)) : 0;

  const [created] = await db.insert(allowanceDefinitionsTable).values({
    name: body.name,
    description: body.description ?? null,
    isTaxable: body.isTaxable ?? true,
    calculationType: body.calculationType ?? "variable",
    sortOrder: maxSort + 1,
    isActive: true,
  }).returning();
  return res.status(201).json(created);
});

router.put("/allowance-definitions/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const body = req.body;

  // sortOrder が指定されていて変更がある場合、重複を入れ替えで解消
  if (body.sortOrder !== undefined) {
    const newOrder = body.sortOrder;
    const [current] = await db.select().from(allowanceDefinitionsTable).where(eq(allowanceDefinitionsTable.id, id));
    if (!current) return res.status(404).json({ error: "Not found" });

    if (current.sortOrder !== newOrder) {
      const [conflicting] = await db.select().from(allowanceDefinitionsTable)
        .where(and(eq(allowanceDefinitionsTable.sortOrder, newOrder), ne(allowanceDefinitionsTable.id, id)));
      if (conflicting) {
        // 入れ替え：競合相手に現在の sortOrder を割り当て
        await db.update(allowanceDefinitionsTable)
          .set({ sortOrder: current.sortOrder, updatedAt: new Date() })
          .where(eq(allowanceDefinitionsTable.id, conflicting.id));
      }
    }
  }

  const [updated] = await db.update(allowanceDefinitionsTable).set({
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.isTaxable !== undefined && { isTaxable: body.isTaxable }),
    ...(body.calculationType !== undefined && { calculationType: body.calculationType }),
    ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
    updatedAt: new Date(),
  }).where(eq(allowanceDefinitionsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  return res.json(updated);
});

router.delete("/allowance-definitions/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  // 関連する社員手当レコードも削除してから定義を完全削除
  await db.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.allowanceDefinitionId, id));
  await db.delete(allowanceDefinitionsTable).where(eq(allowanceDefinitionsTable.id, id));
  return res.status(204).send();
});

router.get("/employees/:id/allowances", async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);

  const empAllowances = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId))
    .orderBy(employeeAllowancesTable.sortOrder);

  if (empAllowances.length === 0) {
    return res.json([]);
  }

  const definitions = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true));

  const result = empAllowances.map(ea => {
    const def = definitions.find(d => d.id === ea.allowanceDefinitionId);
    return {
      id: ea.id,
      employeeId,
      allowanceDefinitionId: ea.allowanceDefinitionId,
      allowanceName: def?.name ?? "",
      isTaxable: def?.isTaxable ?? true,
      amount: ea.amount,
      sortOrder: ea.sortOrder,
    };
  });

  return res.json(result);
});

router.put("/employees/:id/allowances", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);
  const { allowances } = req.body as { allowances: Array<{ allowanceDefinitionId: number; amount: number }> };

  const insertData = allowances?.length > 0
    ? allowances.map((item, idx) => ({
        employeeId,
        allowanceDefinitionId: item.allowanceDefinitionId,
        amount: item.amount,
        sortOrder: idx,
      }))
    : [];

  await db.transaction(async (tx) => {
    await tx.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, employeeId));
    if (insertData.length > 0) {
      await tx.insert(employeeAllowancesTable).values(insertData).returning();
    }
  });

  const empAllowances = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId))
    .orderBy(employeeAllowancesTable.sortOrder);

  const definitions = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true));

  const result = empAllowances.map(ea => {
    const def = definitions.find(d => d.id === ea.allowanceDefinitionId);
    return {
      id: ea.id,
      employeeId,
      allowanceDefinitionId: ea.allowanceDefinitionId,
      allowanceName: def?.name ?? "",
      isTaxable: def?.isTaxable ?? true,
      amount: ea.amount,
      sortOrder: ea.sortOrder,
    };
  });

  return res.json(result);
});

// ── 差引マスター ─────────────────────────────────────────────────────────────

router.get("/deduction-definitions", async (req, res) => {
  const { activeOnly } = req.query;
  let rows = await db.select().from(deductionDefinitionsTable).orderBy(deductionDefinitionsTable.sortOrder);
  if (activeOnly === "true") {
    rows = rows.filter(r => r.isActive);
  }
  return res.json(rows);
});

router.post("/deduction-definitions", requireAdmin, async (req, res) => {
  const body = req.body;
  const existing = await db.select().from(deductionDefinitionsTable).orderBy(deductionDefinitionsTable.sortOrder);
  const maxSort = existing.length > 0 ? Math.max(0, ...existing.map(e => e.sortOrder)) : 0;

  const [created] = await db.insert(deductionDefinitionsTable).values({
    name: body.name,
    description: body.description ?? null,
    calculationType: body.calculationType ?? "fixed",
    sortOrder: maxSort + 1,
    isActive: true,
  }).returning();
  return res.status(201).json(created);
});

router.put("/deduction-definitions/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const body = req.body;

  // sortOrder が指定されていて変更がある場合、重複を入れ替えで解消
  if (body.sortOrder !== undefined) {
    const newOrder = body.sortOrder;
    const [current] = await db.select().from(deductionDefinitionsTable).where(eq(deductionDefinitionsTable.id, id));
    if (!current) return res.status(404).json({ error: "Not found" });

    if (current.sortOrder !== newOrder) {
      const [conflicting] = await db.select().from(deductionDefinitionsTable)
        .where(and(eq(deductionDefinitionsTable.sortOrder, newOrder), ne(deductionDefinitionsTable.id, id)));
      if (conflicting) {
        // 入れ替え：競合相手に現在の sortOrder を割り当て
        await db.update(deductionDefinitionsTable)
          .set({ sortOrder: current.sortOrder, updatedAt: new Date() })
          .where(eq(deductionDefinitionsTable.id, conflicting.id));
      }
    }
  }

  const [updated] = await db.update(deductionDefinitionsTable).set({
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.calculationType !== undefined && { calculationType: body.calculationType }),
    ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
    updatedAt: new Date(),
  }).where(eq(deductionDefinitionsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  return res.json(updated);
});

router.delete("/deduction-definitions/:id", requireAdmin, async (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  // 関連する社員差引レコードも削除してから定義を完全削除
  await db.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.deductionDefinitionId, id));
  await db.delete(deductionDefinitionsTable).where(eq(deductionDefinitionsTable.id, id));
  return res.status(204).send();
});

router.get("/employees/:id/deductions", async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);

  const empDeductions = await db.select().from(employeeDeductionsTable)
    .where(eq(employeeDeductionsTable.employeeId, employeeId))
    .orderBy(employeeDeductionsTable.sortOrder);

  if (empDeductions.length === 0) {
    return res.json([]);
  }

  const definitions = await db.select().from(deductionDefinitionsTable)
    .where(eq(deductionDefinitionsTable.isActive, true));

  const result = empDeductions.map(ed => {
    const def = definitions.find(d => d.id === ed.deductionDefinitionId);
    return {
      id: ed.id,
      employeeId,
      deductionDefinitionId: ed.deductionDefinitionId,
      deductionName: def?.name ?? "",
      amount: ed.amount,
      sortOrder: ed.sortOrder,
    };
  });

  return res.json(result);
});

router.put("/employees/:id/deductions", requireAdmin, async (req, res) => {
  const employeeId = parseInt(paramStr(req.params.id), 10);
  const { deductions } = req.body as { deductions: Array<{ deductionDefinitionId: number; amount: number }> };

  await db.transaction(async (tx) => {
    await tx.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.employeeId, employeeId));
    if (deductions.length > 0) {
      await tx.insert(employeeDeductionsTable).values(
        deductions.map((item, idx) => ({
          employeeId,
          deductionDefinitionId: item.deductionDefinitionId,
          amount: item.amount,
          sortOrder: idx,
        }))
      );
    }
  });

  const empDeductions = await db.select().from(employeeDeductionsTable)
    .where(eq(employeeDeductionsTable.employeeId, employeeId))
    .orderBy(employeeDeductionsTable.sortOrder);

  const definitions = await db.select().from(deductionDefinitionsTable)
    .where(eq(deductionDefinitionsTable.isActive, true));

  const result = empDeductions.map(ed => {
    const def = definitions.find(d => d.id === ed.deductionDefinitionId);
    return {
      id: ed.id,
      employeeId,
      deductionDefinitionId: ed.deductionDefinitionId,
      deductionName: def?.name ?? "",
      amount: ed.amount,
      sortOrder: ed.sortOrder,
    };
  });

  return res.json(result);
});

export default router;
