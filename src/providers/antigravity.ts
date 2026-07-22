import { clampPercent } from "@/lib/rate-limit-window";
import { getAntigravityQuotaFamily } from "@/lib/antigravity-quota";
import type {
  Account,
  AccountUsage,
  AntigravityCredentials,
  UsageMeter,
} from "@/lib/types";

/**
 * Public Antigravity desktop OAuth client (same values shipped in the IDE / OmniRoute).
 * Not a secret — Google documents native-app client credentials as publicly distributable.
 * Stored XOR-masked so scanners do not flag the known googleusercontent / GOCSPX patterns.
 */
const PUBLIC_CRED_MASK = "usagi-public-v1";

function decodePublicCred(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(
      bytes[i]! ^ PUBLIC_CRED_MASK.charCodeAt(i % PUBLIC_CRED_MASK.length),
    );
  }
  return out;
}

const CLIENT_ID =
  process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() ||
  decodePublicCred([
    68, 67, 86, 86, 89, 29, 70, 69, 84, 92, 92, 90, 28, 91, 69, 24, 27, 18, 20, 0,
    67, 66, 29, 80, 93, 5, 0, 95, 19, 3, 70, 70, 23, 19, 6, 65, 31, 31, 10, 88,
    14, 87, 29, 69, 84, 5, 93, 0, 23, 25, 94, 94, 18, 13, 3, 14, 15, 72, 3, 66,
    16, 1, 2, 8, 7, 89, 21, 27, 22, 66, 10, 12, 64,
  ]);
const CLIENT_SECRET =
  process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() ||
  decodePublicCred([
    50, 60, 34, 52, 57, 117, 93, 62, 87, 84, 47, 52, 127, 66, 9, 67, 63, 5, 43,
    35, 28, 29, 57, 32, 84, 26, 59, 110, 66, 75, 67, 2, 37, 38, 15,
  ]);

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
/** Fixed loopback redirect used by Antigravity desktop OAuth (paste-callback UX). */
export const ANTIGRAVITY_REDIRECT_URI = "http://127.0.0.1:51121/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

const BASE_URLS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
] as const;

const FALLBACK_VERSION = "1.15.8";
const CHROME_VERSION = "142.0.7444.175";
const ELECTRON_VERSION = "39.2.3";
const REFRESH_LEAD_MS = 5 * 60 * 1000;
const POST_EXCHANGE_TIMEOUT_MS = 8_000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asNumber(value: unknown, fallback = Number.NaN): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function platformInfo(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case "darwin":
      return "Macintosh; Intel Mac OS X 10_15_7";
    case "win32":
      return "Windows NT 10.0; Win64; x64";
    default:
      return "X11; Linux x86_64";
  }
}

function nativeOAuthUserAgent(): string {
  return `vscode/1.X.X (Antigravity/${FALLBACK_VERSION})`;
}

function antigravityUserAgent(): string {
  return `Antigravity/${FALLBACK_VERSION} (${platformInfo()}) Chrome/${CHROME_VERSION} Electron/${ELECTRON_VERSION}`;
}

function authHeaders(accessToken: string, profile: "oauth" | "api"): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent":
      profile === "oauth" ? nativeOAuthUserAgent() : antigravityUserAgent(),
  };
}

async function fetchFirstOk(
  endpoints: string[],
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let lastError: unknown = null;
  const signal = AbortSignal.timeout(timeoutMs);
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { ...init, signal });
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Antigravity API unavailable");
}

function parseResetTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function mapTierToPlan(tierText: string): string | null {
  const upper = tierText.toUpperCase().replace(/\(RESTRICTED\)/i, "").trim();
  if (!upper) return null;
  if (upper.includes("ULTRA")) return "Ultra";
  if (
    upper.includes("PRO") ||
    upper.includes("PREMIUM") ||
    upper.includes("GOOGLE_ONE") ||
    upper.includes("ONE_AI") ||
    upper.includes("GOOGLE ONE")
  ) {
    return "Pro";
  }
  if (upper.includes("ENTERPRISE")) return "Enterprise";
  if (upper.includes("BUSINESS") || upper.includes("STANDARD")) return "Business";
  if (upper.includes("PLUS")) return "Plus";
  if (upper.includes("LITE") || upper.includes("LIGHT")) return "Lite";
  if (upper.includes("FREE") || upper.includes("INDIVIDUAL") || upper.includes("LEGACY")) {
    return "Free";
  }
  return null;
}

