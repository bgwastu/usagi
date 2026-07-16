import { createHash, randomBytes } from "node:crypto";

const pending = new Map<
  string,
  { codeVerifier: string; createdAt: number }
>();

const TTL_MS = 15 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [state, value] of pending) {
    if (now - value.createdAt > TTL_MS) pending.delete(state);
  }
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createPkceChallenge(): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  prune();
  const state = base64url(randomBytes(16));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  pending.set(state, { codeVerifier, createdAt: Date.now() });
  return { state, codeVerifier, codeChallenge };
}

export function takePkceVerifier(state: string): string | null {
  prune();
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  return entry.codeVerifier;
}

export function parseOAuthCallbackUrl(raw: string): {
  code: string;
  state: string;
} {
  const url = new URL(raw.trim());
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(`OAuth error: ${error}`);
  }
  if (!code || !state) {
    throw new Error("Callback URL must include code and state");
  }
  return { code, state };
}
