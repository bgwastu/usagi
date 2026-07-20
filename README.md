# Usagi

Self-hosted usage board for provider accounts.

![Usagi board](docs/screenshots/board.png)

## Run

```bash
bun install
bun run dev
```

Or with Docker:

```bash
docker run --rm -p 3000:3000 -v usagi-data:/app/data ghcr.io/bgwastu/usagi:latest
```

Open [http://localhost:3000](http://localhost:3000). Accounts live in `data/data.json` (gitignored).

Optional: set `ENCRYPTION_KEY` to encrypt that file at rest. If decryption fails, the app exits.

## Providers

- **Codex** — OAuth (PKCE), auto-refresh · 5-hour + weekly windows
- **OpenCode Go** — session cookie; workspace ID optional · 5-hour + weekly (+ monthly if present)
- **Cursor** — `WorkosCursorSessionToken` cookie · plan / Auto+Composer / API / on-demand (unofficial dashboard API)
- **Tavily** — API key · plan / key credits
- **Exa** — Team Management service key · spend windows (fast 30d first, then 3d/7d); key budget bar when `budgetCents` is set (optional key ID)
- **Composio** — Org API key (`oak_…`) · monthly tool-call / pro-tool quota bars

## Notes

- Runs without login — keep it on localhost or a trusted network.
- Board shell (accounts + last-known meters) loads instantly; live usage refreshes in the background via `/api/accounts/usage`.
- UI polls usage every 5s; Tavily live-fetches at most every 2 minutes (10 req / 10 min on `/usage`).
- Usage cache persists in `data/usage-cache.json` so cold restarts still show stale meters.
- Light/dark follows system preference.
