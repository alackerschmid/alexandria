<template>
  <div class="h-screen bg-black relative overflow-hidden">
    <!-- Camera (always running) -->
    <div ref="scannerContainer" class="scanner-viewport w-full h-full"></div>

    <!-- Flash overlay: brief orange pulse on detection -->
    <div
      class="absolute inset-0 bg-orange-neon pointer-events-none z-20 transition-opacity duration-150"
      :class="flash ? 'opacity-60' : 'opacity-0'"
    />

    <!-- Header -->
    <div class="absolute top-0 left-0 right-0 z-30 px-5 py-5 flex justify-between items-center">
      <span
        v-if="sessionCount > 0"
        class="text-orange-neon text-[10px] tracking-[0.25em] uppercase cursor-pointer"
        @click="router.push('/')"
      >
        {{ sessionCount }} saved
      </span>
      <span v-else />
      <button
        class="w-11 h-11 flex items-center justify-center rounded-full transition-colors"
        style="background: rgba(255,255,255,0.15); backdrop-filter: blur(4px)"
        @click="router.push('/')"
      >
        <v-icon icon="mdi-close" color="white" size="20" />
      </button>
    </div>

    <!-- Scanning frame + detecting status -->
    <div
      v-if="scanState === 'scanning' || scanState === 'detecting'"
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
    >
      <div class="relative" style="width: 320px; height: 128px">
        <!-- Corner marks only — no inner fill -->
        <div class="absolute top-0 left-0 w-10 h-10 border-l border-t transition-all duration-200"
             :class="scanState === 'detecting' ? 'border-white border-2' : 'border-white/40'" />
        <div class="absolute top-0 right-0 w-10 h-10 border-r border-t transition-all duration-200"
             :class="scanState === 'detecting' ? 'border-white border-2' : 'border-white/40'" />
        <div class="absolute bottom-0 left-0 w-10 h-10 border-l border-b transition-all duration-200"
             :class="scanState === 'detecting' ? 'border-white border-2' : 'border-white/40'" />
        <div class="absolute bottom-0 right-0 w-10 h-10 border-r border-b transition-all duration-200"
             :class="scanState === 'detecting' ? 'border-white border-2' : 'border-white/40'" />

        <!-- Horizontal scan line (visible while idle) -->
        <div
          v-if="scanState === 'scanning'"
          class="absolute inset-x-4 top-1/2 -translate-y-1/2 h-px bg-orange-neon/50 scan-line"
        />

        <!-- "Looking up" pill — anchored below the frame -->
        <Transition name="fade">
          <div
            v-if="scanState === 'detecting'"
            class="absolute top-full left-1/2 -translate-x-1/2 mt-6 flex items-center gap-2.5 px-5 py-2.5 whitespace-nowrap pointer-events-none"
            style="background: rgba(17,17,16,0.88); border: 1px solid rgba(255,102,0,0.55)"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-orange-neon animate-pulse shrink-0" />
            <span class="text-white text-xs font-bold tracking-[0.2em] uppercase">Looking up…</span>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Guide text (scanning only) -->
    <div
      v-if="scanState === 'scanning'"
      class="absolute bottom-0 left-0 right-0 z-20 pb-10 flex flex-col items-center"
    >
      <span class="text-white/40 text-[10px] tracking-[0.25em] uppercase">
        Point at a barcode
      </span>
    </div>

    <!-- Manual ISBN input overlay -->
    <Transition name="slide-up">
      <div
        v-if="showManualInput && scanState === 'scanning'"
        class="absolute bottom-24 left-6 right-6 z-30 flex border border-white/20"
        style="background: rgba(0,0,0,0.9)"
      >
        <input
          ref="manualInputRef"
          v-model="manualIsbn"
          type="text"
          inputmode="numeric"
          placeholder="ISBN-10 or ISBN-13"
          class="flex-1 bg-transparent text-white px-4 py-3 text-sm outline-none placeholder:text-white/30"
          @keydown.enter="submitManualIsbn"
        />
        <button
          class="px-5 text-orange-neon text-[10px] font-bold tracking-[0.25em] uppercase"
          @click="submitManualIsbn"
        >
          Go
        </button>
      </div>
    </Transition>

    <!-- Preview card — slides up from bottom over the live camera -->
    <Transition name="slide-up">
      <div
        v-if="(scanState === 'preview' || scanState === 'saving') && detectedBook"
        class="absolute bottom-0 left-0 right-0 z-40 px-6 pt-6 pb-10"
        style="background: #111110"
      >
        <!-- Not found notice -->
        <p
          v-if="detectedBook.notFound"
          class="text-[10px] text-white/40 tracking-[0.2em] uppercase mb-4"
        >
          No metadata found — ISBN only will be saved
        </p>

        <!-- Book info -->
        <div class="flex gap-4 mb-6">
          <img
            v-if="detectedBook.coverUrl"
            :src="detectedBook.coverUrl"
            class="w-14 h-20 object-cover shrink-0"
          />
          <div
            v-else
            class="w-14 h-20 flex items-center justify-center shrink-0"
            style="background: #1c1b19; border: 1px solid #2e2b28"
          >
            <v-icon icon="mdi-book-outline" size="24" color="grey" />
          </div>

          <div class="flex-1 min-w-0 pt-1">
            <p
              v-if="detectedBook.notFound"
              class="text-base text-white/40 italic leading-snug mb-1"
            >
              Unknown book
            </p>
            <p
              v-else
              class="font-heading text-lg font-bold text-white leading-snug line-clamp-3 mb-1"
            >
              {{ detectedBook.title }}
            </p>
            <p v-if="!detectedBook.notFound" class="text-xs text-white/60">
              {{ detectedBook.author
              }}<span v-if="detectedBook.year"> · {{ detectedBook.year }}</span>
            </p>
            <p class="text-[10px] text-white/30 font-mono mt-1">{{ detectedBook.isbn }}</p>
          </div>
        </div>

        <!-- Actions -->
        <button
          class="w-full bg-orange-neon text-black py-4 text-xs font-bold tracking-[0.25em] uppercase mb-3 transition-opacity disabled:opacity-40"
          :disabled="scanState === 'saving'"
          @click="saveBook"
        >
          {{ scanState === 'saving' ? '—' : (detectedBook.notFound ? 'Save ISBN' : 'Save Book') }}
        </button>
        <button
          class="w-full text-white/40 text-xs tracking-[0.2em] uppercase py-2 disabled:opacity-40"
          :disabled="scanState === 'saving'"
          @click="scanAgain"
        >
          Scan Again
        </button>
      </div>
    </Transition>

    <!-- Toast -->
    <v-snackbar
      v-model="toast"
      :timeout="3000"
      location="bottom"
      color="#111110"
      rounded="0"
      class="mb-16"
    >
      <div class="flex items-center gap-3 py-0.5">
        <v-icon
          :icon="toastColor === 'error' ? 'mdi-alert-circle-outline' : toastColor === 'warning' ? 'mdi-alert-outline' : 'mdi-check-circle-outline'"
          :color="toastColor === 'error' ? 'error' : toastColor === 'warning' ? 'warning' : 'primary'"
          size="16"
          class="shrink-0"
        />
        <span class="text-xs text-white tracking-wide">{{ toastMessage }}</span>
      </div>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import Quagga from "@ericblade/quagga2";

