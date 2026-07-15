import type { OwningStatus, ReadStatus } from "@/types/book";

// A scan queued locally while offline (or after a failed save), to be replayed
// against POST /api/scans once connectivity/auth returns. Persisted in
// localStorage so it survives reloads. Pure of Vue so it's unit-testable
// (test/offline-queue.spec.ts).

export interface QueuedBook {
  isbn: string;
  status?: ReadStatus;
  owning_status?: OwningStatus;
  rating?: number | null;
}

const QUEUE_KEY = "bookscan_queue_v3";

export function readQueue(): QueuedBook[] {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
}

/** Persists the queue, removing the key entirely once it's empty. */
export function writeQueue(queue: QueuedBook[]): void {
  if (queue.length) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } else {
    localStorage.removeItem(QUEUE_KEY);
  }
}

/** Appends a book unless its ISBN is already queued (dedupe by ISBN). */
export function enqueueBook(book: QueuedBook): void {
  const queue = readQueue();
  if (!queue.some((b) => b.isbn === book.isbn)) writeQueue([...queue, book]);
}

export function removeFromQueue(isbn: string): void {
  writeQueue(readQueue().filter((b) => b.isbn !== isbn));
}
