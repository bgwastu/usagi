import type {
  Account,
  AccountCardModel,
  AccountUsage,
  ProviderId,
} from "@/lib/types";
import { fetchCodexUsage, refreshCodexCredentials } from "@/providers/codex";
import { fetchCursorUsage } from "@/providers/cursor";
import { fetchOpenCodeGoUsage } from "@/providers/opencode-go";
import { fetchTavilyUsage } from "@/providers/tavily";
import { fetchExaUsage } from "@/providers/exa";
import { fetchComposioUsage } from "@/providers/composio";
import { saveAccount } from "@/lib/db";
import { PROVIDER_META } from "@/lib/types";
import {
  clearPersistedUsageCache,
  readPersistedUsageCache,
  removePersistedUsageEntry,
  schedulePersistUsageCache,
  type PersistedCacheEntry,
} from "@/lib/usage-cache-store";

type CacheEntry = PersistedCacheEntry;

type GlobalUsageCache = typeof globalThis & {
  __usagiUsageCache?: Map<string, CacheEntry>;
  __usagiCredentialCooldown?: Map<string, number>;
  __usagiUsageCacheHydrated?: boolean;
};

const globalStore = globalThis as GlobalUsageCache;

/** Survive Next.js HMR so Tavily isn't re-hit every reload. */
const usageCache =
  globalStore.__usagiUsageCache ?? new Map<string, CacheEntry>();
globalStore.__usagiUsageCache = usageCache;

/** Shared cooldown when multiple accounts share one API key / cookie. */
const credentialCooldown =
  globalStore.__usagiCredentialCooldown ?? new Map<string, number>();
globalStore.__usagiCredentialCooldown = credentialCooldown;

function hydrateUsageCacheFromDisk() {
  if (globalStore.__usagiUsageCacheHydrated) return;
  globalStore.__usagiUsageCacheHydrated = true;
  if (usageCache.size > 0) return;
  for (const [id, entry] of readPersistedUsageCache()) {
    usageCache.set(id, entry);
  }
}

function writeCacheEntry(accountId: string, entry: CacheEntry) {
  usageCache.set(accountId, entry);
  schedulePersistUsageCache(usageCache);
}

function credentialCooldownKey(account: Account): string {
  switch (account.provider) {
    case "tavily":
      return `tavily:${account.credentials.apiKey}`;
    case "exa":
      return `exa:${account.credentials.apiKey}:${account.credentials.keyId ?? ""}`;
    case "composio":
      return `composio:${account.credentials.apiKey}`;
    case "opencode-go":
      return `opencode-go:${account.credentials.cookie}`;
    case "cursor":
      return `cursor:${account.credentials.cookie}`;
    case "codex":
      return `codex:${account.credentials.refreshToken}`;
    default: {
      const _exhaustive: never = account;
      return _exhaustive;
    }
  }
}

function isRateLimitedUsage(usage: AccountUsage): boolean {
  return (
    usage.status === "error" &&
    typeof usage.error === "string" &&
    /rate limit/i.test(usage.error)
  );
}

function rateLimitedPlaceholder(account: Account): AccountUsage {
  const provider = account.provider;
  return {
    accountId: account.id,
    provider,
    meters: [],
    fetchedAt: Date.now(),
    status: "error",
    error:
      provider === "tavily"
        ? "Tavily usage rate limit (10 / 10 min) — try again shortly"
        : "Provider rate limited — try again shortly",
  };
}

/** Instant board shell: accounts + last-known usage (memory/disk), no live fetches. */
export function buildAccountShell(
  accounts: Account[],
): AccountCardModel[] {
  hydrateUsageCacheFromDisk();
  return accounts.map((account) => ({
    account,
    usage: usageCache.get(account.id)?.usage ?? null,
  }));
}

export function getCachedUsage(accountId: string): AccountUsage | null {
  hydrateUsageCacheFromDisk();
  return usageCache.get(accountId)?.usage ?? null;
}

function needsLiveFetch(account: Account, force?: boolean): boolean {
  hydrateUsageCacheFromDisk();
  const now = Date.now();
  const cached = usageCache.get(account.id);
  const sharedCooldownUntil =
    credentialCooldown.get(credentialCooldownKey(account)) ?? 0;
  const nextFetchAt = Math.max(cached?.nextFetchAt ?? 0, sharedCooldownUntil);
  const inHardRateLimit = sharedCooldownUntil > now;

  if (inHardRateLimit) return false;
  if (force) return true;
  if (!cached) return true;
  return nextFetchAt <= now;
}