const router = useRouter();
const authStore = useAuthStore();
const API_BASE = import.meta.env.VITE_API_URL || "";

// ── State machine ─────────────────────────────────────────────────────────────

type ScanState = "scanning" | "detecting" | "preview" | "saving";

interface BookPreview {
  isbn: string;
  title: string;
  author: string;
  year?: string;
  coverUrl?: string;
  notFound?: boolean;
}

const scanState = ref<ScanState>("scanning");
const detectedBook = ref<BookPreview | null>(null);
const flash = ref(false);
const sessionCount = ref(0);

// ISBNs already handled this session — prevents accidental re-scans while
// the camera is still pointed at the same barcode after saving.
const sessionScanned = new Set<string>();

// ISBNs already saved in the library — populated on mount, kept in sync on save.
const libraryIsbns = new Set<string>();

async function loadLibraryIsbns() {
  try {
    const res = await fetch(`${API_BASE}/api/scans?limit=500`, {
      headers: { Authorization: `Bearer ${authStore.token}` },
    });
    if (res.ok) {
      const data: { isbn: string }[] = await res.json();
      data.forEach((b) => libraryIsbns.add(b.isbn));
    }
  } catch {}
}

// ── Manual ISBN entry ─────────────────────────────────────────────────────────

const showManualInput = ref(false);
const manualIsbn = ref("");

