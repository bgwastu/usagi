import { JSONFilePreset } from "lowdb/node";
import {
  decryptPayload,
  encryptPayload,
  ensureDataDir,
  isEncryptedBlob,
  readRawStore,
  writeRawStore,
  dataFilePath,
} from "@/lib/crypto";
import type { Account, DatabaseSchema } from "@/lib/types";

const defaultData: DatabaseSchema = {
  version: 1,
  accounts: [],
};

function encryptionKey(): string | undefined {
  const key = process.env.ENCRYPTION_KEY?.trim();
  return key || undefined;
}

async function loadPlainJson(): Promise<DatabaseSchema> {
  ensureDataDir();
  const raw = readRawStore();
  const key = encryptionKey();

  if (!raw) {
    writeRawStore(
      key
        ? encryptPayload(JSON.stringify(defaultData, null, 2), key)
        : JSON.stringify(defaultData, null, 2),
    );
    return structuredClone(defaultData);
  }

  const trimmed = raw.trim();
  if (isEncryptedBlob(trimmed)) {
    if (!key) {
      throw new Error(
        "data.json is encrypted but ENCRYPTION_KEY is not set.",
      );
    }
    const plain = decryptPayload(trimmed, key);
    return JSON.parse(plain) as DatabaseSchema;
  }

  if (key) {
    // Migrate plaintext → encrypted on next write path
    return JSON.parse(trimmed) as DatabaseSchema;
  }

  return JSON.parse(trimmed) as DatabaseSchema;
}

type DbHandle = Awaited<ReturnType<typeof JSONFilePreset<DatabaseSchema>>>;

let memoryDb: DatabaseSchema | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function persist(data: DatabaseSchema) {
  const key = encryptionKey();
  const json = JSON.stringify(data, null, 2);
  writeRawStore(key ? encryptPayload(json, key) : json);
}

export async function getDb(): Promise<{
  data: DatabaseSchema;
  write: () => Promise<void>;
}> {
  if (!memoryDb) {
    memoryDb = await loadPlainJson();
  }

  return {
    data: memoryDb,
    write: async () => {
      writeQueue = writeQueue.then(async () => {
        if (!memoryDb) return;
        await persist(memoryDb);
      });
      await writeQueue;
    },
  };
}

/** lowdb-compatible helper when ENCRYPTION_KEY is unset — still OK for tools */
export async function getLowdb(): Promise<DbHandle> {
  ensureDataDir();
  if (encryptionKey()) {
    throw new Error("Use getDb() when ENCRYPTION_KEY is set.");
  }
  return JSONFilePreset<DatabaseSchema>(dataFilePath(), defaultData);
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.data.accounts;
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const db = await getDb();
  return db.data.accounts.find((a) => a.id === id);
}

export async function saveAccount(account: Account): Promise<Account> {
  const db = await getDb();
  const index = db.data.accounts.findIndex((a) => a.id === account.id);
  if (index >= 0) {
    db.data.accounts[index] = account;
  } else {
    db.data.accounts.push(account);
  }
  await db.write();
  return account;
}

export async function deleteAccount(id: string): Promise<boolean> {
  const db = await getDb();
  const before = db.data.accounts.length;
  db.data.accounts = db.data.accounts.filter((a) => a.id !== id);
  if (db.data.accounts.length === before) return false;
  await db.write();
  return true;
}

export async function replaceAccounts(accounts: Account[]): Promise<void> {
  const db = await getDb();
  db.data.accounts = accounts;
  await db.write();
}

export async function reorderAccounts(orderedIds: string[]): Promise<Account[]> {
  const db = await getDb();
  const byId = new Map(db.data.accounts.map((a) => [a.id, a]));
  const next: Account[] = [];
  for (const id of orderedIds) {
    const account = byId.get(id);
    if (account) {
      next.push(account);
      byId.delete(id);
    }
  }
  for (const leftover of byId.values()) {
    next.push(leftover);
  }
  db.data.accounts = next;
  await db.write();
  return next;
}
