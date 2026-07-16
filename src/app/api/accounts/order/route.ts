import { NextResponse } from "next/server";
import { reorderAccounts } from "@/lib/db";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { orderedIds?: string[] };
    if (!Array.isArray(body.orderedIds)) {
      return NextResponse.json({ error: "orderedIds required" }, { status: 400 });
    }
    const accounts = await reorderAccounts(body.orderedIds);
    return NextResponse.json({ accounts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reorder";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
