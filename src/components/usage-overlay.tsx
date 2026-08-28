"use client";

import { useTranslations } from "@/i18n/client";

export function UsageOverlay() {
  const t = useTranslations("Loading");

  return (
    <div
      className="mb-8 flex items-center gap-3 pb-2"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-px w-32 overflow-hidden bg-rule" aria-hidden>
        <div className="h-full w-1/2 bg-accent motion-safe:animate-[quota-scan_1.1s_var(--ease-in-out)_infinite]" />
      </div>
      <p className="m-0 font-outlier text-[0.6875rem] tracking-[0.08em] text-ink-2 uppercase">
        {t("refreshingQuotas")}
      </p>
    </div>
  );
}
