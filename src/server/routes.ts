import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { authStatus, login, logout, requireAuth } from "@/server/auth";
import { buildAccountShell, fetchUsageForAccount, refreshAccountUsages, invalidateUsageCache, publicAccount } from "@/lib/usage";
import { deleteAccount, getAccount, listAccounts, reorderAccounts, saveAccount } from "@/lib/db";
import { DEFAULT_SPAN, type Account, type AccountUsage, type ComposioPlanId } from "@/lib/types";
import { exchangeAntigravityCode, buildAntigravityAuthorizeUrl } from "@/providers/antigravity";
import { exchangeCodexCode, buildCodexAuthorizeUrl } from "@/providers/codex";
import { normalizeCursorCookie } from "@/providers/cursor";
import { createOAuthState, createPkceChallenge, parseOAuthCallbackUrl } from "@/lib/oauth-pkce";
import { saveOAuthState, takeOAuthState } from "@/lib/db";

export const api = new Hono();
const publicResult = (result: { account: Account; usage: AccountUsage }) => ({ ...result, account: publicAccount(result.account) });

api.get("/auth/status", authStatus);
api.post("/auth/login", async (c) => {
  const body = await c.req.json<{ password?: string }>();
  if (!login(c, body.password ?? "")) return c.json({ error: "Invalid password" }, 401);
  return c.json({ ok: true });
});
api.post("/auth/logout", (c) => { logout(c); return c.json({ ok: true }); });

api.use("/accounts/*", requireAuth);
api.use("/accounts", requireAuth);
api.use("/oauth/*", requireAuth);

api.get("/accounts", async (c) => c.json({ accounts: await buildAccountShell(await listAccounts()) }));

api.get("/accounts/usage", async (c) => {
  const force = c.req.query("force") === "1";
  return c.json({ accounts: await refreshAccountUsages(await listAccounts(), { force }) });
});

api.put("/accounts/order", async (c) => {
  const body = await c.req.json<{ orderedIds?: string[] }>();
  if (!Array.isArray(body.orderedIds)) return c.json({ error: "orderedIds required" }, 400);
  return c.json({ accounts: await reorderAccounts(body.orderedIds) });
});

api.get("/accounts/:id", async (c) => {
  const account = await getAccount(c.req.param("id"));
  if (!account) return c.json({ error: "Not found" }, 404);
  return c.json(publicResult(await fetchUsageForAccount(account, { force: true })));
});

api.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await getAccount(id);
  if (!account) return c.json({ error: "Not found" }, 404);
  await deleteAccount(id); invalidateUsageCache(id);
  return c.json({ ok: true });
});

type CreateBody = Record<string, unknown> & { provider: Account["provider"]; name?: string; span?: Account["span"] };

api.post("/accounts", async (c) => {
  const body = await c.req.json<CreateBody>();
  const now = Date.now();
  let account: Account;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (body.provider === "opencode-go") {
    account = { id: randomUUID(), provider: body.provider, name, span: body.span ?? DEFAULT_SPAN[body.provider], credentials: { cookie: String(body.cookie ?? "").trim(), ...(body.workspaceId ? { workspaceId: String(body.workspaceId).trim() } : {}) }, authStatus: "ok", createdAt: now, updatedAt: now };
  } else if (body.provider === "cursor") {
    const cookie = normalizeCursorCookie(String(body.cookie ?? ""));
    if (!cookie) return c.json({ error: "Paste the WorkosCursorSessionToken cookie" }, 400);
    account = { id: randomUUID(), provider: body.provider, name, span: body.span ?? DEFAULT_SPAN[body.provider], credentials: { cookie }, authStatus: "ok", createdAt: now, updatedAt: now };
  } else if (body.provider === "tavily" || body.provider === "exa" || body.provider === "composio") {
    const apiKey = String(body.apiKey ?? "").trim();
    if (!apiKey) return c.json({ error: "API key required" }, 400);
    account = { id: randomUUID(), provider: body.provider, name, span: body.span ?? DEFAULT_SPAN[body.provider], credentials: { apiKey, ...(body.provider === "exa" && body.keyId ? { keyId: String(body.keyId).trim() } : {}), ...(body.provider === "composio" && body.plan ? { plan: body.plan as ComposioPlanId } : {}) } as Account["credentials"], authStatus: "ok", createdAt: now, updatedAt: now } as Account;
  } else if (body.provider === "codex" && typeof body.oauthCallbackUrl === "string") {
    const { code, state } = parseOAuthCallbackUrl(body.oauthCallbackUrl);
    const verifier = await takeOAuthState(state, "codex");
    if (!verifier) return c.json({ error: "OAuth state expired — start login again" }, 400);
    const credentials = await exchangeCodexCode({ code, codeVerifier: verifier });
    account = { id: randomUUID(), provider: "codex", name: name || credentials.email || "Codex", span: body.span ?? DEFAULT_SPAN.codex, credentials, authStatus: "ok", createdAt: now, updatedAt: now };
  } else if (body.provider === "antigravity" && typeof body.oauthCallbackUrl === "string") {
    const { code, state } = parseOAuthCallbackUrl(body.oauthCallbackUrl);
    if (!(await takeOAuthState(state, "antigravity"))) return c.json({ error: "OAuth state expired — start login again" }, 400);
    const credentials = await exchangeAntigravityCode({ code });
    account = { id: randomUUID(), provider: "antigravity", name: name || credentials.email || "Antigravity", span: body.span ?? DEFAULT_SPAN.antigravity, credentials, authStatus: "ok", createdAt: now, updatedAt: now };
  } else return c.json({ error: "Invalid create payload" }, 400);
  await saveAccount(account);
  return c.json(publicResult(await fetchUsageForAccount(account, { force: true })));
});

