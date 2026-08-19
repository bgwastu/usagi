import type { Account, AccountUsage, UsageMeter } from "@/lib/types";

const API_BASE = "https://api.commandcode.ai";
const CREDITS_URL = `${API_BASE}/alpha/billing/credits`;
const SUBSCRIPTIONS_URL = `${API_BASE}/alpha/billing/subscriptions`;
const WHOAMI_URL = `${API_BASE}/alpha/whoami`;

/**
 * Published monthly grants and rolling caps from
 * https://commandcode.ai/docs/resources/usage-limits (checked 2026-08).
 * Monthly remaining comes from the wire; the allowance is the denominator.
 */
export const COMMAND_CODE_PLANS = {
  "individual-go": {
    label: "Go",
    monthlyCreditsUsd: 10,
    fiveHourCapUsd: 3,
    weeklyCapUsd: 6,
  },
  "individual-goat": {
    label: "GOAT",
    monthlyCreditsUsd: 70,
    fiveHourCapUsd: 14,
    weeklyCapUsd: 35,
  },
  "individual-pro": {
    label: "Pro",
    monthlyCreditsUsd: 80,
    fiveHourCapUsd: 16,
    weeklyCapUsd: 40,
  },
  "individual-max": {
    label: "Max 10×",
    monthlyCreditsUsd: 150,
    fiveHourCapUsd: 45,
    weeklyCapUsd: 90,
  },
  "individual-ultra": {
    label: "Max 20×",
    monthlyCreditsUsd: 300,
    fiveHourCapUsd: 90,
    weeklyCapUsd: 180,
  },
  "team-pro": {
    label: "Team Pro",
    monthlyCreditsUsd: 40,
    fiveHourCapUsd: 12,
    weeklyCapUsd: 24,
  },
} as const;

export type CommandCodePlanId = keyof typeof COMMAND_CODE_PLANS;

type WindowDetail = {
  used?: number;
  cap?: number;
  limit?: number;
  exceeded?: boolean;
  resetAt?: number | string | null;
};

type CreditsResponse = {
  credits?: {
    belowThreshold?: boolean;
    creditThreshold?: number;
    monthlyCredits?: number;
    purchasedCredits?: number;
    freeCredits?: number;
  };
  windowLimits?: {
    limited?: boolean;
    exceeded?: string | null;
    fiveHour?: WindowDetail;
    weekly?: WindowDetail;
  };
};

type SubscriptionsResponse = {
  success?: boolean;
  data?: {
    planId?: string;
    status?: string;
    userId?: string;
    currentPeriodEnd?: string | number | null;
  } | null;
};

