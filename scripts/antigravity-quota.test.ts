import { afterEach, describe, expect, test } from "bun:test";
import { fetchAntigravityUsage } from "../src/providers/antigravity.ts";
import type { Account } from "../src/lib/types.ts";

const account: Extract<Account, { provider: "antigravity" }> = {
  id: "acc",
  provider: "antigravity",
  name: "Test",
  span: "2x1",
  credentials: {
    accessToken: "token",
    refreshToken: "refresh",
    projectId: "proj",
  },
  createdAt: 0,
  updatedAt: 0,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function installFetch(handler: (url: string) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return handler(url);
  }) as typeof fetch;
}

describe("fetchAntigravityUsage", () => {
  test("omitted remainingFraction is empty and beats a sibling still at 1", async () => {
    installFetch((url) => {
      if (url.includes("loadCodeAssist")) {
        return json({
          cloudaicompanionProject: "proj",
          currentTier: { id: "free-tier" },
        });
      }
      if (url.includes("retrieveUserQuotaSummary")) {
        return json({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-5h",
                  displayName: "Five Hour Limit Remaining",
                  resetTime: "2026-09-27T18:00:00Z",
                },
                {
                  bucketId: "gemini-weekly",
                  displayName: "Weekly Limit Remaining",
                  remainingFraction: 1,
                  resetTime: "2026-10-04T18:00:00Z",
                },
                { displayName: "not a bucket" },
              ],
            },
          ],
        });
      }
      if (url.includes("retrieveUserQuota")) {
        return json({
          buckets: [
            {
              modelId: "gemini-2.5-pro",
              resetTime: "2026-09-27T18:00:00Z",
            },
          ],
        });
      }
      if (url.includes("fetchAvailableModels")) {
        return json({
          models: {
            "gemini-2.5-pro": {
              displayName: "Gemini 2.5 Pro",
              quotaInfo: {
                remainingFraction: 1,
                resetTime: "2026-09-27T18:00:00Z",
              },
            },
          },
        });
      }
      return json({ error: url }, 404);
    });

    const usage = await fetchAntigravityUsage(account);
    expect(usage.status).toBe("ok");
    expect(usage.meters.map((meter) => [meter.id, meter.usedPercent, meter.label])).toEqual([
      ["family_gemini", 100, "Gemini · 5-hour"],
    ]);
    expect(usage.detailMeters?.map((meter) => meter.usedPercent)).toEqual([100]);
  });

  test("a reported full fraction stays 100% left", async () => {
    installFetch((url) => {
      if (url.includes("loadCodeAssist")) {
        return json({ cloudaicompanionProject: "proj" });
      }
      if (url.includes("retrieveUserQuotaSummary")) {
        return json({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-5h",
                  displayName: "Five Hour Limit Remaining",
                  remainingFraction: 1,
                  resetTime: "2026-09-27T18:00:00Z",
                },
              ],
            },
          ],
        });
      }
      if (url.includes("retrieveUserQuota")) return json({ buckets: [] });
      if (url.includes("fetchAvailableModels")) return json({ models: {} });
      return json({ error: url }, 404);
    });

    const usage = await fetchAntigravityUsage(account);
    expect(usage.status).toBe("ok");
    expect(usage.meters.map((meter) => meter.usedPercent)).toEqual([0]);
  });

  test("when the summary request fails, a live omitted fraction still beats catalog 1.0", async () => {
    installFetch((url) => {
      if (url.includes("loadCodeAssist")) {
        return json({ cloudaicompanionProject: "proj" });
      }
      if (url.includes("retrieveUserQuotaSummary")) return json({}, 500);
      if (url.includes("retrieveUserQuota")) {
        return json({
          buckets: [
            {
              modelId: "gemini-2.5-pro",
              resetTime: "2026-09-27T18:00:00Z",
            },
          ],
        });
      }
      if (url.includes("fetchAvailableModels")) {
        return json({
          models: {
            "gemini-2.5-pro": {
              displayName: "Gemini 2.5 Pro",
              quotaInfo: { remainingFraction: 1, resetTime: "2026-09-27T18:00:00Z" },
            },
          },
        });
      }
      return json({ error: url }, 404);
    });

    const usage = await fetchAntigravityUsage(account);
    expect(usage.status).toBe("ok");
    expect(usage.meters.map((meter) => [meter.id, meter.usedPercent])).toEqual([
      ["family_gemini", 100],
    ]);
    expect(usage.detailMeters?.map((meter) => meter.usedPercent)).toEqual([100]);
  });
});
