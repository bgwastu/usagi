import { formatResetCountdown, meterFillClass } from "@/lib/format";
import { clampPercent, remainingPercent } from "@/lib/rate-limit-window";
import type { UsageMeter } from "@/lib/types";

type MeterBarProps = {
  meter: UsageMeter;
  compact?: boolean;
};

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
          <div
            className="h-1.5 overflow-hidden rounded-full bg-meter-track"
            role="meter"
            aria-label={`${meter.label} left`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(remainingPct)}
          >
            <div
              className={`h-full origin-left rounded-full motion-safe:animate-[meter-fill_420ms_var(--ease-out)_both] ${meterFillClass(usedPct)}`}
              style={{ width: `${remainingPct}%` }}
            />
          </div>
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
      <div
        className="h-1.5 overflow-hidden rounded-full bg-meter-track"
        role="meter"
        aria-label={`${meter.label} left`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remaining)}
      >
        <div
          className={`h-full origin-left rounded-full motion-safe:animate-[meter-fill_420ms_var(--ease-out)_both] ${meterFillClass(used)}`}
          style={{ width: `${remaining}%` }}
        />
      </div>
      {!compact ? (
        <p className="m-0 text-xs text-ink-2">
          resets in {formatResetCountdown(meter.resetsAt)}
        </p>
      ) : null}
    </div>
  );
}
