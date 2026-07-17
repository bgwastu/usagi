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
    const pct =
      meter.usedPercent != null
        ? Math.min(100, Math.max(0, meter.usedPercent))
        : hasLimit && meter.remaining != null
          ? Math.min(
              100,
              Math.max(0, ((meter.limit! - meter.remaining) / meter.limit!) * 100),
            )
          : null;

    return (
      <div className={`flex min-w-0 flex-col ${compact ? "gap-0.5" : "gap-1"}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs tracking-[0.04em] text-muted uppercase">
            {meter.label}
          </span>
          <span className="font-outlier text-sm tabular-nums text-ink">
            {hasLimit && meter.remaining != null
              ? meter.unit === "USD"
                ? `$${meter.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} / $${meter.limit!.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : `${meter.remaining.toLocaleString()} / ${meter.limit!.toLocaleString()}`
              : meter.used != null
                ? meter.unit === "USD"
                  ? `$${meter.used.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
                  : `${meter.used.toLocaleString()} used`
                : meter.remaining != null
                  ? `${meter.remaining.toLocaleString()} ${meter.unit ?? ""}`.trim()
                  : pct != null
                    ? `${Math.round(pct)}%`
                    : "—"}
          </span>
        </div>
        {pct != null ? (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-meter-track"
            role="meter"
            aria-label={`${meter.label} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div
              className={`h-full origin-left rounded-full motion-safe:animate-[meter-fill_420ms_var(--ease-out)_both] ${meterFillClass(pct)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        {!compact && hasLimit ? (
          <p className="m-0 text-xs text-ink-2">
            {meter.unit === "USD" && meter.remaining != null
              ? `$${meter.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} remaining this cycle`
              : `${meter.remaining?.toLocaleString()} remaining this cycle`}
            {meter.resetsAt != null
              ? ` · resets in ${formatResetCountdown(meter.resetsAt)}`
              : null}
          </p>
        ) : null}
      </div>
    );
  }

  if (meter.kind !== "window" || meter.usedPercent == null) {
    return null;
  }

  // API / providers store used%; ChatGPT & Codex UIs show remaining.
  const used = clampPercent(meter.usedPercent);
  const remaining = remainingPercent(used);

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-0.5" : "gap-1"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs tracking-[0.04em] text-muted uppercase">
          {meter.label}
        </span>
        <span className="font-outlier text-sm tabular-nums text-ink">
          {Math.round(remaining)}%
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-meter-track"
        role="meter"
        aria-label={`${meter.label} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remaining)}
      >
        <div
          className={`h-full origin-left rounded-full motion-safe:animate-[meter-fill_420ms_var(--ease-out)_both] ${meterFillClass(used)}`}
          style={{ width: `${used}%` }}
        />
      </div>
      {!compact ? (
        <p className="m-0 text-xs text-ink-2">
          remaining · resets in {formatResetCountdown(meter.resetsAt)}
        </p>
      ) : null}
    </div>
  );
}
