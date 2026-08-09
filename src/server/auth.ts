import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

const COOKIE = "usagi_session";
const runtime = globalThis as typeof globalThis & { __usagiPassword?: string };
const sessionValue = (password: string) => createHmac("sha256", password).update("usagi-session-v1").digest("base64url");

export function configurePassword(password?: string) { runtime.__usagiPassword = password?.trim() || ""; }
export function configuredPassword() { return runtime.__usagiPassword ?? process.env.USAGI_PASSWORD?.trim() ?? ""; }
export function passwordRequired() { return configuredPassword().length > 0; }

export function authStatus(c: Context) { return c.json({ required: passwordRequired(), authenticated: !passwordRequired() || isAuthenticated(c) }); }
export function isAuthenticated(c: Context) {
  const password = configuredPassword();
  if (!password) return true;
  const actual = getCookie(c, COOKIE);
  const expected = sessionValue(password);
  if (!actual) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function login(c: Context, password: string) {
  const expected = configuredPassword();
  const a = Buffer.from(password); const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return false;
  setCookie(c, COOKIE, sessionValue(expected), { httpOnly: true, sameSite: "Lax", secure: c.req.url.startsWith("https://"), path: "/", maxAge: 60 * 60 * 24 * 30 });
  return true;
}

export function logout(c: Context) { deleteCookie(c, COOKIE, { path: "/" }); }

export const requireAuth = createMiddleware(async (c, next) => {
  if (!isAuthenticated(c)) return c.json({ error: "Authentication required" }, 401);
  await next();
});
