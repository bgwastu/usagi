"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("LocaleSwitcher");

  async function switchLocale(next: Locale) {
    if (next === locale) return;
    await setLocaleAction(next);
    router.refresh();
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-rule p-0.5"
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
                ? "cursor-default rounded-sm bg-paper-3 px-2.5 py-1.5 font-display text-xs font-semibold tracking-[0.04em] text-ink"
                : "cursor-pointer rounded-sm px-2.5 py-1.5 font-display text-xs font-medium tracking-[0.04em] text-muted transition-colors duration-120 ease-out hover:bg-paper-2 hover:text-ink"
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
