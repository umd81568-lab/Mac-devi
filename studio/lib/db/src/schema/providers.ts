import { boolean, integer, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const providerCredentialStorage = ["macos-keychain", "none"] as const;
export type ProviderCredentialStorage = (typeof providerCredentialStorage)[number];

export const providersTable = pgTable("providers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("not-configured"),
  detail: text("detail").notNull().default(""),
  tokenConfigured: boolean("token_configured").notNull().default(false),
});

export const insertProviderSchema = createInsertSchema(providersTable);
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providersTable.$inferSelect;