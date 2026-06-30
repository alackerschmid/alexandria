<template>
  <div class="px-1">
    <p class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary/70 pb-1">
      {{ $t('library.display_options') }}
    </p>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="mainOnly = !mainOnly"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{ $t('library.main_entries_only') }}</span>
        <span class="block text-[10px] text-text-secondary mt-0.5 leading-snug">{{ $t('library.main_entries_only_sub') }}</span>
      </span>
      <span :class="track(mainOnly)"><span :class="knob(mainOnly)" /></span>
    </button>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="highlightComplete = !highlightComplete"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{ $t('library.highlight_complete') }}</span>
        <span class="block text-[10px] text-text-secondary mt-0.5 leading-snug">{{ $t('library.highlight_complete_sub') }}</span>
      </span>
      <span :class="track(highlightComplete)"><span :class="knob(highlightComplete)" /></span>
    </button>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left py-3.5"
      @click="showUnowned = !showUnowned"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{ $t('library.show_unowned') }}</span>
        <span class="block text-[10px] text-text-secondary mt-0.5 leading-snug">{{ $t('library.show_unowned_sub') }}</span>
      </span>
      <span :class="track(showUnowned)"><span :class="knob(showUnowned)" /></span>
    </button>

    <p v-if="!seriesContext" class="text-[10px] text-text-secondary py-3.5 leading-snug">
      {{ $t('library.display_series_hint') }}
    </p>

    <slot name="extra" />
  </div>
</template>

<script lang="ts" setup>
const mainOnly = defineModel<boolean>('mainOnly', { required: true })
const highlightComplete = defineModel<boolean>('highlightComplete', { required: true })
const showUnowned = defineModel<boolean>('showUnowned', { required: true })

defineProps<{ seriesContext: boolean }>()

const track = (on: boolean) =>
  `shrink-0 w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-orange-neon' : 'bg-charcoal-border'}`
const knob = (on: boolean) =>
  `absolute top-0.5 w-4 h-4 rounded-full bg-charcoal transition-all ${on ? 'left-[18px]' : 'left-0.5'}`
</script>
