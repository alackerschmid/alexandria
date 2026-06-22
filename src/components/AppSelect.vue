<template>
  <v-menu v-model="open" :close-on-content-click="true" offset="4" :min-width="minWidth">
    <template #activator="{ props: menuProps }">
      <button
        v-bind="menuProps"
        class="flex items-center gap-2.5 border border-charcoal-border bg-charcoal-light px-3 py-2 text-[11px] tracking-[0.04em] text-text-primary transition-colors hover:border-charcoal-border/60"
        :class="{ 'border-charcoal-border/60': open }"
      >
        {{ currentLabel }}
        <span
          class="text-text-secondary text-[10px] transition-transform duration-150"
          :class="{ 'rotate-180': open }"
        >▾</span>
      </button>
    </template>

    <div class="bg-[#1a1917] border border-charcoal-border shadow-xl py-1">
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        class="flex items-center justify-between w-full px-4 py-2.5 text-left text-[11px] tracking-[0.04em] transition-colors"
        :class="modelValue === opt.value
          ? 'text-orange-neon'
          : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'"
        @click="$emit('update:modelValue', opt.value)"
      >
        {{ opt.label }}
        <v-icon
          v-if="modelValue === opt.value"
          icon="mdi-check"
          size="11"
          class="text-orange-neon ml-4 shrink-0"
        />
      </button>
    </div>
  </v-menu>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
  minWidth?: number
}>(), {
  minWidth: 160,
})

defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)

const currentLabel = computed(
  () => props.options.find(o => o.value === props.modelValue)?.label ?? props.modelValue,
)
</script>
