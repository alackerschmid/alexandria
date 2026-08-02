import { SignJWT, jwtVerify } from "jose";
import type { Context, Next } from "hono";
import type { Env } from "./types";

export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export async function signToken(
  userId: number,
  secret: string,
): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
}

// Gate for /api/admin/*, applied after authMiddleware (which is what sets userId). Costs one
// SELECT per admin request — admin traffic is one person, and the flag is flipped by hand in D1,
// so it deliberately isn't cached or carried in the JWT: a token issued before the flip has to
// start working without being re-issued.
export const adminMiddleware = async (c: Context<Env>, next: Next) => {
  const row = await c.env.DB.prepare("SELECT is_admin FROM users WHERE id = ?")
    .bind(c.get("userId"))
    .first<{ is_admin: number }>();
  if (row?.is_admin !== 1) return c.json({ error: "Forbidden" }, 403);
  await next();
};

export const authMiddleware = async (c: Context<Env>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    c.set("userId", payload.userId as number);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
};
