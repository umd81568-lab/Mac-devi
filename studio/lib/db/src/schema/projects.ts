import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description").notNull().default(""),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  format: varchar("format", { length: 16 }).notNull().default("landscape"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  scenes: integer("scenes").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  updatedAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;