/**
 * The home greeting's two pure decisions: which time-of-day string to use, and what to call
 * someone who never set a first name.
 *
 * Both lived inside `home.vue`, where this repo's pure-logic-only test setup can't reach them —
 * so neither the four hour boundaries nor the no-name case had anything pinning it.
 */

export type GreetingKey =
  | "greeting_morning"
  | "greeting_afternoon"
  | "greeting_evening"
  | "greeting_night";

/** `hour` is 0–23 local time. Night wraps both ends of the day. */
export function greetingKey(hour: number): GreetingKey {
  if (hour < 6) return "greeting_night";
  if (hour < 12) return "greeting_morning";
  if (hour < 17) return "greeting_afternoon";
  if (hour < 22) return "greeting_evening";
  return "greeting_night";
}

/**
 * The name in the greeting: the user's own if they set one, otherwise the local part of their
 * email, capitalised.
 *
 * Returns null when neither yields anything, so the caller can greet *without* a name instead of
 * interpolating an empty string into "Good morning, {name}." and rendering a dangling comma.
 */
export function greetingName(
  firstname: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const own = firstname?.trim();
  if (own) return own;
  const local = (email ?? "").split("@")[0].trim();
  if (!local) return null;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
