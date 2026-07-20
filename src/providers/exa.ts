import type { Account, AccountUsage, UsageMeter } from "@/lib/types";

const TEAM_MGMT = "https://admin-api.exa.ai/team-management";
const TEAMS_ME = "https://api.exa.ai/websets/v0/teams/me";
/** Exa usage lookback max for spend-against-budget (documented API cap). */
const BUDGET_LOOKBACK_MS = 180 * 86_400_000;
/** Fail fast — Exa admin API is often slow; long waits stall the board tile. */
const EXA_TIMEOUT_MS = 8_000;

type ExaApiKey = {
  id: string;
  name?: string | null;
  rateLimit?: number | null;
  budgetCents?: number | null;
  isOverBudget?: boolean;
};

type ExaListKeysResponse = {
  apiKeys?: ExaApiKey[];
  apiKey?: ExaApiKey;
};

type ExaKeyUsageResponse = {
  api_key_id?: string;
  api_key_name?: string | null;
  total_cost_usd?: number;
};

type ExaTeamInfo = {
  name?: string;
  concurrency?: { active?: number; queued?: number };
  limits?: {
    maxConcurrent?: number | null;
    maxQueued?: number | null;
  };
};

type SpendWindows = {
  spend3d: number | null;
  spend7d: number | null;
  spend30d: number;
  keyName?: string | null;
};

export type ExaFetchDetail = "fast" | "full";

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    /timed out|aborted/i.test(err.message)
  );
}

async function fetchExa(
  url: string,
  init: RequestInit,
  options?: { retries?: number },
): Promise<Response> {
  const retries = options?.retries ?? 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      if (!isTimeoutError(err) || attempt === retries) break;
    }
  }
  if (isTimeoutError(lastError)) {
    throw new Error("Exa timed out — try again shortly");
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Exa request failed");
}

function usdMeter(input: {
  id: string;
  label: string;
  used: number;
  limit?: number | null;
  resetsAt?: number | null;
}): UsageMeter {
  const limit = input.limit ?? null;
  if (limit == null || limit <= 0) {
    return {
      id: input.id,
      label: input.label,
      kind: "credits",
      used: input.used,
      unit: "USD",
      resetsAt: input.resetsAt,
    };
  }
  const usedPercent = Math.min(100, Math.max(0, (input.used / limit) * 100));
  return {
    id: input.id,
    label: input.label,
    kind: "credits",
    used: input.used,
    remaining: Math.max(0, limit - input.used),
    limit,
    usedPercent,
    unit: "USD",
    resetsAt: input.resetsAt,
  };
}

