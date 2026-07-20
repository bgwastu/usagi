import { randomUUID } from "node:crypto";
import type { Account, AccountUsage } from "@/lib/types";

const OPENCODE_BASE = "https://opencode.ai";
const OPENCODE_SERVER_URL = "https://opencode.ai/_server";
const API_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Server-function hash for the workspaces endpoint — stable identifier used by
// the opencode.ai SST/TanStack router server-fn protocol (same as Orca).
const WORKSPACES_SERVER_ID =
  "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";

// Fallback for lite.subscription.get — refreshed dynamically from public assets
// when possible. Authenticated /workspace/{id}/go HTML currently hangs upstream.
const FALLBACK_SUBSCRIPTION_SERVER_ID =
  "c7389bd0e731f80f49593e5ee53835475f4e28594dd6bd83eb229bab753498cd";

let cachedSubscriptionServerId: { id: string; fetchedAt: number } | null = null;
const SUBSCRIPTION_ID_TTL_MS = 60 * 60 * 1000;

function normalizeCookieInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(";") || /^(?:auth|__Host-auth)=/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("Fe26.2**") || /^[a-zA-Z0-9.\-_]+$/.test(trimmed)) {
    return `auth=${trimmed}`;
  }
  return trimmed;
}

function filterAuthCookie(raw: string): string {
  return raw
    .split(";")
    .map((p) => p.trim())
    .filter((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return false;
      const name = pair.slice(0, eq).trim();
      return name === "auth" || name === "__Host-auth";
    })
    .join("; ");
}

