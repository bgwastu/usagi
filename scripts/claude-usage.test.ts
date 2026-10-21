import { afterEach, describe, expect, test } from "bun:test";
import { createPkceChallenge } from "../src/lib/oauth-pkce.ts";
import {
  buildClaudeAuthorizeUrl,
  claudeMetersFromUsage,
  exchangeClaudeCode,
  fetchClaudeUsage,
  formatClaudePlan,
  formatClaudeTokenError,
  parseClaudeOAuthCallback,
  parseClaudeReset,
} from "../src/providers/claude.ts";
import type { Account } from "../src/lib/types.ts";

const account: Extract<Account, { provider: "claude" }> = {
  id: "acc",
  provider: "claude",
  name: "Claude",
  span: "2x1",
  credentials: {
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
  },
  createdAt: 0,
  updatedAt: 0,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createPkceChallenge", () => {
  test("uses a 32-byte state for Claude", () => {
    const { state } = createPkceChallenge(32);
    expect(state).toHaveLength(43);
  });
});

describe("buildClaudeAuthorizeUrl", () => {
  test("matches CLIProxyAPI's authorize request", () => {
    const url = new URL(
      buildClaudeAuthorizeUrl({ state: "state", codeChallenge: "challenge" }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    );
    expect(url.searchParams.get("code")).toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:54545/callback");
    expect(url.search.slice(1).split("&").map((part) => part.split("=")[0])).toEqual([
      "client_id",
      "code",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
    ]);
  });
});

describe("parseClaudeOAuthCallback", () => {
  test("reads code and state from the platform callback URL", () => {
    expect(
      parseClaudeOAuthCallback(
        "https://platform.claude.com/oauth/code/callback?code=abc123&state=xyz789",
      ),
    ).toEqual({ code: "abc123", state: "xyz789" });
  });

  test("reads the manual code#state string", () => {
    expect(parseClaudeOAuthCallback("abc123#xyz789")).toEqual({
      code: "abc123",
      state: "xyz789",
    });
  });

  test("strips a code#state pair stuffed into the code query", () => {
    expect(
      parseClaudeOAuthCallback(
        "https://platform.claude.com/oauth/code/callback?code=abc123%23xyz789",
      ),
    ).toEqual({ code: "abc123", state: "xyz789" });
  });

  test("rejects a bare code", () => {
    expect(() => parseClaudeOAuthCallback("abc123")).toThrow(/code#state/);
  });

  test("rejects the authorize link, whose code parameter is the literal true", () => {
    expect(() =>
      parseClaudeOAuthCallback(
        "https://claude.ai/oauth/authorize?code=true&state=abc&client_id=x",
      ),
    ).toThrow(/sign-in link/);
  });
});

describe("parseClaudeReset", () => {
  test("treats zoneless ISO timestamps as UTC", () => {
    expect(parseClaudeReset("2026-07-14T17:30:00")).toBe(Date.parse("2026-07-14T17:30:00Z"));
  });

  test("keeps offsets and epoch seconds", () => {
    expect(parseClaudeReset("2026-07-14T17:30:00.045562+00:00")).toBe(
      Date.parse("2026-07-14T17:30:00.045562+00:00"),
    );
    expect(parseClaudeReset(1_700_000_000)).toBe(1_700_000_000_000);
  });
});

describe("formatClaudePlan", () => {
  test("maps rate limit tiers", () => {
    expect(formatClaudePlan({ organization: { rate_limit_tier: "default_claude_max_20x" } })).toBe(
      "Max 20x",
    );
    expect(formatClaudePlan({ organization: { rate_limit_tier: "default_claude_max_5x" } })).toBe(
      "Max 5x",
    );
    expect(formatClaudePlan({ organization: { rate_limit_tier: "default_claude_pro" } })).toBe(
      "Pro",
    );
    expect(formatClaudePlan({ organization: { organization_type: "claude_team" } })).toBe("Team");
  });
});

describe("claudeMetersFromUsage", () => {
  test("maps session, weekly, model windows, fable scope, and extra usage", () => {
    const meters = claudeMetersFromUsage({
      five_hour: { utilization: 33, resets_at: "2026-07-14T17:30:00+00:00" },
      seven_day: { utilization: 88, resets_at: "2026-07-19T12:00:00+00:00" },
      seven_day_opus: null,
      seven_day_sonnet: { utilization: 1, resets_at: "2026-07-19T12:00:00+00:00" },
      limits: [
        {
          kind: "weekly_scoped",
          percent: 54,
          resets_at: "2026-07-19T12:00:00+00:00",
          scope: { model: { display_name: "Fable" } },
        },
        {
          kind: "weekly_scoped",
          percent: 9,
          scope: { model: { display_name: "Sonnet" } },
        },
      ],
      extra_usage: {
        is_enabled: true,
        monthly_limit: 50,
        used_credits: 12.5,
        utilization: 25,
      },
    });

    expect(meters.map((meter) => [meter.id, meter.usedPercent])).toEqual([
      ["session", 33],
      ["weekly", 88],
      ["sonnet", 1],
      ["fable", 54],
      ["extra", 25],
    ]);
    expect(meters[0]?.resetsAt).toBe(Date.parse("2026-07-14T17:30:00+00:00"));
    expect(meters.find((meter) => meter.id === "extra")).toMatchObject({
      kind: "credits",
      used: 12.5,
      limit: 50,
      remaining: 37.5,
    });
  });
});

describe("formatClaudeTokenError", () => {
  test("reads Anthropic's object error instead of printing [object Object]", () => {
    expect(
      formatClaudeTokenError(
        JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "Too many requests" },
        }),
      ),
    ).toBe("rate_limit_error: Too many requests");
  });
});

