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
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="showStatusIcons = !showStatusIcons"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.show_status_icons")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.show_status_icons_sub") }}</span
        >
      </span>
      <AppToggle :model-value="showStatusIcons" />
    </button>

    <button
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="onlyOwned = !onlyOwned"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.only_owned")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.only_owned_sub") }}</span
        >
      </span>
      <AppToggle :model-value="onlyOwned" />
    </button>

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
      <AppToggle :model-value="mainOnly" />
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
      <AppToggle :model-value="highlightComplete" />
    </button>

    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
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
      <AppToggle :model-value="showUnowned" />
    </button>

    <button
      class="flex items-center justify-between gap-5 w-full text-left border-b border-charcoal-border py-3.5"
      @click="highlightOwningBorder = !highlightOwningBorder"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.highlight_owning_border")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.highlight_owning_border_sub") }}</span
        >
      </span>
      <AppToggle :model-value="highlightOwningBorder" />
    </button>

    <button
      class="flex items-center justify-between gap-5 w-full text-left py-3.5"
      @click="groupEditions = !groupEditions"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.group_editions")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.group_editions_sub") }}</span
        >
      </span>
      <AppToggle :model-value="groupEditions" />
    </button>

    <slot name="extra" />
  </div>
</template>

<script lang="ts" setup>
import AppToggle from "@/components/AppToggle.vue";

const mainOnly = defineModel<boolean>("mainOnly", { required: true });
const highlightComplete = defineModel<boolean>("highlightComplete", {
  required: true,
});
const showUnowned = defineModel<boolean>("showUnowned", { required: true });
const showStatusIcons = defineModel<boolean>("showStatusIcons", {
  required: true,
});
const onlyOwned = defineModel<boolean>("onlyOwned", { required: true });
const highlightOwningBorder = defineModel<boolean>("highlightOwningBorder", {
  required: true,
});
const groupEditions = defineModel<boolean>("groupEditions", {
  required: true,
});
const viewMode = defineModel<"list" | "tile">("viewMode");

withDefaults(defineProps<{ seriesContext: boolean; showViewRow?: boolean }>(), {
  showViewRow: false,
});
</script>
