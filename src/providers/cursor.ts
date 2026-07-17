import { clampPercent } from "@/lib/rate-limit-window";
import type { Account, AccountUsage, UsageMeter } from "@/lib/types";

const USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const AUTH_ME_URL = "https://cursor.com/api/auth/me";
const API_TIMEOUT_MS = 15_000;

type CursorUsageBucket = {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
  /** When bonus allowance exists, `total` is the real cap (included + bonus). */
  breakdown?: {
    included?: number;
    bonus?: number;
    total?: number;
  };
};

type CursorUsageSummary = {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  limitType?: string;
  isUnlimited?: boolean;
  individualUsage?: {
    plan?: CursorUsageBucket;
    onDemand?: CursorUsageBucket;
    overall?: CursorUsageBucket;
  };
  teamUsage?: {
    onDemand?: CursorUsageBucket;
    pooled?: CursorUsageBucket;
  };
};

type CursorAuthMe = {
  email?: string;
  name?: string;
};

/** Accept raw token or `WorkosCursorSessionToken=…` / full Cookie header. */
export function normalizeCursorCookie(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes("=")) {
    const pairs = trimmed.split(";").map((p) => p.trim());
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name === "WorkosCursorSessionToken" && value) {
        return value;
      }
    }
  }

  return trimmed;
}

function cookieHeader(sessionToken: string): string {
  return `WorkosCursorSessionToken=${sessionToken}`;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

async function cursorGetJson<T>(
  url: string,
  sessionToken: string,
): Promise<{ ok: true; status: number; json: T } | { ok: false; status: number }> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader(sessionToken),
      Origin: "https://cursor.com",
      Referer: "https://cursor.com/dashboard/usage",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (res.status >= 300 && res.status < 400) {
    return { ok: false, status: 401 };
  }
  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  return { ok: true, status: res.status, json: (await res.json()) as T };
}

function planMeters(
  plan: CursorUsageBucket | undefined,
  resetsAt: number | null,
  isUnlimited: boolean,
): UsageMeter[] {
  if (!plan) return [];

  const meters: UsageMeter[] = [];
  const totalPercent = numberOrNull(plan.totalPercentUsed);
  const autoPercent = numberOrNull(plan.autoPercentUsed);
  const apiPercent = numberOrNull(plan.apiPercentUsed);
  const usedRaw = numberOrNull(plan.used);
  const limitRaw = numberOrNull(plan.limit);
  const remainingRaw = numberOrNull(plan.remaining);
  const breakdownTotal = numberOrNull(plan.breakdown?.total);

  // Prefer breakdown.total when Cursor grants bonus allowance — plan.limit is
  // often just the included tier (e.g. 2000) while totalPercentUsed is vs total.
  const limit =
    breakdownTotal != null && breakdownTotal > 0
      ? breakdownTotal
      : limitRaw;
  const usedPercent =
    totalPercent != null
      ? clampPercent(totalPercent)
      : usedRaw != null && limit != null && limit > 0
        ? clampPercent((usedRaw / limit) * 100)
        : null;
  const used =
    usedPercent != null && limit != null
      ? Math.round((usedPercent / 100) * limit)
      : usedRaw;
  const remaining =
    used != null && limit != null
      ? Math.max(0, limit - used)
      : remainingRaw;

  if (isUnlimited && usedPercent == null && usedRaw == null) {
    return [
      {
        id: "plan",
        label: "Plan",
        kind: "credits",
        used: usedRaw ?? 0,
        unit: "requests",
      },
    ];
  }

  if (usedPercent != null || (used != null && limit != null && limit > 0)) {
    meters.push({
      id: "plan",
      label: "Plan",
      kind: "credits",
      used: used ?? undefined,
      remaining: remaining ?? undefined,
      limit: limit ?? undefined,
      usedPercent: usedPercent ?? undefined,
      unit: "requests",
      resetsAt,
    });
  }

  if (autoPercent != null) {
    meters.push({
      id: "auto",
      label: "Auto + Composer",
      kind: "window",
      usedPercent: clampPercent(autoPercent),
      resetsAt,
    });
  }

  if (apiPercent != null) {
    meters.push({
      id: "api",
      label: "API",
      kind: "window",
      usedPercent: clampPercent(apiPercent),
      resetsAt,
    });
  }

  return meters;
}

