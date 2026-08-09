import { listAccounts } from "@/lib/db";

await listAccounts();
console.log("Self-hosted SQLite schema is ready.");
