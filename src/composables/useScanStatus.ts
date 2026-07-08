import { computed } from "vue";
import { useApi } from "@/composables/useApi";
import { NEXT_STATUS } from "@/composables/useBookStatus";
import { useAuthStore } from "@/stores/auth";
import { useGuestStore } from "@/stores/guest";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";

// Centralises the optimistic reading-status mutation that the library list performs.
// Guest scans are updated in localStorage; authenticated scans PATCH the API and roll
// back the optimistic change on failure, re-throwing so the caller can surface a toast.
export function useScanStatus() {
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
      book.status = prev;
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

  return { setStatus, cycleStatus, setOwningStatus };
}
