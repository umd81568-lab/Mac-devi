import { integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { studioAssetsTable } from "./studio-assets";

export const studioJobKinds = ["voice", "image", "presenter-lipsync", "presenter-scene"] as const;
export const studioJobStatuses = ["queued", "rendering", "review", "complete", "failed", "cancelled"] as const;

export const studioJobsTable = pgTable("studio_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  kind: varchar("kind", { length: 40 }).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").references(() => studioAssetsTable.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  eta: varchar("eta", { length: 40 }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  outputPath: text("output_path"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertStudioJobSchema = createInsertSchema(studioJobsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertStudioJob = z.infer<typeof insertStudioJobSchema>;
export type StudioJob = typeof studioJobsTable.$inferSelect;