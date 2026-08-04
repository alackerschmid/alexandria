import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import authRoutes from "./routes/auth";
import booksRoutes from "./routes/books";
import fieldsRoutes from "./routes/fields";
import scansRoutes from "./routes/scans";
import { works, series } from "./routes/catalog";
import statsRoutes from "./routes/stats";
import importRoutes from "./routes/import";
import adminRoutes from "./routes/admin";
import { usageMiddleware } from "./usage";
import { scheduled } from "./sweeper";

const app = new Hono<Env>();

app.use("/api/*", async (c, next) => {
  const origin = c.env.CORS_ORIGIN ?? "*";
  return cors({
    origin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Type", "Retry-After"],
  })(c, next);
});

// After CORS so a preflight doesn't allocate one, before the routes so every handler has it.
app.use("/api/*", usageMiddleware);

app.route("/api/auth", authRoutes);
app.route("/api/books", booksRoutes);
app.route("/api/field-definitions", fieldsRoutes);
app.route("/api/scans", scansRoutes);
app.route("/api/works", works);
app.route("/api/series", series);
app.route("/api/stats", statsRoutes);
app.route("/api/import", importRoutes);
app.route("/api/admin", adminRoutes);

export default { fetch: app.fetch, scheduled };
