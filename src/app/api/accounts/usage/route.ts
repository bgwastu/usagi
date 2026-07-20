import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/db";
import { refreshAccountUsages } from "@/lib/usage";

export const runtime = "nodejs";

/**
 * Live usage refresh (stale-while-revalidate companion to GET /api/accounts).
 * Board should already be painted from the shell; this fills/updates meters.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const accounts = await listAccounts();
    const cards = await refreshAccountUsages(accounts, { force });
    return NextResponse.json({ accounts: cards });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
