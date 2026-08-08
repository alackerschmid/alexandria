import { Hono } from "hono";
import type { Env } from "../types";
import { EMAIL_RE, signToken, authMiddleware } from "../auth";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  DUMMY_PASSWORD_HASH,
} from "../password";
import { rateLimitOrReject, clientIp } from "../rate-limit";
import { parsePreferences, sanitizePreferences } from "../preferences";
import { readJsonBody, INVALID_JSON_BODY } from "../json-body";
import { isUniqueConstraintError } from "../library-query";

const auth = new Hono<Env>();

auth.post("/register", async (c) => {
  const ip = clientIp(c);
  const blocked = await rateLimitOrReject(
    c,
    `register:${ip}`,
    5,
    10,
    "Too many registration attempts — please slow down",
  );
  if (blocked) return blocked;

  const body = await readJsonBody<{ email?: unknown; password?: unknown }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  // typeof guard before EMAIL_RE: `test` stringifies its argument, so a JSON array
  // `["a@b.com"]` passes the regex and then binds to D1 as neither text nor number → 500.
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const { password } = body;

  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ error: "A valid email address is required" }, 400);
  }
  // typeof guard: a non-string JSON value (e.g. a number) has no usable .length
  // and would otherwise be silently coerced by hashPassword's TextEncoder.
  if (typeof password !== "string" || password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const db = c.env.DB;
  const hash = await hashPassword(password);

  let userId: number;
  try {
    const result = await db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .bind(email, hash)
      .run();
    userId = result.meta.last_row_id;
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return c.json(
        { error: "An account with that email already exists" },
        409,
      );
    }
    return c.json({ error: "Failed to create account" }, 500);
  }

  const token = await signToken(userId, c.env.JWT_SECRET);
  // `preferences` is constant-empty here (the INSERT never sets it), but it's returned for the
  // same reason login returns it: the client seeds its preferences store from the auth response
  // rather than spending a round-trip on GET /preferences.
  // is_admin is likewise constant here — the column defaults to 0 and nothing but a manual D1
  // update ever sets it — but the client reads the same field from both auth responses.
  return c.json(
    { token, email, firstname: null, preferences: {}, is_admin: false },
    201,
  );
});

