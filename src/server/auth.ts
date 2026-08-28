import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

const COOKIE = "usagi_session";
const runtime = globalThis as typeof globalThis & { __usagiPassword?: string };
const sessionValue = (password: string) =>
  createHmac("sha256", password).update("usagi-session-v1").digest("base64url");

export function configurePassword(password?: string) {
  runtime.__usagiPassword = password?.trim() || "";
}
export function configuredPassword() {
  return runtime.__usagiPassword ?? process.env.USAGI_PASSWORD?.trim() ?? "";
}
export function passwordRequired() {
  return configuredPassword().length > 0;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Bearer token or X-Usagi-Password — the shared USAGI_PASSWORD, not the cookie HMAC. */
function presentedPassword(c: Context): string | null {
  const authorization = c.req.header("Authorization");
  if (authorization) {
    const match = /^Bearer\s+(\S+)/i.exec(authorization);
    if (match?.[1]) return match[1];
  }
  const header = c.req.header("X-Usagi-Password");
  return header && header.length > 0 ? header : null;
}

export function authStatus(c: Context) {
  return c.json({
    required: passwordRequired(),
    authenticated: !passwordRequired() || isAuthenticated(c),
  });
}

export function isAuthenticated(c: Context) {
  const password = configuredPassword();
  if (!password) return true;
  const presented = presentedPassword(c);
  if (presented != null) return safeEqual(presented, password);
  const actual = getCookie(c, COOKIE);
  const expected = sessionValue(password);
  if (!actual) return false;
  return safeEqual(actual, expected);
}

export function login(c: Context, password: string) {
  const expected = configuredPassword();
  if (!expected || !safeEqual(password, expected)) return false;
  setCookie(c, COOKIE, sessionValue(expected), {
    httpOnly: true,
    sameSite: "Lax",
    secure: c.req.url.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export function unauthorized(c: Context) {
  if (passwordRequired()) {
    c.header("WWW-Authenticate", 'Bearer realm="usagi"');
  }
  return c.json({ error: "Authentication required" }, 401);
}

export const requireAuth = createMiddleware(async (c, next) => {
  if (!isAuthenticated(c)) return unauthorized(c);
  await next();
});
