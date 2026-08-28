"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/i18n/client";

const secondaryBtnClass =
  "cursor-pointer rounded-sm border border-rule bg-transparent px-3.5 py-2 text-sm text-ink transition-colors duration-150 ease-out hover:bg-paper-2";

type ApiDocsModalProps = {
  onClose: () => void;
};

export function ApiDocsModal({ onClose }: ApiDocsModalProps) {
  const t = useTranslations("Api");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const origin = useMemo(
    () =>
      typeof window === "undefined"
        ? "http://localhost:3000"
        : window.location.origin,
    [],
  );
  const [passwordRequired, setPasswordRequired] = useState<boolean | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const curl = passwordRequired
    ? `curl -H "Authorization: Bearer $USAGI_PASSWORD" ${origin}/api`
    : `curl ${origin}/api`;

  useEffect(() => {
    void fetch("/api/auth/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((value: { required?: boolean }) => {
        setPasswordRequired(Boolean(value.required));
      })
      .catch(() => {
        setPasswordRequired(false);
      });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-[clamp(1rem,3vw,2rem)]">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer border-0 bg-scrim motion-safe:animate-[fade-in_220ms_var(--ease-out)_both]"
        aria-label={t("closeDialog")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative max-h-[min(90vh,44rem)] w-full max-w-136 overflow-auto rounded-md border border-rule bg-paper p-8 motion-safe:animate-[modal-in_220ms_var(--ease-out)_both]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[0.6875rem] tracking-[0.08em] text-muted uppercase">
              {t("kicker")}
            </p>
            <h2
              id={titleId}
              className="m-0 font-display text-[1.5rem] font-semibold tracking-[-0.02em]"
            >
              {t("title")}
            </h2>
          </div>
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            {t("close")}
          </button>
        </header>

        <div className="grid gap-6">
          <p className="m-0 max-w-prose text-ink-2">{t("intro")}</p>

          <div>
            <p className="m-0 text-[0.6875rem] font-medium tracking-[0.04em] text-muted uppercase">
              {t("endpoints")}
            </p>
            <p className="m-0 mt-1.5 font-outlier text-[0.8125rem] text-ink">
              GET /api
            </p>
            <p className="m-0 mt-2 text-sm text-ink-2">{t("forceHint")}</p>
          </div>

          {passwordRequired !== null ? (
            <div className="grid gap-2">
              <p className="m-0 text-[0.6875rem] font-medium tracking-[0.04em] text-muted uppercase">
                {t("curl")}
              </p>
              <div className="flex min-w-0 items-center overflow-hidden rounded-sm border border-rule bg-paper-2">
                <pre className="m-0 min-w-0 flex-1 overflow-x-auto px-3.5 py-2.5 font-outlier text-[0.8125rem] leading-relaxed whitespace-nowrap text-ink">
                  {curl}
                </pre>
                <button
                  type="button"
                  className="shrink-0 cursor-pointer border-0 border-l border-rule bg-transparent px-3 text-sm text-ink transition-colors duration-150 ease-out hover:bg-paper-3"
                  onClick={() => {
                    void copy();
                  }}
                >
                  {copied ? t("copied") : t("copy")}
                </button>
              </div>
            </div>
          ) : null}

          {passwordRequired ? (
            <p className="m-0 text-sm text-ink-2">{t("authNote")}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
