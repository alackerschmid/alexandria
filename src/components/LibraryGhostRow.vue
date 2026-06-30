<template>
  <article
    class="flex items-start gap-3 p-4 border border-dashed border-charcoal-border cursor-pointer hover:border-charcoal-border/60 transition-colors opacity-50"
    @click="$emit('select')"
  >
    <!-- Ghost spine -->
    <div
      class="w-10 h-15 shrink-0 flex items-center justify-center bg-charcoal-light border border-dashed border-charcoal-border"
    >
      <v-icon icon="mdi-book-outline" size="16" class="text-text-secondary/50" />
    </div>

    <!-- Text -->
    <div class="flex-1 min-w-0 flex flex-col gap-1">
      <div class="font-heading text-sm font-bold text-text-secondary leading-snug line-clamp-2">
        {{ title || '—'
        }}<span v-if="ordinal != null" class="font-normal text-text-secondary/60">
          #{{ ordinal }}</span>
      </div>
      <div class="flex items-center gap-1 mt-auto pt-2">
        <span class="font-mono text-[10px] tracking-[0.12em] uppercase text-text-secondary/50">
          {{ $t('library.unowned') }}
        </span>
        <span
          v-if="isNovella"
          class="font-mono text-[9px] tracking-[0.12em] uppercase text-text-secondary/40"
        >
          · {{ $t('library.novella') }}
        </span>
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  title: string | null
  ordinal: number | null
}>()

defineEmits<{ select: [] }>()

const isNovella = computed(() => props.ordinal != null && !Number.isInteger(props.ordinal))
</script>
