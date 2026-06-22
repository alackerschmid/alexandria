<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />
    <div class="w-full max-w-300 mx-auto flex-1 flex flex-col w-full">
      <!-- Header -->
      <div class="px-6 md:px-10 pt-10 pb-6 border-b border-charcoal-border">
        <button
          class="flex items-center gap-1 text-[10px] text-text-secondary tracking-[0.2em] uppercase hover:text-text-primary transition-colors mb-4"
          @click="$router.back()"
        >
          <v-icon icon="mdi-arrow-left" size="14" />
          {{ $t("series.back") }}
        </button>
        <p class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3">
          {{ $t("series.section") }}
        </p>
        <h1
          class="font-heading text-4xl md:text-5xl font-bold text-text-primary leading-[1.05]"
        >
          {{ series?.name || $t("detail.series") }}
        </h1>
        <p
          v-if="series"
          class="text-xs text-text-secondary tracking-[0.15em] uppercase mt-3 font-mono"
        >
          {{ $t("series.owned_count", { owned: ownedCount, total: entries.length }) }}
        </p>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center mt-20">
        <v-progress-circular indeterminate color="primary" size="24" width="2" />
      </div>

      <!-- Not found -->
      <div v-else-if="!series" class="px-6 md:px-10 pt-16 pb-8">
        <p class="text-sm text-text-secondary">{{ $t("series.not_found") }}</p>
      </div>

      <!-- Entries -->
      <div v-else class="pb-28">
        <div
          v-for="entry in entries"
          :key="entry.work_id"
          class="flex items-center gap-4 px-6 md:px-10 py-3 border-b border-charcoal-border"
          :class="entry.owned ? '' : 'opacity-50'"
        >
          <div
            class="w-6 shrink-0 text-center font-mono text-xs"
            :class="entry.owned ? 'text-orange-neon' : 'text-text-secondary/50'"
          >
            {{ entry.ordinal != null ? entry.ordinal : "—" }}
          </div>
          <img
            v-if="entry.cover_url"
            :src="entry.cover_url"
            class="w-9 h-13 object-cover shrink-0"
          />
          <div
            v-else
            class="w-9 h-13 bg-charcoal-light border border-charcoal-border flex items-center justify-center shrink-0"
          >
            <v-icon icon="mdi-book-outline" size="16" color="primary" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-text-primary truncate">
              {{ entry.title || $t("series.untitled") }}
            </div>
            <div
              class="text-[10px] tracking-[0.15em] uppercase mt-0.5"
              :class="entry.owned ? 'text-orange-neon' : 'text-text-secondary/50'"
            >
              {{ entry.owned ? $t("detail.edition_in_library") : $t("series.missing") }}
            </div>
          </div>
        </div>
      </div>

      <AppFooter class="mt-auto" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";

interface SeriesEntry {
  work_id: number;
  ordinal: number | null;
  title: string | null;
  owned: number;
  isbn: string | null;
  cover_url: string | null;
  scan_id: number | null;
}

interface SeriesResponse {
  id: number;
  name: string | null;
  entries: SeriesEntry[];
}

const route = useRoute();
const { apiFetch } = useApi();
const localeStore = useLocaleStore();

const loading = ref(true);
const series = ref<SeriesResponse | null>(null);
const entries = computed(() => series.value?.entries ?? []);
const ownedCount = computed(() => entries.value.filter((e) => e.owned).length);

async function load() {
  loading.value = true;
  try {
    const res = await apiFetch(
      `/api/series/${route.params.id}?locale=${localeStore.locale}`,
    );
    series.value = res.ok ? await res.json() : null;
  } catch {
    series.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => [route.params.id, localeStore.locale], load);
</script>
