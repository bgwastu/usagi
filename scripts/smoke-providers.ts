import { readFileSync, writeFileSync } from "node:fs";
import { fetchTavilyUsage } from "../src/providers/tavily.ts";
import { fetchExaUsage } from "../src/providers/exa.ts";
import { fetchComposioUsage } from "../src/providers/composio.ts";
import { fetchOpenCodeGoUsage } from "../src/providers/opencode-go.ts";
import {
  fetchCodexUsage,
  refreshCodexCredentials,
} from "../src/providers/codex.ts";
import type { Account } from "../src/lib/types.ts";

const db = JSON.parse(readFileSync("./data/data.json", "utf8")) as {
  accounts: Account[];
};

for (const account of db.accounts) {
  try {
    let working = account;
    if (working.provider === "codex") {
      const refreshed = await refreshCodexCredentials(working);
      working = refreshed.account;
      console.log(
        "codex refresh changed=",
        refreshed.changed,
        "auth=",
        working.authStatus,
      );
      // persist refreshed tokens if changed
      if (refreshed.changed) {
        const idx = db.accounts.findIndex((a) => a.id === working.id);
        if (idx >= 0) db.accounts[idx] = working;
        writeFileSync("./data/data.json", JSON.stringify(db, null, 2));
      }
    }

    const usage =
      working.provider === "tavily"
        ? await fetchTavilyUsage(working)
        : working.provider === "exa"
          ? await fetchExaUsage(working)
          : working.provider === "composio"
            ? await fetchComposioUsage(working)
            : working.provider === "opencode-go"
              ? await fetchOpenCodeGoUsage(working)
              : await fetchCodexUsage(working);

    console.log(
      working.provider,
      usage.status,
      usage.plan ?? "",
      "meters=",
      usage.meters
        .map((m) => `${m.id}:${m.usedPercent ?? m.remaining ?? m.used}`)
        .join(",") || "(none)",
      usage.error ?? "",
    );
  } catch (e) {
    console.log(
      account.provider,
      "THROW",
      e instanceof Error ? e.message : e,
    );
  }
}
