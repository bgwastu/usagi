import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureDataDir } from "@/lib/crypto";
import type { AccountUsage } from "@/lib/types";

export type PersistedCacheEntry = {
  usage: AccountUsage;
  fetchedAt: number;
  nextFetchAt: number;
};

type PersistedCacheFile = {
  version: 1;
  entries: Record<string, PersistedCacheEntry>;
};

function usageCachePath() {
  return path.join(process.cwd(), "data", "usage-cache.json");
}

export function readPersistedUsageCache(): Map<string, PersistedCacheEntry> {
  const file = usageCachePath();
  if (!existsSync(file)) return new Map();
  try {
    const raw = readFileSync(file, "utf8");
    const json = JSON.parse(raw) as PersistedCacheFile;
    if (json.version !== 1 || !json.entries || typeof json.entries !== "object") {
      return new Map();
    }
    return new Map(Object.entries(json.entries));
  } catch {
    return new Map();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersistUsageCache(
  entries: Map<string, PersistedCacheEntry>,
) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      ensureDataDir();
      const payload: PersistedCacheFile = {
        version: 1,
        entries: Object.fromEntries(entries),
      };
      writeFileSync(usageCachePath(), JSON.stringify(payload), { mode: 0o600 });
    } catch {
      // Disk cache is best-effort; in-memory still works.
    }
  }, 400);
}

export function removePersistedUsageEntry(accountId: string) {
  const map = readPersistedUsageCache();
  if (!map.delete(accountId)) return;
  try {
    ensureDataDir();
    const payload: PersistedCacheFile = {
      version: 1,
      entries: Object.fromEntries(map),
    };
    writeFileSync(usageCachePath(), JSON.stringify(payload), { mode: 0o600 });
  } catch {
    // ignore
  }
}

export function clearPersistedUsageCache() {
  try {
    ensureDataDir();
    writeFileSync(
      usageCachePath(),
      JSON.stringify({ version: 1, entries: {} } satisfies PersistedCacheFile),
      { mode: 0o600 },
    );
  } catch {
    // ignore
  }
}