const submitManualIsbn = () => {
  const isbn = manualIsbn.value.replace(/[^0-9Xx]/g, "");
  if (isbn.length !== 10 && isbn.length !== 13) {
    showToast("Enter a valid 10 or 13-digit ISBN", "error");
    return;
  }
  manualIsbn.value = "";
  showManualInput.value = false;
  onBarcodeDetected(isbn.toUpperCase());
};

// ── Toast ─────────────────────────────────────────────────────────────────────

const toast = ref(false);
const toastMessage = ref("");
const toastColor = ref("success");

const showToast = (message: string, color = "success") => {
  toastMessage.value = message;
  toastColor.value = color;
  toast.value = true;
};

// ── Book lookup (Google Books → OpenLibrary fallback) ─────────────────────────

async function lookupBook(isbn: string): Promise<BookPreview | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
    );
    const data = await res.json();
    const info = data.items?.[0]?.volumeInfo;
    if (info) {
      return {
        isbn,
        title: info.title,
        author: info.authors?.[0] ?? "Unknown Author",
        year: info.publishedDate?.slice(0, 4),
        coverUrl: info.imageLinks?.thumbnail?.replace("http:", "https:"),
      };
    }
  } catch {}

  try {
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
    );
    const data = await res.json();
    const book = data[`ISBN:${isbn}`];
    if (book) {
      return {
        isbn,
        title: book.title,
        author: book.authors?.[0]?.name ?? "Unknown Author",
        coverUrl: book.cover?.medium,
      };
    }
  } catch {}

  return null;
}

// ── Detection handler ─────────────────────────────────────────────────────────

const onBarcodeDetected = async (isbn: string) => {
  if (scanState.value !== "scanning") return;

  // Already handled this session — ignore silently so the camera can keep running.
  if (sessionScanned.has(isbn)) return;

  // Already in the library — notify and suppress without showing the preview card.
  if (libraryIsbns.has(isbn)) {
    flash.value = true;
    navigator.vibrate?.(30);
    setTimeout(() => (flash.value = false), 200);
    sessionScanned.add(isbn);
    showToast("Already in your library", "warning");
    return;
  }

  scanState.value = "detecting";
  flash.value = true;
  navigator.vibrate?.(50);
  setTimeout(() => (flash.value = false), 200);

  const book = await lookupBook(isbn);
  detectedBook.value = book ?? { isbn, title: "", author: "", notFound: true };
  scanState.value = "preview";
};

// ── Offline queue ─────────────────────────────────────────────────────────────

interface QueuedBook {
  isbn: string;
  title?: string;
  author?: string;
  coverUrl?: string;
}

const QUEUE_KEY = "bookscan_queue_v2";

function migrateV1Queue() {
  const OLD_KEY = "bookscan_queue";
  const old = localStorage.getItem(OLD_KEY);
  if (!old) return;
  try {
    const oldItems: string[] = JSON.parse(old);
    const newItems: QueuedBook[] = oldItems.map((isbn) => ({ isbn }));
    const existing: QueuedBook[] = JSON.parse(
      localStorage.getItem(QUEUE_KEY) ?? "[]"
    );
    const merged = [
      ...existing,
      ...newItems.filter((b) => !existing.some((e) => e.isbn === b.isbn)),
    ];
    localStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
    localStorage.removeItem(OLD_KEY);
  } catch {}
}

function enqueue(book: QueuedBook) {
  const q: QueuedBook[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  if (!q.some((b) => b.isbn === book.isbn)) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...q, book]));
  }
}

async function postScan(book: QueuedBook): Promise<"saved" | "duplicate"> {
  const res = await fetch(`${API_BASE}/api/scans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authStore.token}`,
    },
    body: JSON.stringify({
      isbn: book.isbn,
      title: book.title ?? null,
      author: book.author ?? null,
      cover_url: book.coverUrl ?? null,
    }),
  });
  if (res.status === 409) return "duplicate";
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
  return "saved";
}

