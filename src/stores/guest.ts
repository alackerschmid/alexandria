import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { NEXT_STATUS } from "@/composables/useBookStatus";
import type { Book, ReadStatus } from "@/types/book";

const STORAGE_KEY = "guest_scans";
const MAX_GUEST_SCANS = 3;
const API_BASE = import.meta.env.VITE_API_URL || "";

function load(): Book[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export const useGuestStore = defineStore("guest", () => {
  const scans = ref<Book[]>(load());

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scans.value));
  }

  const remaining = computed(() =>
    Math.max(0, MAX_GUEST_SCANS - scans.value.length),
  );
  const isAtLimit = computed(() => scans.value.length >= MAX_GUEST_SCANS);

  function addScan(
    book: Omit<Book, "id" | "status" | "created_at">,
    status: ReadStatus = "unread",
  ): "ok" | "duplicate" | "limit_reached" {
    if (isAtLimit.value) return "limit_reached";
    if (scans.value.some((s) => s.isbn === book.isbn)) return "duplicate";
    // Negative IDs distinguish guest scans from real DB rows
    const id = -Date.now();
    scans.value.unshift({
      ...book,
      id,
      status,
      created_at: new Date().toISOString(),
    });
    persist();
    return "ok";
  }

  function removeScan(isbn: string) {
    scans.value = scans.value.filter((s) => s.isbn !== isbn);
    persist();
  }

  function cycleStatus(isbn: string) {
    const scan = scans.value.find((s) => s.isbn === isbn);
    if (!scan) return;
    scan.status = NEXT_STATUS[scan.status];
    persist();
  }

  function setStatus(isbn: string, status: ReadStatus) {
    const scan = scans.value.find((s) => s.isbn === isbn);
    if (!scan) return;
    scan.status = status;
    persist();
  }

  async function syncToAccount(token: string): Promise<void> {
    const toSync = [...scans.value].reverse(); // oldest first
    const failedIsbns = new Set<string>();
    for (const scan of toSync) {
      try {
        const res = await fetch(`${API_BASE}/api/scans`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isbn: scan.isbn, status: scan.status }),
        });
        // 409 duplicate → already in account, fine
        if (!res.ok && res.status !== 409) failedIsbns.add(scan.isbn);
      } catch {
        failedIsbns.add(scan.isbn);
      }
    }
    // Keep failures around so they survive for a retry on next login.
    scans.value = scans.value.filter((s) => failedIsbns.has(s.isbn));
    persist();
  }

  function clear() {
    scans.value = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    scans,
    remaining,
    isAtLimit,
    addScan,
    removeScan,
    cycleStatus,
    setStatus,
    syncToAccount,
    clear,
  };
});
