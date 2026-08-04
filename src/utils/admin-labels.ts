/**
 * Fallback display name for a machine string the board has no translation for. The counters are
 * written by the worker and can outrun the frontend across a deploy, so a provider or operation
 * this build has never heard of still has to render as something — "New Provider" rather than a
 * raw `new_provider` or a missing-key warning.
 */
export function humanizeToken(token: string): string {
  return (
    token
      .split(/[_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || token
  );
}
