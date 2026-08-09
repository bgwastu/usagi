import { Hono } from "hono";
import { cors } from "hono/cors";
import { api } from "@/server/routes";

export const app = new Hono();
app.use("/api/*", cors({ origin: (origin) => origin || "*", credentials: true }));
app.route("/api", api);
app.onError((error, c) => { console.error(error); return c.json({ error: "Internal server error" }, 500); });
