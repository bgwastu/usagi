"use client";

import { useLocale, useSetLocale, useTranslations } from "@/i18n/client";
import { locales, type Locale } from "@/i18n/config";

export function LocaleSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useTranslations("LocaleSwitcher");

  async function switchLocale(next: Locale) {
    if (next === locale) return;
    setLocale(next);
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-sm border border-rule p-0.5"
      role="group"
      aria-label={t("label")}
    >
      {locales.map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            type="button"
            className={
              active
                ? "cursor-default rounded-sm bg-paper-3 px-2.5 py-1.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-ink"
                : "cursor-pointer rounded-sm px-2.5 py-1.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted transition-colors duration-150 ease-out hover:bg-paper-2 hover:text-ink"
            }
            aria-pressed={active}
            disabled={active}
            onClick={() => {
              void switchLocale(code);
            }}
          >
            {t(code)}
          </button>
        );
      })}
    </div>
  );
}
