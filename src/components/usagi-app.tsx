"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { AccountTile } from "@/components/account-tile";
import {
  AccountWizard,
  type WizardDraft,
} from "@/components/account-wizard";
import { AccountsLoading } from "@/components/accounts-loading";
import type { AccountCardModel, ComposioPlanId } from "@/lib/types";

const REFRESH_MS = 5_000;

const addBtnClass =
  "shrink-0 cursor-pointer whitespace-nowrap rounded-md border border-accent bg-accent px-4 py-2.5 font-display text-sm font-semibold text-accent-ink transition-[transform,filter] duration-[220ms] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus";

function reorderCards(
  cards: AccountCardModel[],
  fromIndex: number,
  toIndex: number,
): AccountCardModel[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= cards.length ||
    toIndex >= cards.length
  ) {
    return cards;
  }
  const next = [...cards];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function UsagiApp() {
  const [cards, setCards] = useState<AccountCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [, setClock] = useState(() => Date.now());

  const editingCard = useMemo(
    () => cards.find((card) => card.account.id === editingId) ?? null,
    [cards, editingId],
  );

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      const json = (await res.json()) as {
        accounts?: AccountCardModel[];
        error?: string;
      };
      startTransition(() => {
        if (!res.ok) {
          setLoadError(json.error ?? "Failed to load accounts");
          setLoading(false);
          return;
        }
        setCards(json.accounts ?? []);
        setLoadError(null);
        setLoading(false);
        setClock(Date.now());
      });
    } catch (error) {
      startTransition(() => {
        setLoadError(error instanceof Error ? error.message : "Network error");
        setLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    const boot = window.setTimeout(() => {
      void refresh();
    }, 0);
    const id = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

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

  function handleDragStart(index: number) {
    setDragIndex(index);
    setOverIndex(index);
  }

  function handleDragOver(index: number) {
    setOverIndex((current) => (current === index ? current : index));
  }

  async function handleDragEnd() {
    if (dragIndex != null && overIndex != null && dragIndex !== overIndex) {
      const next = reorderCards(cards, dragIndex, overIndex);
      setCards(next);
      await fetch("/api/accounts/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedIds: next.map((card) => card.account.id),
        }),
      });
    }
    setDragIndex(null);
    setOverIndex(null);
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
    await refresh();
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
      <header className="flex items-center justify-between gap-6 px-[clamp(1rem,3vw,2rem)] py-6 max-[40rem]:items-start">
        <div className="min-w-0">
          <p className="m-0 font-display text-[clamp(2rem,4vw+0.5rem,2.75rem)] leading-none font-bold tracking-[-0.045em] text-ink">
            Usagi
            <span
              className="ml-1 inline-block size-[0.45em] translate-y-[0.12em] rounded-sm bg-accent align-baseline"
              aria-hidden
            />
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Provider usage at a glance
          </p>
        </div>
        <button type="button" className={addBtnClass} onClick={openCreate}>
          Add account
        </button>
      </header>

      <main className="flex-1 px-[clamp(1rem,3vw,2rem)] pt-4 pb-12">
        {loading ? (
          <AccountsLoading />
        ) : loadError ? (
          <p className="text-danger">{loadError}</p>
        ) : cards.length === 0 ? (
          <section className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
            <h1 className="m-0 font-display text-[clamp(2.25rem,4vw+0.5rem,3rem)] font-semibold tracking-[-0.03em]">
              No accounts yet
            </h1>
            <p className="m-0 text-ink-2">
              Add a provider account to watch quotas, credits, and reset windows
              from one board.
            </p>
            <button type="button" className={addBtnClass} onClick={openCreate}>
              Add account
            </button>
          </section>
        ) : (
          <section
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:auto-rows-[minmax(11rem,auto)] md:grid-cols-4"
            aria-label="Provider accounts"
            onDragOver={(event) => event.preventDefault()}
          >
            {cards.map((card, index) => (
              <AccountTile
                key={card.account.id}
                card={card}
                index={index}
                isDragging={dragIndex === index}
                isDragOver={
                  overIndex === index &&
                  dragIndex != null &&
                  dragIndex !== index
                }
                onOpen={openEdit}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={() => {
                  void handleDragEnd();
                }}
              />
            ))}
          </section>
        )}
      </main>

      <AccountWizard
        key={editingId ?? "create"}
        open={wizardOpen}
        mode={editingId ? "edit" : "create"}
        initial={wizardInitial}
        onClose={closeWizard}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
