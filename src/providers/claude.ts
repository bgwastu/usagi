import { clampPercent } from "@/lib/rate-limit-window";
import type { Account, AccountUsage, ClaudeCredentials, UsageMeter } from "@/lib/types";

/** Claude Code OAuth client for subscription usage windows. */
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTH_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
/** Loopback callback registered for this client. The platform callback is rejected. */
const REDIRECT_URI = "http://localhost:54545/callback";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
/** Same scope list CLIProxyAPI sends for Claude login. */
const SCOPE =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
/** Required on the usage route. Without a claude-code user agent it 429s immediately. */
const USAGE_USER_AGENT = "claude-code/2.1.69";
/**
 * Required on the token route. A claude-code/ or Mozilla user agent is
 * rejected with 429 before the code is even checked. Claude Code itself
 * exchanges tokens with axios.
 */
const TOKEN_USER_AGENT = "axios/1.15.2";
const TOKEN_ACCEPT = "application/json, text/plain, */*";
const OAUTH_BETA = "oauth-2025-04-20";
const REFRESH_LEAD_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

type ClaudeWindow = {
  utilization?: number | null;
  resets_at?: string | number | null;
};

type ClaudeUsageLimit = {
  kind?: string;
  percent?: number;
  resets_at?: string | number | null;
  scope?: { model?: { display_name?: string } };
};

export type ClaudeUsageResponse = {
  five_hour?: ClaudeWindow | null;
  seven_day?: ClaudeWindow | null;
  seven_day_opus?: ClaudeWindow | null;
  seven_day_sonnet?: ClaudeWindow | null;
  seven_day_fable?: ClaudeWindow | null;
  fable_weekly?: ClaudeWindow | null;
  fable_seven_day?: ClaudeWindow | null;
  extra_usage?: {
    is_enabled?: boolean;
    monthly_limit?: number | null;
    used_credits?: number | null;
    utilization?: number | null;
  } | null;
  limits?: ClaudeUsageLimit[] | null;
};

type ClaudeProfile = {
  account?: {
    email?: string;
    display_name?: string;
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
  };
  organization?: {
    name?: string;
    rate_limit_tier?: string;
    organization_type?: string;
  };
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function claudeHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": OAUTH_BETA,
    Accept: "application/json",
    "User-Agent": USAGE_USER_AGENT,
  };
}

function expiresAtFrom(expiresIn: number | undefined, now = Date.now()): number {
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    return now + expiresIn * 1000;
  }
  return now + DEFAULT_TTL_MS;
}

