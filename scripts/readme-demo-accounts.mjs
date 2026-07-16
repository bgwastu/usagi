/**
 * README screenshot fixture only — not imported by the Next.js app.
 * Used by scripts/capture-readme-screenshots.mjs via browser API mocking.
 */
export function readmeDemoAccounts(now = Date.now()) {
  return {
    accounts: [
      {
        account: {
          id: "demo-codex",
          provider: "codex",
          name: "you@example.com",
          span: "2x1",
          credentials: {
            accessToken: "demo",
            refreshToken: "demo",
            email: "you@example.com",
            expiresAt: now + 7 * 24 * 60 * 60 * 1000,
          },
          authStatus: "ok",
          createdAt: now,
          updatedAt: now,
        },
        usage: {
          accountId: "demo-codex",
          provider: "codex",
          accountLabel: "you@example.com",
          plan: "Plus",
          meters: [
            {
              id: "session",
              label: "5-hour",
              kind: "window",
              usedPercent: 21,
              windowSeconds: 5 * 60 * 60,
              resetsAt: now + 3 * 60 * 60 * 1000 + 12 * 60 * 1000,
            },
            {
              id: "weekly",
              label: "Weekly",
              kind: "window",
              usedPercent: 47,
              windowSeconds: 7 * 24 * 60 * 60,
              resetsAt: now + 2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000,
            },
          ],
          fetchedAt: now,
          status: "ok",
        },
      },
      {
        account: {
          id: "demo-opencode",
          provider: "opencode-go",
          name: "home workspace",
          span: "2x1",
          credentials: { cookie: "demo" },
          authStatus: "ok",
          createdAt: now,
          updatedAt: now,
        },
        usage: {
          accountId: "demo-opencode",
          provider: "opencode-go",
          accountLabel: "you@example.com",
          meters: [
            {
              id: "session",
              label: "5-hour",
              kind: "window",
              usedPercent: 8,
              windowSeconds: 5 * 60 * 60,
              resetsAt: now + 4 * 60 * 60 * 1000 + 40 * 60 * 1000,
            },
            {
              id: "weekly",
              label: "Weekly",
              kind: "window",
              usedPercent: 34,
              windowSeconds: 7 * 24 * 60 * 60,
              resetsAt: now + 4 * 24 * 60 * 60 * 1000,
            },
            {
              id: "monthly",
              label: "Monthly",
              kind: "window",
              usedPercent: 62,
              windowSeconds: 30 * 24 * 60 * 60,
              resetsAt: now + 11 * 24 * 60 * 60 * 1000,
            },
          ],
          fetchedAt: now,
          status: "ok",
        },
      },
      {
        account: {
          id: "demo-tavily",
          provider: "tavily",
          name: "research",
          span: "1x1",
          credentials: { apiKey: "demo" },
          authStatus: "ok",
          createdAt: now,
          updatedAt: now,
        },
        usage: {
          accountId: "demo-tavily",
          provider: "tavily",
          accountLabel: "research",
          plan: "Researcher",
          meters: [
            {
              id: "plan",
              label: "Plan credits",
              kind: "credits",
              used: 1240,
              remaining: 3760,
              limit: 5000,
              usedPercent: 24.8,
              unit: "credits",
            },
          ],
          fetchedAt: now,
          status: "ok",
        },
      },
    ],
  };
}
