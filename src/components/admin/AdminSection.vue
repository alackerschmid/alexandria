<template>
  <!-- The board's sections and the drill-down dialogs each load, fail and retry the same way; only
       the title, the skeleton height and the retry handler differ. Keeping the convention here
       means a change to it (say, holding stale data visible during a refresh) is one edit. -->
  <SectionSkeleton
    v-if="section.loading && !section.data"
    :rows="rows"
    :class="stateClass"
  />
  <SectionError
    v-else-if="section.error"
    :title="title"
    :detail="section.error"
    :retrying="section.loading"
    :titled="titled"
    :class="stateClass"
    @retry="emit('retry')"
  />
  <slot v-else-if="section.data" :data="section.data" />
</template>

<script setup lang="ts" generic="T">
import type { Section } from "@/types/admin";
import SectionError from "@/components/admin/SectionError.vue";
import SectionSkeleton from "@/components/admin/SectionSkeleton.vue";

defineProps<{
  section: Section<T>;
  title: string;
  /** Skeleton row count — roughly the height the loaded section will occupy. */
  rows: number;
  /**
   * Padding for the skeleton and error states only. The board's sections sit in a padded page and
   * need none; a dialog's content is full-bleed, so those two states have to inset themselves.
   */
  stateClass?: string;
  /** Set when the caller already displays `title` itself — the error state then drops its heading. */
  titled?: boolean;
}>();

defineSlots<{ default: (props: { data: T }) => unknown }>();

const emit = defineEmits<{ retry: [] }>();
</script>
