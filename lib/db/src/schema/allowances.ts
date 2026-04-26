import { pgTable, serial, text, integer, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const allowanceDefinitionsTable = pgTable("allowance_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isTaxable: boolean("is_taxable").notNull().default(true),
  isSocialInsuranceIncluded: boolean("is_social_insurance_included").notNull().default(true),
  calculationType: text("calculation_type").notNull().default("variable"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
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
