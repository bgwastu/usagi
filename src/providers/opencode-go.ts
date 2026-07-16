import { randomUUID } from "node:crypto";
import type { Account, AccountUsage } from "@/lib/types";

const OPENCODE_BASE = "https://opencode.ai";
const OPENCODE_SERVER_URL = "https://opencode.ai/_server";
const API_TIMEOUT_MS = 15_000;

// Server-function hash for the workspaces endpoint — stable identifier used by
// the opencode.ai SST/TanStack router server-fn protocol (same as Orca).
const WORKSPACES_SERVER_ID =
  "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";

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
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!workspacesRes.ok) {
    throw new Error(`Workspaces fetch failed (${workspacesRes.status})`);
  }

  return parseWorkspaceIds(await workspacesRes.text());
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
        error: err instanceof Error ? err.message : "Workspace discovery failed",
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

  let lastError = "Could not parse usage data from any available workspace";
  let sawNoSubscription = false;
  let accountLabel: string | undefined;

  for (const workspaceId of ids) {
    try {
      const pageRes = await fetch(
        `${OPENCODE_BASE}/workspace/${workspaceId}/go`,
        {
          headers: {
            Cookie: cookieHeader,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Origin: OPENCODE_BASE,
            Referer: OPENCODE_BASE,
          },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );

      if (!pageRes.ok) {
        lastError = `OpenCode Go page failed (${pageRes.status})`;
        continue;
      }

      const pageText = await pageRes.text();
      const emailMatch = pageText.match(
        /\$R\[\d+\],"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"\)/,
      );
      accountLabel = emailMatch?.[1] ?? workspaceId;

      const parsed = parseSubscriptionFromPageText(pageText);
      if (parsed) {
        return usageFromParsed(account.id, accountLabel, parsed);
      }

      const noSubscription =
        pageText.includes("Subscribe to Go") ||
        /subscription\s*:\s*null/.test(pageText);
      if (noSubscription) {
        sawNoSubscription = true;
        lastError = "No active OpenCode Go subscription on this workspace";
        continue;
      }

      lastError = "Could not parse Go usage from opencode.ai";
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
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
