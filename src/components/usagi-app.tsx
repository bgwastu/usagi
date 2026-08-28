"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "@/i18n/client";
import { AccountsLoading } from "@/components/accounts-loading";
import { ApiDocsModal } from "@/components/api-docs-modal";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { UsageOverlay } from "@/components/usage-overlay";
import { reorderCardsByIds } from "@/lib/board-layout";
import type { AccountCardModel } from "@/lib/types";
import type { WizardDraft } from "@/components/account-wizard";

import { AccountsBoard } from "@/components/accounts-board";
import { AccountWizard } from "@/components/account-wizard";

const REFRESH_MS = 5_000;

function sameBoard(a: AccountCardModel[], b: AccountCardModel[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.account.id !== right.account.id) return false;
    if (left.account.updatedAt !== right.account.updatedAt) return false;
    if (left.usage?.fetchedAt !== right.usage?.fetchedAt) return false;
    if (left.usage?.status !== right.usage?.status) return false;
  }
  return true;
}

const addBtnClass =
  "shrink-0 cursor-pointer whitespace-nowrap rounded-sm border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-[filter] duration-150 ease-out hover:brightness-110 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus";

const apiBtnClass =
  "shrink-0 cursor-pointer whitespace-nowrap rounded-sm border border-rule bg-transparent px-3.5 py-2.5 text-sm text-ink transition-colors duration-150 ease-out hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus";

type UsagiAppProps = {
  /** SSR shell: accounts + last-known usage (may be null). */
  initialCards?: AccountCardModel[];
};

