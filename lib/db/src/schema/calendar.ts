import { pgTable, serial, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";

export const calendarOverridesTable = pgTable("calendar_overrides", {
  id: serial("id").primaryKey(),
  dateStr: text("date_str").notNull(),
  isRed: boolean("is_red").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("calendar_overrides_date_str_key").on(t.dateStr)]);

export type CalendarOverride = typeof calendarOverridesTable.$inferSelect;
