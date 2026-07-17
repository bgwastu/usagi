import type { Account, AccountUsage, UsageMeter } from "@/lib/types";

const TEAM_MGMT = "https://admin-api.exa.ai/team-management";
const TEAMS_ME = "https://api.exa.ai/websets/v0/teams/me";
/** Exa usage lookback max for spend-against-budget (documented API cap). */
const BUDGET_LOOKBACK_MS = 180 * 86_400_000;

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
  spend3d: number;
  spend7d: number;
  spend30d: number;
  keyName?: string | null;
};

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
  const res = await fetch(url, {
    headers: {
      "x-api-key": serviceKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as ExaKeyUsageResponse;
}

async function fetchKeySpendWindows(
  serviceKey: string,
  keyId: string,
  nowMs: number,
): Promise<SpendWindows> {
  const end = toIso(nowMs);
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
  return [
    usdMeter({
      id: "spend-3d",
      label: "3d spend",
      used: totals.spend3d,
    }),
    usdMeter({
      id: "spend-7d",
      label: "7d spend",
      used: totals.spend7d,
    }),
    usdMeter({
      id: "spend-30d",
      label: "30d spend",
      used: totals.spend30d,
    }),
  ];
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
 * 3d / 7d / 30d spend. Optional `keyId` scopes to one search key.
 * When that key has `budgetCents`, also shows a Key budget remaining bar
 * (180d spend vs budget — not team wallet balance).
 */
export async function fetchExaUsage(
  account: Extract<Account, { provider: "exa" }>,
): Promise<AccountUsage> {
  const apiKey = account.credentials.apiKey;
  const preferredKeyId = account.credentials.keyId?.trim();
  const nowMs = Date.now();

  const listRes = await fetch(`${TEAM_MGMT}/api-keys`, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

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

    const windows = await Promise.all(
      targets.map((key) => fetchKeySpendWindows(apiKey, key.id, nowMs)),
    );

    const totals: SpendWindows = {
      spend3d: 0,
      spend7d: 0,
      spend30d: 0,
      keyName: null,
    };
    for (let i = 0; i < targets.length; i++) {
      const w = windows[i]!;
      const key = targets[i]!;
      totals.spend3d += w.spend3d;
      totals.spend7d += w.spend7d;
      totals.spend30d += w.spend30d;
      if (!totals.keyName) {
        totals.keyName = w.keyName ?? key.name;
      }
    }

    const meters = spendMeters(totals);

    // Per-key budgets only make sense for a single scoped key.
    if (targets.length === 1) {
      const key = targets[0]!;
      const budgetUsd =
        key.budgetCents != null && key.budgetCents > 0
          ? key.budgetCents / 100
          : null;
      if (budgetUsd != null) {
        const againstBudget = await fetchKeyUsage(apiKey, key.id, {
          start: toIso(nowMs - BUDGET_LOOKBACK_MS),
          end: toIso(nowMs),
        });
        meters.unshift(
          keyBudgetMeter({
            budgetUsd,
            usedUsd: againstBudget?.total_cost_usd ?? 0,
            isOverBudget: key.isOverBudget,
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
  const teamRes = await fetch(TEAMS_ME, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

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
