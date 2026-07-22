"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import { useTranslations } from "next-intl";
import { MeterBar } from "@/components/meter-bar";
import { ProviderIcon } from "@/components/provider-icons";
import { BOARD_DRAG_HANDLE_CLASS } from "@/lib/board-layout";
import { getAntigravityQuotaFamily } from "@/lib/antigravity-quota";
import {
  PROVIDER_META,
  type AccountCardModel,
  type UsageMeter,
} from "@/lib/types";

type AccountTileProps = {
  card: AccountCardModel;
  index: number;
  onOpen: (accountId: string) => void;
  /** Intrinsic content box (excludes tile padding) for grid height measurement. */
  measureRef?: Ref<HTMLDivElement>;
};

const CLICK_SLOP_PX = 6;

const tileClassName =
  "box-border flex h-full w-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-rule bg-paper/90 p-4 text-left text-ink shadow-[0_1px_0_oklch(22%_0.02_40/0.04),0_8px_24px_oklch(50%_0.03_45/0.06)] transition-[box-shadow,border-color,background-color] duration-220 ease-out hover:border-accent/45 hover:bg-paper-2/92 hover:shadow-[0_1px_0_oklch(22%_0.02_40/0.04),0_12px_28px_oklch(50%_0.03_45/0.1)]";

function DragHandle() {
  const t = useTranslations("Tile");
  return (
    <span
      className={`${BOARD_DRAG_HANDLE_CLASS} -mr-1.5 -mt-1.5 grid size-9 shrink-0 touch-none place-items-center rounded-md text-muted transition-colors duration-220 ease-out hover:bg-paper-3 hover:text-ink`}
      aria-hidden
      title={t("dragTitle")}
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

function modelsForFamilyBar(
  detailMeters: UsageMeter[],
  familyMeterId: string,
): UsageMeter[] {
  const wantGemini = familyMeterId === "family_gemini";
  return detailMeters.filter((meter) => {
    const family = getAntigravityQuotaFamily(`${meter.label} ${meter.id}`);
    return wantGemini ? family === "gemini" : family !== "gemini";
  });
}

export function AccountTile({
  card,
  index,
  onOpen,
  measureRef,
}: AccountTileProps) {
  const t = useTranslations("Tile");
  const tLoading = useTranslations("Loading");
  const { account, usage } = card;
  const meta = PROVIDER_META[account.provider];
  const meters = usage?.meters ?? [];
  const detailMeters = usage?.detailMeters ?? [];
  const canToggleFamilies =
    detailMeters.length > 0 && meters.some((m) => m.id.startsWith("family_"));
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const [entrance, setEntrance] = useState(true);
  const [entranceDelayMs] = useState(() => index * 70);
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null);

  const expandedModels =
    expandedFamilyId != null
      ? modelsForFamilyBar(detailMeters, expandedFamilyId)
      : [];

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    didDrag.current = false;
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (!pointerOrigin.current) return;
    const dx = event.clientX - pointerOrigin.current.x;
    const dy = event.clientY - pointerOrigin.current.y;
    if (Math.hypot(dx, dy) > CLICK_SLOP_PX) {
      didDrag.current = true;
    }
  }

  function openEdit() {
    if (didDrag.current) return;
    onOpen(account.id);
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(account.id);
    }
  }

  function toggleFamily(meterId: string) {
    setExpandedFamilyId((current) => (current === meterId ? null : meterId));
  }

  return (
    <div
      className={
        entrance
          ? `${tileClassName} motion-safe:animate-[tile-fade_420ms_var(--ease-out)_both]`
          : tileClassName
      }
      style={entrance ? { animationDelay: `${entranceDelayMs}ms` } : undefined}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        setEntrance(false);
      }}
    >
      <div ref={measureRef} className="flex w-full shrink-0 flex-col gap-3">
        <div
          role="button"
          tabIndex={0}
          className="-m-1 flex min-w-0 cursor-pointer items-start justify-between gap-2 rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={t("ariaLabel", {
            provider: meta.displayName,
            name: account.name,
          })}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onClick={openEdit}
          onKeyDown={handleHeaderKeyDown}
        >
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
          <p className="m-0 text-sm text-danger">{t("reauthRequired")}</p>
        ) : null}

        {usage == null ? (
          <div
            className="flex min-h-0 min-w-0 flex-col gap-2.5"
            aria-busy="true"
            aria-label={tLoading("usage")}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-3">
                <span
                  className="block h-2.5 w-14 rounded-md bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                  aria-hidden
                />
                <span
                  className="block h-2.5 w-10 rounded-md bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                  aria-hidden
                />
              </div>
              <span
                className="block h-2 w-full rounded-full bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                aria-hidden
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-3">
                <span
                  className="block h-2.5 w-16 rounded-md bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                  aria-hidden
                />
                <span
                  className="block h-2.5 w-10 rounded-md bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                  aria-hidden
                />
              </div>
              <span
                className="block h-2 w-full rounded-full bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                aria-hidden
              />
            </div>
          </div>
        ) : usage.status === "error" || usage.status === "unavailable" ? (
          <button
            type="button"
            className="m-0 cursor-pointer border-0 bg-transparent p-0 text-left text-sm text-danger"
            onClick={openEdit}
          >
            {usage.error ?? t("usageUnavailable")}
          </button>
        ) : canToggleFamilies ? (
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {meters.map((meter) => {
              const expanded = expandedFamilyId === meter.id;
              return (
                <div key={meter.id} className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="-mx-1 cursor-pointer rounded-lg border-0 bg-transparent px-1 py-0.5 text-left transition-colors hover:bg-paper-3/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    aria-expanded={expanded}
                    aria-label={t("toggleMeterGroup", {
                      group: meter.label.split(" · ")[0] ?? meter.label,
                    })}
                    onClick={() => toggleFamily(meter.id)}
                  >
                    <MeterBar
                      meter={meter}
                      entranceKey={`${account.id}:${meter.id}`}
                    />
                  </button>
                  {expanded ? (
                    <div className="ml-1 flex flex-col gap-2 border-l border-rule pl-3">
                      {expandedModels.map((model) => (
                        <MeterBar
                          key={model.id}
                          meter={model}
                          compact
                          entranceKey={`${account.id}:${meter.id}:${model.id}`}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            className="flex min-h-0 min-w-0 cursor-pointer flex-col gap-2 border-0 bg-transparent p-0 text-left"
            onClick={openEdit}
            aria-label={t("ariaLabel", {
              provider: meta.displayName,
              name: account.name,
            })}
          >
            {meters.map((meter) => (
              <MeterBar
                key={meter.id}
                meter={meter}
                entranceKey={`${account.id}:${meter.id}`}
              />
            ))}
          </button>
        )}
      </div>
    </div>
  );
}
