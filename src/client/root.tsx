import { useEffect, useState } from "react";
import { UsagiApp } from "@/components/usagi-app";
import { useTranslations } from "@/i18n/client";

export function ClientRoot() {
  const t = useTranslations("Auth");
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/auth/status").then((response) => response.json()).then((value: { required: boolean; authenticated: boolean }) => { setRequired(value.required); setAuthenticated(value.authenticated); }); }, []);
  if (!required || authenticated) return <UsagiApp />;
  return <main className="grid min-h-dvh place-items-center p-6"><form className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-rule bg-paper p-8 shadow-lg" onSubmit={async (event) => { event.preventDefault(); setError(null); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); if (!response.ok) { setError(t("invalid")); return; } setAuthenticated(true); }}><h1 className="m-0 font-display text-2xl font-semibold">Usagi</h1><p className="m-0 text-sm text-ink-2">{t("prompt")}</p><input className="w-full rounded-md border border-rule bg-paper-2 px-3.5 py-2.5 text-ink" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />{error ? <p className="m-0 text-sm text-danger">{error}</p> : null}<button className="rounded-md border border-accent bg-accent px-4 py-2.5 font-display font-semibold text-accent-ink" type="submit">{t("login")}</button></form></main>;
}
