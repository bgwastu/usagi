import type { Account, AccountUsage, UsageMeter } from "@/lib/types";

const ORG_USAGE_SUMMARY =
  "https://backend.composio.dev/api/v3.1/org/usage/summary";
const PROJECT_USAGE_SUMMARY =
  "https://backend.composio.dev/api/v3.1/project/usage/summary";
const ORG_PROJECT_LIST =
  "https://backend.composio.dev/api/v3.1/org/owner/project/list";

/** Published monthly quotas from composio.dev/pricing (pro tools = premium). */
export const COMPOSIO_PLAN_QUOTAS = {
  free: {
    displayName: "Totally Free",
    toolCalls: 20_000,
    premiumToolCalls: 1_000,
  },
  cheap: {
    displayName: "Ridiculously Cheap",
    toolCalls: 200_000,
    premiumToolCalls: 5_000,
  },
  serious: {
    displayName: "Serious Business",
    toolCalls: 2_000_000,
    premiumToolCalls: 50_000,
  },
  enterprise: {
    displayName: "Enterprise",
    toolCalls: null as number | null,
    premiumToolCalls: null as number | null,
  },
} as const;

export type ComposioPlanId = keyof typeof COMPOSIO_PLAN_QUOTAS;

type ComposioEntitySummary = {
  unit?: string;
  total_quantity?: string;
  event_count?: number;
};

type ComposioUsageSummary = {
  entities?: {
    tool_calls?: ComposioEntitySummary;
    sessions?: ComposioEntitySummary;
    premium_tool_calls?: ComposioEntitySummary;
  };
};

type AuthMode = "org" | "project";

