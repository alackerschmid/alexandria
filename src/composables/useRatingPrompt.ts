import { ref } from "vue";
import type { Book, ReadStatus } from "@/types/book";

// Owns the rating/review dialog for a page. It lives at page level rather than inside
// BookDetail because marking a book read from a library card — with no detail dialog open —
// has to be able to raise the same prompt; BookDetail just asks its parent to open it.
export function useRatingPrompt() {
  const promptBook = ref<Book | null>(null);
  const promptOpen = ref(false);

  function openPrompt(book: Book) {
    promptBook.value = book;
    promptOpen.value = true;
  }

  // Fires on the transition *into* "read" only — re-picking a status a book already has
  // shouldn't nag, and neither should any other status change.
  function promptIfRead(book: Book, previousStatus: ReadStatus) {
    if (book.status === "read" && previousStatus !== "read") openPrompt(book);
  }

  return { promptBook, promptOpen, openPrompt, promptIfRead };
}
