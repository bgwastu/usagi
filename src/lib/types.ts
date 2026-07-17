export type ProviderId =
  | "opencode-go"
  | "codex"
  | "tavily"
  | "exa"
  | "composio";

export type MeterKind = "window" | "credits" | "balance";

export type UsageMeter = {
  id: string;
  label: string;
  kind: MeterKind;
  usedPercent?: number;
  windowSeconds?: number;
  resetsAt?: number | null;
  used?: number;
  remaining?: number;
  limit?: number;
  unit?: string;
};

export type TileSpan = "1x1" | "2x1" | "1x2" | "2x2";

export type OpenCodeGoCredentials = {
  cookie: string;
  /** Optional override; when unset, the default workspace is discovered. */
  workspaceId?: string;
};

export type CodexCredentials = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  expiresAt?: number;
  lastRefresh?: number;
};

export type TavilyCredentials = {
  apiKey: string;
};

export type ExaCredentials = {
  /** Team Management service key (preferred) or a search API key. */
  apiKey: string;
  /** Optional search-key UUID when `apiKey` is a service key. */
  keyId?: string;
};

export type ComposioPlanId = "free" | "cheap" | "serious" | "enterprise";

export type ComposioCredentials = {
  /** Org API key (`oak_…`, preferred) or project API key (`ak_…`). */
  apiKey: string;
  /**
   * Optional plan override for monthly quota bars.
   * When unset, Usagi assumes Totally Free (or escalates if MTD usage exceeds that tier).
   */
  plan?: ComposioPlanId;
};

export type AccountBase = {
  id: string;
  name: string;
  span: TileSpan;
  authStatus?: "ok" | "reauth_required";
  authError?: string;
  createdAt: number;
  updatedAt: number;
};

export type Account =
  | (AccountBase & {
      provider: "opencode-go";
      credentials: OpenCodeGoCredentials;
    })
  | (AccountBase & {
      provider: "codex";
      credentials: CodexCredentials;
    })
  | (AccountBase & {
      provider: "tavily";
      credentials: TavilyCredentials;
    })
  | (AccountBase & {
      provider: "exa";
      credentials: ExaCredentials;
    })
  | (AccountBase & {
      provider: "composio";
      credentials: ComposioCredentials;
    });

export type AccountUsage = {
  accountId: string;
  provider: ProviderId;
  accountLabel?: string;
  plan?: string;
  meters: UsageMeter[];
  fetchedAt: number;
  error?: string;
  status: "ok" | "error" | "unavailable";
};

export type AccountCardModel = {
  account: Account;
  usage: AccountUsage | null;
};

export type DatabaseSchema = {
  version: 1;
  accounts: Account[];
};

export const PROVIDER_META: Record<
  ProviderId,
  {
    displayName: string;
    credentialHint: string;
    /** Minimum gap between live provider fetches (UI may poll faster). */
    minRefreshMs: number;
    /** Extra backoff after a provider rate-limit response. */
    rateLimitBackoffMs?: number;
  }
> = {
  codex: {
    displayName: "Codex",
    credentialHint: "OAuth · auto-refresh",
    minRefreshMs: 5_000,
  },
  "opencode-go": {
    displayName: "OpenCode Go",
    credentialHint: "Session cookie · auto workspace",
    minRefreshMs: 5_000,
  },
  tavily: {
    displayName: "Tavily",
    credentialHint: "API key · monthly credits",
    // Usage endpoint: 10 req / 10 min — refresh at most every 2 minutes.
    minRefreshMs: 120_000,
    rateLimitBackoffMs: 10 * 60_000,
  },
  exa: {
    displayName: "Exa",
    credentialHint: "Service key · 3d / 7d / 30d spend",
    minRefreshMs: 60_000,
  },
  composio: {
    displayName: "Composio",
    credentialHint: "Org API key · monthly tool-call quota",
    minRefreshMs: 60_000,
  },
};

export const DEFAULT_SPAN: Record<ProviderId, TileSpan> = {
  codex: "2x1",
  "opencode-go": "2x1",
  tavily: "1x1",
  exa: "1x2",
  composio: "1x2",
};
