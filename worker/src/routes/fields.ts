import { Hono } from "hono";
import type { Env } from "../types";
import { authMiddleware } from "../auth";
import { parseTagArray, dedupeTrimmed } from "../library-query";

const fields = new Hono<Env>();

const VALID_TYPES: Set<string> = new Set([
  "text",
  "integer",
  "select",
  "tag",
  "date",
]);

fields.use("*", authMiddleware);

interface FieldDefRow {
  id: number;
  name: string;
  type: string;
  options: string | null;
  sort_order: number;
  required: number;
}

// Cleans a raw `options` body value into a deduped, non-empty string array, or null when there's
// nothing usable — only meaningful for `select` fields, but accepted regardless of the field's
// own type (mirrors how `field_options` is just an inert column for every other type).
function sanitizeOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const cleaned = dedupeTrimmed(
    raw.filter((v): v is string => typeof v === "string"),
  );
  return cleaned.length ? cleaned : null;
}

function parseFieldRow(
  row: FieldDefRow,
): Omit<FieldDefRow, "options"> & { options: string[] } {
  const { options, ...rest } = row;
  return { ...rest, options: parseTagArray(options) };
}

// A select field's stored values must stay a subset of its own options — when a PATCH changes
// `options`, clear any book_custom_fields value that's no longer in the new set, mirroring how
// DELETE /:id/values already scrubs every book's value when a tag is removed. Without this, a
// removed/renamed option would leave books silently holding an orphaned value that only gets
// dropped (with no error surfaced) the next time that book happens to save any custom field.
async function cleanupOrphanedSelectValues(
  db: D1Database,
  userId: number,
  fieldDefId: number,
  validOptions: string[],
): Promise<void> {
  if (!validOptions.length) {
    await db
      .prepare(
        "UPDATE book_custom_fields SET field_value = NULL WHERE user_id = ? AND field_def_id = ? AND field_value IS NOT NULL",
      )
      .bind(userId, fieldDefId)
      .run();
    return;
  }
  const placeholders = validOptions.map(() => "?").join(",");
  await db
    .prepare(
      `UPDATE book_custom_fields SET field_value = NULL
       WHERE user_id = ? AND field_def_id = ? AND field_value IS NOT NULL
         AND field_value NOT IN (${placeholders})`,
    )
    .bind(userId, fieldDefId, ...validOptions)
    .run();
}

fields.get("/", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order, required FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order",
  )
    .bind(userId)
    .all<FieldDefRow>();
  return c.json(results.map((row) => parseFieldRow(row)));
});

fields.post("/", async (c) => {
  const userId = c.get("userId");
  const { name, type = "text", options } = await c.req.json<{
    name: string;
    type?: string;
    options?: unknown;
  }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);
  if (!VALID_TYPES.has(type)) return c.json({ error: "Invalid type" }, 400);
  const cleanOptions = sanitizeOptions(options);

  const maxOrder = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM user_field_definitions WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ max_order: number }>();

  try {
    const result = await c.env.DB.prepare(
      "INSERT INTO user_field_definitions (user_id, field_name, field_type, field_options, sort_order) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        userId,
        name.trim(),
        type,
        cleanOptions ? JSON.stringify(cleanOptions) : null,
        (maxOrder?.max_order ?? -1) + 1,
      )
      .run();
    return c.json(
      {
        id: result.meta.last_row_id,
        name: name.trim(),
        type,
        options: cleanOptions ?? [],
        required: false,
        sort_order: (maxOrder?.max_order ?? -1) + 1,
      },
      201,
    );
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed"))
      return c.json({ error: "A field with that name already exists" }, 409);
    return c.json({ error: "Failed to create field" }, 500);
  }
});

