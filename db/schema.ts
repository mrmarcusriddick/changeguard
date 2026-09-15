import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const assets = sqliteTable("assets", { id: text("id").primaryKey(), name: text("name").notNull(), detail: text("detail").notNull() });
export const changes = sqliteTable("changes", {
 id: text("id").primaryKey(), owner: text("owner").notNull(), assetId: text("asset_id").notNull().references(() => assets.id),
 title: text("title").notNull(), description: text("description").notNull(), created: text("created").notNull(),
}, t => [index("idx_changes_owner_created").on(t.owner,t.created)]);
export const runs = sqliteTable("runs", { id: text("id").primaryKey(), changeId: text("change_id").notNull().references(() => changes.id), created: text("created").notNull(), result: text("result").notNull() }, t => [index("idx_runs_change_created").on(t.changeId,t.created)]);
export const findings = sqliteTable("findings", { id: text("id").primaryKey(), runId: text("run_id").notNull().references(() => runs.id), evidence: text("evidence").notNull() }, t => [index("idx_findings_run").on(t.runId)]);
export const plans = sqliteTable("plans", { id: text("id").primaryKey(), runId: text("run_id").notNull().references(() => runs.id), created: text("created").notNull(), document: text("document").notNull() }, t => [index("idx_plans_run").on(t.runId)]);
export const audit = sqliteTable("audit", { id: text("id").primaryKey(), changeId: text("change_id").notNull().references(() => changes.id), actor: text("actor").notNull(), action: text("action").notNull(), created: text("created").notNull() }, t => [index("idx_audit_change_created").on(t.changeId,t.created)]);
