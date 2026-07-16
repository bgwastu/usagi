export function formatResetCountdown(
  resetsAt: number | null | undefined,
  now = Date.now(),
): string {
  if (resetsAt == null) return "—";
  const delta = resetsAt - now;
  if (delta <= 0) return "resetting";

  const totalSec = Math.round(delta / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}

export function meterFillClass(usedPercent: number): string {
  if (usedPercent >= 90) return "bg-meter-crit";
  if (usedPercent >= 75) return "bg-meter-warn";
  return "bg-accent";
}
