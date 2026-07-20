"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ProviderIcon } from "@/components/provider-icons";
import { COOKIES_TXT_EXTENSION_URL } from "@/lib/cookie-extension";
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
  onDelete?: () => Promise<void> | void;
};

type Step = "provider" | "credentials";

const fieldClass =
  "w-full rounded-md border border-rule bg-paper-2 px-3.5 py-2.5 text-ink transition-colors hover:border-accent/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const secondaryBtnClass =
  "cursor-pointer rounded-md border border-rule bg-transparent px-3.5 py-2 text-sm text-ink transition-[transform,background-color] duration-120 ease-out hover:-translate-y-px hover:bg-paper-2 active:translate-y-0";

const primaryBtnClass =
  "cursor-pointer rounded-md border border-accent bg-accent px-4 py-2.5 font-display font-semibold text-accent-ink transition-[transform,filter] duration-120 ease-out hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50";

const authorizeLinkClass = `${secondaryBtnClass} inline-flex self-start no-underline`;

const extensionLinkClass =
  "font-medium text-ink underline decoration-rule underline-offset-2 transition-colors hover:decoration-accent";

function CookieExtensionLink({ children }: { children: React.ReactNode }) {
  return (
    <a
      href={COOKIES_TXT_EXTENSION_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={extensionLinkClass}
    >
      {children}
    </a>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="text-ink">{children}</code>;
}

function WizardPanel({
  mode,
  initial,
  onClose,
  onSubmit,
  onDelete,
}: Omit<AccountWizardProps, "open">) {
  const t = useTranslations("Wizard");
  const tProviders = useTranslations("Providers");
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
  const [oauthRequesting, setOauthRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const oauthPreparing =
    oauthRequesting ||
    (step === "credentials" &&
      provider === "codex" &&
      authorizeUrl === null &&
      error === null);

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

  async function startCodexOauth() {
    setOauthRequesting(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/codex/start", { method: "POST" });
      const json = (await res.json()) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.authorizeUrl) {
        setAuthorizeUrl(null);
        setError(json.error ?? t("errors.oauthStartFailed"));
        return null;
      }
      setAuthorizeUrl(json.authorizeUrl);
      return json.authorizeUrl;
    } catch {
      setAuthorizeUrl(null);
      setError(t("errors.oauthStartFailed"));
      return null;
    } finally {
      setOauthRequesting(false);
    }
  }

  useEffect(() => {
    if (step !== "credentials" || provider !== "codex") return;

    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/oauth/codex/start", {
          method: "POST",
          signal: controller.signal,
        });
        const json = (await res.json()) as {
          authorizeUrl?: string;
          error?: string;
        };
        if (controller.signal.aborted) return;
        if (!res.ok || !json.authorizeUrl) {
          setAuthorizeUrl(null);
          setError(json.error ?? t("errors.oauthStartFailed"));
          return;
        }
        setAuthorizeUrl(json.authorizeUrl);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAuthorizeUrl(null);
        setError(t("errors.oauthStartFailed"));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [step, provider, t]);

  function selectProvider(next: ProviderId) {
    setProvider(next);
    setStep("credentials");
    setError(null);
    setAuthorizeUrl(null);
  }

  function namePlaceholder(id: ProviderId): string {
    switch (id) {
      case "codex":
        return t("placeholders.codexName");
      case "cursor":
        return t("placeholders.cursorName");
      case "tavily":
        return t("placeholders.tavilyName");
      case "exa":
        return t("placeholders.exaName");
      case "composio":
        return t("placeholders.composioName");
      default:
        return t("placeholders.opencodeName");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("errors.nameRequired"));
      return;
    }

    if (provider === "opencode-go" && !cookie.trim()) {
      setError(t("errors.opencodeCookieRequired"));
      return;
    }

    if (provider === "cursor" && !cookie.trim()) {
      setError(t("errors.cursorCookieRequired"));
      return;
    }

    if (provider === "tavily" && !apiKey.trim()) {
      setError(t("errors.tavilyKeyRequired"));
      return;
    }

    if (provider === "exa" && !apiKey.trim()) {
      setError(t("errors.exaKeyRequired"));
      return;
    }

    if (provider === "composio" && !apiKey.trim()) {
      setError(t("errors.composioKeyRequired"));
      return;
    }

    if (
      provider === "codex" &&
      mode === "create" &&
      !oauthCallbackUrl.trim()
    ) {
      setError(t("errors.oauthCallbackRequired"));
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

      if (provider === "cursor") {
        await onSubmit({
          provider,
          name: trimmedName,
          cookie: cookie.trim(),
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
      setError(err instanceof Error ? err.message : t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-[clamp(1rem,3vw,2rem)]">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer border-0 bg-scrim motion-safe:animate-[fade-in_220ms_var(--ease-out)_both]"
        aria-label={t("closeWizard")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative max-h-[min(90vh,44rem)] w-full max-w-136 overflow-auto rounded-2xl border border-rule bg-paper p-8 shadow-[0_24px_64px_oklch(22%_0.02_45/0.22)] motion-safe:animate-[modal-in_420ms_var(--ease-out)_both]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs tracking-[0.08em] text-muted uppercase">
              {mode === "create" ? t("addAccount") : t("editAccount")}
            </p>
            <h2
              id={titleId}
              className="m-0 font-display text-2xl font-semibold tracking-[-0.03em]"
            >
              {step === "provider"
                ? t("chooseProvider")
                : PROVIDER_META[provider].displayName}
            </h2>
          </div>
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            {t("close")}
          </button>
        </header>

        {step === "provider" ? (
          <div className="grid gap-3">
            {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="grid cursor-pointer grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-4 gap-y-0.5 rounded-md border border-rule bg-paper-2 p-4 text-left transition-[transform,border-color] duration-120 ease-out hover:-translate-y-0.5 hover:border-accent/55"
                onClick={() => void selectProvider(id)}
              >
                <span className="row-span-2 grid size-11 place-items-center rounded-md border border-rule bg-paper-3 text-ink">
                  <ProviderIcon provider={id} size={20} />
                </span>
                <span className="font-display text-lg font-semibold">
                  {PROVIDER_META[id].displayName}
                </span>
                <span className="text-sm text-ink-2">
                  {tProviders(`${id}.hint` as `${ProviderId}.hint`)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1 text-sm text-ink-2">
              <span>{t("accountName")}</span>
              <input
                className={fieldClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder(provider)}
                autoComplete="off"
              />
            </label>

            {provider === "opencode-go" ? (
              <>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>{t("sessionCookie")}</span>
                  <textarea
                    className={fieldClass}
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                    placeholder={t("placeholders.opencodeCookie")}
                    rows={4}
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    {t.rich("help.opencodeCookie", {
                      ext: (chunks) => (
                        <CookieExtensionLink>{chunks}</CookieExtensionLink>
                      ),
                    })}
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>
                    {t("workspaceId")}{" "}
                    <span className="text-muted">{t("optional")}</span>
                  </span>
                  <input
                    className={fieldClass}
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    placeholder={t("placeholders.workspaceId")}
                    autoComplete="off"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    {t("help.opencodeWorkspace")}
                  </span>
                </label>
              </>
            ) : null}

            {provider === "cursor" ? (
              <label className="flex flex-col gap-1 text-sm text-ink-2">
                <span>{t("sessionCookie")}</span>
                <textarea
                  className={fieldClass}
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder={t("placeholders.cursorCookie")}
                  rows={4}
                />
                <span className="text-xs leading-relaxed text-muted">
                  {t.rich("help.cursorCookie", {
                    ext: (chunks) => (
                      <CookieExtensionLink>{chunks}</CookieExtensionLink>
                    ),
                    code: (chunks) => <InlineCode>{chunks}</InlineCode>,
                  })}
                </span>
              </label>
            ) : null}

            {provider === "tavily" ? (
              <label className="flex flex-col gap-1 text-sm text-ink-2">
                <span>{t("apiKey")}</span>
                <input
                  className={fieldClass}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("placeholders.tavilyKey")}
                  autoComplete="off"
                  type="password"
                />
                <span className="text-xs leading-relaxed text-muted">
                  {t("help.tavilyKey")}
                </span>
              </label>
            ) : null}

            {provider === "exa" ? (
              <>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>{t("serviceKey")}</span>
                  <input
                    className={fieldClass}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t("placeholders.exaKey")}
                    autoComplete="off"
                    type="password"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    {t("help.exaKey")}
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>
                    {t("keyId")}{" "}
                    <span className="text-muted">{t("optional")}</span>
                  </span>
                  <input
                    className={fieldClass}
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value)}
                    placeholder={t("placeholders.exaKeyId")}
                    autoComplete="off"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    {t("help.exaKeyId")}
                  </span>
                </label>
              </>
            ) : null}

            {provider === "composio" ? (
              <>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>{t("orgApiKey")}</span>
                  <input
                    className={fieldClass}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t("placeholders.composioKey")}
                    autoComplete="off"
                    type="password"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    {t("help.composioKey")}
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>
                    {t("plan")}{" "}
                    <span className="text-muted">{t("optional")}</span>
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
                    <option value="">{t("composioPlans.auto")}</option>
                    <option value="free">{t("composioPlans.free")}</option>
                    <option value="cheap">{t("composioPlans.cheap")}</option>
                    <option value="serious">{t("composioPlans.serious")}</option>
                    <option value="enterprise">
                      {t("composioPlans.enterprise")}
                    </option>
                  </select>
                  <span className="text-xs leading-relaxed text-muted">
                    {t("help.composioPlan")}
                  </span>
                </label>
              </>
            ) : null}

            {provider === "codex" ? (
              <>
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-rule bg-paper-2 p-4">
                  <p className="m-0 text-sm text-ink-2">
                    {mode === "edit"
                      ? t("codexEditHint")
                      : t("codexCreateHint")}
                  </p>
                  {authorizeUrl ? (
                    <a
                      href={authorizeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={authorizeLinkClass}
                    >
                      {t("openAuthorizeUrl")}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className={`${secondaryBtnClass} self-start`}
                      disabled={oauthPreparing}
                      onClick={() => {
                        void startCodexOauth();
                      }}
                    >
                      {oauthPreparing
                        ? t("preparingOauth")
                        : t("startOauth")}
                    </button>
                  )}
                </div>
                <label className="flex flex-col gap-1 text-sm text-ink-2">
                  <span>{t("oauthCallbackUrl")}</span>
                  <textarea
                    className={fieldClass}
                    value={oauthCallbackUrl}
                    onChange={(e) => setOauthCallbackUrl(e.target.value)}
                    placeholder={t("placeholders.oauthCallback")}
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
                  {t("back")}
                </button>
              ) : onDelete ? (
                <button
                  type="button"
                  className={`${secondaryBtnClass} border-danger/40 text-danger hover:bg-danger/10`}
                  disabled={busy || deleting}
                  onClick={() => {
                    if (
                      !window.confirm(
                        t("confirmDelete", {
                          name: name.trim() || t("thisAccount"),
                        }),
                      )
                    ) {
                      return;
                    }
                    setDeleting(true);
                    setError(null);
                    void Promise.resolve(onDelete())
                      .catch((err) => {
                        setError(
                          err instanceof Error
                            ? err.message
                            : t("errors.deleteFailed"),
                        );
                      })
                      .finally(() => setDeleting(false));
                  }}
                >
                  {deleting ? t("deleting") : t("delete")}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                className={primaryBtnClass}
                disabled={busy || deleting}
              >
                {busy
                  ? t("saving")
                  : mode === "create"
                    ? t("saveAccount")
                    : t("updateCredentials")}
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
  onDelete,
}: AccountWizardProps) {
  if (!open) return null;

  return (
    <WizardPanel
      mode={mode}
      initial={initial}
      onClose={onClose}
      onSubmit={onSubmit}
      onDelete={onDelete}
    />
  );
}