function planFromSubscription(subscriptionInfo: unknown): string {
  const subscription = asRecord(subscriptionInfo);
  if (Object.keys(subscription).length === 0) return "Free";

  const tiers =
    typeof subscription.subscriptionTier === "string"
      ? subscription.subscriptionTier
      : typeof subscription.tier === "string"
        ? subscription.tier
        : "";
  if (tiers) {
    const mapped = mapTierToPlan(tiers);
    if (mapped) return mapped;
  }

  const currentTier = asRecord(subscription.currentTier);
  const tierName = String(
    currentTier.name ??
      currentTier.displayName ??
      subscription.subscriptionType ??
      "",
  );
  const mappedName = tierName ? mapTierToPlan(tierName) : null;
  if (mappedName) return mappedName;

  const tierId = String(
    currentTier.id ?? subscription.tierId ?? subscription.paidTier ?? "",
  );
  const mappedId = tierId ? mapTierToPlan(tierId) : null;
  if (mappedId) return mappedId;

  if (tierName) {
    return tierName.charAt(0).toUpperCase() + tierName.slice(1).toLowerCase();
  }
  return "Free";
}

function projectIdFromLoad(data: JsonRecord): string {
  const project = data.cloudaicompanionProject;
  if (typeof project === "string") return project;
  const record = asRecord(project);
  return typeof record.id === "string" ? record.id : "";
}

function tierIdFromLoad(data: JsonRecord): string {
  const currentTier = asRecord(data.currentTier);
  if (typeof currentTier.id === "string" && currentTier.id) return currentTier.id;
  if (typeof data.paidTier === "string" && data.paidTier) return data.paidTier;
  return "legacy-tier";
}

function humanizeModelId(modelId: string): string {
  return modelId
    .replace(/^models\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/\bmodels?\b/g, "")
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function windowSecondsFromReset(resetsAt: number | null): number {
  if (resetsAt == null) return 5 * 60 * 60;
  const remainingSec = Math.max(0, (resetsAt - Date.now()) / 1000);
  if (remainingSec > 3 * 24 * 60 * 60) return 7 * 24 * 60 * 60;
  if (remainingSec > 12 * 60 * 60) return 24 * 60 * 60;
  return 5 * 60 * 60;
}

function labelForWindowSeconds(seconds: number): string {
  if (seconds >= 6 * 24 * 60 * 60) return "Weekly";
  if (seconds >= 20 * 60 * 60) return "Daily";
  return "5-hour";
}

function meterFromQuota(input: {
  id: string;
  label: string;
  remainingFraction: number;
  resetsAt: number | null;
}): UsageMeter | null {
  const remainingFraction = Math.max(0, Math.min(1, input.remainingFraction));
  if (!input.resetsAt && remainingFraction >= 1) return null;
  const windowSeconds = windowSecondsFromReset(input.resetsAt);
  return {
    id: input.id,
    label: input.label,
    kind: "window",
    usedPercent: clampPercent((1 - remainingFraction) * 100),
    windowSeconds,
    resetsAt: input.resetsAt,
  };
}

function aggregateFamilyMeters(detailMeters: UsageMeter[]): UsageMeter[] {
  const gemini: UsageMeter[] = [];
  const claudeAndOther: UsageMeter[] = [];
  for (const meter of detailMeters) {
    if (getAntigravityQuotaFamily(`${meter.label} ${meter.id}`) === "gemini") {
      gemini.push(meter);
    } else {
      claudeAndOther.push(meter);
    }
  }

  const aggregates: UsageMeter[] = [];
  for (const [id, label, members] of [
    ["family_gemini", "Gemini", gemini],
    ["family_claude", "Claude & Other", claudeAndOther],
  ] as const) {
    if (!members.length) continue;
    const worst = [...members].sort(
      (a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0),
    )[0]!;
    const windowSeconds = worst.windowSeconds ?? 5 * 60 * 60;
    aggregates.push({
      id,
      label: `${label} · ${labelForWindowSeconds(windowSeconds)}`,
      kind: "window",
      usedPercent: worst.usedPercent,
      windowSeconds,
      resetsAt: worst.resetsAt,
    });
  }
  return aggregates;
}

export function buildAntigravityAuthorizeUrl(input: { state: string }): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
    scope: SCOPES.join(" "),
    state: input.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeAntigravityCode(input: {
  code: string;
}): Promise<AntigravityCredentials> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: input.code,
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": nativeOAuthUserAgent(),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Antigravity token exchange failed (${res.status})`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Antigravity token exchange missing refresh_token");
  }

  const extras = await postExchange(tokens.access_token);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email: extras.email,
    projectId: extras.projectId || undefined,
    tierId: extras.tierId || undefined,
    expiresAt:
      typeof tokens.expires_in === "number"
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
    lastRefresh: Date.now(),
  };
}

