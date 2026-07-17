"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ProviderIcon } from "@/components/provider-icons";
import type { ComposioPlanId, ProviderId } from "@/lib/types";
import { PROVIDER_META } from "@/lib/types";

export type WizardMode = "create" | "edit";

export type WizardDraft = {
  provider: ProviderId;
  name: string;
  cookie?: string;
  workspaceId?: string;
  oauthCallbackUrl?: string;
  apiKey?: string;
  keyId?: string;
  composioPlan?: ComposioPlanId | "";
};

type AccountWizardProps = {
  open: boolean;
  mode: WizardMode;
  initial?: Partial<WizardDraft>;
  onClose: () => void;
  onSubmit: (draft: WizardDraft) => Promise<void> | void;
};

type Step = "provider" | "credentials";

const fieldClass =
  "w-full rounded-md border border-rule bg-paper-2 px-3.5 py-2.5 text-ink transition-colors hover:border-accent/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const secondaryBtnClass =
  "cursor-pointer rounded-md border border-rule bg-transparent px-3.5 py-2 text-sm text-ink transition-[transform,background-color] duration-[120ms] ease-[var(--ease-out)] hover:-translate-y-px hover:bg-paper-2 active:translate-y-0";

const primaryBtnClass =
  "cursor-pointer rounded-md border border-accent bg-accent px-4 py-2.5 font-display font-semibold text-accent-ink transition-[transform,filter] duration-[120ms] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50";