function parseQuantity(entity: ComposioEntitySummary | undefined): number {
  if (!entity) return 0;
  if (typeof entity.event_count === "number") return entity.event_count;
  const raw = entity.total_quantity;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function resolveAuthMode(apiKey: string): AuthMode {
  if (apiKey.startsWith("oak_")) return "org";
  if (apiKey.startsWith("ak_")) return "project";
  // Consumer keys (ck_) cannot call usage APIs.
  return "org";
}

function monthWindow(nowMs: number): {
  from: number;
  to: number;
  resetsAt: number;
} {
  const now = new Date(nowMs);
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const resetsAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { from, to: nowMs, resetsAt };
}

function resolvePlanId(
  explicit: string | undefined,
  monthlyToolCalls: number,
  monthlyPremium: number,
): ComposioPlanId {
  if (explicit && explicit in COMPOSIO_PLAN_QUOTAS) {
    return explicit as ComposioPlanId;
  }
  // Billing subscription is cookie-auth only; escalate the displayed quota
  // when month-to-date usage already exceeds a lower tier's included amount.
  if (monthlyToolCalls > 200_000 || monthlyPremium > 5_000) return "serious";
  if (monthlyToolCalls > 20_000 || monthlyPremium > 1_000) return "cheap";
  return "free";
}

function limitedMeter(input: {
  id: string;
  label: string;
  used: number;
  limit: number | null;
  resetsAt?: number;
}): UsageMeter {
  const limit = input.limit;
  if (limit == null || limit <= 0) {
    return {
      id: input.id,
      label: input.label,
      kind: "credits",
      used: input.used,
      unit: "calls",
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
    unit: "calls",
    resetsAt: input.resetsAt,
  };
}

async function fetchUsageSummary(
  apiKey: string,
  mode: AuthMode,
  range: { from: number; to: number },
  entityTypes: Array<"tool_calls" | "sessions" | "premium_tool_calls">,
): Promise<ComposioUsageSummary> {
  const url = mode === "org" ? ORG_USAGE_SUMMARY : PROJECT_USAGE_SUMMARY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (mode === "org") headers["x-org-api-key"] = apiKey;
  else headers["x-api-key"] = apiKey;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: range.from,
      to: range.to,
      entity_types: entityTypes,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(
      mode === "org"
        ? "Invalid Composio org API key"
        : "Invalid Composio project API key",
    );
  }
  if (res.status === 429) {
    throw new RateLimitError();
  }
  if (!res.ok) {
    throw new Error(`Composio usage failed (${res.status})`);
  }
  return (await res.json()) as ComposioUsageSummary;
}

async function fetchOrgLabel(apiKey: string): Promise<string | undefined> {
  const res = await fetch(ORG_PROJECT_LIST, {
    headers: {
      "x-org-api-key": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as {
    data?: Array<{ name?: string; org_id?: string }>;
  };
  const first = json.data?.[0];
  return first?.name ?? first?.org_id;
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

class RateLimitError extends Error {
  constructor() {
    super("Composio rate limited — try again shortly");
    this.name = "RateLimitError";
  }
}

/**
 * Composio usage fetch.
 *
 * Prefers org API keys (`oak_…` → `x-org-api-key` + org usage summary).
 * Project keys (`ak_…`) fall back to project usage summary.
 *
 * Monthly tool-call / premium quotas come from published plan limits
 * (subscription details are cookie-auth only on Composio's billing API).
 */
export async function fetchComposioUsage(
  account: Extract<Account, { provider: "composio" }>,
): Promise<AccountUsage> {
  const apiKey = account.credentials.apiKey;
  const nowMs = Date.now();
  const mode = resolveAuthMode(apiKey);

  if (apiKey.startsWith("ck_")) {
    return {
      accountId: account.id,
      provider: "composio",
      meters: [],
      fetchedAt: nowMs,
      status: "error",
      error:
        "Consumer keys (ck_…) only work for Connect MCP. Use an org key (oak_…) from Organization Settings.",
    };
  }

  const month = monthWindow(nowMs);

  try {
    const [monthly, last7d, label] = await Promise.all([
      fetchUsageSummary(apiKey, mode, month, [
        "tool_calls",
        "premium_tool_calls",
        "sessions",
      ]),
      fetchUsageSummary(
        apiKey,
        mode,
        { from: nowMs - 7 * 86_400_000, to: nowMs },
        ["tool_calls"],
      ),
      mode === "org" ? fetchOrgLabel(apiKey) : Promise.resolve(undefined),
    ]);

    const toolCallsMonth = parseQuantity(monthly.entities?.tool_calls);
    const premiumMonth = parseQuantity(monthly.entities?.premium_tool_calls);
    const sessionsMonth = parseQuantity(monthly.entities?.sessions);
    const toolCalls7d = parseQuantity(last7d.entities?.tool_calls);

    const planId = resolvePlanId(
      account.credentials.plan,
      toolCallsMonth,
      premiumMonth,
    );
    const plan = COMPOSIO_PLAN_QUOTAS[planId];

    const meters: UsageMeter[] = [
      limitedMeter({
        id: "tool-calls-month",
        label: "Tool calls",
        used: toolCallsMonth,
        limit: plan.toolCalls,
        resetsAt: month.resetsAt,
      }),
      limitedMeter({
        id: "premium-month",
        label: "Pro tool calls",
        used: premiumMonth,
        limit: plan.premiumToolCalls,
        resetsAt: month.resetsAt,
      }),
      {
        id: "tool-calls-7d",
        label: "7d tool calls",
        kind: "credits",
        used: toolCalls7d,
        unit: "calls",
      },
    ];

    if (sessionsMonth > 0) {
      meters.push({
        id: "sessions-month",
        label: "Sessions",
        kind: "credits",
        used: sessionsMonth,
        unit: "sessions",
      });
    }

    return {
      accountId: account.id,
      provider: "composio",
      accountLabel: label ?? account.name,
      plan: plan.displayName,
      meters,
      fetchedAt: nowMs,
      status: "ok",
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        accountId: account.id,
        provider: "composio",
        meters: [],
        fetchedAt: nowMs,
        status: "error",
        error: error.message,
      };
    }
    if (error instanceof RateLimitError) {
      return {
        accountId: account.id,
        provider: "composio",
        meters: [],
        fetchedAt: nowMs,
        status: "error",
        error: error.message,
      };
    }
    throw error;
  }
}