/** ISO timestamps without a zone are UTC. Epoch values may be seconds or ms. */
export function parseClaudeReset(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 20_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return n > 20_000_000_000 ? n : n * 1000;
  }
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const parsed = Date.parse(hasZone ? trimmed : `${trimmed}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Accepts the platform callback URL, or the `code#state` string Claude shows
 * on the manual-code page.
 */
export function parseClaudeOAuthCallback(raw: string): {
  code: string;
  state: string;
} {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (/oauth\/authorize/i.test(trimmed) || /[?&]code=true(?:&|$)/i.test(trimmed)) {
    throw new Error(
      "That is the sign-in link. After you authorize, paste the localhost:54545 callback URL from the address bar.",
    );
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const error = url.searchParams.get("error");
    if (error) throw new Error(`OAuth error: ${error}`);
    let code = url.searchParams.get("code")?.trim() ?? "";
    let state = url.searchParams.get("state")?.trim() ?? "";
    if (!state && url.hash.length > 1) {
      state = decodeURIComponent(url.hash.slice(1)).trim();
    }
    if (code.includes("#")) {
      const [head, tail] = code.split("#");
      if (head && tail && !state) {
        code = head;
        state = tail;
      } else if (head) {
        code = head;
      }
    }
    if (!code || !state) {
      throw new Error("Callback URL must include code and state");
    }
    return { code, state };
  }

  const hash = trimmed.indexOf("#");
  if (hash > 0) {
    const code = trimmed.slice(0, hash).trim();
    const state = trimmed.slice(hash + 1).trim();
    if (code && state && !state.includes("#")) return { code, state };
  }
  throw new Error("Paste the Claude callback URL or the code#state value");
}

export function formatClaudePlan(profile: ClaudeProfile | null | undefined): string | undefined {
  if (!profile) return undefined;
  const tier = profile.organization?.rate_limit_tier ?? "";
  const multiple = tier.match(/_(\d+)x$/i);
  if (/max/i.test(tier)) return multiple ? `Max ${multiple[1]}x` : "Max";
  if (/pro/i.test(tier)) return "Pro";
  if (/team/i.test(tier) || profile.organization?.organization_type === "claude_team") {
    return "Team";
  }
  if (profile.account?.has_claude_max) return "Max";
  if (profile.account?.has_claude_pro) return "Pro";
  return undefined;
}

function windowMeter(
  id: string,
  label: string,
  windowSeconds: number,
  window: ClaudeWindow | null | undefined,
): UsageMeter | null {
  if (!window || typeof window.utilization !== "number" || !Number.isFinite(window.utilization)) {
    return null;
  }
  return {
    id,
    label,
    kind: "window",
    usedPercent: clampPercent(window.utilization),
    windowSeconds,
    resetsAt: parseClaudeReset(window.resets_at),
  };
}

export function claudeMetersFromUsage(json: ClaudeUsageResponse): UsageMeter[] {
  const meters: UsageMeter[] = [];
  const seen = new Set<string>();
  const push = (meter: UsageMeter | null) => {
    if (!meter || seen.has(meter.id)) return;
    seen.add(meter.id);
    meters.push(meter);
  };

  push(windowMeter("session", "5-hour", FIVE_HOUR_SECONDS, json.five_hour));
  push(windowMeter("weekly", "Weekly", WEEK_SECONDS, json.seven_day));
  push(windowMeter("sonnet", "Sonnet", WEEK_SECONDS, json.seven_day_sonnet));
  push(windowMeter("opus", "Opus", WEEK_SECONDS, json.seven_day_opus));
  push(
    windowMeter(
      "fable",
      "Fable",
      WEEK_SECONDS,
      json.seven_day_fable ?? json.fable_seven_day ?? json.fable_weekly,
    ),
  );

  for (const limit of json.limits ?? []) {
    if (limit?.kind !== "weekly_scoped") continue;
    const name = limit.scope?.model?.display_name?.trim();
    if (!name || typeof limit.percent !== "number") continue;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!id) continue;
    push({
      id,
      label: name,
      kind: "window",
      usedPercent: clampPercent(limit.percent),
      windowSeconds: WEEK_SECONDS,
      resetsAt: parseClaudeReset(limit.resets_at),
    });
  }

  const extra = json.extra_usage;
  if (extra?.is_enabled) {
    const used = typeof extra.used_credits === "number" ? extra.used_credits : undefined;
    const limit = typeof extra.monthly_limit === "number" ? extra.monthly_limit : undefined;
    const usedPercent =
      typeof extra.utilization === "number"
        ? clampPercent(extra.utilization)
        : used != null && limit != null && limit > 0
          ? clampPercent((used / limit) * 100)
          : undefined;
    if (usedPercent != null || used != null) {
      push({
        id: "extra",
        label: "Extra",
        kind: "credits",
        ...(usedPercent != null ? { usedPercent } : {}),
        ...(used != null ? { used } : {}),
        ...(limit != null ? { limit, remaining: Math.max(0, limit - (used ?? 0)) } : {}),
        unit: "credits",
      });
    }
  }

  return meters;
}

export function buildClaudeAuthorizeUrl(input: {
  state: string;
  codeChallenge: string;
}): string {
  // Key order matches Go's url.Values.Encode, which is what CLIProxyAPI sends.
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    code: "true",
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state: input.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Anthropic returns `error` as a string or as `{ type, message }`. */
export function formatClaudeTokenError(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const json = JSON.parse(trimmed) as {
      error?: unknown;
      error_description?: unknown;
      message?: unknown;
    };
    const description = textField(json.error_description);
    if (description) return description;
    const errorText = textField(json.error);
    if (errorText) return errorText;
    if (json.error && typeof json.error === "object") {
      const err = json.error as { message?: unknown; type?: unknown };
      const message = textField(err.message);
      const type = textField(err.type);
      if (message && type) return `${type}: ${message}`;
      if (message) return message;
      if (type) return type;
    }
    const message = textField(json.message);
    if (message) return message;
  } catch {
    // Response was not JSON.
  }
  return trimmed.slice(0, 180);
}