function windowMeter(input: {
  id: string;
  label: string;
  used: number;
  limit: number | null | undefined;
}): UsageMeter | null {
  if (input.limit == null || input.limit <= 0) return null;
  const usedPercent = Math.min(
    100,
    Math.max(0, (input.used / input.limit) * 100),
  );
  return {
    id: input.id,
    label: input.label,
    kind: "window",
    used: input.used,
    remaining: Math.max(0, input.limit - input.used),
    limit: input.limit,
    usedPercent,
  };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

async function fetchKeyUsage(
  serviceKey: string,
  keyId: string,
  range?: { start: string; end: string },
): Promise<ExaKeyUsageResponse | null> {
  const url = new URL(`${TEAM_MGMT}/api-keys/${keyId}/usage`);
  if (range) {
    url.searchParams.set("start_date", range.start);
    url.searchParams.set("end_date", range.end);
  }
  try {
    const res = await fetchExa(url.toString(), {
      headers: {
        "x-api-key": serviceKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as ExaKeyUsageResponse;
  } catch (err) {
    if (isTimeoutError(err) || /timed out/i.test(String(err))) return null;
    throw err;
  }
}

async function fetchKeySpendWindows(
  serviceKey: string,
  keyId: string,
  nowMs: number,
  detail: ExaFetchDetail,
): Promise<SpendWindows> {
  const end = toIso(nowMs);
  if (detail === "fast") {
    const u30 = await fetchKeyUsage(serviceKey, keyId);
    return {
      spend3d: null,
      spend7d: null,
      spend30d: u30?.total_cost_usd ?? 0,
      keyName: u30?.api_key_name,
    };
  }

  const [u3, u7, u30] = await Promise.all([
    fetchKeyUsage(serviceKey, keyId, {
      start: toIso(nowMs - 3 * 86_400_000),
      end,
    }),
    fetchKeyUsage(serviceKey, keyId, {
      start: toIso(nowMs - 7 * 86_400_000),
      end,
    }),
    fetchKeyUsage(serviceKey, keyId),
  ]);

  return {
    spend3d: u3?.total_cost_usd ?? 0,
    spend7d: u7?.total_cost_usd ?? 0,
    spend30d: u30?.total_cost_usd ?? 0,
    keyName: u30?.api_key_name ?? u7?.api_key_name ?? u3?.api_key_name,
  };
}

function spendMeters(totals: SpendWindows): UsageMeter[] {
  const meters: UsageMeter[] = [];
  if (totals.spend3d != null) {
    meters.push(
      usdMeter({
        id: "spend-3d",
        label: "3d spend",
        used: totals.spend3d,
      }),
    );
  }
  if (totals.spend7d != null) {
    meters.push(
      usdMeter({
        id: "spend-7d",
        label: "7d spend",
        used: totals.spend7d,
      }),
    );
  }
  meters.push(
    usdMeter({
      id: "spend-30d",
      label: "30d spend",
      used: totals.spend30d,
    }),
  );
  return meters;
}

function keyBudgetMeter(input: {
  budgetUsd: number;
  usedUsd: number;
  isOverBudget?: boolean;
}): UsageMeter {
  const meter = usdMeter({
    id: "key-budget",
    label: "Key budget",
    used: input.usedUsd,
    limit: input.budgetUsd,
  });
  if (input.isOverBudget) {
    return {
      ...meter,
      remaining: 0,
      usedPercent: 100,
    };
  }
  return meter;
}

function parseTeamLabel(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const match = /\(([^)]+)\)/.exec(message);
  return match?.[1]?.trim();
}

/**
 * Exa usage fetch.
 *
 * Prefer a Team Management **service key** (`apiKey`): lists keys and loads
 * spend windows. Optional `keyId` scopes to one search key.
 * When that key has `budgetCents`, also shows a Key budget remaining bar
 * (180d spend vs budget — not team wallet balance).
 *
 * `detail: "fast"` (cold load) fetches 30d + budget only.
 * `detail: "full"` adds 3d / 7d windows. Budget always runs in parallel with windows.
 */
export async function fetchExaUsage(
  account: Extract<Account, { provider: "exa" }>,
  options?: { detail?: ExaFetchDetail },
): Promise<AccountUsage> {
  const apiKey = account.credentials.apiKey;
  const preferredKeyId = account.credentials.keyId?.trim();
  const nowMs = Date.now();
  const detail = options?.detail ?? "full";

  let listRes: Response;
  try {
    listRes = await fetchExa(
      `${TEAM_MGMT}/api-keys`,
      {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      },
      { retries: 1 },
    );
  } catch (err) {
    // List timeout/network: hard fail — do not fall through to teams/me (doubles wait).
    const message =
      err instanceof Error ? err.message : "Exa timed out — try again shortly";
    return {
      accountId: account.id,
      provider: "exa",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error: message,
    };
  }

  if (listRes.status === 429) {
    return {
      accountId: account.id,
      provider: "exa",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error: "Exa team-management rate limited — try again shortly",
    };
  }

  if (listRes.ok) {
    const json = (await listRes.json()) as ExaListKeysResponse;
    const keys = json.apiKeys ?? (json.apiKey ? [json.apiKey] : []);
    if (!keys.length) {
      return {
        accountId: account.id,
        provider: "exa",
        accountLabel: account.name,
        meters: [],
        fetchedAt: nowMs,
        status: "unavailable",
        error: "No API keys on this Exa team",
      };
    }

    const targets = preferredKeyId
      ? keys.filter((k) => k.id === preferredKeyId)
      : keys;

    if (preferredKeyId && targets.length === 0) {
      return {
        accountId: account.id,
        provider: "exa",
        meters: [],
        fetchedAt: nowMs,
        status: "error",
        error: `Key ID ${preferredKeyId} not found on this team`,
      };
    }

    // Windows + optional budget in parallel (budget used to be sequential after windows).
    const perKey = await Promise.all(
      targets.map(async (key) => {
        const budgetUsd =
          targets.length === 1 &&
          key.budgetCents != null &&
          key.budgetCents > 0
            ? key.budgetCents / 100
            : null;

        const [windows, againstBudget] = await Promise.all([
          fetchKeySpendWindows(apiKey, key.id, nowMs, detail),
          budgetUsd != null
            ? fetchKeyUsage(apiKey, key.id, {
                start: toIso(nowMs - BUDGET_LOOKBACK_MS),
                end: toIso(nowMs),
              })
            : Promise.resolve(null),
        ]);

        return { key, windows, budgetUsd, againstBudget };
      }),
    );

    const totals: SpendWindows = {
      spend3d: detail === "full" ? 0 : null,
      spend7d: detail === "full" ? 0 : null,
      spend30d: 0,
      keyName: null,
    };
    for (const row of perKey) {
      const w = row.windows;
      totals.spend30d += w.spend30d;
      if (totals.spend3d != null && w.spend3d != null) {
        totals.spend3d += w.spend3d;
      }
      if (totals.spend7d != null && w.spend7d != null) {
        totals.spend7d += w.spend7d;
      }
      if (!totals.keyName) {
        totals.keyName = w.keyName ?? row.key.name;
      }
    }

    const meters = spendMeters(totals);

    if (perKey.length === 1) {
      const row = perKey[0]!;
      if (row.budgetUsd != null) {
        meters.unshift(
          keyBudgetMeter({
            budgetUsd: row.budgetUsd,
            usedUsd: row.againstBudget?.total_cost_usd ?? 0,
            isOverBudget: row.key.isOverBudget,
          }),
        );
      }
    }

    return {
      accountId: account.id,
      provider: "exa",
      accountLabel: totals.keyName ?? account.name,
      plan: targets.length === 1 ? (targets[0]?.name ?? "Team") : "Team",
      meters,
      fetchedAt: nowMs,
      status: "ok",
    };
  }

  // Regular search API key — validate without burning search credits.
  // Only reached when list returned a non-timeout HTTP error (not a service key).
  let teamRes: Response;
  try {
    teamRes = await fetchExa(TEAMS_ME, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Exa timed out — try again shortly";
    return {
      accountId: account.id,
      provider: "exa",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error: message,
    };
  }

  if (teamRes.status === 429) {
    return {
      accountId: account.id,
      provider: "exa",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error: "Exa rate limited — try again shortly",
    };
  }

  if (teamRes.ok) {
    const team = (await teamRes.json()) as ExaTeamInfo;
    const meters: UsageMeter[] = [];
    const concurrent = windowMeter({
      id: "concurrent",
      label: "Concurrent",
      used: team.concurrency?.active ?? 0,
      limit: team.limits?.maxConcurrent,
    });
    const queue = windowMeter({
      id: "queued",
      label: "Queued",
      used: team.concurrency?.queued ?? 0,
      limit: team.limits?.maxQueued,
    });
    if (concurrent) meters.push(concurrent);
    if (queue) meters.push(queue);

    return {
      accountId: account.id,
      provider: "exa",
      accountLabel: team.name ?? account.name,
      plan: team.name,
      meters,
      fetchedAt: nowMs,
      status: "ok",
    };
  }

  const teamBody = (await teamRes.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    tag?: string;
  };

  const invalid =
    teamBody.tag === "INVALID_API_KEY" ||
    /invalid api key/i.test(teamBody.error ?? "") ||
    /invalid api key/i.test(teamBody.message ?? "");

  if (invalid) {
    return {
      accountId: account.id,
      provider: "exa",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error: "Invalid Exa API key",
    };
  }

  if (teamRes.status === 401 && teamBody.message) {
    const label = parseTeamLabel(teamBody.message);
    return {
      accountId: account.id,
      provider: "exa",
      accountLabel: label ?? account.name,
      plan: label?.split(" - ")[0]?.trim() || "Personal",
      meters: [],
      fetchedAt: nowMs,
      status: "ok",
    };
  }

  if (listRes.status === 401) {
    return {
      accountId: account.id,
      provider: "exa",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error: "Invalid Exa API key",
    };
  }

  throw new Error(
    `Exa usage failed (team-mgmt ${listRes.status}, teams/me ${teamRes.status})`,
  );
}
