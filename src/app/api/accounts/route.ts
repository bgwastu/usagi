import { NextResponse } from "next/server";
import { listAccounts, saveAccount } from "@/lib/db";
import { fetchUsageForAccount } from "@/lib/usage";
import {
  DEFAULT_SPAN,
  type Account,
  type ComposioPlanId,
  type ProviderId,
} from "@/lib/types";
import { randomUUID } from "node:crypto";
import {
  exchangeCodexCode,
  extractCodexIdentity,
} from "@/providers/codex";
import { normalizeCursorCookie } from "@/providers/cursor";
import { parseOAuthCallbackUrl, takePkceVerifier } from "@/lib/oauth-pkce";

export const runtime = "nodejs";

export async function GET() {
  try {
    const accounts = await listAccounts();
    const cards = await Promise.all(
      accounts.map(async (account) => {
        const { account: nextAccount, usage } =
          await fetchUsageForAccount(account);
        return { account: nextAccount, usage };
      }),
    );
    return NextResponse.json({ accounts: cards });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type CreateBody =
  | {
      provider: "opencode-go";
      name: string;
      cookie: string;
      workspaceId?: string;
      span?: Account["span"];
    }
  | {
      provider: "cursor";
      name: string;
      cookie: string;
      span?: Account["span"];
    }
  | {
      provider: "tavily";
      name: string;
      apiKey: string;
      span?: Account["span"];
    }
  | {
      provider: "exa";
      name: string;
      apiKey: string;
      keyId?: string;
      span?: Account["span"];
    }
  | {
      provider: "composio";
      name: string;
      apiKey: string;
      plan?: ComposioPlanId;
      span?: Account["span"];
    }
  | {
      provider: "codex";
      name?: string;
      oauthCallbackUrl: string;
      span?: Account["span"];
    }
  | {
      provider: "codex";
      name?: string;
      accessToken: string;
      refreshToken: string;
      span?: Account["span"];
    };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBody;
    const now = Date.now();
    let account: Account;

    if (body.provider === "opencode-go") {
      const workspaceId = body.workspaceId?.trim();
      account = {
        id: randomUUID(),
        provider: "opencode-go",
        name: body.name.trim(),
        span: body.span ?? DEFAULT_SPAN["opencode-go"],
        credentials: {
          cookie: body.cookie.trim(),
          ...(workspaceId ? { workspaceId } : {}),
        },
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else if (body.provider === "cursor") {
      const cookie = normalizeCursorCookie(body.cookie);
      if (!cookie) {
        return NextResponse.json(
          { error: "Paste the WorkosCursorSessionToken cookie" },
          { status: 400 },
        );
      }
      account = {
        id: randomUUID(),
        provider: "cursor",
        name: body.name.trim(),
        span: body.span ?? DEFAULT_SPAN.cursor,
        credentials: { cookie },
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else if (body.provider === "tavily") {
      account = {
        id: randomUUID(),
        provider: "tavily",
        name: body.name.trim(),
        span: body.span ?? DEFAULT_SPAN.tavily,
        credentials: { apiKey: body.apiKey.trim() },
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else if (body.provider === "exa") {
      const keyId = body.keyId?.trim();
      account = {
        id: randomUUID(),
        provider: "exa",
        name: body.name.trim(),
        span: body.span ?? DEFAULT_SPAN.exa,
        credentials: {
          apiKey: body.apiKey.trim(),
          ...(keyId ? { keyId } : {}),
        },
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else if (body.provider === "composio") {
      const plan = body.plan;
      account = {
        id: randomUUID(),
        provider: "composio",
        name: body.name.trim(),
        span: body.span ?? DEFAULT_SPAN.composio,
        credentials: {
          apiKey: body.apiKey.trim(),
          ...(plan ? { plan } : {}),
        },
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else if ("oauthCallbackUrl" in body && body.oauthCallbackUrl) {
      const { code, state } = parseOAuthCallbackUrl(body.oauthCallbackUrl);
      const verifier = takePkceVerifier(state);
      if (!verifier) {
        return NextResponse.json(
          { error: "OAuth state expired — start login again" },
          { status: 400 },
        );
      }
      const credentials = await exchangeCodexCode({
        code,
        codeVerifier: verifier,
      });
      account = {
        id: randomUUID(),
        provider: "codex",
        name: body.name?.trim() || credentials.email || "Codex",
        span: body.span ?? DEFAULT_SPAN.codex,
        credentials,
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else if ("accessToken" in body && body.accessToken && body.refreshToken) {
      const identity = extractCodexIdentity(body.accessToken);
      account = {
        id: randomUUID(),
        provider: "codex",
        name: body.name?.trim() || identity.email || "Codex",
        span: body.span ?? DEFAULT_SPAN.codex,
        credentials: {
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          accountId: identity.accountId,
          email: identity.email,
          expiresAt: identity.expiresAt,
          lastRefresh: now,
        },
        authStatus: "ok",
        createdAt: now,
        updatedAt: now,
      };
    } else {
      return NextResponse.json({ error: "Invalid create payload" }, { status: 400 });
    }

    await saveAccount(account);
    const { account: nextAccount, usage } = await fetchUsageForAccount(account, {
      force: true,
    });
    return NextResponse.json({ account: nextAccount, usage });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export type { ProviderId };
