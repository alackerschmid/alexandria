<script setup lang="ts">
import { computed } from "vue";

// A one-click enum picker: shows the current option and advances to the next on click.
// Trades discoverability for speed — meant for dense rows where a full segmented control
// wouldn't fit and every option is reachable within a few clicks.

const props = defineProps<{
  options: { value: string; label: string; color: string }[];
  modelValue: string;
  title?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const index = computed(() =>
  Math.max(
    0,
    props.options.findIndex((o) => o.value === props.modelValue),
  ),
);
const current = computed(() => props.options[index.value]);

function next() {
  if (props.disabled) return;
  const opt = props.options[(index.value + 1) % props.options.length];
  emit("update:modelValue", opt.value);
}
</script>

<template>
  <button
    type="button"
    :title="title"
    :disabled="disabled"
    class="inline-flex items-center gap-1.5 w-full border border-charcoal-border px-2.5 py-2 font-mono text-[9.5px] tracking-[0.06em] uppercase text-text-secondary whitespace-nowrap hover:border-primary transition-colors disabled:opacity-40"
    @click="next"
  >
    <span
      class="w-[5px] h-[5px] rounded-full flex-none"
      :style="{ background: current.color }"
    />
    <span class="flex-1 text-left truncate">{{ current.label }}</span>
    <span class="flex-none text-[8px] opacity-50" aria-hidden="true">▲</span>
  </button>
</template>
