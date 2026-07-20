import { listAccounts } from "@/lib/db";
import { buildAccountShell } from "@/lib/usage";
import { UsagiApp } from "@/components/usagi-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialCards;
  try {
    const accounts = await listAccounts();
    initialCards = buildAccountShell(accounts);
  } catch {
    initialCards = undefined;
  }
  return <UsagiApp initialCards={initialCards} />;
}
