import { NextResponse } from "next/server";
import { buildCodexAuthorizeUrl } from "@/providers/codex";
import { createPkceChallenge } from "@/lib/oauth-pkce";

export const runtime = "nodejs";

export async function POST() {
  const { state, codeChallenge } = createPkceChallenge();
  const authorizeUrl = buildCodexAuthorizeUrl({ state, codeChallenge });
  return NextResponse.json({ authorizeUrl, state });
}
