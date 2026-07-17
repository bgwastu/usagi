"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatResetCountdown, meterFillClass } from "@/lib/format";
import { clampPercent, remainingPercent } from "@/lib/rate-limit-window";
import type { UsageMeter } from "@/lib/types";

type MeterBarProps = {
  meter: UsageMeter;
  compact?: boolean;
};

type MeterTrackProps = {
  usedPct: number;
  remainingPct: number;
  label: string;
};

function MeterTrack({ usedPct, remainingPct, label }: MeterTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  function showTip() {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTip({ x: rect.left + rect.width / 2, y: rect.top });
  }

  function hideTip() {
    setTip(null);
  }

  const usedLabel = `${Math.round(usedPct)}% used`;

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
            className={`h-full origin-left rounded-full motion-safe:animate-[meter-fill_420ms_var(--ease-out)_both] ${meterFillClass(usedPct)}`}
            style={{ width: `${remainingPct}%` }}
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

export function MeterBar({ meter, compact = false }: MeterBarProps) {
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
            : `${meter.remaining.toLocaleString()} / ${meter.limit!.toLocaleString()} left`
        : meter.used != null
          ? meter.unit === "USD"
            ? `$${meter.used.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
            : `${meter.used.toLocaleString()} used`
          : meter.remaining != null
            ? `${[meter.remaining.toLocaleString(), meter.unit, "left"].filter(Boolean).join(" ")}`
            : remainingPct != null
              ? `${Math.round(remainingPct)}% left`
              : "—";

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
          />
        ) : null}
        {!compact && hasLimit && meter.resetsAt != null ? (
          <p className="m-0 text-xs text-ink-2">
            resets in {formatResetCountdown(meter.resetsAt)}
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

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-0.5" : "gap-1"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs tracking-[0.04em] text-muted uppercase">
          {meter.label}
        </span>
        <span className="font-outlier text-sm tabular-nums text-ink">
          {Math.round(remaining)}% left
        </span>
      </div>
      <MeterTrack
        usedPct={used}
        remainingPct={remaining}
        label={meter.label}
      />
      {!compact ? (
        <p className="m-0 text-xs text-ink-2">
          resets in {formatResetCountdown(meter.resetsAt)}
        </p>
      ) : null}
    </div>
  );
}
