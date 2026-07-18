<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppButton from "@/components/AppButton.vue";
import { STATUS_META } from "@/composables/useBookStatus";
import type { ReviewItem } from "@/composables/useGoodreadsImport";

const props = defineProps<{ item: ReviewItem }>();
defineEmits<{ resolve: []; undo: [] }>();

const { t } = useI18n();

const skipped = computed(() => props.item.status === "skipped");
</script>

<template>
  <div
    class="flex items-center gap-4 px-6 md:px-8 py-3"
    :class="skipped ? 'opacity-60' : ''"
  >
    <!-- ghost cover: these rows have no resolved edition, so there's no cover to show -->
    <div
      class="w-10 h-[60px] flex-none border border-dashed border-charcoal-border bg-charcoal-light"
    />

    <div class="min-w-0 flex-1">
      <p class="font-heading font-bold text-[13px] text-text-primary truncate">
        {{ item.row.title }}
      </p>
      <p class="text-[10.5px] text-text-secondary truncate mt-0.5">
        {{ item.row.author || t("book.unknown_author") }}
      </p>
      <p
        v-if="skipped"
        class="text-[10px] text-text-secondary italic mt-1.5"
      >
        {{ t("import.review.skipped_note") }}
      </p>
      <p
        v-else
        class="inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.06em] mt-1.5"
        :style="{ color: STATUS_META.dnf.color }"
      >
        <span
          class="w-[5px] h-[5px] rounded-full flex-none"
          :style="{ background: STATUS_META.dnf.color }"
        />
        {{ t(`import.review.reason_${item.reason}`) }}
      </p>
    </div>

    <button
      v-if="skipped"
      type="button"
      class="flex-none font-mono text-[10px] tracking-[0.1em] uppercase text-text-secondary hover:text-text-primary transition-colors"
      @click="$emit('undo')"
    >
      {{ t("import.review.undo") }}
    </button>
    <AppButton
      v-else
      variant="primary"
      size="sm"
      class="flex-none"
      @click="$emit('resolve')"
    >
      {{ t("import.review.resolve") }}
    </AppButton>
  </div>
</template>
