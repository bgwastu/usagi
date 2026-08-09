CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, span TEXT NOT NULL, credentials TEXT NOT NULL, auth_status TEXT NOT NULL DEFAULT 'ok', auth_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS usage_snapshots (account_id TEXT PRIMARY KEY, usage TEXT NOT NULL, fetched_at INTEGER NOT NULL, next_fetch_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, verifier TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
