import { Hono } from "hono";
import { cors } from "hono/cors";
import { api } from "@/server/routes";

const corsMw = cors({ origin: (origin) => origin || "*", credentials: true });

export const app = new Hono();
app.use("/api", corsMw);
app.use("/api/*", corsMw);
app.route("/api", api);
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
});
