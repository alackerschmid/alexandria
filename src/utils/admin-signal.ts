/**
 * Shared severity vocabulary for the admin board. Kept apart from the data helpers in
 * `admin-usage.ts` because this is the one piece that maps state to *appearance* — several
 * components colour themselves from the same three levels, and they must agree.
 */

/** `neutral` is "no reading yet" (loading or failed), not a fourth severity. */
export type SignalLevel = "neutral" | "ok" | "warning" | "critical";

export function signalText(level: SignalLevel): string {
  switch (level) {
    case "ok":
      return "text-signal-ok";
    case "warning":
      return "text-signal-warn";
    case "critical":
      return "text-signal-critical";
    default:
      return "text-text-secondary";
  }
}

export function signalBg(level: SignalLevel): string {
  switch (level) {
    case "ok":
      return "bg-signal-ok";
    case "warning":
      return "bg-signal-warn";
    case "critical":
      return "bg-signal-critical";
    default:
      return "bg-charcoal-border";
  }
}

export function signalBorder(level: SignalLevel): string {
  switch (level) {
    case "ok":
      return "border-signal-ok";
    case "warning":
      return "border-signal-warn";
    case "critical":
      return "border-signal-critical";
    default:
      return "border-charcoal-border";
  }
}

/** Share of enrichment runs that failed, banded: a few failures are normal, a lot are not. */
export function failureLevel(percent: number): SignalLevel {
  if (percent >= 25) return "critical";
  if (percent >= 10) return "warning";
  return "ok";
}
