import {
  clampPercent,
  labelCodexRateLimitWindow,
  resetAtMs,
} from "@/lib/rate-limit-window";
import type { Account, AccountUsage, CodexCredentials } from "@/lib/types";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_LEAD_MS = 24 * 60 * 60 * 1000;

type CodexRateLimitWindow = {
  used_percent?: number;
  reset_at?: number;
  reset_after_seconds?: number;
  limit_window_seconds?: number;
};

type CodexUsageResponse = {
  plan_type?: string;
  rate_limit?: {
    primary_window?: CodexRateLimitWindow;
    secondary_window?: CodexRateLimitWindow;
  };
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractCodexIdentity(accessToken: string): {
  email?: string;
  accountId?: string;
  plan?: string;
  expiresAt?: number;
} {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return {};
  const auth = payload["https://api.openai.com/auth"] as
    | Record<string, unknown>
    | undefined;
  const profile = payload["https://api.openai.com/profile"] as
    | Record<string, unknown>
    | undefined;
  return {
    email: typeof profile?.email === "string" ? profile.email : undefined,
    accountId:
      typeof auth?.chatgpt_account_id === "string"
        ? auth.chatgpt_account_id
        : undefined,
    plan:
      typeof auth?.chatgpt_plan_type === "string"
        ? auth.chatgpt_plan_type
        : undefined,
    expiresAt:
      typeof payload.exp === "number" ? payload.exp * 1000 : undefined,
  };
}

export function buildCodexAuthorizeUrl(input: {
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "login");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  return url.toString();
}

export async function exchangeCodexCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<CodexCredentials> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: input.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: input.codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Codex token exchange failed (${res.status})`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
  };
  const identity = extractCodexIdentity(json.access_token);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    accountId: identity.accountId,
    email: identity.email,
    expiresAt: identity.expiresAt,
    lastRefresh: Date.now(),
  };
}

export async function refreshCodexCredentials(account: Extract<
  Account,
  { provider: "codex" }
>): Promise<{ account: Extract<Account, { provider: "codex" }>; changed: boolean }> {
  const { credentials } = account;
  const needsRefresh =
    !credentials.expiresAt ||
    credentials.expiresAt - Date.now() < REFRESH_LEAD_MS ||
    (credentials.lastRefresh != null &&
      Date.now() - credentials.lastRefresh > 7 * 24 * 60 * 60 * 1000);

  if (!needsRefresh) {
    return { account, changed: false };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: credentials.refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    return {
      account: {
        ...account,
        authStatus: "reauth_required",
        authError: `Token refresh failed (${res.status})`,
        updatedAt: Date.now(),
      },
      changed: true,
    };
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };
  const identity = extractCodexIdentity(json.access_token);

  return {
    account: {
      ...account,
      name: identity.email ?? account.name,
      authStatus: "ok",
      authError: undefined,
      credentials: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? credentials.refreshToken,
        idToken: json.id_token ?? credentials.idToken,
        accountId: identity.accountId ?? credentials.accountId,
        email: identity.email ?? credentials.email,
        expiresAt: identity.expiresAt,
        lastRefresh: Date.now(),
      },
      updatedAt: Date.now(),
    },
    changed: true,
  };
}

export async function fetchCodexUsage(
  account: Extract<Account, { provider: "codex" }>,
): Promise<AccountUsage> {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${account.credentials.accessToken}`,
      Accept: "application/json",
      ...(account.credentials.accountId
        ? { "ChatGPT-Account-ID": account.credentials.accountId }
        : {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    return {
      accountId: account.id,
      provider: "codex",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "Codex session expired — re-authenticate",
    };
  }

  if (!res.ok) {
    throw new Error(`Codex usage failed (${res.status})`);
  }

  const json = (await res.json()) as CodexUsageResponse;
  const primary = json.rate_limit?.primary_window;
  const secondary = json.rate_limit?.secondary_window;
  const meters = [];

  if (primary?.used_percent != null) {
    const windowSeconds = primary.limit_window_seconds;
    meters.push({
      // Slot ids stay stable; labels come from limit_window_seconds.
      id: "session",
      label: labelCodexRateLimitWindow({
        windowSeconds,
        isSecondary: false,
        resetAtSec: primary.reset_at,
        otherResetAtSec: secondary?.reset_at,
      }),
      kind: "window" as const,
      usedPercent: clampPercent(primary.used_percent),
      windowSeconds,
      resetsAt: resetAtMs(primary.reset_at, primary.reset_after_seconds),
    });
  }
  if (secondary?.used_percent != null) {
    const windowSeconds = secondary.limit_window_seconds;
    meters.push({
      id: "weekly",
      label: labelCodexRateLimitWindow({
        windowSeconds,
        isSecondary: true,
        resetAtSec: secondary.reset_at,
        otherResetAtSec: primary?.reset_at,
      }),
      kind: "window" as const,
      usedPercent: clampPercent(secondary.used_percent),
      windowSeconds,
      resetsAt: resetAtMs(secondary.reset_at, secondary.reset_after_seconds),
    });
  }

  return {
    accountId: account.id,
    provider: "codex",
    accountLabel: account.credentials.email ?? account.name,
    plan: json.plan_type,
    meters,
    fetchedAt: Date.now(),
    status: meters.length ? "ok" : "unavailable",
    error: meters.length ? undefined : "No rate-limit windows returned",
  };
}
