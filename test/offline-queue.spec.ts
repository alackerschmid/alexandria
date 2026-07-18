import { describe, it, expect, beforeEach } from "vitest";
import {
  readQueue,
  writeQueue,
  enqueueBook,
  removeFromQueue,
  type QueuedBook,
} from "@/utils/offline-queue";

// Minimal in-memory localStorage shim — the util is otherwise pure, so this lets
// the tests run in the plain node environment without jsdom.
function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  (globalThis as any).localStorage = makeLocalStorageStub();
});

const book = (isbn: string, status?: QueuedBook["status"]): QueuedBook => ({
  isbn,
  status,
});

describe("offline-queue", () => {
  it("starts empty", () => {
    expect(readQueue()).toEqual([]);
  });

  it("enqueues a book", () => {
    enqueueBook(book("111", "read"));
    expect(readQueue()).toEqual([{ isbn: "111", status: "read" }]);
  });

  it("dedupes by ISBN — a second enqueue of the same ISBN is a no-op", () => {
    enqueueBook(book("111", "read"));
    enqueueBook(book("111", "unread")); // same ISBN, different status
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe("read"); // original entry preserved
  });

  it("keeps distinct ISBNs", () => {
    enqueueBook(book("111"));
    enqueueBook(book("222"));
    expect(readQueue().map((b) => b.isbn)).toEqual(["111", "222"]);
  });

  it("removes a book by ISBN", () => {
    enqueueBook(book("111"));
    enqueueBook(book("222"));
    removeFromQueue("111");
    expect(readQueue().map((b) => b.isbn)).toEqual(["222"]);
  });

  it("clears the storage key entirely once the queue empties", () => {
    enqueueBook(book("111"));
    removeFromQueue("111");
    expect(readQueue()).toEqual([]);
    expect(localStorage.getItem("bookscan_queue_v3")).toBeNull();
  });

  it("writeQueue([]) removes the key rather than storing '[]'", () => {
    writeQueue([book("111")]);
    writeQueue([]);
    expect(localStorage.getItem("bookscan_queue_v3")).toBeNull();
  });
});
