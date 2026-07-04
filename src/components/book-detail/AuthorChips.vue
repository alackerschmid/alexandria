<template>
  <div v-if="names.length" class="flex flex-wrap text-text-secondary" :class="wrapperClass">
    <template v-for="(name, i) in names" :key="name">
      <button
        class="hover:text-orange-neon transition-colors text-left"
        @click="$emit('select', name)"
      >{{ name }}</button><span v-if="i < names.length - 1">,</span>
    </template>
  </div>
  <div v-else class="text-text-secondary" :class="wrapperClass">
    {{ $t("book.unknown_author") }}
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import type { Book } from "@/types/book";
import { authorNames } from "@/utils/book-display";

const props = defineProps<{
  book: Pick<Book, "author" | "authors">;
  size?: "compact" | "expanded";
}>();

defineEmits<{
  select: [name: string];
}>();

const names = computed(() => authorNames(props.book));

const wrapperClass = computed(() =>
  props.size === "expanded" ? "gap-x-1.5 text-base mb-8" : "gap-x-1 text-sm mb-3",
);
</script>
