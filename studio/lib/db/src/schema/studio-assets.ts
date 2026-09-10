import { boolean, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studioAssetKind = ["voice-profile", "presenter-reference"] as const;

export const studioAssetsTable = pgTable("studio_assets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  kind: varchar("kind", { length: 40 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  filePath: text("file_path").notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  consentGranted: boolean("consent_granted").notNull().default(false),
  consentSubject: varchar("consent_subject", { length: 180 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStudioAssetSchema = createInsertSchema(studioAssetsTable).omit({
  createdAt: true,
});
export type InsertStudioAsset = z.infer<typeof insertStudioAssetSchema>;
export type StudioAsset = typeof studioAssetsTable.$inferSelect;