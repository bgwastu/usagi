import type { Account, AccountUsage, UsageMeter } from "@/lib/types";

type TavilyUsageResponse = {
  key?: {
    usage?: number;
    limit?: number | null;
    search_usage?: number;
    extract_usage?: number;
    crawl_usage?: number;
    map_usage?: number;
    research_usage?: number;
  };
  account?: {
    current_plan?: string;
    plan_usage?: number;
    plan_limit?: number;
    paygo_usage?: number;
    paygo_limit?: number;
  };
};

function creditsMeter(input: {
  id: string;
  label: string;
  used: number;
  limit: number | null | undefined;
}): UsageMeter {
  const limit = input.limit ?? null;
  if (limit == null || limit <= 0) {
    return {
      id: input.id,
      label: input.label,
      kind: "credits",
      used: input.used,
      unit: "credits",
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
    unit: "credits",
  };
}

export async function fetchTavilyUsage(
  account: Extract<Account, { provider: "tavily" }>,
): Promise<AccountUsage> {
  const res = await fetch("https://api.tavily.com/usage", {
    headers: {
      Authorization: `Bearer ${account.credentials.apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401) {
    return {
      accountId: account.id,
      provider: "tavily",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "Invalid Tavily API key",
    };
  }

  if (res.status === 429) {
    return {
      accountId: account.id,
      provider: "tavily",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "Tavily usage rate limit (10 / 10 min) — try again shortly",
    };
  }

  if (!res.ok) {
    throw new Error(`Tavily usage failed (${res.status})`);
  }

  const json = (await res.json()) as TavilyUsageResponse;
  const meters: UsageMeter[] = [];

  if (json.account?.plan_usage != null) {
    meters.push(
      creditsMeter({
        id: "plan",
        label: "Plan credits",
        used: json.account.plan_usage,
        limit: json.account.plan_limit,
      }),
    );
  }

  if (json.key?.usage != null) {
    meters.push(
      creditsMeter({
        id: "key",
        label: "Key credits",
        used: json.key.usage,
        limit: json.key.limit,
      }),
    );
  }

  if (
    json.account?.paygo_usage != null &&
    (json.account.paygo_usage > 0 || (json.account.paygo_limit ?? 0) > 0)
  ) {
    meters.push(
      creditsMeter({
        id: "paygo",
        label: "PAYG",
        used: json.account.paygo_usage,
        limit: json.account.paygo_limit,
      }),
    );
  }

  return {
    accountId: account.id,
    provider: "tavily",
    accountLabel: account.name,
    plan: json.account?.current_plan,
    meters,
    fetchedAt: Date.now(),
    status: meters.length ? "ok" : "unavailable",
    error: meters.length ? undefined : "No credit meters returned",
  };
}
