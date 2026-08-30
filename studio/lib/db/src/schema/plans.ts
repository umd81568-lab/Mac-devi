import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export type StoredScenePlan = {
  index: number;
  title: string;
  narration: string;
  visualPrompt: string;
  durationSeconds: number;
  assetStatus: "pending" | "ready" | "needs-review";
  subtitleStartSeconds?: number;
  subtitleEndSeconds?: number;
  delivery?: StoredSceneDelivery;
};

export type StoredSceneDelivery = {
  voiceProfileId?: number | null;
  rate?: number;
  pitch?: number;
  pauseMs?: number;
  pronunciation?: string | null;
  presenterAssetId?: number | null;
  presenterMode?: "none" | "lipsync" | "scene";
  presenterFraming?: "close-up" | "waist-up" | "full-body";
  presenterDeliveryMode?: "conversational" | "presentational" | "energetic" | "calm";
  subtitlesEnabled?: boolean;
};

export const projectPlansTable = pgTable("project_plans", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  sceneCount: integer("scene_count").notNull(),
  estimatedDurationSeconds: integer("estimated_duration_seconds").notNull(),
  scenes: jsonb("scenes").$type<StoredScenePlan[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const storedScenePlanSchema = z.object({
  index: z.number(),
  title: z.string(),
  narration: z.string(),
  visualPrompt: z.string(),
  durationSeconds: z.number(),
  assetStatus: z.enum(["pending", "ready", "needs-review"]),
  subtitleStartSeconds: z.number().optional(),
  subtitleEndSeconds: z.number().optional(),
  delivery: z.object({
    voiceProfileId: z.number().nullable().optional(),
    rate: z.number().optional(),
    pitch: z.number().optional(),
    pauseMs: z.number().optional(),
    pronunciation: z.string().nullable().optional(),
    presenterAssetId: z.number().nullable().optional(),
    presenterMode: z.enum(["none", "lipsync", "scene"]).optional(),
    subtitlesEnabled: z.boolean().optional(),
  }).optional(),
});