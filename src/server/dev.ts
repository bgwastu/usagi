import { createServer } from "vite";
import { getRequestListener } from "@hono/node-server";
import { app } from "@/server/app";
import { configurePassword } from "@/server/auth";
import { configureEncryptionKey } from "@/lib/crypto";

configurePassword(process.env.USAGI_PASSWORD);
configureEncryptionKey(process.env.ENCRYPTION_KEY);

const handle = getRequestListener(app.fetch);

const vite = await createServer({
  plugins: [
    {
      name: "usagi-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathName = req.url?.split("?")[0] ?? "";
          if (!pathName.startsWith("/api")) {
            next();
            return;
          }
          try {
            await handle(req, res);
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
});

await vite.listen();
vite.printUrls();

const shutdown = async () => {
  await vite.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