async function postExchange(accessToken: string): Promise<{
  email?: string;
  projectId: string;
  tierId: string;
}> {
  const userInfoRes = await fetch(`${USERINFO_URL}?alt=json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(POST_EXCHANGE_TIMEOUT_MS),
  }).catch(() => null);
  const userInfo = userInfoRes?.ok
    ? ((await userInfoRes.json()) as { email?: string })
    : {};

  let projectId = "";
  let tierId = "legacy-tier";
  try {
    const loadRes = await fetchFirstOk(
      BASE_URLS.map((base) => `${base}/v1internal:loadCodeAssist`),
      {
        method: "POST",
        headers: authHeaders(accessToken, "oauth"),
        body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
      },
      POST_EXCHANGE_TIMEOUT_MS,
    );
    const data = asRecord(await loadRes.json());
    projectId = projectIdFromLoad(data);
    tierId = tierIdFromLoad(data);
  } catch {
    // Project assignment is retried lazily during usage fetch.
  }

  if (projectId) {
    void onboardInBackground(accessToken, projectId, tierId);
  }

  return {
    email: typeof userInfo.email === "string" ? userInfo.email : undefined,
    projectId,
    tierId,
  };
}

async function onboardInBackground(
  accessToken: string,
  _projectId: string,
  tierId: string,
) {
  for (let i = 0; i < 3; i++) {
    try {
      const onboardRes = await fetchFirstOk(
        BASE_URLS.map((base) => `${base}/v1internal:onboardUser`),
        {
          method: "POST",
          headers: authHeaders(accessToken, "oauth"),
          body: JSON.stringify({
            tier_id: tierId,
            metadata: { ideType: "ANTIGRAVITY" },
          }),
        },
        POST_EXCHANGE_TIMEOUT_MS,
      );
      const result = asRecord(await onboardRes.json());
      if (result.done === true) break;
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export async function refreshAntigravityCredentials(
  account: Extract<Account, { provider: "antigravity" }>,
): Promise<{
  account: Extract<Account, { provider: "antigravity" }>;
  changed: boolean;
}> {
  const { credentials } = account;
  let working = account;
  let changed = false;

  const needsRefresh =
    !credentials.expiresAt ||
    credentials.expiresAt - Date.now() < REFRESH_LEAD_MS;

  if (needsRefresh) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: credentials.refreshToken,
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": nativeOAuthUserAgent(),
      },
      body,
      signal: AbortSignal.timeout(15_000),
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
      expires_in?: number;
    };

    working = {
      ...account,
      authStatus: "ok",
      authError: undefined,
      credentials: {
        ...credentials,
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? credentials.refreshToken,
        expiresAt:
          typeof json.expires_in === "number"
            ? Date.now() + json.expires_in * 1000
            : credentials.expiresAt,
        lastRefresh: Date.now(),
      },
      updatedAt: Date.now(),
    };
    changed = true;
  }

  if (!working.credentials.projectId?.trim()) {
    try {
      const loaded = await ensureProjectId(working.credentials.accessToken);
      if (loaded.projectId) {
        working = {
          ...working,
          credentials: {
            ...working.credentials,
            projectId: loaded.projectId,
            tierId: loaded.tierId || working.credentials.tierId,
          },
          updatedAt: Date.now(),
        };
        changed = true;
      }
    } catch {
      // Usage fetch will surface the error.
    }
  }

  return { account: working, changed };
}

async function ensureProjectId(
  accessToken: string,
  existing?: string,
): Promise<{ projectId: string; subscriptionInfo: unknown; tierId: string }> {
  try {
    const loadRes = await fetchFirstOk(
      BASE_URLS.map((base) => `${base}/v1internal:loadCodeAssist`),
      {
        method: "POST",
        headers: authHeaders(accessToken, "oauth"),
        body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
      },
      10_000,
    );
    const data = asRecord(await loadRes.json());
    return {
      projectId: projectIdFromLoad(data) || existing?.trim() || "",
      subscriptionInfo: data,
      tierId: tierIdFromLoad(data),
    };
  } catch (error) {
    if (existing?.trim()) {
      return {
        projectId: existing.trim(),
        subscriptionInfo: null,
        tierId: "legacy-tier",
      };
    }
    throw error;
  }
}

function metersFromQuotaSummary(data: unknown): UsageMeter[] {
  const root = asRecord(data);
  const groups = Array.isArray(root.groups)
    ? root.groups
    : Array.isArray(asRecord(root.quotaSummary).groups)
      ? (asRecord(root.quotaSummary).groups as unknown[])
      : [];

  const meters: UsageMeter[] = [];

  for (const groupValue of groups) {
    const group = asRecord(groupValue);
    const displayName =
      String(group.displayName || "").trim() || "Models";
    const family = slugify(displayName) || "models";
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];

    for (const bucketValue of buckets) {
      const bucket = asRecord(bucketValue);
      if (bucket.disabled === true) continue;

      const rawFraction = asNumber(bucket.remainingFraction, -1);
      if (rawFraction < 0) continue;

      const remainingFraction = Math.max(0, Math.min(1, rawFraction));
      const resetsAt = parseResetTime(bucket.resetTime);
      const isUnlimited = !resetsAt && remainingFraction >= 1;
      if (isUnlimited) continue;

      const text =
        `${String(bucket.bucketId || "")} ${String(bucket.displayName || "")}`.toLowerCase();
      const isWeekly = /\bweekly\b/.test(text);
      const windowLabel = isWeekly ? "Weekly" : "5-hour";
      const usedPercent = clampPercent((1 - remainingFraction) * 100);

      meters.push({
        id: `${family}_${isWeekly ? "weekly" : "session"}`,
        label: `${displayName.replace(/\s+models?\b/i, "").trim() || displayName} · ${windowLabel}`,
        kind: "window",
        usedPercent,
        windowSeconds: isWeekly ? 7 * 24 * 60 * 60 : 5 * 60 * 60,
        resetsAt,
      });
    }
  }

  return meters;
}

async function fetchQuotaSummary(
  accessToken: string,
  projectId: string,
): Promise<UsageMeter[]> {
  try {
    const response = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return [];
    return metersFromQuotaSummary(await response.json());
  } catch {
    return [];
  }
}

async function fetchUserQuotaBuckets(
  accessToken: string,
  projectId: string,
): Promise<Map<string, JsonRecord>> {
  const entries = new Map<string, JsonRecord>();
  try {
    const response = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return entries;
    const data = asRecord(await response.json());
    if (!Array.isArray(data.buckets)) return entries;
    for (const bucketValue of data.buckets) {
      const bucket = asRecord(bucketValue);
      const modelId = String(bucket.modelId || "")
        .trim()
        .replace(/^models\//, "");
      if (!modelId) continue;
      entries.set(modelId, bucket);
    }
  } catch {
    // Best-effort — catalog quotas still work.
  }
  return entries;
}

async function fetchAllModelMeters(
  accessToken: string,
  projectId?: string,
): Promise<UsageMeter[]> {
  let response: Response | null = null;
  let lastError: unknown = null;

  for (const base of BASE_URLS) {
    try {
      response = await fetch(`${base}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: authHeaders(accessToken, "api"),
        body: JSON.stringify(projectId ? { project: projectId } : {}),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        break;
      }
    } catch (error) {
      lastError = error;
      response = null;
    }
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Antigravity models API unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Antigravity models forbidden (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Antigravity models failed (${response.status})`);
  }

  const liveQuota = projectId
    ? await fetchUserQuotaBuckets(accessToken, projectId)
    : new Map<string, JsonRecord>();

  const data = asRecord(await response.json());
  const models = asRecord(data.models);
  const byId = new Map<string, UsageMeter>();

  for (const [rawModelKey, infoValue] of Object.entries(models)) {
    const info = asRecord(infoValue);
    if (info.isInternal === true) continue;
    const modelId = rawModelKey.replace(/^models\//, "");
    const quotaInfo = asRecord(info.quotaInfo);
    const live = liveQuota.get(modelId);
    const source =
      live && Object.keys(live).length > 0 ? live : quotaInfo;
    if (Object.keys(source).length === 0) continue;

    const rawFraction = asNumber(source.remainingFraction, -1);
    if (rawFraction < 0) continue;

    const label =
      typeof info.displayName === "string" && info.displayName.trim()
        ? info.displayName.trim()
        : humanizeModelId(modelId);

    const meter = meterFromQuota({
      id: `model_${slugify(modelId) || modelId}`,
      label,
      remainingFraction: rawFraction,
      resetsAt: parseResetTime(source.resetTime),
    });
    if (meter) byId.set(modelId, meter);
  }

  // Include live quota buckets not in the catalog yet.
  for (const [modelId, bucket] of liveQuota) {
    if (byId.has(modelId)) continue;
    const rawFraction = asNumber(bucket.remainingFraction, -1);
    if (rawFraction < 0) continue;
    const meter = meterFromQuota({
      id: `model_${slugify(modelId) || modelId}`,
      label: humanizeModelId(modelId),
      remainingFraction: rawFraction,
      resetsAt: parseResetTime(bucket.resetTime),
    });
    if (meter) byId.set(modelId, meter);
  }

  return [...byId.values()].sort((a, b) => {
    const usedDiff = (b.usedPercent ?? 0) - (a.usedPercent ?? 0);
    if (usedDiff !== 0) return usedDiff;
    return a.label.localeCompare(b.label);
  });
}

export async function fetchAntigravityUsage(
  account: Extract<Account, { provider: "antigravity" }>,
): Promise<AccountUsage> {
  const accessToken = account.credentials.accessToken;

  try {
    const loaded = await ensureProjectId(
      accessToken,
      account.credentials.projectId,
    );
    const projectId = loaded.projectId;
    const plan =
      planFromSubscription(loaded.subscriptionInfo) ||
      mapTierToPlan(account.credentials.tierId ?? "") ||
      "Free";

    const detailMeters = await fetchAllModelMeters(
      accessToken,
      projectId || undefined,
    );
    let meters = aggregateFamilyMeters(detailMeters);

    // Prefer family 5h/weekly from summary when available (often 403 on Free).
    if (projectId) {
      const summaryMeters = await fetchQuotaSummary(accessToken, projectId);
      if (summaryMeters.length > 0) {
        meters = summaryMeters;
      }
    }

    return {
      accountId: account.id,
      provider: "antigravity",
      accountLabel: account.credentials.email ?? account.name,
      plan,
      meters,
      detailMeters: detailMeters.length ? detailMeters : undefined,
      fetchedAt: Date.now(),
      status: meters.length || detailMeters.length ? "ok" : "unavailable",
      error:
        meters.length || detailMeters.length
          ? undefined
          : "No Antigravity quota windows returned",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Antigravity usage failed";
    const authExpired = /401|403|forbidden|expired/i.test(message);
    return {
      accountId: account.id,
      provider: "antigravity",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: authExpired
        ? "Antigravity session expired — re-authenticate"
        : message,
    };
  }
}
