/** Matches openai/codex `get_limits_duration` (±5% window tolerance). */
const WINDOW_DEFS = [
  { seconds: 5 * 60 * 60, label: "5-hour" },
  { seconds: 24 * 60 * 60, label: "Daily" },
  { seconds: 7 * 24 * 60 * 60, label: "Weekly" },
  { seconds: 30 * 24 * 60 * 60, label: "Monthly" },
  { seconds: 365 * 24 * 60 * 60, label: "Annual" },
] as const;

/** Secondary sometimes reports 24h while reset cadence is weekly (openclaw heuristic). */
const WEEKLY_RESET_GAP_SECONDS = 3 * 24 * 60 * 60;

function isApproximateWindow(seconds: number, expected: number): boolean {
  return seconds >= expected * 0.95 && seconds <= expected * 1.05;
}

export function labelForWindowSeconds(windowSeconds: number): string | null {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return null;
  for (const def of WINDOW_DEFS) {
    if (isApproximateWindow(windowSeconds, def.seconds)) return def.label;
  }
  const hours = Math.round(windowSeconds / 3600);
  if (hours > 0) return `${hours}h`;
  return null;
}

export function labelCodexRateLimitWindow(input: {
  windowSeconds?: number;
  isSecondary: boolean;
  resetAtSec?: number;
  otherResetAtSec?: number;
  nowSec?: number;
}): string {
  const fromDuration =
    input.windowSeconds != null
      ? labelForWindowSeconds(input.windowSeconds)
      : null;

  if (fromDuration) {
    // Prefer weekly when secondary looks daily but resets ~a week after primary.
    if (
      input.isSecondary &&
      fromDuration === "Daily" &&
      typeof input.resetAtSec === "number" &&
      typeof input.otherResetAtSec === "number" &&
      input.resetAtSec - input.otherResetAtSec >= WEEKLY_RESET_GAP_SECONDS
    ) {
      return "Weekly";
    }
    return fromDuration;
  }

  // No usable duration: infer from how far out reset_at is (covers slot/duration drift).
  if (typeof input.resetAtSec === "number") {
    const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
    const untilReset = input.resetAtSec - nowSec;
    if (untilReset >= WEEKLY_RESET_GAP_SECONDS) return "Weekly";
    if (untilReset >= 20 * 60 * 60) return "Daily";
  }

  return input.isSecondary ? "Weekly" : "5-hour";
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function remainingPercent(usedPercent: number): number {
  return clampPercent(100 - usedPercent);
}

export function resetAtMs(
  resetAt: number | undefined,
  resetAfterSeconds?: number,
  now = Date.now(),
): number | null {
  if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
    return resetAt < 1e12 ? resetAt * 1000 : resetAt;
  }
  if (
    typeof resetAfterSeconds === "number" &&
    Number.isFinite(resetAfterSeconds) &&
    resetAfterSeconds >= 0
  ) {
    return now + resetAfterSeconds * 1000;
  }
  return null;
}