auth.post("/login", async (c) => {
  const ip = clientIp(c);
  const blocked = await rateLimitOrReject(
    c,
    `login:${ip}`,
    10,
    1,
    "Too many login attempts — please slow down",
  );
  if (blocked) return blocked;

  const body = await readJsonBody<{ email?: unknown; password?: unknown }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const { password } = body;

  if (!email || typeof password !== "string" || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const db = c.env.DB;
  const user = await db
    .prepare(
      "SELECT id, password_hash, firstname, preferences, is_admin FROM users WHERE email = ?",
    )
    .bind(email)
    .first<{
      id: number;
      password_hash: string;
      firstname: string | null;
      preferences: string | null;
      is_admin: number;
    }>();

  // Always run a verification, even with no row: short-circuiting on `!user` answered an
  // unregistered email ~100k PBKDF2 iterations sooner than a wrong password, which is a
  // membership oracle. Registration's 409 already leaks existence, but that's a fixable
  // separate hole and this one is a two-line close.
  const passwordOk = await verifyPassword(
    password,
    user?.password_hash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !passwordOk) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Lazy migration to the current hash scheme now that the plaintext is in hand.
  // Best-effort and off the critical path: a failed rehash must not fail a
  // verified login (the next login simply retries it).
  if (needsRehash(user.password_hash)) {
    c.executionCtx.waitUntil(
      hashPassword(password)
        .then((hash) =>
          db
            .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(hash, user.id)
            .run(),
        )
        .catch((e) => console.error("password rehash failed", e)),
    );
  }

  const token = await signToken(user.id, c.env.JWT_SECRET);
  // Carried on the same row we already read to verify the password, so this costs no extra
  // query and saves the client a GET /preferences before it can paint the user's look.
  return c.json({
    token,
    email,
    firstname: user.firstname ?? null,
    preferences: parsePreferences(user.preferences),
    // Rides the same row, so it also costs nothing. Only decides whether the client shows the
    // admin nav link — every /api/admin request re-checks the column server-side regardless.
    is_admin: user.is_admin === 1,
  });
});

auth.patch("/me", authMiddleware, async (c) => {
  const body = await readJsonBody<{
    firstname?: string;
    email?: string;
    currentPassword?: string;
    newPassword?: string;
  }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const db = c.env.DB;
  const userId = c.get("userId");
  const result: Record<string, unknown> = {};

  // Validate everything up front and write nothing until the guard block below has passed:
  // a request carrying {firstname, email, currentPassword} with a wrong password must change
  // nothing at all, or the 401 the client sees contradicts the state the server kept.
  let newFirstname: string | null = null;
  if (typeof body.firstname === "string") {
    newFirstname = body.firstname.trim();
    if (!newFirstname)
      return c.json({ error: "A valid first name is required" }, 400);
  }

  const changingEmail = typeof body.email === "string";
  const changingPassword =
    typeof body.currentPassword === "string" &&
    typeof body.newPassword === "string";

  let newEmail: string | null = null;
  if (changingEmail) {
    newEmail = body.email!.trim().toLowerCase();
    if (!EMAIL_RE.test(newEmail))
      return c.json({ error: "A valid email address is required" }, 400);
  }
  if (changingPassword && body.newPassword!.length < 8) {
    return c.json(
      { error: "New password must be at least 8 characters" },
      400,
    );
  }

  if (newFirstname === null && !changingEmail && !changingPassword) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  // Both email and password changes require re-proving the current password — a leaked bearer
  // token (all authMiddleware checks) must not be enough to rebind the account's identity.
  // Verification attempts are rate-limited per user, since a token holder would otherwise get
  // unlimited password guesses against this endpoint.
  if (changingEmail || changingPassword) {
    const blocked = await rateLimitOrReject(
      c,
      `me-verify:${userId}`,
      10,
      1,
      "Too many attempts — please slow down",
    );
    if (blocked) return blocked;

    if (!body.currentPassword) {
      return c.json(
        {
          error:
            "Current password is required to change your email or password",
        },
        400,
      );
    }
    const user = await db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(userId)
      .first<{ password_hash: string }>();
    if (
      !user ||
      !(await verifyPassword(body.currentPassword, user.password_hash))
    ) {
      return c.json({ error: "Current password is incorrect" }, 401);
    }
  }

  // One UPDATE for every field the request carried: all three live on `users`, so a single
  // statement is atomic by construction. Three sequential UPDATEs left the earlier ones applied
  // when a later one failed (a taken email 409s after the firstname had already been written).
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (newFirstname !== null) {
    sets.push("firstname = ?");
    binds.push(newFirstname);
    result.firstname = newFirstname;
  }
  if (changingEmail) {
    sets.push("email = ?");
    binds.push(newEmail);
    result.email = newEmail;
  }
  if (changingPassword) {
    sets.push("password_hash = ?");
    binds.push(await hashPassword(body.newPassword!));
    result.passwordChanged = true;
  }

  try {
    await db
      .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, userId)
      .run();
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return c.json({ error: "That email address is already in use" }, 409);
    }
    return c.json({ error: "Failed to update account" }, 500);
  }

  return c.json(result);
});

auth.get("/preferences", authMiddleware, async (c) => {
  const row = await c.env.DB.prepare("SELECT preferences FROM users WHERE id = ?")
    .bind(c.get("userId"))
    .first<{ preferences: string | null }>();
  return c.json({ preferences: parsePreferences(row?.preferences ?? null) });
});

// Full replace, not a merge: the client holds the complete preference set in memory and
// sends all of it, so a key it deleted actually disappears.
auth.put("/preferences", authMiddleware, async (c) => {
  const body = await readJsonBody<{ preferences?: unknown }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const preferences = sanitizePreferences(body.preferences);
  if (!preferences) {
    return c.json({ error: "Invalid preferences payload" }, 400);
  }

  await c.env.DB.prepare("UPDATE users SET preferences = ? WHERE id = ?")
    .bind(JSON.stringify(preferences), c.get("userId"))
    .run();
  return c.body(null, 204);
});

auth.delete("/me", authMiddleware, async (c) => {
  const body = await readJsonBody<{ password?: string }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const { password } = body;
  if (typeof password !== "string" || !password) {
    return c.json(
      { error: "Password is required to delete your account" },
      400,
    );
  }

  const userId = c.get("userId");
  // Shares the me-verify:<userId> budget with PATCH /me — both endpoints re-verify the current
  // password against a bearer token alone, so a leaked token shouldn't get unlimited guesses here.
  const blocked = await rateLimitOrReject(
    c,
    `me-verify:${userId}`,
    10,
    1,
    "Too many attempts — please slow down",
  );
  if (blocked) return blocked;

  const db = c.env.DB;
  const user = await db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(userId)
    .first<{ password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Incorrect password" }, 401);
  }

  await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return new Response(null, { status: 204 });
});

export default auth;
