<template>
  <!-- The board's three sections each load, fail and retry the same way; only the title, the
       skeleton height and the retry handler differ. Keeping the convention here means a change
       to it (say, holding stale data visible during a refresh) is one edit, not three. -->
  <SectionSkeleton v-if="section.loading && !section.data" :rows="rows" />
  <SectionError
    v-else-if="section.error"
    :title="title"
    :detail="section.error"
    :retrying="section.loading"
    @retry="emit('retry')"
  />
  <slot v-else-if="section.data" :data="section.data" />
</template>

<script setup lang="ts" generic="T">
import SectionError from "@/components/admin/SectionError.vue";
import SectionSkeleton from "@/components/admin/SectionSkeleton.vue";

defineProps<{
  section: { data: T | null; loading: boolean; error: string | null };
  title: string;
  /** Skeleton row count — roughly the height the loaded section will occupy. */
  rows: number;
}>();

defineSlots<{ default: (props: { data: T }) => unknown }>();

const emit = defineEmits<{ retry: [] }>();
</script>
