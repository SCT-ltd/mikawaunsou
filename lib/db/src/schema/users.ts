import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const usersTable = pgTable("system_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
