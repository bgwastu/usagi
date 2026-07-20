"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { formatResetCountdown, meterFillClass } from "@/lib/format";
import { clampPercent, remainingPercent } from "@/lib/rate-limit-window";
import type { UsageMeter } from "@/lib/types";

type MeterBarProps = {
  meter: UsageMeter;
  compact?: boolean;
  /** Stable id so fill entrance survives grid remounts after drag. */
  entranceKey?: string;
};

type MeterTrackProps = {
  usedPct: number;
  remainingPct: number;
  label: string;
  usedLabel: string;
  entranceKey?: string;
};

/** Fills that already played — survives RGL remounts on drop/reorder. */
const playedMeterEntrances = new Set<string>();

function MeterTrack({
  usedPct,
  remainingPct,
  label,
  usedLabel,
  entranceKey,
}: MeterTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [entrance, setEntrance] = useState(() => {
    if (!entranceKey) return true;
    if (playedMeterEntrances.has(entranceKey)) return false;
    playedMeterEntrances.add(entranceKey);
    return true;
  });

  function showTip() {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTip({ x: rect.left + rect.width / 2, y: rect.top });
  }

  function hideTip() {
    setTip(null);
  }

  return (
    <>
      <div
        ref={trackRef}
        className="relative -my-1 cursor-default py-1"
        role="meter"
        aria-label={`${label}: ${usedLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remainingPct)}
        onPointerEnter={showTip}
        onPointerLeave={hideTip}
      >
        <div className="h-1.5 overflow-hidden rounded-full bg-meter-track">
          <div
            className={`h-full origin-left rounded-full ${meterFillClass(usedPct)}${
              entrance
                ? " motion-safe:animate-[meter-fill_420ms_var(--ease-out)_both]"
                : ""
            }`}
            style={{ width: `${remainingPct}%` }}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              setEntrance(false);
            }}
          />
        </div>
      </div>
      {tip != null
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-50 rounded-md border border-rule bg-ink px-2 py-1 font-outlier text-xs tabular-nums text-paper shadow-[0_8px_20px_oklch(22%_0.02_40/0.18)] motion-safe:animate-[fade-in_140ms_var(--ease-out)_both]"
              style={{
                left: tip.x,
                top: tip.y,
                transform: "translate(-50%, calc(-100% - 8px))",
              }}
            >
              {usedLabel}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function formatCountdownLabel(
  resetsAt: number | null | undefined,
  emDash: string,
  resetting: string,
): string {
  const raw = formatResetCountdown(resetsAt);
  if (raw === "—") return emDash;
  if (raw === "resetting") return resetting;
  return raw;
}

export function MeterBar({
  meter,
  compact = false,
  entranceKey,
}: MeterBarProps) {
  const t = useTranslations("Meter");

  if (meter.kind === "credits" || meter.kind === "balance") {
    const hasLimit = meter.limit != null && meter.limit > 0;
    const usedPct =
      meter.usedPercent != null
        ? clampPercent(meter.usedPercent)
        : hasLimit && meter.remaining != null
          ? clampPercent(
              ((meter.limit! - meter.remaining) / meter.limit!) * 100,
            )
          : null;
    const remainingPct =
      usedPct != null ? remainingPercent(usedPct) : null;

    const valueText =
      hasLimit && meter.remaining != null
        ? meter.unit === "USD"
          ? `$${meter.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} / $${meter.limit!.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : compact
            ? `${meter.remaining.toLocaleString()} / ${meter.limit!.toLocaleString()}`
            : `${meter.remaining.toLocaleString()} / ${meter.limit!.toLocaleString()} ${t("left")}`
        : meter.used != null
          ? meter.unit === "USD"
            ? `$${meter.used.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
            : `${meter.used.toLocaleString()} ${t("used")}`
          : meter.remaining != null
            ? `${[meter.remaining.toLocaleString(), meter.unit, t("left")].filter(Boolean).join(" ")}`
            : remainingPct != null
              ? t("percentLeft", { percent: Math.round(remainingPct) })
              : t("emDash");

    const usedLabel =
      usedPct != null
        ? t("percentUsed", { percent: Math.round(usedPct) })
        : t("emDash");

    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="shrink-0 text-xs tracking-[0.04em] text-muted uppercase">
            {meter.label}
          </span>
          <span className="min-w-0 truncate text-right font-outlier text-xs tabular-nums text-ink sm:text-sm">
            {valueText}
          </span>
        </div>
        {remainingPct != null && usedPct != null ? (
          <MeterTrack
            usedPct={usedPct}
            remainingPct={remainingPct}
            label={meter.label}
            usedLabel={usedLabel}
            entranceKey={entranceKey}
          />
        ) : null}
        {!compact && hasLimit && meter.resetsAt != null ? (
          <p className="m-0 text-xs text-ink-2">
            {t("resetsIn", {
              time: formatCountdownLabel(
                meter.resetsAt,
                t("emDash"),
                t("resetting"),
              ),
            })}
          </p>
        ) : null}
      </div>
    );
  }

  if (meter.kind !== "window" || meter.usedPercent == null) {
    return null;
  }

  // API / providers store used%; UI shows remaining.
  const used = clampPercent(meter.usedPercent);
  const remaining = remainingPercent(used);
  const usedLabel = t("percentUsed", { percent: Math.round(used) });

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-0.5" : "gap-1"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs tracking-[0.04em] text-muted uppercase">
          {meter.label}
        </span>
        <span className="font-outlier text-sm tabular-nums text-ink">
          {t("percentLeft", { percent: Math.round(remaining) })}
        </span>
      </div>
      <MeterTrack
        usedPct={used}
        remainingPct={remaining}
        label={meter.label}
        usedLabel={usedLabel}
        entranceKey={entranceKey}
      />
      {!compact ? (
        <p className="m-0 text-xs text-ink-2">
          {t("resetsIn", {
            time: formatCountdownLabel(
              meter.resetsAt,
              t("emDash"),
              t("resetting"),
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}
