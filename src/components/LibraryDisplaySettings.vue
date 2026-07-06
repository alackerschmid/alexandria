<template>
  <div class="px-1">
    <p
      class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary/70 pb-1"
    >
      {{ $t("library.display_options") }}
    </p>

    <div
      v-if="showViewRow"
      class="flex items-center justify-between gap-5 w-full border-b border-charcoal-border py-3.5"
    >
      <span class="text-xs text-text-primary">{{
        $t("library.view_label")
      }}</span>
      <div class="flex">
        <button
          class="flex items-center gap-1.5 h-8 px-3.5 border -ml-px first:ml-0 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors"
          :class="
            viewMode === 'list'
              ? 'border-charcoal-border text-orange-neon bg-charcoal'
              : 'border-charcoal-border text-text-secondary'
          "
          :aria-pressed="viewMode === 'list'"
          @click="viewMode = 'list'"
        >
          <v-icon icon="mdi-view-list" size="14" />
          {{ $t("settings.defaults.view_list") }}
        </button>
        <button
          class="flex items-center gap-1.5 h-8 px-3.5 border -ml-px first:ml-0 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors"
          :class="
            viewMode === 'tile'
              ? 'border-charcoal-border text-orange-neon bg-charcoal'
              : 'border-charcoal-border text-text-secondary'
          "
          :aria-pressed="viewMode === 'tile'"
          @click="viewMode = 'tile'"
        >
          <v-icon icon="mdi-view-grid" size="14" />
          {{ $t("settings.defaults.view_tile") }}
        </button>
      </div>
    </div>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="mainOnly = !mainOnly"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.main_entries_only")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.main_entries_only_sub") }}</span
        >
      </span>
      <span :class="track(mainOnly)"><span :class="knob(mainOnly)" /></span>
    </button>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="highlightComplete = !highlightComplete"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.highlight_complete")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.highlight_complete_sub") }}</span
        >
      </span>
      <span :class="track(highlightComplete)"
        ><span :class="knob(highlightComplete)"
      /></span>
    </button>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left py-3.5"
      @click="showUnowned = !showUnowned"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.show_unowned")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.show_unowned_sub") }}</span
        >
      </span>
      <span :class="track(showUnowned)"
        ><span :class="knob(showUnowned)"
      /></span>
    </button>

    <p
      v-if="!seriesContext"
      class="text-[10px] text-text-secondary py-3.5 leading-snug"
    >
      {{ $t("library.display_series_hint") }}
    </p>

    <slot name="extra" />
  </div>
</template>

<script lang="ts" setup>
const mainOnly = defineModel<boolean>("mainOnly", { required: true });
const highlightComplete = defineModel<boolean>("highlightComplete", {
  required: true,
});
const showUnowned = defineModel<boolean>("showUnowned", { required: true });
const viewMode = defineModel<"list" | "tile">("viewMode");

withDefaults(defineProps<{ seriesContext: boolean; showViewRow?: boolean }>(), {
  showViewRow: false,
});

const track = (on: boolean) =>
  `shrink-0 w-9 h-5 rounded-full relative transition-colors ${on ? "bg-orange-neon" : "bg-charcoal-border"}`;
const knob = (on: boolean) =>
  `absolute top-0.5 w-4 h-4 rounded-full bg-charcoal transition-all ${on ? "left-[18px]" : "left-0.5"}`;
</script>
