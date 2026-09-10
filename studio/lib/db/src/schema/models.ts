import { boolean, integer, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modelsTable = pgTable("models", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 160 }).notNull(),
  provider: varchar("provider", { length: 80 }).notNull(),
  purpose: varchar("purpose", { length: 120 }).notNull(),
  runtime: varchar("runtime", { length: 80 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("available"),
  size: varchar("size", { length: 40 }).notNull(),
  recommended: boolean("recommended").notNull().default(false),
});

export const insertModelSchema = createInsertSchema(modelsTable);
export type InsertModel = z.infer<typeof insertModelSchema>;
export type Model = typeof modelsTable.$inferSelect;