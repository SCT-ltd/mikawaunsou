import { Router } from "express";
import { db, allowanceDefinitionsTable, employeeAllowancesTable, deductionDefinitionsTable, employeeDeductionsTable } from "@workspace/db";
import { eq, and, ne, asc } from "drizzle-orm";

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

router.put("/allowance-definitions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

router.delete("/allowance-definitions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // 関連する社員手当レコードも削除してから定義を完全削除
  await db.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.allowanceDefinitionId, id));
  await db.delete(allowanceDefinitionsTable).where(eq(allowanceDefinitionsTable.id, id));
  return res.status(204).send();
});

router.get("/employees/:id/allowances", async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);

  const definitions = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true));

  const empAllowances = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId));

  // 全定義を返す。社員固有のsortOrderがあればそれを使い、なければ定義のsortOrderを大きなオフセット付きで末尾扱い
  const result = definitions
    .map(def => {
      const ea = empAllowances.find(a => a.allowanceDefinitionId === def.id);
      return {
        id: ea?.id ?? 0,
        employeeId,
        allowanceDefinitionId: def.id,
        allowanceName: def.name,
        isTaxable: def.isTaxable,
        amount: ea?.amount ?? 0,
        sortOrder: ea != null ? ea.sortOrder : 1_000_000 + def.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return res.json(result);
});

router.put("/employees/:id/allowances", async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  const { allowances } = req.body as { allowances: Array<{ allowanceDefinitionId: number; amount: number; sortOrder?: number }> };

  await db.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, employeeId));
  if (allowances.length > 0) {
    await db.insert(employeeAllowancesTable).values(
      allowances.map((item, idx) => ({
        employeeId,
        allowanceDefinitionId: item.allowanceDefinitionId,
        amount: item.amount,
        sortOrder: item.sortOrder ?? idx,
      }))
    );
  }

  const empAllowances = await db.select().from(employeeAllowancesTable)
    .where(eq(employeeAllowancesTable.employeeId, employeeId));

  const definitions = await db.select().from(allowanceDefinitionsTable)
    .where(eq(allowanceDefinitionsTable.isActive, true));

  const result = definitions
    .map(def => {
      const ea = empAllowances.find(a => a.allowanceDefinitionId === def.id);
      return {
        id: ea?.id ?? 0,
        employeeId,
        allowanceDefinitionId: def.id,
        allowanceName: def.name,
        isTaxable: def.isTaxable,
        amount: ea?.amount ?? 0,
        sortOrder: ea != null ? ea.sortOrder : 1_000_000 + def.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

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

router.post("/deduction-definitions", async (req, res) => {
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

router.put("/deduction-definitions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

router.delete("/deduction-definitions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // 関連する社員差引レコードも削除してから定義を完全削除
  await db.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.deductionDefinitionId, id));
  await db.delete(deductionDefinitionsTable).where(eq(deductionDefinitionsTable.id, id));
  return res.status(204).send();
});

router.get("/employees/:id/deductions", async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);

  const definitions = await db.select().from(deductionDefinitionsTable)
    .where(eq(deductionDefinitionsTable.isActive, true));

  const empDeductions = await db.select().from(employeeDeductionsTable)
    .where(eq(employeeDeductionsTable.employeeId, employeeId));

  const result = definitions
    .map(def => {
      const ed = empDeductions.find(d => d.deductionDefinitionId === def.id);
      return {
        id: ed?.id ?? 0,
        employeeId,
        deductionDefinitionId: def.id,
        deductionName: def.name,
        amount: ed?.amount ?? 0,
        sortOrder: ed != null ? ed.sortOrder : 1_000_000 + def.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return res.json(result);
});

router.put("/employees/:id/deductions", async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  const { deductions } = req.body as { deductions: Array<{ deductionDefinitionId: number; amount: number; sortOrder?: number }> };

  await db.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.employeeId, employeeId));
  if (deductions.length > 0) {
    await db.insert(employeeDeductionsTable).values(
      deductions.map((item, idx) => ({
        employeeId,
        deductionDefinitionId: item.deductionDefinitionId,
        amount: item.amount,
        sortOrder: item.sortOrder ?? idx,
      }))
    );
  }

  const empDeductions = await db.select().from(employeeDeductionsTable)
    .where(eq(employeeDeductionsTable.employeeId, employeeId));

  const definitions = await db.select().from(deductionDefinitionsTable)
    .where(eq(deductionDefinitionsTable.isActive, true));

  const result = definitions
    .map(def => {
      const ed = empDeductions.find(d => d.deductionDefinitionId === def.id);
      return {
        id: ed?.id ?? 0,
        employeeId,
        deductionDefinitionId: def.id,
        deductionName: def.name,
        amount: ed?.amount ?? 0,
        sortOrder: ed != null ? ed.sortOrder : 1_000_000 + def.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return res.json(result);
});

export default router;
