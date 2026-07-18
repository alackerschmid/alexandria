import { onUnmounted } from "vue";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";

// Backoff schedule for polling a freshly-scanned book until enrichment resolves.
const POLL_DELAYS = [5000, 8000, 12_000, 15_000, 20_000];

/**
 * Polls `GET /api/scans/:id` while a book's enrichment is `pending`, calling
 * `onResolved` with the fresh row once it finishes. Stops on close/unmount and
 * is skipped for guest/readonly views. Caller drives start/stop from its watchers.
 *
 * If the schedule runs out while the row is still `pending`, `onExhausted` fires.
 * That is not a failure: after a bulk import the sweeper backlog can be hours deep,
 * so the work is legitimately queued. The caller uses it to stop implying imminent
 * progress rather than to report an error.
 */
export function useEnrichmentPoll(options: {
  isOpen: () => boolean;
  scanId: () => number;
  status: () => string | undefined;
  guest: () => boolean;
  readonly: () => boolean;
  onResolved: (data: unknown) => void;
  onExhausted?: () => void;
}) {
  const { apiFetch } = useApi();
  const localeStore = useLocaleStore();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPoll() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce(attempt: number) {
    if (!options.isOpen() || options.guest() || options.status() !== "pending")
      return;
    try {
      const res = await apiFetch(
        `/api/scans/${options.scanId()}?locale=${localeStore.locale}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.enrichment_status !== "pending") {
          options.onResolved(data);
          return;
        }
      }
    } catch {
      /* transient — fall through to retry */
    }
    if (attempt + 1 < POLL_DELAYS.length && options.isOpen()) {
      pollTimer = setTimeout(
        () => pollOnce(attempt + 1),
        POLL_DELAYS[attempt + 1],
      );
    } else if (options.isOpen()) {
      options.onExhausted?.();
    }
  }

  function startEnrichmentPoll() {
    clearPoll();
    if (options.guest() || options.readonly() || options.status() !== "pending")
      return;
    pollTimer = setTimeout(() => pollOnce(0), POLL_DELAYS[0]);
  }

  onUnmounted(clearPoll);

  return { startEnrichmentPoll, clearPoll };
}
