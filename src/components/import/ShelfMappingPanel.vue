<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppSegmented from "@/components/AppSegmented.vue";
import { STATUS_ORDER } from "@/composables/useBookStatus";
import type { ShelfMapping } from "@/utils/goodreads";
import type { ReadStatus } from "@/types/book";

const props = defineProps<{
  shelfCounts: Map<string, number>;
  mapping: Record<string, ShelfMapping>;
}>();
const emit = defineEmits<{
  "update-mapping": [shelf: string, next: ShelfMapping];
}>();

const { t } = useI18n();

const statusOptions = computed(() =>
  STATUS_ORDER.map((s) => ({ value: s, label: t(`book.${s}`) })),
);

function updateStatus(shelf: string, status: string) {
  emit("update-mapping", shelf, {
    ...props.mapping[shelf],
    status: status as ReadStatus,
  });
}
</script>

<template>
  <div class="border border-charcoal-border divide-y divide-charcoal-border">
    <div
      v-for="[shelf, count] in shelfCounts"
      :key="shelf"
      class="flex flex-col gap-3 p-4"
    >
      <div>
        <p class="text-[14px] text-text-primary truncate">{{ shelf }}</p>
        <p class="text-[11px] text-text-secondary">
          {{ t("import.mapping.count", { n: count }) }}
        </p>
      </div>
      <div>
        <p
          class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ t("library.filter_status") }}
        </p>
        <AppSegmented
          :options="statusOptions"
          :model-value="mapping[shelf]?.status"
          size="sm"
          @update:model-value="(v) => updateStatus(shelf, v)"
        />
      </div>
    </div>
  </div>
</template>