function parseWorkspaceIds(text: string): string[] {
  const ids: string[] = [];
  const workspaceIdRegex = /\bid\s*:\s*["']((?:wrk|wk)_[a-zA-Z0-9]+)["']/g;
  for (const match of text.matchAll(workspaceIdRegex)) {
    const id = match[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function extractUsageBlock(text: string, key: string): string | null {
  const keyRegex = new RegExp(`\\b${key}\\b\\s*:`, "g");
  let keyMatch: RegExpExecArray | null;
  while ((keyMatch = keyRegex.exec(text)) !== null) {
    const searchStart = keyMatch.index + keyMatch[0].length;
    const searchWindow = text.slice(searchStart, searchStart + 30);
    const braceOffset = searchWindow.indexOf("{");
    if (braceOffset === -1) continue;
    const openBrace = searchStart + braceOffset;
    let depth = 0;
    let block: string | null = null;
    for (let i = openBrace; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          block = text.slice(openBrace, i + 1);
          break;
        }
      }
    }
    if (
      block &&
      extractTopLevelNumber(block, "usagePercent") !== null &&
      extractTopLevelNumber(block, "resetInSec") !== null
    ) {
      return block;
    }
  }
  return null;
}

function extractTopLevelNumber(objText: string, fieldName: string): number | null {
  const fieldRegex = new RegExp(
    `\\b${fieldName}\\b\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)`,
  );
  let depth = 0;
  for (let i = 0; i < objText.length; i++) {
    const ch = objText[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      continue;
    }
    if (depth === 1) {
      const slice = objText.slice(i, i + fieldName.length + 30);
      const m = fieldRegex.exec(slice);
      if (m && m.index === 0) {
        return Number(m[1]);
      }
    }
  }
  return null;
}

function parseSubscriptionFromPageText(text: string): {
  rollingUsagePercent: number;
  weeklyUsagePercent: number;
  monthlyUsagePercent: number | null;
  rollingResetInSec: number;
  weeklyResetInSec: number;
  monthlyResetInSec: number | null;
} | null {
  const rollingBlock = extractUsageBlock(text, "rollingUsage");
  const weeklyBlock = extractUsageBlock(text, "weeklyUsage");
  if (!rollingBlock || !weeklyBlock) return null;

  const rollingPercent = extractTopLevelNumber(rollingBlock, "usagePercent");
  const rollingReset = extractTopLevelNumber(rollingBlock, "resetInSec");
  const weeklyPercent = extractTopLevelNumber(weeklyBlock, "usagePercent");
  const weeklyReset = extractTopLevelNumber(weeklyBlock, "resetInSec");
  if (
    rollingPercent === null ||
    rollingReset === null ||
    weeklyPercent === null ||
    weeklyReset === null
  ) {
    return null;
  }

  const monthlyBlock = extractUsageBlock(text, "monthlyUsage");
  const monthlyPercent = monthlyBlock
    ? extractTopLevelNumber(monthlyBlock, "usagePercent")
    : null;
  const monthlyReset = monthlyBlock
    ? extractTopLevelNumber(monthlyBlock, "resetInSec")
    : null;

  return {
    rollingUsagePercent: Math.min(100, Math.max(0, rollingPercent)),
    weeklyUsagePercent: Math.min(100, Math.max(0, weeklyPercent)),
    monthlyUsagePercent:
      monthlyPercent !== null ? Math.min(100, Math.max(0, monthlyPercent)) : null,
    rollingResetInSec: rollingReset,
    weeklyResetInSec: weeklyReset,
    monthlyResetInSec: monthlyReset,
  };
}

function timeoutMessage(err: unknown, step: string): string {
  if (
    err instanceof Error &&
    (err.name === "TimeoutError" || /timed out/i.test(err.message))
  ) {
    return `opencode.ai ${step} timed out`;
  }
  return err instanceof Error ? err.message : "Unknown error";
}

async function discoverWorkspaceIds(cookieHeader: string): Promise<string[]> {
  const instanceId = `server-fn:${randomUUID()}`;
  const workspacesUrl = `${OPENCODE_SERVER_URL}?id=${WORKSPACES_SERVER_ID}`;
  const workspacesRes = await fetch(workspacesUrl, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
      "X-Server-Id": WORKSPACES_SERVER_ID,
      "X-Server-Instance": instanceId,
      Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
      Origin: OPENCODE_BASE,
      Referer: OPENCODE_BASE,
      "User-Agent": UA,
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!workspacesRes.ok) {
    throw new Error(`Workspaces fetch failed (${workspacesRes.status})`);
  }

  return parseWorkspaceIds(await workspacesRes.text());
}

function extractSubscriptionHashFromBundle(text: string): string | null {
  const varToHash = new Map<string, string>();
  const refPattern =
    /(\w+)\s*=\s*createServerReference\(["']([0-9a-f]{64})["']/g;
  let match: RegExpExecArray | null;
  while ((match = refPattern.exec(text)) !== null) {
    varToHash.set(match[1], match[2]);
  }
  if (varToHash.size === 0) return null;

  for (const [varName, hash] of varToHash) {
    const usagePattern = new RegExp(
      `(?:query|action)\\(\\s*${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,\\s*["']lite\\.subscription\\.get["']`,
    );
    if (usagePattern.test(text)) return hash;
  }
  return null;
}

async function resolveSubscriptionServerId(): Promise<string> {
  const now = Date.now();
  if (
    cachedSubscriptionServerId &&
    now - cachedSubscriptionServerId.fetchedAt < SUBSCRIPTION_ID_TTL_MS
  ) {
    return cachedSubscriptionServerId.id;
  }

  try {
    const homeRes = await fetch(OPENCODE_BASE, {
      headers: {
        Accept: "text/html",
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!homeRes.ok) throw new Error(`Home fetch failed (${homeRes.status})`);
    const homeHtml = await homeRes.text();
    const entryMatch = homeHtml.match(
      /\/_build\/assets\/(entry-client-[^"']+\.js)/,
    );
    if (!entryMatch) throw new Error("entry-client bundle not found");

    const entryRes = await fetch(`${OPENCODE_BASE}${entryMatch[0]}`, {
      headers: { Accept: "*/*", "User-Agent": UA },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!entryRes.ok) throw new Error(`entry-client fetch failed (${entryRes.status})`);
    const entryText = await entryRes.text();

    const goRouteIdx = entryText.indexOf("workspace/[id]/go/index.tsx");
    if (goRouteIdx < 0) throw new Error("Go workspace route not found in entry");
    const window = entryText.slice(goRouteIdx, goRouteIdx + 500);
    const chunkMatch = window.match(/\["\.\/(index-[A-Za-z0-9_-]+\.js)"\]|\.\/(index-[A-Za-z0-9_-]+\.js)/);
    const chunkName = chunkMatch?.[1] ?? chunkMatch?.[2];
    if (!chunkName) throw new Error("Go chunk name not found");

    const chunkRes = await fetch(`${OPENCODE_BASE}/_build/assets/${chunkName}`, {
      headers: { Accept: "*/*", "User-Agent": UA },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!chunkRes.ok) throw new Error(`Go chunk fetch failed (${chunkRes.status})`);
    const hash = extractSubscriptionHashFromBundle(await chunkRes.text());
    if (!hash) throw new Error("lite.subscription.get hash not found");

    cachedSubscriptionServerId = { id: hash, fetchedAt: now };
    return hash;
  } catch {
    cachedSubscriptionServerId = {
      id: FALLBACK_SUBSCRIPTION_SERVER_ID,
      fetchedAt: now,
    };
    return FALLBACK_SUBSCRIPTION_SERVER_ID;
  }
}

function buildSubscriptionArgs(workspaceId: string): string {
  return JSON.stringify({
    t: { t: 9, i: 0, l: 1, a: [{ t: 1, s: workspaceId }], o: 0 },
    f: 31,
    m: [],
  });
}

async function fetchSubscriptionUsageText(
  cookieHeader: string,
  workspaceId: string,
  subscriptionServerId: string,
): Promise<string> {
  const args = buildSubscriptionArgs(workspaceId);
  const url = `${OPENCODE_SERVER_URL}?id=${subscriptionServerId}&args=${encodeURIComponent(args)}`;
  const instanceId = `server-fn:${randomUUID()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
      "X-Server-Id": subscriptionServerId,
      "X-Server-Instance": instanceId,
      Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
      Origin: OPENCODE_BASE,
      Referer: `${OPENCODE_BASE}/workspace/${workspaceId}`,
      "User-Agent": UA,
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Subscription fetch failed (${res.status})`);
  }

  return res.text();
}

function usageFromParsed(
  accountId: string,
  accountLabel: string,
  parsed: NonNullable<ReturnType<typeof parseSubscriptionFromPageText>>,
): AccountUsage {
  const now = Date.now();
  const meters = [
    {
      id: "session",
      label: "5-hour",
      kind: "window" as const,
      usedPercent: parsed.rollingUsagePercent,
      windowSeconds: 5 * 60 * 60,
      resetsAt: now + parsed.rollingResetInSec * 1000,
    },
    {
      id: "weekly",
      label: "Weekly",
      kind: "window" as const,
      usedPercent: parsed.weeklyUsagePercent,
      windowSeconds: 7 * 24 * 60 * 60,
      resetsAt: now + parsed.weeklyResetInSec * 1000,
    },
  ];

  if (
    parsed.monthlyUsagePercent !== null &&
    parsed.monthlyResetInSec !== null
  ) {
    meters.push({
      id: "monthly",
      label: "Monthly",
      kind: "window",
      usedPercent: parsed.monthlyUsagePercent,
      windowSeconds: 30 * 24 * 60 * 60,
      resetsAt: now + parsed.monthlyResetInSec * 1000,
    });
  }

  return {
    accountId,
    provider: "opencode-go",
    accountLabel,
    meters,
    fetchedAt: now,
    status: "ok",
  };
}

export async function fetchOpenCodeGoUsage(
  account: Extract<Account, { provider: "opencode-go" }>,
): Promise<AccountUsage> {
  const cookieHeader = filterAuthCookie(
    normalizeCookieInput(account.credentials.cookie),
  );
  if (!cookieHeader) {
    return {
      accountId: account.id,
      provider: "opencode-go",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "No auth cookie found",
    };
  }

  const override = account.credentials.workspaceId?.trim();
  let ids: string[] = [];

  if (override) {
    if (!/^(wrk|wk)_[A-Za-z0-9]+$/.test(override)) {
      return {
        accountId: account.id,
        provider: "opencode-go",
        meters: [],
        fetchedAt: Date.now(),
        status: "error",
        error: "Invalid workspace ID format",
      };
    }
    ids = [override];
  } else {
    try {
      ids = await discoverWorkspaceIds(cookieHeader);
    } catch (err) {
      return {
        accountId: account.id,
        provider: "opencode-go",
        meters: [],
        fetchedAt: Date.now(),
        status: "error",
        error: timeoutMessage(err, "workspace discovery"),
      };
    }
  }

  if (ids.length === 0) {
    return {
      accountId: account.id,
      provider: "opencode-go",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: "No workspace found — set a Workspace ID override",
    };
  }

  let subscriptionServerId: string;
  try {
    subscriptionServerId = await resolveSubscriptionServerId();
  } catch (err) {
    return {
      accountId: account.id,
      provider: "opencode-go",
      meters: [],
      fetchedAt: Date.now(),
      status: "error",
      error: timeoutMessage(err, "subscription hash discovery"),
    };
  }

  let lastError = "Could not parse usage data from any available workspace";
  let sawNoSubscription = false;
  let accountLabel: string | undefined;

  for (const workspaceId of ids) {
    try {
      const text = await fetchSubscriptionUsageText(
        cookieHeader,
        workspaceId,
        subscriptionServerId,
      );
      accountLabel = workspaceId;

      const emailMatch = text.match(
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
      );
      if (emailMatch?.[1]) accountLabel = emailMatch[1];

      const parsed = parseSubscriptionFromPageText(text);
      if (parsed) {
        return usageFromParsed(account.id, accountLabel, parsed);
      }

      const noSubscription =
        text.includes("Subscribe to Go") ||
        /subscription\s*:\s*null/.test(text) ||
        (!text.includes("rollingUsage") && /\bnull\b/.test(text));
      if (noSubscription) {
        sawNoSubscription = true;
        lastError = "No active OpenCode Go subscription on this workspace";
        continue;
      }

      lastError = "Could not parse Go usage from opencode.ai";
    } catch (err) {
      lastError = timeoutMessage(err, "subscription fetch");
    }
  }

  return {
    accountId: account.id,
    provider: "opencode-go",
    accountLabel,
    meters: [],
    fetchedAt: Date.now(),
    status: sawNoSubscription ? "unavailable" : "error",
    error: lastError,
  };
}
