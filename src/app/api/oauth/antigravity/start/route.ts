import { NextResponse } from "next/server";
import { buildAntigravityAuthorizeUrl } from "@/providers/antigravity";
import { createOAuthState } from "@/lib/oauth-pkce";

export const runtime = "nodejs";

export async function POST() {
  const { state } = createOAuthState();
  const authorizeUrl = buildAntigravityAuthorizeUrl({ state });
  return NextResponse.json({ authorizeUrl, state });
}