/**
 * Live-fetch usage for accounts that are past their refresh window.
 * Safe to call from a background poll — board can already show stale meters.
 */
export async function refreshAccountUsages(
  accounts: Account[],
  options?: { force?: boolean },
): Promise<AccountCardModel[]> {
  hydrateUsageCacheFromDisk();
  const results = await Promise.all(
    accounts.map(async (account) => {
      if (!needsLiveFetch(account, options?.force)) {
        return {
          account,
          usage: usageCache.get(account.id)?.usage ?? null,
        };
      }
      return fetchUsageForAccount(account, { force: options?.force });
    }),
  );
  return results;
}

export async function fetchUsageForAccount(
  account: Account,
  options?: { force?: boolean },
): Promise<{ account: Account; usage: AccountUsage }> {
  hydrateUsageCacheFromDisk();
  const now = Date.now();
  const minMs = PROVIDER_META[account.provider].minRefreshMs;
  const rateLimitBackoffMs =
    PROVIDER_META[account.provider].rateLimitBackoffMs ?? minMs;
  const cached = usageCache.get(account.id);
  const sharedCooldownUntil =
    credentialCooldown.get(credentialCooldownKey(account)) ?? 0;

  const nextFetchAt = Math.max(cached?.nextFetchAt ?? 0, sharedCooldownUntil);
  const inProviderCooldown = nextFetchAt > now;
  const inHardRateLimit = sharedCooldownUntil > now;

  // Serve cache while inside the provider's min refresh window.
  // Force may bypass min refresh, but never a hard rate-limit cooldown.
  if (inProviderCooldown && (!options?.force || inHardRateLimit)) {
    if (cached) return { account, usage: cached.usage };
    if (inHardRateLimit) {
      return { account, usage: rateLimitedPlaceholder(account) };
    }
  }

  let working = account;

  if (working.provider === "codex") {
    const refreshed = await refreshCodexCredentials(working);
    if (refreshed.changed) {
      working = refreshed.account;
      await saveAccount(working);
    }
  }

  const hasFreshMeters =
    cached?.usage.status === "ok" && cached.usage.meters.length > 0;

  let usage: AccountUsage;
  try {
    usage = await fetchProviderUsage(working, {
      // Cold / error tiles: one Exa window. Warm tiles: full 3d/7d/30d.
      exaDetail: hasFreshMeters ? "full" : "fast",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown provider error";
    usage = {
      accountId: working.id,
      provider: working.provider,
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: message,
    };
  }

  let entryNextFetchAt = now + minMs;

  if (isRateLimitedUsage(usage)) {
    entryNextFetchAt = now + rateLimitBackoffMs;
    credentialCooldown.set(credentialCooldownKey(working), entryNextFetchAt);

    // Keep last successful meters instead of blanking the tile.
    if (cached?.usage.status === "ok" && cached.usage.meters.length > 0) {
      usage = {
        ...cached.usage,
        fetchedAt: cached.usage.fetchedAt,
      };
    }
  }

  writeCacheEntry(working.id, {
    usage,
    fetchedAt: now,
    nextFetchAt: entryNextFetchAt,
  });
  return { account: working, usage };
}

async function fetchProviderUsage(
  account: Account,
  options?: { exaDetail?: "fast" | "full" },
): Promise<AccountUsage> {
  switch (account.provider) {
    case "codex":
      return fetchCodexUsage(account);
    case "opencode-go":
      return fetchOpenCodeGoUsage(account);
    case "tavily":
      return fetchTavilyUsage(account);
    case "exa":
      return fetchExaUsage(account, { detail: options?.exaDetail ?? "full" });
    case "composio":
      return fetchComposioUsage(account);
    case "cursor":
      return fetchCursorUsage(account);
    default: {
      const _exhaustive: never = account;
      return _exhaustive;
    }
  }
}

export function invalidateUsageCache(accountId?: string) {
  hydrateUsageCacheFromDisk();
  if (accountId) {
    usageCache.delete(accountId);
    removePersistedUsageEntry(accountId);
  } else {
    usageCache.clear();
    clearPersistedUsageCache();
  }
}

export function providerIds(): ProviderId[] {
  return Object.keys(PROVIDER_META) as ProviderId[];
}
