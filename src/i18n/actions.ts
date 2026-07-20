"use server";

import { cookies } from "next/headers";
import {
  isLocale,
  localeCookieName,
  type Locale,
} from "./config";

export async function setLocaleAction(locale: Locale) {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(localeCookieName, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
