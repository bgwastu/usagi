"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { AccountsLoading } from "@/components/accounts-loading";
import { reorderCardsByIds } from "@/lib/board-layout";
import type { AccountCardModel, ComposioPlanId } from "@/lib/types";
import type { WizardDraft } from "@/components/account-wizard";

const AccountsBoard = dynamic(
  () =>
    import("@/components/accounts-board").then((m) => ({
      default: m.AccountsBoard,
    })),
  { loading: () => <AccountsLoading />, ssr: false },
);

const AccountWizard = dynamic(
  () =>
    import("@/components/account-wizard").then((m) => ({
      default: m.AccountWizard,
    })),
  { ssr: false },
);

const REFRESH_MS = 5_000;

const addBtnClass =
  "shrink-0 cursor-pointer whitespace-nowrap rounded-md border border-accent bg-accent px-4 py-2.5 font-display text-sm font-semibold text-accent-ink transition-[transform,filter] duration-220 ease-out hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus";

type UsagiAppProps = {
  /** SSR shell: accounts + last-known usage (may be null). */
  initialCards?: AccountCardModel[];
};

export function UsagiApp({ initialCards }: UsagiAppProps) {
  const [cards, setCards] = useState<AccountCardModel[]>(
    () => initialCards ?? [],
  );
  const [loading, setLoading] = useState(() => initialCards == null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [, setClock] = useState(() => Date.now());
  const pauseRefreshRef = useRef(false);
  const hasCardsRef = useRef((initialCards?.length ?? 0) > 0);

  const editingCard = useMemo(
    () => cards.find((card) => card.account.id === editingId) ?? null,
    [cards, editingId],
  );

  const applyCards = useCallback((next: AccountCardModel[]) => {
    hasCardsRef.current = next.length > 0;
    setCards(next);
    setLoadError(null);
    setLoading(false);
    setClock(Date.now());
  }, []);

  /** Instant shell — accounts + cached meters, no live provider calls. */
  const refreshShell = useCallback(async () => {
    if (pauseRefreshRef.current) return;
    if (
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
          setLoadError(json.error ?? "Failed to load accounts");
          setLoading(false);
          return;
        }
        applyCards(json.accounts ?? []);
      });
    } catch (error) {
      startTransition(() => {
        if (pauseRefreshRef.current) return;
        setLoadError(error instanceof Error ? error.message : "Network error");
        setLoading(false);
      });
    }
  }, [applyCards]);

  /** Live usage refresh — may be slow; board should already be painted. */
  const refreshUsage = useCallback(
    async (options?: { force?: boolean }) => {
      if (pauseRefreshRef.current) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      try {
        const qs = options?.force ? "?force=1" : "";
        const res = await fetch(`/api/accounts/usage${qs}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          accounts?: AccountCardModel[];
          error?: string;
        };
        startTransition(() => {
          if (pauseRefreshRef.current) return;
          if (!res.ok) {
            // Keep shell visible; surface error only if we have no cards yet.
            if (!hasCardsRef.current) {
              setLoadError(json.error ?? "Failed to refresh usage");
            }
            return;
          }
          applyCards(json.accounts ?? []);
        });
      } catch {
        // Soft-fail usage refresh; shell/cached meters stay up.
      }
    },
    [applyCards],
  );

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (initialCards == null) {
        await refreshShell();
      } else {
        setLoading(false);
      }
      if (cancelled) return;
      await refreshUsage();
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
      } else if (draft.oauthCallbackUrl) {
        body.oauthCallbackUrl = draft.oauthCallbackUrl;
      }
      const res = await fetch(`/api/accounts/${editingCard.account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Update failed");
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
      if (!res.ok) throw new Error(json.error ?? "Create failed");
    }
    closeWizard();
    await refreshShell();
    await refreshUsage({ force: true });
  }

  async function handleDelete() {
    if (!editingCard) return;
    const res = await fetch(`/api/accounts/${editingCard.account.id}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Delete failed");
    closeWizard();
    await refreshShell();
  }

  const wizardInitial = editingCard
    ? {
        provider: editingCard.account.provider,
        name: editingCard.account.name,
        cookie:
          editingCard.account.provider === "opencode-go" ||
          editingCard.account.provider === "cursor"
            ? editingCard.account.credentials.cookie
            : undefined,
        workspaceId:
          editingCard.account.provider === "opencode-go"
            ? editingCard.account.credentials.workspaceId
            : undefined,
        apiKey:
          editingCard.account.provider === "tavily" ||
          editingCard.account.provider === "exa" ||
          editingCard.account.provider === "composio"
            ? editingCard.account.credentials.apiKey
            : undefined,
        keyId:
          editingCard.account.provider === "exa"
            ? editingCard.account.credentials.keyId
            : undefined,
        composioPlan:
          editingCard.account.provider === "composio"
            ? ((editingCard.account.credentials.plan ?? "") as
                | ComposioPlanId
                | "")
            : undefined,
      }
    : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-[clamp(1rem,3vw,2rem)]">
        <header className="flex items-center justify-between gap-6 py-6 max-[40rem]:items-start">
          <div className="min-w-0">
            <p className="m-0 font-display text-[clamp(2rem,4vw+0.5rem,2.75rem)] leading-none font-bold tracking-[-0.045em] text-ink">
              Usagi
              <span
                className="ml-1 inline-block size-[0.45em] translate-y-[0.12em] rounded-sm bg-accent align-baseline"
                aria-hidden
              />
            </p>
          </div>
          <button type="button" className={addBtnClass} onClick={openCreate}>
            Add account
          </button>
        </header>

        <main className="flex-1 pb-12">
          {loading ? (
            <AccountsLoading />
          ) : loadError ? (
            <p className="text-danger">{loadError}</p>
          ) : cards.length === 0 ? (
            <section className="mx-auto mt-16 flex max-w-md flex-col gap-4 text-center items-center">
              <h1 className="m-0 font-display text-[clamp(2.25rem,4vw+0.5rem,3rem)] font-semibold tracking-[-0.03em]">
                No accounts yet
              </h1>
              <p className="m-0 text-ink-2">
                Add a provider account to watch quotas, credits, and reset
                windows from one board.
              </p>
              <button type="button" className={addBtnClass} onClick={openCreate}>
                Add account
              </button>
            </section>
          ) : (
            <AccountsBoard
              cards={cards}
              onOpen={openEdit}
              onReorder={(orderedIds) => {
                void handleReorder(orderedIds);
              }}
              onDragActiveChange={handleDragActiveChange}
            />
          )}
        </main>
      </div>

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
