<template>
  <div
    class="cursor-pointer group min-w-0"
    :style="{ opacity: owned ? 1 : 0.5 }"
    @click="$emit('select')"
  >
    <div class="relative aspect-2/3 overflow-hidden bg-charcoal-light mb-1.5">
      <!-- Unowned ghost -->
      <div
        v-if="!owned"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 border border-dashed border-charcoal-border"
      >
        <v-icon icon="mdi-book-outline" size="18" class="text-text-secondary/50" />
        <span class="font-mono text-[8px] tracking-[0.14em] text-text-secondary/60 uppercase">
          {{ $t('library.unowned') }}
        </span>
      </div>

      <!-- Owned with cover image -->
      <img
        v-else-if="coverUrl"
        :src="coverUrl"
        :alt="title || ''"
        class="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
      />

      <!-- Owned, no cover → tint + initials -->
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center"
        :style="{ background: tint }"
      >
        <span class="font-heading font-bold text-[30px]" style="color: rgba(236,233,227,0.22)">
          {{ glyph }}
        </span>
      </div>

      <!-- Status dot (owned only) -->
      <div
        v-if="owned"
        class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
        style="box-shadow: 0 0 0 2px rgba(0,0,0,0.4)"
        :style="{ background: statusColor }"
      />

      <!-- Novella / side-entry badge -->
      <span
        v-if="isNovella"
        class="absolute bottom-1.5 left-1.5 font-mono text-[7px] tracking-[0.12em] text-[#cbc4ba] px-1 py-0.5"
        style="background: rgba(0,0,0,0.55)"
      >
        {{ $t('library.novella') }}
      </span>
    </div>

    <p
      class="text-[10px] font-heading font-bold leading-snug line-clamp-2"
      :class="owned ? 'text-text-primary' : 'text-text-secondary'"
    >
      {{ title || '—'
      }}<span v-if="ordinal != null" class="font-normal text-text-secondary/70">
        #{{ ordinal }}</span>
    </p>
    <p v-if="author" class="text-[9px] text-text-secondary/70 mt-0.5 truncate">{{ author }}</p>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { ReadStatus } from '@/types/book'
import { tintFor, initials } from '@/utils/cover'
import { STATUS_META } from '@/composables/useBookStatus'

const props = defineProps<{
  title: string | null
  coverUrl: string | null
  ordinal: number | null
  owned: boolean
  status?: ReadStatus
  author?: string | null
}>()

defineEmits<{ select: [] }>()

const tint = computed(() => tintFor(props.title || ''))
const glyph = computed(() => initials(props.title || '?'))
const isNovella = computed(() => props.ordinal != null && !Number.isInteger(props.ordinal))

const statusColor = computed(() => STATUS_META[props.status ?? 'unread'].themeColor)
</script>
