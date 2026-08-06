import { computed } from "vue";
import { useApi } from "@/composables/useApi";
import { NEXT_STATUS } from "@/composables/useBookStatus";
import { useAuthStore } from "@/stores/auth";
import { useGuestStore } from "@/stores/guest";
import { workSiblings } from "@/utils/book-display";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";

export interface ScanStatusOptions {
  /** The page's full book list, so a rating/review write can fan out across every owned edition
   *  of the same work (they share one stored value — see `workSiblings`). Omit when the page
   *  holds a single book. */
  books?: () => Book[];
}

// Centralises the optimistic reading-status mutation that the library list performs.
// Guest scans are updated in localStorage; authenticated scans PATCH the API and roll
// back the optimistic change on failure, re-throwing so the caller can surface a toast.
export function useScanStatus(options: ScanStatusOptions = {}) {
  const { apiFetch } = useApi();
  const authStore = useAuthStore();
  const guestStore = useGuestStore();
  const isGuest = computed(() => !authStore.isAuthenticated);

  async function setStatus(book: Book, next: ReadStatus): Promise<void> {
    if (book.status === next) return;
    if (isGuest.value) {
      guestStore.setStatus(book.isbn, next);
      return;
    }
    const prev = book.status;
    book.status = next;
    try {
      const res = await apiFetch(`/api/scans/${book.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      // Only roll back if nothing newer has superseded this optimistic write — the same guard
      // setOwningStatus and setWorkField carry. Without it, a second rapid status cycle that
      // already succeeded gets reverted by the first one's failure.
      if (book.status === next) book.status = prev;
      throw e;
    }
  }

  function cycleStatus(book: Book): Promise<void> {
    if (isGuest.value) {
      guestStore.cycleStatus(book.isbn);
      return Promise.resolve();
    }
    return setStatus(book, NEXT_STATUS[book.status]);
  }

  async function setOwningStatus(
    book: Book,
    next: OwningStatus,
  ): Promise<void> {
    if (book.owning_status === next) return;
    if (isGuest.value) {
      guestStore.setOwningStatus(book.isbn, next);
      return;
    }
    const prev = book.owning_status;
    book.owning_status = next;
    try {
      const res = await apiFetch(`/api/scans/${book.id}`, {
        method: "PATCH",
        body: JSON.stringify({ owning_status: next }),
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      // Only roll back if nothing newer has superseded this optimistic write
      // (e.g. a second rapid toggle that already succeeded).
      if (book.owning_status === next) book.owning_status = prev;
      throw e;
    }
  }

  // Shared by setRating/setReview: rating and review are stored per work, not per scan, so one
  // value is shared by every owned edition. Writing only to the Book instance the caller handed
  // us would leave the siblings stale, and the collapsed work-card (useEditionGrouping picks one
  // representative) would disagree with the edition carousel until the next refetch. Each sibling
  // rolls back individually, skipping any a newer write has superseded — the same guard
  // setOwningStatus uses.
  async function setWorkField<K extends "rating" | "review">(
    book: Book,
    field: K,
    next: Book[K],
    body: Record<string, unknown>,
  ): Promise<void> {
    const siblings = workSiblings(book, options.books?.());
    const previous = siblings.map((b) => b[field] ?? null);
    for (const sibling of siblings) sibling[field] = next;
    try {
      const res = await apiFetch(`/api/scans/${book.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      // The response carries what only the server knows: the row's new `updated_at` (which the
      // detail view shows as the review's "written" date — without this it keeps showing the
      // previous one, and a first-ever review shows none at all) and the authoritative `work_id`,
      // which the route may have just created via `linkWork` for a book the client still has as
      // unlinked. Applying it means the *next* write fans out across the full sibling set.
      const saved = (await res.json()) as {
        work_id?: number | null;
        review_updated_at?: string | null;
      };
      for (const sibling of siblings) {
        if (saved.review_updated_at !== undefined) {
          sibling.review_updated_at = saved.review_updated_at;
        }
        if (saved.work_id != null && sibling.work_id == null) {
          sibling.work_id = saved.work_id;
        }
      }
    } catch (e) {
      siblings.forEach((sibling, i) => {
        if (sibling[field] === next) sibling[field] = previous[i] as Book[K];
      });
      throw e;
    }
  }

  async function setRating(book: Book, next: number | null): Promise<void> {
    if (book.rating === next) return;
    if (isGuest.value) {
      guestStore.setRating(book.isbn, next);
      return;
    }
    return setWorkField(book, "rating", next, { rating: next });
  }

  async function setReview(book: Book, next: string | null): Promise<void> {
    const normalized = next?.trim() || null;
    if ((book.review ?? null) === normalized) return;
    if (isGuest.value) {
      guestStore.setReview(book.isbn, normalized);
      return;
    }
    return setWorkField(book, "review", normalized, { review: normalized });
  }

  return { setStatus, cycleStatus, setOwningStatus, setRating, setReview };
}