async function readTokenError(res: Response): Promise<string> {
  const text = await res.text();
  return formatClaudeTokenError(text) || `HTTP ${res.status}`;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: TOKEN_ACCEPT,
      "Content-Type": "application/json",
      "User-Agent": TOKEN_USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Claude token exchange failed (${res.status}): ${await readTokenError(res)}`);
  }
  return (await res.json()) as TokenResponse;
}

async function fetchClaudeProfile(accessToken: string): Promise<ClaudeProfile | null> {
  const res = await fetch(PROFILE_URL, {
    headers: claudeHeaders(accessToken),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    await res.text();
    return null;
  }
  return (await res.json()) as ClaudeProfile;
}

export async function exchangeClaudeCode(input: {
  code: string;
  state: string;
  codeVerifier: string;
}): Promise<ClaudeCredentials> {
  const json = await postToken({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: input.codeVerifier,
    state: input.state,
  });
  if (!json.access_token || !json.refresh_token) {
    throw new Error("Claude token response was missing access or refresh token");
  }
  const profile = await fetchClaudeProfile(json.access_token);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    email: profile?.account?.email,
    expiresAt: expiresAtFrom(json.expires_in),
    lastRefresh: Date.now(),
    scope: json.scope ?? SCOPE,
  };
}

export async function refreshClaudeCredentials(
  account: Extract<Account, { provider: "claude" }>,
): Promise<{ account: Extract<Account, { provider: "claude" }>; changed: boolean }> {
  const { credentials } = account;
  const needsRefresh =
    !credentials.expiresAt || credentials.expiresAt - Date.now() < REFRESH_LEAD_MS;

  if (!needsRefresh) return { account, changed: false };

  const reauth = (authError: string) => ({
    account: {
      ...account,
      authStatus: "reauth_required" as const,
      authError,
      updatedAt: Date.now(),
    },
    changed: true as const,
  });

  let json: TokenResponse;
  try {
    json = await postToken({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: CLIENT_ID,
      scope: credentials.scope || SCOPE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";
    return reauth(message);
  }

  if (!json.access_token) return reauth("Token refresh failed");

  return {
    account: {
      ...account,
      authStatus: "ok",
      authError: undefined,
      credentials: {
        ...credentials,
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? credentials.refreshToken,
        expiresAt: expiresAtFrom(json.expires_in),
        lastRefresh: Date.now(),
        scope: json.scope ?? credentials.scope,
      },
      updatedAt: Date.now(),
    },
    changed: true,
  };
}

export async function fetchClaudeUsage(
  account: Extract<Account, { provider: "claude" }>,
): Promise<AccountUsage> {
  const res = await fetch(USAGE_URL, {
    headers: claudeHeaders(account.credentials.accessToken),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401 || res.status === 403) {
    await res.text();
    return {
      accountId: account.id,
      provider: "claude",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error:
        res.status === 403
          ? "Claude usage rejected (403) — re-authenticate"
          : "Claude session expired (401) — re-authenticate",
    };
  }

  if (res.status === 429) {
    await res.text();
    return {
      accountId: account.id,
      provider: "claude",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "Claude usage rate limit — try again shortly",
    };
  }

  if (!res.ok) {
    throw new Error(`Claude usage failed (${res.status})`);
  }

  const json = (await res.json()) as ClaudeUsageResponse;
  const profile = await fetchClaudeProfile(account.credentials.accessToken);
  const meters = claudeMetersFromUsage(json);

  return {
    accountId: account.id,
    provider: "claude",
    accountLabel: profile?.account?.email ?? account.credentials.email ?? account.name,
    plan: formatClaudePlan(profile),
    meters,
    fetchedAt: Date.now(),
    status: meters.length ? "ok" : "unavailable",
    error: meters.length ? undefined : "No rate-limit windows returned",
  };
}