type WhoamiResponse = {
  success?: boolean;
  user?: {
    id?: string;
    name?: string;
    email?: string;
    userName?: string;
  };
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function resetAtMs(value: unknown): number | null {
  const n = numberOrNull(value);
  if (n == null || n <= 0) return null;
  // Wire mixes seconds and milliseconds.
  return n > 20_000_000_000 ? n : n * 1000;
}

function periodEndMs(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return resetAtMs(value);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

async function fetchJson(
  url: string,
  apiKey: string,
): Promise<{ ok: true; status: number; json: unknown } | { ok: false; status: number }> {
  const res = await fetch(url, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    await res.text().catch(() => undefined);
    return { ok: false, status: res.status };
  }
  return { ok: true, status: res.status, json: await res.json() };
}

function planFor(planId: string | undefined) {
  if (!planId) return null;
  const id = planId.trim().toLowerCase() as CommandCodePlanId;
  return id in COMMAND_CODE_PLANS
    ? { id, ...COMMAND_CODE_PLANS[id] }
    : null;
}

/**
 * Only trust the catalogue allowance when live rolling caps match the published
 * plan — catches silent repricing without inventing a denominator.
 */
function trustedMonthlyAllowance(
  plan: ReturnType<typeof planFor>,
  fiveHourCap: number | null,
  weeklyCap: number | null,
  monthlyRemaining: number,
): number | null {
  if (!plan) return null;
  if (monthlyRemaining > plan.monthlyCreditsUsd) return null;
  if (fiveHourCap == null || weeklyCap == null) return null;
  if (fiveHourCap !== plan.fiveHourCapUsd) return null;
  if (weeklyCap !== plan.weeklyCapUsd) return null;
  return plan.monthlyCreditsUsd;
}

function usdCreditsMeter(input: {
  id: string;
  label: string;
  used?: number;
  remaining?: number;
  limit?: number | null;
  resetsAt?: number | null;
}): UsageMeter {
  const limit = input.limit ?? null;
  if (limit == null || limit <= 0) {
    const remaining = input.remaining ?? 0;
    return {
      id: input.id,
      label: input.label,
      kind: "credits",
      used: input.used,
      remaining,
      unit: "USD",
      resetsAt: input.resetsAt ?? undefined,
    };
  }
  const used =
    input.used ??
    (input.remaining != null ? Math.max(0, limit - input.remaining) : 0);
  const remaining =
    input.remaining ?? Math.max(0, limit - used);
  return {
    id: input.id,
    label: input.label,
    kind: "credits",
    used,
    remaining,
    limit,
    usedPercent: clampPercent((used / limit) * 100),
    unit: "USD",
    resetsAt: input.resetsAt ?? undefined,
  };
}

function rollingWindowMeter(
  id: string,
  label: string,
  detail: WindowDetail | undefined,
): UsageMeter | null {
  if (!detail) return null;
  const limit = numberOrNull(detail.cap ?? detail.limit);
  if (limit == null || limit <= 0) return null;
  const used = Math.max(0, numberOrNull(detail.used) ?? 0);
  return usdCreditsMeter({
    id,
    label,
    used,
    remaining: Math.max(0, limit - used),
    limit,
    resetsAt: resetAtMs(detail.resetAt),
  });
}

export async function fetchCommandCodeUsage(
  account: Extract<Account, { provider: "command-code" }>,
): Promise<AccountUsage> {
  const apiKey = account.credentials.apiKey;

  const [creditsResult, subscriptionResult, whoamiResult] = await Promise.all([
    fetchJson(CREDITS_URL, apiKey),
    fetchJson(SUBSCRIPTIONS_URL, apiKey).catch(() => ({
      ok: false as const,
      status: 0,
    })),
    fetchJson(WHOAMI_URL, apiKey).catch(() => ({
      ok: false as const,
      status: 0,
    })),
  ]);

  if (!creditsResult.ok) {
    if (creditsResult.status === 401 || creditsResult.status === 403) {
      return {
        accountId: account.id,
        provider: "command-code",
        meters: [],
        fetchedAt: Date.now(),
        status: "error",
        error: "Invalid Command Code API key",
      };
    }
    if (creditsResult.status === 429) {
      return {
        accountId: account.id,
        provider: "command-code",
        meters: [],
        fetchedAt: Date.now(),
        status: "error",
        error: "Command Code rate limited — try again shortly",
      };
    }
    throw new Error(`Command Code credits failed (${creditsResult.status})`);
  }

  const body = creditsResult.json as CreditsResponse;
  const credits = body.credits;
  if (!credits || typeof credits !== "object") {
    throw new Error("Command Code credits response missing credits object");
  }

  const monthlyRemaining = numberOrNull(credits.monthlyCredits);
  if (monthlyRemaining == null) {
    throw new Error("Command Code credits response missing monthlyCredits");
  }

  const purchased = Math.max(0, numberOrNull(credits.purchasedCredits) ?? 0);
  const free = Math.max(0, numberOrNull(credits.freeCredits) ?? 0);
  const windows = body.windowLimits;
  const fiveHourCap = numberOrNull(
    windows?.fiveHour?.cap ?? windows?.fiveHour?.limit,
  );
  const weeklyCap = numberOrNull(windows?.weekly?.cap ?? windows?.weekly?.limit);

  let planLabel: string | undefined;
  let periodEnd: number | null = null;
  if (subscriptionResult.ok) {
    const sub = subscriptionResult.json as SubscriptionsResponse;
    if (sub.success === true && sub.data && typeof sub.data === "object") {
      const plan = planFor(sub.data.planId);
      planLabel = plan?.label ?? sub.data.planId;
      periodEnd = periodEndMs(sub.data.currentPeriodEnd);
    } else if (sub.success === true && sub.data === null) {
      planLabel = "Pay as you go";
    }
  }

  let accountLabel = account.name;
  if (whoamiResult.ok) {
    const who = whoamiResult.json as WhoamiResponse;
    accountLabel =
      who.user?.email ??
      who.user?.userName ??
      who.user?.name ??
      account.name;
  }

  const plan = planFor(
    subscriptionResult.ok
      ? (subscriptionResult.json as SubscriptionsResponse).data?.planId
      : undefined,
  );
  const monthlyLimit = trustedMonthlyAllowance(
    plan,
    fiveHourCap,
    weeklyCap,
    monthlyRemaining,
  );

  const meters: UsageMeter[] = [
    usdCreditsMeter({
      id: "monthly",
      label: "Plan credits",
      remaining: monthlyRemaining,
      limit: monthlyLimit,
      resetsAt: periodEnd,
    }),
  ];

  if (purchased > 0) {
    meters.push(
      usdCreditsMeter({
        id: "topup",
        label: "Top-up credits",
        remaining: purchased,
      }),
    );
  }

  if (free > 0) {
    meters.push(
      usdCreditsMeter({
        id: "free",
        label: "Free credits",
        remaining: free,
      }),
    );
  }

  const fiveHour = rollingWindowMeter("session", "5-hour", windows?.fiveHour);
  if (fiveHour) meters.push(fiveHour);

  const weekly = rollingWindowMeter("weekly", "Weekly", windows?.weekly);
  if (weekly) meters.push(weekly);

  return {
    accountId: account.id,
    provider: "command-code",
    accountLabel,
    plan: planLabel,
    meters,
    fetchedAt: Date.now(),
    status: meters.length ? "ok" : "unavailable",
    error: meters.length ? undefined : "No credit meters returned",
  };
}
