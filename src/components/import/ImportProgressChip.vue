<script setup lang="ts">
import { computed, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useImportStore } from "@/stores/import";

// Global indicator for the background Goodreads import (see stores/import.ts) — rendered from
// App.vue so it's visible from anywhere in the app, not just the /import page itself. Hidden
// while already on /import, since the page itself shows the same state in full.
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useImportStore();

type ChipState = "running" | "paused" | "complete";

const chipState = computed<ChipState | null>(() => {
  if (route.name === "import") return null;
  if (store.isRunning) return "running";
  if (store.sessionPaused) return "paused";
  if (store.step === "review" && !store.chipDismissed) return "complete";
  return null;
});

const label = computed(() => {
  switch (chipState.value) {
    case "running":
      return t("import.chip.running", {
        done: store.counts.imported + store.counts.updated + store.counts.failed,
        total: store.counts.total,
      });
    case "paused":
      return t("import.chip.paused");
    case "complete": {
      const n = store.counts.imported + store.counts.updated;
      return t("import.chip.complete", { n }, n);
    }
    default:
      return "";
  }
});

// The running and paused chips report work in progress and stay until it ends; the success one
// is an acknowledgement, and used to sit there until someone clicked ×  — following the reader
// across every page, a worker restart and even a logout. It times itself out instead. The full
// summary is still on /import, which is where the chip leads.
const DISMISS_AFTER_MS = 10_000;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;

function clearDismissTimer() {
  clearTimeout(dismissTimer);
  dismissTimer = undefined;
}

watch(
  chipState,
  (state) => {
    clearDismissTimer();
    if (state === "complete")
      dismissTimer = setTimeout(() => store.dismissChip(), DISMISS_AFTER_MS);
  },
  { immediate: true },
);

onUnmounted(clearDismissTimer);

function go() {
  router.push({ name: "import" });
}

function dismiss(e: Event) {
  e.stopPropagation();
  store.dismissChip();
}
</script>

<template>
  <!-- Container, not a button: the dismiss control is a separate button, and a button can't be
       nested inside another button (the parser would hoist it out). -->
  <div
    v-if="chipState"
    class="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 max-w-[calc(100vw-2rem)]"
  >
    <button
      type="button"
      class="flex items-center gap-2.5 w-full bg-charcoal-light border border-charcoal-border shadow-xl py-3 pl-4 text-left hover:border-primary transition-colors"
      :class="chipState === 'complete' ? 'pr-9' : 'pr-4'"
      @click="go"
    >
      <span
        v-if="chipState === 'running'"
        class="w-2 h-2 rounded-full bg-primary flex-none animate-pulse"
      />
      <span
        v-else
        class="w-2 h-2 rounded-full flex-none"
        :class="chipState === 'complete' ? 'bg-success' : 'bg-warning'"
      />
      <span class="text-[12px] text-text-primary truncate">{{ label }}</span>
    </button>
    <button
      v-if="chipState === 'complete'"
      type="button"
      :aria-label="t('detail.close')"
      class="absolute top-1/2 -translate-y-1/2 right-2.5 text-[14px] leading-none text-text-secondary/60 hover:text-text-primary transition-colors"
      @click="dismiss"
    >
      ×
    </button>
  </div>
</template>