fields.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    name?: string;
    type?: string;
    required?: boolean;
    options?: unknown;
  }>();

  if (body.type !== undefined && !VALID_TYPES.has(body.type)) {
    return c.json({ error: "Invalid type" }, 400);
  }

  const setClauses: string[] = [];
  const bindings: unknown[] = [];

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return c.json({ error: "Name cannot be empty" }, 400);
    setClauses.push("field_name = ?");
    bindings.push(trimmed);
  }
  if (typeof body.type === "string") {
    setClauses.push("field_type = ?");
    bindings.push(body.type);
  }
  if (typeof body.required === "boolean") {
    setClauses.push("required = ?");
    bindings.push(body.required ? 1 : 0);
  }
  if ("options" in body) {
    const cleanOptions = sanitizeOptions(body.options);
    setClauses.push("field_options = ?");
    bindings.push(cleanOptions ? JSON.stringify(cleanOptions) : null);
  }

  if (setClauses.length === 0)
    return c.json({ error: "Nothing to update" }, 400);

  bindings.push(id, userId);
  try {
    const result = await c.env.DB.prepare(
      `UPDATE user_field_definitions SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`,
    )
      .bind(...bindings)
      .run();
    if (!result.meta.changes) return c.json({ error: "Not found" }, 404);

    const updated = await c.env.DB.prepare(
      "SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order, required FROM user_field_definitions WHERE id = ?",
    )
      .bind(id)
      .first<FieldDefRow>();
    if (!updated) return c.json(updated);
    const parsed = parseFieldRow(updated);
    if ("options" in body && parsed.type === "select") {
      await cleanupOrphanedSelectValues(c.env.DB, userId, id, parsed.options);
    }
    return c.json(parsed);
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed"))
      return c.json({ error: "A field with that name already exists" }, 409);
    return c.json({ error: "Failed to update field" }, 500);
  }
});

fields.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare(
    "SELECT 1 FROM user_field_definitions WHERE id = ? AND user_id = ?",
  )
    .bind(id, userId)
    .first();
  if (!owned) return c.json({ error: "Not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM book_custom_fields WHERE field_def_id = ? AND user_id = ?",
    ).bind(id, userId),
    c.env.DB.prepare(
      "DELETE FROM user_field_definitions WHERE id = ? AND user_id = ?",
    ).bind(id, userId),
  ]);
  return c.json({ ok: true });
});

async function userOwnsField(
  db: D1Database,
  userId: number,
  id: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 FROM user_field_definitions WHERE id = ? AND user_id = ?",
    )
    .bind(id, userId)
    .first();
  return !!row;
}

// Distinct tag values used across the user's books for a field — powers the tag autocomplete.
fields.get("/:id/values", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!(await userOwnsField(c.env.DB, userId, id)))
    return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT field_value FROM book_custom_fields WHERE user_id = ? AND field_def_id = ? AND field_value IS NOT NULL",
  )
    .bind(userId, id)
    .all<{ field_value: string }>();

  const distinct = new Set<string>();
  for (const r of results)
    for (const t of parseTagArray(r.field_value)) distinct.add(t);
  return c.json([...distinct].sort((a, b) => a.localeCompare(b)));
});

// Remove a tag value from every book the user owns (global tag delete).
fields.delete("/:id/values", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const value = c.req.query("value");
  if (!value) return c.json({ error: "Value required" }, 400);
  if (!(await userOwnsField(c.env.DB, userId, id)))
    return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, field_value FROM book_custom_fields WHERE user_id = ? AND field_def_id = ? AND field_value IS NOT NULL",
  )
    .bind(userId, id)
    .all<{ id: number; field_value: string }>();

  const updates = [];
  for (const r of results) {
    const tags = parseTagArray(r.field_value);
    if (!tags.includes(value)) continue;
    const remaining = tags.filter((t) => t !== value);
    updates.push(
      c.env.DB.prepare(
        "UPDATE book_custom_fields SET field_value = ? WHERE id = ?",
      ).bind(remaining.length ? JSON.stringify(remaining) : null, r.id),
    );
  }
  if (updates.length) await c.env.DB.batch(updates);
  return c.json({ ok: true });
});

export default fields;