export function UsagiApp({ initialCards }: UsagiAppProps) {
  const t = useTranslations("App");
  const [cards, setCards] = useState<AccountCardModel[]>(
    () => initialCards ?? [],
  );
  const [loading, setLoading] = useState(() => initialCards == null);
  const [usageReady, setUsageReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const pauseRefreshRef = useRef(false);
  const refreshVersionRef = useRef(0);
  const bootShellRef = useRef(true);
  const hasCardsRef = useRef((initialCards?.length ?? 0) > 0);

  const editingCard = useMemo(
    () => cards.find((card) => card.account.id === editingId) ?? null,
    [cards, editingId],
  );

  const applyCards = useCallback((next: AccountCardModel[]) => {
    hasCardsRef.current = next.length > 0;
    setCards((prev) => (sameBoard(prev, next) ? prev : next));
    setLoadError(null);
    setLoading(false);
  }, []);

  /** Instant shell — accounts + cached meters, no live provider calls. */
  const refreshShell = useCallback(
    async (options?: { ignoreHidden?: boolean }) => {
    if (pauseRefreshRef.current) return;
    if (
      !options?.ignoreHidden &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      const json = (await res.json()) as {
        accounts?: AccountCardModel[];
        error?: string;
      };
      startTransition(() => {
        if (pauseRefreshRef.current) return;
        if (!res.ok) {
          setLoadError(json.error ?? t("loadFailed"));
          setLoading(false);
          return;
        }
        const next = json.accounts ?? [];
        applyCards(
          bootShellRef.current
            ? next.map((card) => ({ ...card, usage: null }))
            : next,
        );
        if (next.length === 0) {
          bootShellRef.current = false;
          setUsageReady(true);
        }
      });
    } catch (error) {
      startTransition(() => {
        if (pauseRefreshRef.current) return;
        setLoadError(
          error instanceof Error ? error.message : t("networkError"),
        );
        setLoading(false);
      });
    }
    },
    [applyCards, t],
  );

  /** Live usage refresh — may be slow; board should already be painted. */
  const refreshUsage = useCallback(
    async (options?: { force?: boolean; ignoreHidden?: boolean }) => {
      if (pauseRefreshRef.current) return;
      if (
        !options?.ignoreHidden &&
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      const refreshVersion = refreshVersionRef.current;
      try {
        const qs = options?.force ? "?force=1" : "";
        const res = await fetch(`/api/accounts/usage${qs}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          accounts?: AccountCardModel[];
          error?: string;
        };
        if (
          pauseRefreshRef.current ||
          refreshVersion !== refreshVersionRef.current
        ) {
          return;
        }
        bootShellRef.current = false;
        setUsageReady(true);
        if (!res.ok) {
          if (!hasCardsRef.current) {
            setLoadError(json.error ?? "Failed to refresh usage");
          }
          return;
        }
        startTransition(() => {
          applyCards(json.accounts ?? []);
        });
      } catch {
        bootShellRef.current = false;
        setUsageReady(true);
      }
    },
    [applyCards],
  );

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (initialCards == null) {
        await refreshShell({ ignoreHidden: true });
      } else {
        setLoading(false);
      }
      if (cancelled) return;
      await refreshUsage({ ignoreHidden: true });
    }

    const bootTimer = window.setTimeout(() => {
      void boot();
    }, 0);
    const id = window.setInterval(() => {
      void refreshUsage();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshUsage();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(bootTimer);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initialCards, refreshShell, refreshUsage]);

  function openCreate() {
    setEditingId(null);
    setWizardOpen(true);
  }

  function openEdit(accountId: string) {
    setEditingId(accountId);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    setEditingId(null);
  }

  function handleDragActiveChange(active: boolean) {
    pauseRefreshRef.current = active;
  }

  async function handleReorder(orderedIds: string[]) {
    pauseRefreshRef.current = true;
    setCards((current) => reorderCardsByIds(current, orderedIds));
    try {
      await fetch("/api/accounts/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
    } finally {
      pauseRefreshRef.current = false;
    }
  }

  async function handleSubmit(draft: WizardDraft) {
    if (editingCard) {
      const body: Record<string, unknown> = { name: draft.name };
      if (draft.provider === "opencode-go") {
        body.cookie = draft.cookie;
        body.workspaceId = draft.workspaceId;
      } else if (draft.provider === "cursor") {
        body.cookie = draft.cookie;
      } else if (draft.provider === "tavily") {
        body.apiKey = draft.apiKey;
      } else if (draft.provider === "exa") {
        body.apiKey = draft.apiKey;
        body.keyId = draft.keyId ?? "";
      } else if (draft.provider === "composio") {
        body.apiKey = draft.apiKey;
        body.plan = draft.composioPlan ?? "";
      } else if (draft.provider === "command-code") {
        body.apiKey = draft.apiKey;
      } else if (draft.oauthCallbackUrl) {
        body.oauthCallbackUrl = draft.oauthCallbackUrl;
      }
      const res = await fetch(`/api/accounts/${editingCard.account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("updateFailed"));
    } else {
      const body: Record<string, unknown> = { ...draft };
      if (draft.provider === "composio") {
        body.plan = draft.composioPlan || undefined;
        delete body.composioPlan;
      }
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("createFailed"));
    }
    closeWizard();
    await refreshShell();
    await refreshUsage({ force: true });
  }

  async function handleDelete() {
    if (!editingCard) return;
    const deletedId = editingCard.account.id;
    const res = await fetch(`/api/accounts/${deletedId}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? t("deleteFailed"));
    refreshVersionRef.current += 1;
    setCards((current) =>
      current.filter((card) => card.account.id !== deletedId),
    );
    closeWizard();
    await refreshShell();
  }

  const wizardInitial = editingCard
    ? {
        provider: editingCard.account.provider,
        name: editingCard.account.name,
         cookie: undefined,
         workspaceId: undefined,
         apiKey: undefined,
         keyId: undefined,
         composioPlan: undefined,
      }
    : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-[clamp(1rem,3vw,2rem)]">
        <header className="flex items-center justify-between gap-6 border-b border-rule py-5 max-[40rem]:items-start">
          <div className="min-w-0">
            <p className="m-0 font-display text-[1.75rem] leading-none font-bold tracking-[-0.03em] text-ink">
              Usagi
              <span
                className="ml-1.5 inline-block size-2.5 translate-y-[-0.12em] bg-accent align-baseline"
                aria-hidden
              />
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
            <LocaleSwitcher />
            <button
              type="button"
              className={apiBtnClass}
              onClick={() => setApiOpen(true)}
            >
              {t("api")}
            </button>
            <button type="button" className={addBtnClass} onClick={openCreate}>
              {t("addAccount")}
            </button>
          </div>
        </header>

        <main className="flex-1 py-8 pb-16">
          {loading ? (
            <AccountsLoading />
          ) : loadError ? (
            <p className="text-danger">{loadError}</p>
          ) : cards.length === 0 ? (
            <section className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
              <h1 className="m-0 font-display text-[1.5rem] font-semibold tracking-[-0.02em]">
                {t("emptyTitle")}
              </h1>
              <p className="m-0 max-w-prose text-ink-2">{t("emptyBody")}</p>
              <button type="button" className={addBtnClass} onClick={openCreate}>
                {t("addAccount")}
              </button>
            </section>
          ) : (
            <>
              {!usageReady ? <UsageOverlay /> : null}
              <AccountsBoard
                cards={cards}
                onOpen={openEdit}
                onReorder={(orderedIds) => {
                  void handleReorder(orderedIds);
                }}
                onDragActiveChange={handleDragActiveChange}
              />
            </>
          )}
        </main>
      </div>

      {apiOpen ? <ApiDocsModal onClose={() => setApiOpen(false)} /> : null}

      {wizardOpen ? (
        <AccountWizard
          key={editingId ?? "create"}
          open={wizardOpen}
          mode={editingId ? "edit" : "create"}
          initial={wizardInitial}
          onClose={closeWizard}
          onSubmit={handleSubmit}
          onDelete={editingId ? handleDelete : undefined}
        />
      ) : null}
    </div>
  );
}
