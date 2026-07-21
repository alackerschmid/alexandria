<script setup lang="ts">
import { computed } from "vue";
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
    case "complete":
      return t("import.chip.complete", {
        n: store.counts.imported + store.counts.updated,
      });
    default:
      return "";
  }
});

function go() {
  router.push({ name: "import" });
}

function dismiss(e: Event) {
  e.stopPropagation();
  store.dismissChip();
}
</script>

<template>
  <button
    v-if="chipState"
    type="button"
    class="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 flex items-center gap-2.5 bg-charcoal-light border border-charcoal-border shadow-xl px-4 py-3 text-left hover:border-primary transition-colors max-w-[calc(100vw-2rem)]"
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
    <button
      v-if="chipState === 'complete'"
      type="button"
      :aria-label="t('detail.close')"
      class="flex-none text-[14px] leading-none text-text-secondary/60 hover:text-text-primary transition-colors"
      @click="dismiss"
    >
      ×
    </button>
  </button>
</template>