describe("exchangeClaudeCode", () => {
  test("uses an axios user agent and a JSON body on the token endpoint", async () => {
    let userAgent: string | null = null;
    let contentType: string | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      userAgent = headers.get("user-agent");
      contentType = headers.get("content-type");
      return Response.json(
        { error: { type: "rate_limit_error", message: "Too many requests" } },
        { status: 429 },
      );
    }) as typeof fetch;

    await expect(
      exchangeClaudeCode({ code: "code", state: "state", codeVerifier: "verifier" }),
    ).rejects.toThrow("rate_limit_error: Too many requests");
    expect(userAgent).toBe("axios/1.15.2");
    expect(contentType).toBe("application/json");
  });
});

describe("fetchClaudeUsage", () => {
  test("reports auth expiry and rate limits without throwing", async () => {
    globalThis.fetch = (async () => Response.json({ error: "unauthorized" }, { status: 401 })) as typeof fetch;
    const expired = await fetchClaudeUsage(account);
    expect(expired.status).toBe("error");
    expect(expired.error).toMatch(/re-authenticate/);

    globalThis.fetch = (async () => Response.json({ error: "rate_limit_error" }, { status: 429 })) as typeof fetch;
    const limited = await fetchClaudeUsage(account);
    expect(limited.error).toMatch(/rate limit/i);
  });

  test("sends the claude-code user agent and beta header", async () => {
    let headers: Headers | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return Response.json({
        five_hour: { utilization: 10, resets_at: "2026-07-14T17:30:00Z" },
        seven_day: { utilization: 20, resets_at: "2026-07-19T12:00:00Z" },
      });
    }) as typeof fetch;

    const usage = await fetchClaudeUsage(account);
    expect(usage.status).toBe("ok");
    expect(usage.meters.map((meter) => meter.id)).toEqual(["session", "weekly"]);
    expect(headers?.get("user-agent")).toBe("claude-code/2.1.69");
    expect(headers?.get("anthropic-beta")).toBe("oauth-2025-04-20");
    expect(headers?.get("authorization")).toBe("Bearer token");
  });
});
