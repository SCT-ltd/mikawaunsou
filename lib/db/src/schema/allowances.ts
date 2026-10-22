import { pgTable, serial, text, integer, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const allowanceDefinitionsTable = pgTable("allowance_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isTaxable: boolean("is_taxable").notNull().default(true),
  calculationType: text("calculation_type").notNull().default("variable"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // ON にすると全社員の手当リストに常時表示される（毎回の手当追加を省く）
  pinned: boolean("pinned").notNull().default(false),
  // ON にすると、この手当は雇用保険料の計算基礎から除外される（例: 携帯代など実費弁償の手当）。
  // 交通費（通勤手当）は非課税でも賃金に含めるため OFF のまま。
  excludeFromEmploymentInsurance: boolean("exclude_from_employment_insurance").notNull().default(false),
  // ON にすると、割増賃金（残業・休日・深夜）の基礎と最低賃金の比較に入れる（会社設定①が ON のとき使う）。
  // 家族手当・通勤手当・別居手当・子女教育手当・住宅手当・臨時の賃金は入れない（労基法37条5項・労基則21条）。
  includeInPremiumBase: boolean("include_in_premium_base").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const employeeAllowancesTable = pgTable("employee_allowances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  allowanceDefinitionId: integer("allowance_definition_id").notNull().references(() => allowanceDefinitionsTable.id),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAllowanceDefinitionSchema = createInsertSchema(allowanceDefinitionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAllowanceDefinition = z.infer<typeof insertAllowanceDefinitionSchema>;
export type AllowanceDefinition = typeof allowanceDefinitionsTable.$inferSelect;

export const insertEmployeeAllowanceSchema = createInsertSchema(employeeAllowancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeeAllowance = z.infer<typeof insertEmployeeAllowanceSchema>;
export type EmployeeAllowance = typeof employeeAllowancesTable.$inferSelect;

export const deductionDefinitionsTable = pgTable("deduction_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  calculationType: text("calculation_type").notNull().default("fixed"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const employeeDeductionsTable = pgTable("employee_deductions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  deductionDefinitionId: integer("deduction_definition_id").notNull().references(() => deductionDefinitionsTable.id),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDeductionDefinitionSchema = createInsertSchema(deductionDefinitionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeductionDefinition = z.infer<typeof insertDeductionDefinitionSchema>;
export type DeductionDefinition = typeof deductionDefinitionsTable.$inferSelect;

export const insertEmployeeDeductionSchema = createInsertSchema(employeeDeductionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeeDeduction = z.infer<typeof insertEmployeeDeductionSchema>;
export type EmployeeDeduction = typeof employeeDeductionsTable.$inferSelect;