function onDemandMeter(
  onDemand: CursorUsageBucket | undefined,
  resetsAt: number | null,
): UsageMeter | null {
  if (!onDemand?.enabled) return null;
  const usedCents = numberOrNull(onDemand.used);
  if (usedCents == null) return null;

  const limitCents = numberOrNull(onDemand.limit);
  const remainingCents = numberOrNull(onDemand.remaining);

  if (limitCents != null && limitCents > 0) {
    const usedPercent = clampPercent((usedCents / limitCents) * 100);
    return {
      id: "on-demand",
      label: "On-demand",
      kind: "credits",
      used: centsToUsd(usedCents),
      remaining:
        remainingCents != null
          ? centsToUsd(remainingCents)
          : centsToUsd(Math.max(0, limitCents - usedCents)),
      limit: centsToUsd(limitCents),
      usedPercent,
      unit: "USD",
      resetsAt,
    };
  }

  return {
    id: "on-demand",
    label: "On-demand",
    kind: "credits",
    used: centsToUsd(usedCents),
    unit: "USD",
    resetsAt,
  };
}

function teamOnDemandMeter(
  onDemand: CursorUsageBucket | undefined,
  resetsAt: number | null,
): UsageMeter | null {
  if (!onDemand?.enabled) return null;
  const usedCents = numberOrNull(onDemand.used);
  const limitCents = numberOrNull(onDemand.limit);
  if (usedCents == null || limitCents == null || limitCents <= 0) return null;

  const remainingCents = numberOrNull(onDemand.remaining);
  return {
    id: "team-on-demand",
    label: "Team on-demand",
    kind: "credits",
    used: centsToUsd(usedCents),
    remaining:
      remainingCents != null
        ? centsToUsd(remainingCents)
        : centsToUsd(Math.max(0, limitCents - usedCents)),
    limit: centsToUsd(limitCents),
    usedPercent: clampPercent((usedCents / limitCents) * 100),
    unit: "USD",
    resetsAt,
  };
}

export async function fetchCursorUsage(
  account: Extract<Account, { provider: "cursor" }>,
): Promise<AccountUsage> {
  const sessionToken = normalizeCursorCookie(account.credentials.cookie);
  if (!sessionToken) {
    return {
      accountId: account.id,
      provider: "cursor",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "Missing WorkosCursorSessionToken cookie",
    };
  }

  const [summaryResult, meResult] = await Promise.all([
    cursorGetJson<CursorUsageSummary>(USAGE_SUMMARY_URL, sessionToken),
    cursorGetJson<CursorAuthMe>(AUTH_ME_URL, sessionToken),
  ]);

  if (!summaryResult.ok) {
    if (summaryResult.status === 401 || summaryResult.status === 403) {
      return {
        accountId: account.id,
        provider: "cursor",
        meters: [],
        fetchedAt: Date.now(),
        status: "error",
        error: "Cursor session expired — paste a fresh WorkosCursorSessionToken",
      };
    }
    if (summaryResult.status === 429) {
      return {
        accountId: account.id,
        provider: "cursor",
        meters: [],
        fetchedAt: Date.now(),
        status: "error",
        error: "Cursor usage rate limited — try again shortly",
      };
    }
    throw new Error(`Cursor usage failed (${summaryResult.status})`);
  }

  const summary = summaryResult.json;
  const resetsAt = parseIsoMs(summary.billingCycleEnd);
  const meters: UsageMeter[] = [
    ...planMeters(
      summary.individualUsage?.plan ?? summary.individualUsage?.overall,
      resetsAt,
      summary.isUnlimited === true,
    ),
  ];

  const onDemand = onDemandMeter(summary.individualUsage?.onDemand, resetsAt);
  if (onDemand) meters.push(onDemand);

  const teamOnDemand = teamOnDemandMeter(summary.teamUsage?.onDemand, resetsAt);
  if (teamOnDemand) meters.push(teamOnDemand);

  const email =
    meResult.ok && typeof meResult.json.email === "string"
      ? meResult.json.email
      : undefined;

  const planLabel =
    typeof summary.membershipType === "string"
      ? summary.membershipType
      : undefined;

  return {
    accountId: account.id,
    provider: "cursor",
    accountLabel: email ?? account.name,
    plan: planLabel,
    meters,
    fetchedAt: Date.now(),
    status: meters.length ? "ok" : "unavailable",
    error: meters.length ? undefined : "No usage meters returned",
  };
}
