import { ref } from "vue";
import { useApi } from "@/composables/useApi";

export interface DeletableBook {
  id: number;
  title?: string | null;
  isbn?: string | null;
}

export function useDeleteScan(options: {
  onDeleted: (book: DeletableBook) => void;
  // Return true when the caller handled deletion locally (e.g. guest mode) and
  // the API call should be skipped entirely.
  onGuestDelete?: (book: DeletableBook) => boolean;
}) {
  const { apiFetch } = useApi();

  const deleteDialog = ref(false);
  const bookToDelete = ref<DeletableBook | null>(null);
  const deleting = ref(false);
  const deleteFailed = ref(false);

  function openDeleteDialog(book: DeletableBook) {
    bookToDelete.value = book;
    deleteFailed.value = false;
    deleteDialog.value = true;
  }

  async function confirmDelete() {
    const book = bookToDelete.value;
    if (!book) return;
    if (options.onGuestDelete?.(book)) {
      deleteDialog.value = false;
      bookToDelete.value = null;
      return;
    }
    deleting.value = true;
    deleteFailed.value = false;
    try {
      const res = await apiFetch(`/api/scans/${book.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      deleteDialog.value = false;
      options.onDeleted(book);
      bookToDelete.value = null;
    } catch {
      deleteFailed.value = true;
    } finally {
      deleting.value = false;
    }
  }

  return { deleteDialog, bookToDelete, deleting, deleteFailed, openDeleteDialog, confirmDelete };
}
