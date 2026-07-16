"use client";

import {
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { MeterBar } from "@/components/meter-bar";
import { ProviderIcon } from "@/components/provider-icons";
import { PROVIDER_META, type AccountCardModel } from "@/lib/types";

type AccountTileProps = {
  card: AccountCardModel;
  index: number;
  isDragging: boolean;
  isDragOver: boolean;
  onOpen: (accountId: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
};

const spanClass: Record<AccountCardModel["account"]["span"], string> = {
  "2x2": "md:col-span-2 md:row-span-2",
  "2x1": "md:col-span-2",
  "1x2": "md:row-span-2",
  "1x1": "",
};

const CLICK_SLOP_PX = 6;

export function AccountTile({
  card,
  index,
  isDragging,
  isDragOver,
  onOpen,
  onDragStart,
  onDragOver,
  onDragEnd,
}: AccountTileProps) {
  const { account, usage } = card;
  const meta = PROVIDER_META[account.provider];
  const meters = usage?.meters ?? [];
  const compact = account.span === "1x1";
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    didDrag.current = false;
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!pointerOrigin.current) return;
    const dx = event.clientX - pointerOrigin.current.x;
    const dy = event.clientY - pointerOrigin.current.y;
    if (Math.hypot(dx, dy) > CLICK_SLOP_PX) {
      didDrag.current = true;
    }
  }

  function handleClick() {
    if (didDrag.current) return;
    onOpen(account.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(account.id);
    }
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>) {
    didDrag.current = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    onDragStart(index);
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDragOver(index);
  }

  return (
    <button
      type="button"
      draggable
      className={`flex min-h-full min-w-0 cursor-grab flex-col gap-4 rounded-2xl border bg-paper/90 p-6 text-left text-ink shadow-[0_1px_0_oklch(22%_0.02_40_/_0.04),0_8px_24px_oklch(50%_0.03_45_/_0.06)] transition-[transform,box-shadow,border-color,background-color,opacity] duration-[220ms] ease-[var(--ease-out)] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus motion-safe:animate-[tile-in_420ms_var(--ease-out)_both] ${
        isDragging
          ? "opacity-40 border-accent/60"
          : isDragOver
            ? "border-accent -translate-y-0.5 bg-paper-2/95"
            : "border-rule hover:-translate-y-0.5 hover:border-accent/45 hover:bg-paper-2/92"
      } ${spanClass[account.span]}`}
      style={{ animationDelay: `${index * 70}ms` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        onDragEnd();
      }}
      aria-label={`${meta.displayName} account ${account.name}. Drag to rearrange, activate to edit.`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md border border-rule bg-paper-3 text-ink">
            <ProviderIcon provider={account.provider} size={18} />
          </span>
          <div className="min-w-0">
            <p className="m-0 font-display text-base font-semibold tracking-[-0.02em]">
              {meta.displayName}
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-2">{account.name}</p>
          </div>
        </div>
        {usage?.plan ? (
          <span className="shrink-0 rounded-full border border-rule px-2 py-0.5 font-outlier text-xs tracking-[0.06em] text-muted uppercase">
            {usage.plan}
          </span>
        ) : null}
      </div>

      {account.authStatus === "reauth_required" ? (
        <p className="m-0 text-sm text-danger">Re-auth required</p>
      ) : null}

      {usage?.status === "error" || usage?.status === "unavailable" ? (
        <p className="m-0 text-sm text-danger">
          {usage.error ?? "Usage unavailable"}
        </p>
      ) : (
        <div className="mt-auto flex flex-col gap-3">
          {meters.map((meter) => (
            <MeterBar key={meter.id} meter={meter} compact={compact} />
          ))}
        </div>
      )}
    </button>
  );
}
