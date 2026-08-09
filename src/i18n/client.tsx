import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import en from "../../messages/en.json";
import id from "../../messages/id.json";
import { defaultLocale, isLocale, localeCookieName, type Locale } from "./config";

type Messages = typeof en;
const dictionaries: Record<Locale, Messages> = { en, id: id as Messages };

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({ locale: defaultLocale, setLocale: () => undefined });

function getInitialLocale(): Locale {
  const stored = document.cookie
    .split(";")
    .map((value) => value.trim().split("="))
    .find(([name]) => name === localeCookieName)?.[1];
  return isLocale(stored) ? stored : defaultLocale;
}

function interpolate(value: string, values?: Record<string, unknown>): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => {
    const next = values?.[key];
    return next == null ? `{${key}}` : String(next);
  });
}

function resolve(messages: Messages, namespace: string, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value == null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[part];
  }, messages[namespace as keyof Messages]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  function setLocale(next: Locale) {
    setLocaleState(next);
    document.cookie = `${localeCookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext).locale;
}

export function useSetLocale() {
  return useContext(LocaleContext).setLocale;
}

export function useTranslations(namespace: keyof Messages) {
  const { locale } = useContext(LocaleContext);
  const messages = dictionaries[locale];
  return useMemo(() => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const value = resolve(messages, namespace, key);
      return typeof value === "string" ? interpolate(value, values) : key;
    };
    t.rich = (key: string, values: Record<string, (chunks: string) => ReactNode>) => {
      const value = String(resolve(messages, namespace, key) ?? key);
      const parts = value.split(/(<\w+>.*?<\/\w+>)/g).filter(Boolean);
      return parts.map((part) => {
        const match = part.match(/^<(\w+)>(.*?)<\/\w+>$/);
        if (!match) return part;
        return values[match[1]]?.(match[2]) ?? match[2];
      });
    };
    return t;
  }, [messages, namespace]);
}