api.patch("/accounts/:id", async (c) => {
  const existing = await getAccount(c.req.param("id"));
  if (!existing) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  let next: Account = { ...existing, name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name, span: body.span === "1x1" || body.span === "2x1" || body.span === "1x2" || body.span === "2x2" ? body.span : existing.span, updatedAt: Date.now() };
  if (next.provider === "opencode-go" && typeof body.cookie === "string" && body.cookie.trim()) next = { ...next, credentials: { cookie: body.cookie.trim(), ...(typeof body.workspaceId === "string" && body.workspaceId.trim() ? { workspaceId: body.workspaceId.trim() } : {}) } };
  if (next.provider === "cursor" && typeof body.cookie === "string" && body.cookie.trim()) next = { ...next, credentials: { cookie: normalizeCursorCookie(body.cookie) } };
  if ((next.provider === "tavily" || next.provider === "exa" || next.provider === "composio") && typeof body.apiKey === "string" && body.apiKey.trim()) next = { ...next, credentials: { ...next.credentials, apiKey: body.apiKey.trim(), ...(next.provider === "exa" && typeof body.keyId === "string" ? { keyId: body.keyId.trim() || undefined } : {}), ...(next.provider === "composio" && typeof body.plan === "string" && body.plan ? { plan: body.plan as ComposioPlanId } : {}) } } as Account;
  if (next.provider === "codex" && typeof body.oauthCallbackUrl === "string" && body.oauthCallbackUrl.trim()) { const { code, state } = parseOAuthCallbackUrl(body.oauthCallbackUrl); const verifier = await takeOAuthState(state, "codex"); if (!verifier) return c.json({ error: "OAuth state expired — start login again" }, 400); next = { ...next, credentials: await exchangeCodexCode({ code, codeVerifier: verifier }), authStatus: "ok", authError: undefined }; }
  if (next.provider === "antigravity" && typeof body.oauthCallbackUrl === "string" && body.oauthCallbackUrl.trim()) { const { code, state } = parseOAuthCallbackUrl(body.oauthCallbackUrl); if (!(await takeOAuthState(state, "antigravity"))) return c.json({ error: "OAuth state expired — start login again" }, 400); next = { ...next, credentials: await exchangeAntigravityCode({ code }), authStatus: "ok", authError: undefined }; }
  await saveAccount(next); invalidateUsageCache(next.id);
  return c.json(publicResult(await fetchUsageForAccount(next, { force: true })));
});

api.post("/oauth/codex/start", async (c) => { const { state, codeChallenge, codeVerifier } = createPkceChallenge(); await saveOAuthState(state, codeVerifier, "codex"); return c.json({ authorizeUrl: buildCodexAuthorizeUrl({ state, codeChallenge }), state }); });
api.post("/oauth/antigravity/start", async (c) => { const { state } = createOAuthState(); await saveOAuthState(state, null, "antigravity"); return c.json({ authorizeUrl: buildAntigravityAuthorizeUrl({ state }), state }); });
