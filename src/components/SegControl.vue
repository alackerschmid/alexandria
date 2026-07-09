<script setup lang="ts">
import { useAccentStore } from "@/stores/accent";

defineProps<{
  options: { value: string; label: string }[];
  modelValue: string;
}>();
defineEmits<{ "update:modelValue": [value: string] }>();

const accentStore = useAccentStore();
</script>

<template>
  <div
    class="inline-flex border border-charcoal-border overflow-hidden flex-wrap"
  >
    <button
      v-for="(opt, k) in options"
      :key="opt.value"
      type="button"
      class="px-4 py-2 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors"
      :class="k > 0 ? 'border-l border-charcoal-border' : ''"
      :style="
        opt.value === modelValue
          ? { background: accentStore.color, color: '#111110', fontWeight: 700 }
          : {
              background: 'transparent',
              color: 'rgb(var(--v-theme-text-secondary))',
            }
      "
      @click="$emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