async function drainQueue() {
  const q: QueuedBook[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  if (!q.length) return;
  const remaining: QueuedBook[] = [];
  let authExpired = false;
  for (const book of q) {
    if (authExpired) {
      remaining.push(book);
      continue;
    }
    try {
      const res = await fetch(`${API_BASE}/api/scans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.token}`,
        },
        body: JSON.stringify({
          isbn: book.isbn,
          title: book.title ?? null,
          author: book.author ?? null,
          cover_url: book.coverUrl ?? null,
        }),
      });
      if (res.status === 401) {
        authExpired = true;
        remaining.push(book);
      } else if (res.status !== 409 && !res.ok) {
        remaining.push(book);
      }
    } catch {
      remaining.push(book);
    }
  }
  if (authExpired) {
    showToast(
      "Session expired — sign in again to sync pending books",
      "warning"
    );
  }
  remaining.length
    ? localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
    : localStorage.removeItem(QUEUE_KEY);
}

// ── Actions ───────────────────────────────────────────────────────────────────

const saveBook = async () => {
  if (!detectedBook.value) return;
  scanState.value = "saving";

  const queued: QueuedBook = {
    isbn: detectedBook.value.isbn,
    title: detectedBook.value.notFound ? undefined : detectedBook.value.title,
    author: detectedBook.value.notFound ? undefined : detectedBook.value.author,
    coverUrl: detectedBook.value.coverUrl,
  };

  try {
    const result = await postScan(queued);
    sessionScanned.add(queued.isbn);
    libraryIsbns.add(queued.isbn);
    if (result === "duplicate") {
      showToast("Already in your library", "warning");
    } else {
      sessionCount.value++;
      showToast("Saved!");
    }
  } catch {
    if (!navigator.onLine) {
      enqueue(queued);
      sessionScanned.add(queued.isbn);
      sessionCount.value++;
      showToast("Will sync later", "warning");
    } else {
      showToast("Failed to save", "error");
      scanState.value = "preview";
      return;
    }
  }

  detectedBook.value = null;
  scanState.value = "scanning";
};

const scanAgain = () => {
  detectedBook.value = null;
  scanState.value = "scanning";
};

// ── Camera lifecycle ──────────────────────────────────────────────────────────

const scannerContainer = ref<HTMLDivElement | null>(null);
let scannerStarted = false;

// Require 2 consecutive reads of the same code before firing — filters noise
// without adding perceptible delay at typical camera frame rates.
const detectionBuffer: string[] = [];
const REQUIRED_HITS = 2;

const onQuaggaDetected = (result: { codeResult: { code: string | null } }) => {
  const code = result.codeResult.code;
  if (!code) return;

  detectionBuffer.push(code);
  if (detectionBuffer.length > REQUIRED_HITS) detectionBuffer.shift();

  if (detectionBuffer.length === REQUIRED_HITS && detectionBuffer.every((c) => c === code)) {
    detectionBuffer.length = 0;
    onBarcodeDetected(code);
  }
};

const startScanner = () => {
  if (!scannerContainer.value) return;

  Quagga.init(
    {
      inputStream: {
        type: "LiveStream",
        target: scannerContainer.value,
        constraints: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      locator: { patchSize: "medium", halfSample: true },
      // numOfWorkers: 0 avoids Vite/worker-blob compatibility issues
      numOfWorkers: 0,
      decoder: { readers: ["ean_reader", "ean_8_reader"] },
      locate: true,
    },
    (err: unknown) => {
      if (err) {
        showToast("Failed to access camera", "error");
        console.error(err);
        return;
      }
      Quagga.start();
      scannerStarted = true;
    }
  );

  Quagga.onDetected(onQuaggaDetected);
};

onMounted(() => {
  migrateV1Queue();
  drainQueue();
  loadLibraryIsbns();
  window.addEventListener("online", drainQueue);
  startScanner();
});

onBeforeUnmount(() => {
  window.removeEventListener("online", drainQueue);
  Quagga.offDetected(onQuaggaDetected);
  if (scannerStarted) Quagga.stop();
});
</script>

<style>
/* Quagga2 inserts <video> and a debug <canvas> into .scanner-viewport */
.scanner-viewport video {
  object-fit: cover !important;
  width: 100% !important;
  height: 100% !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
}
canvas.drawingBuffer {
  display: none !important;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes scan {
  0%, 100% { opacity: 0.5; transform: translateY(-12px); }
  50% { opacity: 0.15; transform: translateY(12px); }
}
.scan-line {
  animation: scan 2s ease-in-out infinite;
}
</style>