function WizardPanel({
  mode,
  initial,
  onClose,
  onSubmit,
}: Omit<AccountWizardProps, "open">) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>(
    mode === "edit" || initial?.provider ? "credentials" : "provider",
  );
  const [provider, setProvider] = useState<ProviderId>(
    initial?.provider ?? "codex",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [cookie, setCookie] = useState(initial?.cookie ?? "");
  const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [keyId, setKeyId] = useState(initial?.keyId ?? "");
  const [composioPlan, setComposioPlan] = useState<ComposioPlanId | "">(
    initial?.composioPlan ?? "",
  );
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState(
    initial?.oauthCallbackUrl ?? "",
  );
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function selectProvider(next: ProviderId) {
    setProvider(next);
    setStep("credentials");
    setError(null);
    setAuthorizeUrl(null);
    if (next === "codex" && mode === "create") {
      try {
        const res = await fetch("/api/oauth/codex/start", { method: "POST" });
        const json = (await res.json()) as {
          authorizeUrl?: string;
          error?: string;
        };
        if (!res.ok || !json.authorizeUrl) {
          setError(json.error ?? "Failed to start Codex OAuth");
          return;
        }
        setAuthorizeUrl(json.authorizeUrl);
      } catch {
        setError("Failed to start Codex OAuth");
      }
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Account name is required.");
      return;
    }

    if (provider === "opencode-go" && !cookie.trim()) {
      setError("Paste the opencode.ai session cookie.");
      return;
    }

    if (provider === "tavily" && !apiKey.trim()) {
      setError("Paste your Tavily API key.");
      return;
    }

    if (provider === "exa" && !apiKey.trim()) {
      setError("Paste your Exa Team Management service key.");
      return;
    }

    if (provider === "composio" && !apiKey.trim()) {
      setError("Paste your Composio org API key (oak_…).");
      return;
    }

    if (
      provider === "codex" &&
      mode === "create" &&
      !oauthCallbackUrl.trim()
    ) {
      setError("Paste the OAuth callback URL after signing in.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (provider === "opencode-go") {
        await onSubmit({
          provider,
          name: trimmedName,
          cookie: cookie.trim(),
          workspaceId: workspaceId.trim(),
        });
        return;
      }

      if (provider === "tavily") {
        await onSubmit({
          provider,
          name: trimmedName,
          apiKey: apiKey.trim(),
        });
        return;
      }

      if (provider === "exa") {
        await onSubmit({
          provider,
          name: trimmedName,
          apiKey: apiKey.trim(),
          keyId: keyId.trim() || undefined,
        });
        return;
      }

      if (provider === "composio") {
        await onSubmit({
          provider,
          name: trimmedName,
          apiKey: apiKey.trim(),
          composioPlan: composioPlan || "",
        });
        return;
      }

      await onSubmit({
        provider,
        name: trimmedName,
        oauthCallbackUrl: oauthCallbackUrl.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-[clamp(1rem,3vw,2rem)]">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer border-0 bg-scrim motion-safe:animate-[fade-in_220ms_var(--ease-out)_both]"
        aria-label="Close wizard"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative max-h-[min(90vh,44rem)] w-full max-w-[34rem] overflow-auto rounded-2xl border border-rule bg-paper p-8 shadow-[0_24px_64px_oklch(22%_0.02_45_/_0.22)] motion-safe:animate-[modal-in_420ms_var(--ease-out)_both]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs tracking-[0.08em] text-muted uppercase">
              {mode === "create" ? "Add account" : "Edit account"}
            </p>
            <h2
              id={titleId}
              className="m-0 font-display text-2xl font-semibold tracking-[-0.03em]"
            >
              {step === "provider"
                ? "Choose a provider"
                : PROVIDER_META[provider].displayName}
            </h2>
          </div>
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            Close
          </button>
        </header>

        {step === "provider" ? (
          <div className="grid gap-3">
            {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="grid cursor-pointer grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-4 gap-y-0.5 rounded-md border border-rule bg-paper-2 p-4 text-left transition-[transform,border-color] duration-[120ms] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-accent/55"
                onClick={() => void selectProvider(id)}
              >
                <span className="row-span-2 grid size-11 place-items-center rounded-md border border-rule bg-paper-3 text-ink">
                  <ProviderIcon provider={id} size={20} />
                </span>
                <span className="font-display text-lg font-semibold">
                  {PROVIDER_META[id].displayName}
                </span>
                <span className="text-sm text-ink-2">
                  {PROVIDER_META[id].credentialHint}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1 text-sm text-ink-2">
              <span>Account name</span>
              <input
                className={fieldClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  provider === "codex"
                    ? "personal@email.com"
                    : provider === "tavily"
                      ? "Tavily research"
                      : provider === "exa"
                        ? "Exa team"
                        : provider === "composio"
                          ? "Composio project"
                          : "home workspace"
                }
                autoComplete="off"
              />
            </label>

            {provider === "opencode-go" ? (
              <>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>Session cookie</span>
                  <textarea
                    className={fieldClass}
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                    placeholder="auth=Fe26.2**… or Fe26.2**…"
                    rows={4}
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    Paste either the raw token value (e.g. Fe26.2**…) or the full
                    cookie header (e.g. auth=Fe26.2**…). Find it in your
                    browser&apos;s DevTools → Network → any opencode.ai request →
                    Cookie header. OpenCode Go auth is web-based and shared
                    across Windows and WSL terminals.
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>
                    Workspace ID{" "}
                    <span className="text-muted">(optional)</span>
                  </span>
                  <input
                    className={fieldClass}
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    placeholder="wrk_… — leave blank to auto-detect"
                    autoComplete="off"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    Leave blank to discover the default workspace from your
                    session. Override only if you need a specific workspace
                    (opencode.ai/workspace/wrk_…/go).
                  </span>
                </label>
              </>
            ) : null}

            {provider === "tavily" ? (
              <label className="flex flex-col gap-1 text-sm text-ink-2">
                <span>API key</span>
                <input
                  className={fieldClass}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="tvly-…"
                  autoComplete="off"
                  type="password"
                />
                <span className="text-xs leading-relaxed text-muted">
                  From app.tavily.com. Usage is polled via GET /usage (Bearer).
                  That endpoint allows 10 requests per 10 minutes, so Usagi
                  refreshes Tavily at most every 2 minutes (and backs off for
                  10 minutes if rate-limited).
                </span>
              </label>
            ) : null}

            {provider === "exa" ? (
              <>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>Service key</span>
                  <input
                    className={fieldClass}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    autoComplete="off"
                    type="password"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    From dashboard.exa.ai → Team Management / service API key.
                    Usagi polls 3d / 7d / 30d spend via admin-api.exa.ai. A regular
                    search key only confirms auth (no spend meters).
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>
                    Key ID <span className="text-muted">(optional)</span>
                  </span>
                  <input
                    className={fieldClass}
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value)}
                    placeholder="Search key UUID — leave blank for all keys"
                    autoComplete="off"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    Scope meters to one search key. Leave blank to aggregate all
                    keys on the team.
                  </span>
                </label>
              </>
            ) : null}

            {provider === "composio" ? (
              <>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>Org API key</span>
                  <input
                    className={fieldClass}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="oak_…"
                    autoComplete="off"
                    type="password"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    From dashboard → Organization Settings → Organization Access
                    Tokens (`oak_…`). Usagi polls monthly tool calls / pro tool
                    calls via POST /api/v3.1/org/usage/summary. Consumer keys
                    (`ck_…`) only work for Connect MCP and will not work here.
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>
                    Plan <span className="text-muted">(optional)</span>
                  </span>
                  <select
                    className={fieldClass}
                    value={composioPlan}
                    onChange={(e) =>
                      setComposioPlan(
                        (e.target.value || "") as ComposioPlanId | "",
                      )
                    }
                  >
                    <option value="">Auto (Totally Free quotas)</option>
                    <option value="free">Totally Free · 20k / 1k</option>
                    <option value="cheap">
                      Ridiculously Cheap · 200k / 5k
                    </option>
                    <option value="serious">
                      Serious Business · 2M / 50k
                    </option>
                    <option value="enterprise">Enterprise · no hard cap</option>
                  </select>
                  <span className="text-xs leading-relaxed text-muted">
                    Composio&apos;s subscription API is cookie-auth only, so
                    Usagi cannot read your plan from an org key. Pick your plan
                    for accurate quota bars, or leave Auto (Free quotas; escalates
                    if month-to-date usage exceeds a lower tier).
                  </span>
                </label>
              </>
            ) : null}

            {provider === "codex" ? (
              <>
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-rule bg-paper-2 p-4">
                  <p className="m-0 text-sm text-ink-2">
                    Open the authorize URL, sign in, then paste the localhost
                    callback URL. Tokens refresh automatically.
                  </p>
                  <button
                    type="button"
                    className={`${secondaryBtnClass} self-start`}
                    disabled={!authorizeUrl && mode === "create"}
                    onClick={() => {
                      if (authorizeUrl) {
                        void navigator.clipboard?.writeText(authorizeUrl);
                        window.open(authorizeUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                  >
                    {authorizeUrl ? "Open authorize URL" : "Preparing OAuth…"}
                  </button>
                </div>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>OAuth callback URL</span>
                  <textarea
                    className={fieldClass}
                    value={oauthCallbackUrl}
                    onChange={(e) => setOauthCallbackUrl(e.target.value)}
                    placeholder="http://localhost:1455/auth/callback?code=…&state=…"
                    rows={3}
                  />
                </label>
              </>
            ) : null}

            {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}

            <div className="mt-1 flex items-center justify-between gap-3">
              {mode === "create" ? (
                <button
                  type="button"
                  className={secondaryBtnClass}
                  onClick={() => setStep("provider")}
                >
                  Back
                </button>
              ) : (
                <span />
              )}
              <button type="submit" className={primaryBtnClass} disabled={busy}>
                {busy
                  ? "Saving…"
                  : mode === "create"
                    ? "Save account"
                    : "Update credentials"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function AccountWizard({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: AccountWizardProps) {
  if (!open) return null;

  return (
    <WizardPanel
      mode={mode}
      initial={initial}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
