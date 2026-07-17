import type { Account, AccountUsage, ProviderId } from "@/lib/types";
import { fetchCodexUsage, refreshCodexCredentials } from "@/providers/codex";
import { fetchOpenCodeGoUsage } from "@/providers/opencode-go";
import { fetchTavilyUsage } from "@/providers/tavily";
import { fetchExaUsage } from "@/providers/exa";
import { fetchComposioUsage } from "@/providers/composio";
import { saveAccount } from "@/lib/db";
import { PROVIDER_META } from "@/lib/types";

type CacheEntry = {
  usage: AccountUsage;
  /** Wall clock when this entry was last written. */
  fetchedAt: number;
  /** Earliest time a live provider fetch is allowed again. */
  nextFetchAt: number;
};

type GlobalUsageCache = typeof globalThis & {
  __usagiUsageCache?: Map<string, CacheEntry>;
  __usagiCredentialCooldown?: Map<string, number>;
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

export async function fetchUsageForAccount(
  account: Account,
  options?: { force?: boolean },
): Promise<{ account: Account; usage: AccountUsage }> {
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

  let usage: AccountUsage;
  try {
    usage = await fetchProviderUsage(working);
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

  usageCache.set(working.id, {
    usage,
    fetchedAt: now,
    nextFetchAt: entryNextFetchAt,
  });
  return { account: working, usage };
}

async function fetchProviderUsage(account: Account): Promise<AccountUsage> {
  switch (account.provider) {
    case "codex":
      return fetchCodexUsage(account);
    case "opencode-go":
      return fetchOpenCodeGoUsage(account);
    case "tavily":
      return fetchTavilyUsage(account);
    case "exa":
      return fetchExaUsage(account);
    case "composio":
      return fetchComposioUsage(account);
    default: {
      const _exhaustive: never = account;
      return _exhaustive;
    }
  }
}

export function invalidateUsageCache(accountId?: string) {
  if (accountId) usageCache.delete(accountId);
  else usageCache.clear();
}

export function providerIds(): ProviderId[] {
  return Object.keys(PROVIDER_META) as ProviderId[];
}
