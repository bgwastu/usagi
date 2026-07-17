"use client";

import {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import { MeterBar } from "@/components/meter-bar";
import { ProviderIcon } from "@/components/provider-icons";
import { BOARD_DRAG_HANDLE_CLASS } from "@/lib/board-layout";
import { PROVIDER_META, type AccountCardModel } from "@/lib/types";

type AccountTileProps = {
  card: AccountCardModel;
  index: number;
  onOpen: (accountId: string) => void;
  /** Intrinsic content box (excludes tile padding) for grid height measurement. */
  measureRef?: Ref<HTMLDivElement>;
};

const CLICK_SLOP_PX = 6;

function DragHandle() {
  return (
    <span
      className={`${BOARD_DRAG_HANDLE_CLASS} -mr-1.5 -mt-1.5 grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted transition-colors duration-220 ease-[var(--ease-out)] hover:bg-paper-3 hover:text-ink active:cursor-grabbing`}
      aria-hidden
      title="Drag to rearrange"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="5" cy="3.5" r="1.15" />
        <circle cx="9" cy="3.5" r="1.15" />
        <circle cx="5" cy="7" r="1.15" />
        <circle cx="9" cy="7" r="1.15" />
        <circle cx="5" cy="10.5" r="1.15" />
        <circle cx="9" cy="10.5" r="1.15" />
      </svg>
    </span>
  );
}

export function AccountTile({
  card,
  index,
  onOpen,
  measureRef,
}: AccountTileProps) {
  const { account, usage } = card;
  const meta = PROVIDER_META[account.provider];
  const meters = usage?.meters ?? [];
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

  return (
    <button
      type="button"
      className="box-border flex h-full w-full min-h-0 min-w-0 cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border border-rule bg-paper/90 p-4 text-left text-ink shadow-[0_1px_0_oklch(22%_0.02_40/0.04),0_8px_24px_oklch(50%_0.03_45/0.06)] transition-[box-shadow,border-color,background-color] duration-220 ease-[var(--ease-out)] hover:border-accent/45 hover:bg-paper-2/92 hover:shadow-[0_1px_0_oklch(22%_0.02_40/0.04),0_12px_28px_oklch(50%_0.03_45/0.1)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus motion-safe:animate-[tile-fade_420ms_var(--ease-out)_both]"
      style={{ animationDelay: `${index * 70}ms` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${meta.displayName} account ${account.name}. Activate to edit. Use the drag handle to rearrange.`}
    >
      <div ref={measureRef} className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-rule bg-paper-3 text-ink">
              <ProviderIcon provider={account.provider} size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate font-display text-base font-semibold tracking-[-0.02em]">
                {meta.displayName}
              </p>
              <p className="mt-0.5 truncate text-sm text-ink-2">{account.name}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-1">
            {usage?.plan ? (
              <span className="mt-1 shrink-0 rounded-full border border-rule px-2 py-0.5 font-outlier text-xs tracking-[0.06em] text-muted uppercase">
                {usage.plan}
              </span>
            ) : null}
            <DragHandle />
          </div>
        </div>

        {account.authStatus === "reauth_required" ? (
          <p className="m-0 text-sm text-danger">Re-auth required</p>
        ) : null}

        {usage?.status === "error" || usage?.status === "unavailable" ? (
          <p className="m-0 text-sm text-danger">
            {usage.error ?? "Usage unavailable"}
          </p>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {meters.map((meter) => (
              <MeterBar key={meter.id} meter={meter} />
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
