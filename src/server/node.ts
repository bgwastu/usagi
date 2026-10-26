import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "@/server/app";
import { configurePassword } from "@/server/auth";
import { configureEncryptionKey } from "@/lib/crypto";

configurePassword(process.env.USAGI_PASSWORD);
configureEncryptionKey(process.env.ENCRYPTION_KEY);

/**
 * Provider marks only change when a provider rebrands, and the paths carry no
 * version, so clients may hold them indefinitely. Must be registered before the
 * catch-all static handler; serveStatic's own onFound hook runs after the
 * response is built, which is too late to add headers.
 */
app.use("/providers/*", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
});
app.use("/*", serveStatic({ root: "./dist/client" }));
app.notFound((c) => c.redirect("/"));

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000), hostname: process.env.HOSTNAME ?? "0.0.0.0" });
