import { integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const renderJobsTable = pgTable("render_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  preset: varchar("preset", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  eta: varchar("eta", { length: 40 }),
  options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
  outputPath: text("output_path"),
  subtitlePath: text("subtitle_path"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRenderJobSchema = createInsertSchema(renderJobsTable).omit({
  createdAt: true,
});
export type InsertRenderJob = z.infer<typeof insertRenderJobSchema>;
export type RenderJob = typeof renderJobsTable.$inferSelect;