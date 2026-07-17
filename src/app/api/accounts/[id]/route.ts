import { NextResponse } from "next/server";
import {
  deleteAccount,
  getAccount,
  saveAccount,
} from "@/lib/db";
import { fetchUsageForAccount, invalidateUsageCache } from "@/lib/usage";
import type { Account } from "@/lib/types";
import { exchangeCodexCode } from "@/providers/codex";
import { parseOAuthCallbackUrl, takePkceVerifier } from "@/lib/oauth-pkce";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const account = await getAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await fetchUsageForAccount(account, { force: true });
  return NextResponse.json(result);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const existing = await getAccount(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    let next: Account = { ...existing, updatedAt: Date.now() };

    if (typeof body.name === "string" && body.name.trim()) {
      next = { ...next, name: body.name.trim() };
    }
    if (
      body.span === "1x1" ||
      body.span === "2x1" ||
      body.span === "1x2" ||
      body.span === "2x2"
    ) {
      next = { ...next, span: body.span };
    }

    if (next.provider === "opencode-go") {
      const cookie =
        typeof body.cookie === "string" ? body.cookie.trim() : next.credentials.cookie;
      const workspaceId =
        typeof body.workspaceId === "string"
          ? body.workspaceId.trim() || undefined
          : next.credentials.workspaceId;
      next = {
        ...next,
        provider: "opencode-go",
        credentials: {
          cookie,
          ...(workspaceId ? { workspaceId } : {}),
        },
      };
    } else if (next.provider === "tavily") {
      const apiKey =
        typeof body.apiKey === "string" ? body.apiKey.trim() : next.credentials.apiKey;
      next = {
        ...next,
        provider: "tavily",
        credentials: { apiKey },
      };
    } else if (next.provider === "exa") {
      const apiKey =
        typeof body.apiKey === "string" ? body.apiKey.trim() : next.credentials.apiKey;
      const keyId =
        typeof body.keyId === "string"
          ? body.keyId.trim() || undefined
          : next.credentials.keyId;
      next = {
        ...next,
        provider: "exa",
        credentials: {
          apiKey,
          ...(keyId ? { keyId } : {}),
        },
      };
    } else if (next.provider === "composio") {
      const apiKey =
        typeof body.apiKey === "string"
          ? body.apiKey.trim()
          : next.credentials.apiKey;
      const plan =
        body.plan === "free" ||
        body.plan === "cheap" ||
        body.plan === "serious" ||
        body.plan === "enterprise"
          ? body.plan
          : body.plan === ""
            ? undefined
            : next.credentials.plan;
      next = {
        ...next,
        provider: "composio",
        credentials: {
          apiKey,
          ...(plan ? { plan } : {}),
        },
      };
    } else if (next.provider === "codex") {
      if (typeof body.oauthCallbackUrl === "string" && body.oauthCallbackUrl.trim()) {
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
        next = {
          ...next,
          provider: "codex",
          name: credentials.email ?? next.name,
          credentials,
          authStatus: "ok",
          authError: undefined,
        };
      }
    }

    await saveAccount(next);
    invalidateUsageCache(next.id);
    const result = await fetchUsageForAccount(next, { force: true });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const ok = await deleteAccount(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  invalidateUsageCache(id);
  return NextResponse.json({ ok: true });
}
