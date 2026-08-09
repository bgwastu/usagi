import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { encryptionKey, encryptPayload, decryptPayload } from "@/lib/crypto";
import type { Account, AccountUsage, DatabaseSchema } from "@/lib/types";
import { accounts, oauthStates, schema, usageSnapshots } from "@/db/schema";

type Database = BunSQLiteDatabase<typeof schema>;
let sqliteDatabase: Database | null = null;

function dataDir() {
  return path.join(process.cwd(), "data");
}

function decodeCredentials(value: string): Account["credentials"] {
  const key = encryptionKey();
  return JSON.parse(key ? decryptPayload(value, key) : value) as Account["credentials"];
}

function encodeCredentials(value: Account["credentials"]): string {
  const json = JSON.stringify(value);
  const key = encryptionKey();
  return key ? encryptPayload(json, key) : json;
}

function fromRow(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    provider: row.provider as Account["provider"],
    name: row.name,
    span: row.span as Account["span"],
    credentials: decodeCredentials(row.credentials),
    authStatus: row.authStatus === "reauth_required" ? "reauth_required" : "ok",
    authError: row.authError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as Account;
}

function accountValues(account: Account, position?: number) {
  return {
    id: account.id,
    provider: account.provider,
    name: account.name,
    span: account.span,
    credentials: encodeCredentials(account.credentials),
    authStatus: account.authStatus ?? "ok",
    authError: account.authError ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    ...(position === undefined ? {} : { position }),
  };
}

function migrateLegacy(): Account[] {
  const file = path.join(dataDir(), "data.json");
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf8");
    const key = encryptionKey();
    const json = key && raw.startsWith("usagi1:") ? decryptPayload(raw, key) : raw;
    return (JSON.parse(json) as DatabaseSchema).accounts ?? [];
  } catch {
    return [];
  }
}

async function getDatabase(): Promise<Database> {
  if (sqliteDatabase) return sqliteDatabase;
  mkdirSync(dataDir(), { recursive: true });
  const { Database } = await import("bun:sqlite");
  const { drizzle: drizzleSqlite } = await import("drizzle-orm/bun-sqlite");
  const sqlite = new Database(path.join(dataDir(), "usagi.sqlite"));
  const db = drizzleSqlite(sqlite, { schema });
  sqlite.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, span TEXT NOT NULL, credentials TEXT NOT NULL, auth_status TEXT NOT NULL DEFAULT 'ok', auth_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS usage_snapshots (account_id TEXT PRIMARY KEY, usage TEXT NOT NULL, fetched_at INTEGER NOT NULL, next_fetch_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, verifier TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  sqliteDatabase = db;
  const existing = await db.select({ id: accounts.id }).from(accounts).limit(1);
  if (existing.length === 0) {
    const legacy = migrateLegacy();
    for (const [position, account] of legacy.entries()) await db.insert(accounts).values(accountValues(account, position));
  }
  return db;
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDatabase();
  return (await db.select().from(accounts).orderBy(asc(accounts.position), asc(accounts.createdAt))).map(fromRow);
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const db = await getDatabase();
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function saveAccount(account: Account): Promise<Account> {
  const db = await getDatabase();
  await db.insert(accounts).values(accountValues(account)).onConflictDoUpdate({ target: accounts.id, set: accountValues(account) });
  return account;
}

export async function updateAccount(account: Account) { await saveAccount(account); return true; }

export async function deleteAccount(id: string): Promise<boolean> {
  const db = await getDatabase();
  await db.delete(accounts).where(eq(accounts.id, id));
  return true;
}

export async function replaceAccounts(next: Account[]) {
  const db = await getDatabase();
  await db.delete(accounts);
  for (const [position, account] of next.entries()) await db.insert(accounts).values(accountValues(account, position));
}

export async function reorderAccounts(orderedIds: string[]) {
  const current = await listAccounts();
  const byId = new Map(current.map((account) => [account.id, account]));
  const next = [...orderedIds.map((id) => byId.get(id)).filter((account): account is Account => Boolean(account)), ...byId.values()];
  await replaceAccounts(next);
  return next;
}

export async function readUsageSnapshots() {
  const db = await getDatabase();
  const rows = await db.select().from(usageSnapshots);
  return new Map(rows.map((row) => [row.accountId, { usage: JSON.parse(row.usage) as AccountUsage, fetchedAt: row.fetchedAt, nextFetchAt: row.nextFetchAt }]));
}

export async function writeUsageSnapshots(entries: Map<string, { usage: AccountUsage; fetchedAt: number; nextFetchAt: number }>) {
  const db = await getDatabase();
  for (const [accountId, entry] of entries) {
    await db.insert(usageSnapshots).values({ accountId, usage: JSON.stringify(entry.usage), fetchedAt: entry.fetchedAt, nextFetchAt: entry.nextFetchAt }).onConflictDoUpdate({ target: usageSnapshots.accountId, set: { usage: JSON.stringify(entry.usage), fetchedAt: entry.fetchedAt, nextFetchAt: entry.nextFetchAt } });
  }
}

export async function removeUsageSnapshot(accountId: string) { const db = await getDatabase(); await db.delete(usageSnapshots).where(eq(usageSnapshots.accountId, accountId)); }
export async function clearUsageSnapshots() { const db = await getDatabase(); await db.delete(usageSnapshots); }

export async function saveOAuthState(state: string, verifier: string | null, kind: string) { const db = await getDatabase(); await db.insert(oauthStates).values({ state, verifier, kind, createdAt: Date.now() }); }
export async function takeOAuthState(state: string, kind: string): Promise<string | null> { const db = await getDatabase(); const rows = await db.select().from(oauthStates).where(eq(oauthStates.state, state)).limit(1); const row = rows[0]; if (!row || row.kind !== kind || Date.now() - row.createdAt > 15 * 60 * 1000) return null; await db.delete(oauthStates).where(eq(oauthStates.state, state)); return row.verifier; }
