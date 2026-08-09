import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "@/server/app";
import { configurePassword } from "@/server/auth";
import { configureEncryptionKey } from "@/lib/crypto";

configurePassword(process.env.USAGI_PASSWORD);
configureEncryptionKey(process.env.ENCRYPTION_KEY);
app.use("/*", serveStatic({ root: "./dist/client" }));
app.notFound((c) => c.redirect("/"));

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000), hostname: process.env.HOSTNAME ?? "0.0.0.0" });
