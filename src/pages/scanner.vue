<template>
  <div class="h-screen bg-black relative overflow-hidden">
    <!-- Camera (always running) -->
    <div id="qr-reader" class="w-full h-full"></div>

    <!-- Flash overlay: brief orange pulse on detection -->
    <div
      class="absolute inset-0 bg-orange-neon pointer-events-none z-20 transition-opacity duration-200"
      :class="flash ? 'opacity-30' : 'opacity-0'"
    />

    <!-- Header -->
    <div class="absolute top-0 left-0 right-0 z-30 px-5 py-5 flex justify-between items-center">
      <span
        class="text-[10px] tracking-[0.25em] uppercase transition-colors"
        :class="sessionCount > 0 ? 'text-orange-neon cursor-pointer' : 'text-white/50'"
        @click="sessionCount > 0 && router.push('/')"
      >
        {{ sessionCount > 0 ? `${sessionCount} saved` : authStore.email }}
      </span>
      <v-btn
        icon="mdi-close"
        variant="text"
        color="white"
        size="small"
        @click="router.push('/')"
      />
    </div>

    <!-- Scanning frame (visible while scanning / looking up) -->
    <div
      v-if="scanState === 'scanning' || scanState === 'detecting'"
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
    >
      <div class="relative" style="width: 280px; height: 140px">
        <div class="absolute inset-0 border border-orange-neon/25"></div>
        <div class="absolute top-0 left-0 w-7 h-7 border-t-2 border-l-2 border-orange-neon" />
        <div class="absolute top-0 right-0 w-7 h-7 border-t-2 border-r-2 border-orange-neon" />
        <div class="absolute bottom-0 left-0 w-7 h-7 border-b-2 border-l-2 border-orange-neon" />
        <div class="absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 border-orange-neon" />
      </div>
    </div>

    <!-- Guide text -->
    <div class="absolute bottom-12 left-0 right-0 text-center z-20">
      <span
        v-if="scanState === 'scanning'"
        class="text-white/60 text-[10px] tracking-[0.25em] uppercase"
      >
        Align barcode within frame
      </span>
      <span
        v-else-if="scanState === 'detecting'"
        class="text-white/80 text-[10px] tracking-[0.25em] uppercase"
      >
        Looking up...
      </span>
    </div>

    <!-- Preview card — slides up from bottom over the live camera -->
    <Transition name="slide-up">
      <div
        v-if="(scanState === 'preview' || scanState === 'saving') && detectedBook"
        class="absolute bottom-0 left-0 right-0 z-40 px-6 pt-6 pb-10"
        style="background: #111110"
      >
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
            <p class="font-heading text-lg font-bold text-white leading-snug line-clamp-3 mb-1">
              {{ detectedBook.title }}
            </p>
            <p class="text-xs text-white/60">
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
          {{ scanState === 'saving' ? '—' : 'Save Book' }}
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
      :color="toastColor"
      class="mb-16"
    >
      {{ toastMessage }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { Html5Qrcode } from "html5-qrcode";

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
}

const scanState = ref<ScanState>("scanning");
const detectedBook = ref<BookPreview | null>(null);
const flash = ref(false);
const sessionCount = ref(0);

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
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`,
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
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
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

  scanState.value = "detecting";
  flash.value = true;
  navigator.vibrate?.(50);
  setTimeout(() => (flash.value = false), 200);

  const book = await lookupBook(isbn);
  if (!book) {
    showToast("Book not found", "error");
    scanState.value = "scanning";
    return;
  }

  detectedBook.value = book;
  scanState.value = "preview";
};

// ── Offline queue ─────────────────────────────────────────────────────────────

const QUEUE_KEY = "bookscan_queue";

function enqueue(isbn: string) {
  const q: string[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  if (!q.includes(isbn)) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...q, isbn]));
  }
}

async function postScan(isbn: string) {
  const res = await fetch(`${API_BASE}/api/scans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authStore.token}`,
    },
    body: JSON.stringify({ isbn }),
  });
  if (res.status === 409) return; // duplicate — silently ok
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
}

async function drainQueue() {
  const q: string[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  if (!q.length) return;
  const remaining: string[] = [];
  let authExpired = false;
  for (const isbn of q) {
    if (authExpired) {
      remaining.push(isbn);
      continue;
    }
    try {
      const res = await fetch(`${API_BASE}/api/scans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.token}`,
        },
        body: JSON.stringify({ isbn }),
      });
      if (res.status === 401) {
        authExpired = true;
        remaining.push(isbn);
      } else if (res.status !== 409 && !res.ok) {
        remaining.push(isbn);
      }
    } catch {
      remaining.push(isbn);
    }
  }
  if (authExpired) {
    showToast("Session expired — sign in again to sync pending books", "warning");
  }
  remaining.length
    ? localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
    : localStorage.removeItem(QUEUE_KEY);
}

// ── Actions ───────────────────────────────────────────────────────────────────

const saveBook = async () => {
  if (!detectedBook.value) return;
  scanState.value = "saving";
  const isbn = detectedBook.value.isbn;

  try {
    await postScan(isbn);
    sessionCount.value++;
    showToast("Saved!");
  } catch {
    if (!navigator.onLine) {
      enqueue(isbn);
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

let html5QrCode: Html5Qrcode | null = null;

onMounted(() => {
  drainQueue();
  window.addEventListener("online", drainQueue);

  html5QrCode = new Html5Qrcode("qr-reader");
  html5QrCode
    .start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 280, height: 140 },
        aspectRatio: 1.0,
        disableFlip: false,
      },
      onBarcodeDetected,
      () => {},
    )
    .catch((err) => {
      showToast("Failed to access camera", "error");
      console.error(err);
    });
});

onBeforeUnmount(() => {
  window.removeEventListener("online", drainQueue);
  if (html5QrCode?.isScanning) {
    html5QrCode
      .stop()
      .then(() => html5QrCode?.clear())
      .catch(console.error);
  }
});
</script>

<style>
#qr-reader {
  border: none !important;
  width: 100% !important;
  height: 100vh !important;
}
#qr-reader img,
#qr-reader video {
  object-fit: cover !important;
  width: 100% !important;
  height: 100% !important;
}
#qr-reader__scan_region {
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
</style>
