import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  span: text("span").notNull(),
  credentials: text("credentials").notNull(),
  authStatus: text("auth_status").notNull().default("ok"),
  authError: text("auth_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  position: integer("position").notNull().default(0),
});

export const usageSnapshots = sqliteTable("usage_snapshots", {
  accountId: text("account_id").primaryKey(),
  usage: text("usage").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
  nextFetchAt: integer("next_fetch_at").notNull(),
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  verifier: text("verifier"),
  kind: text("kind").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const schema = { accounts, usageSnapshots, oauthStates };
