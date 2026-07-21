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
      <AppSegmented
        v-model="viewMode"
        size="sm"
        :options="[
          {
            value: 'list',
            label: $t('settings.defaults.view_list'),
            icon: 'mdi-view-list',
          },
          {
            value: 'tile',
            label: $t('settings.defaults.view_tile'),
            icon: 'mdi-view-grid',
          },
        ]"
      />
    </div>

    <!-- Ownership axis: one control, stacked (three labelled options don't fit
         beside a leading label at the panel's width). -->
    <div class="border-b border-charcoal-border py-3.5">
      <span class="block text-xs text-text-primary">{{
        $t("library.books_shown")
      }}</span>
      <span class="block text-[10px] text-text-secondary mt-0.5 leading-snug">{{
        seriesContext
          ? $t("library.books_shown_sub_series")
          : $t("library.books_shown_sub")
      }}</span>
      <AppSegmented
        v-model="scope"
        size="sm"
        class="mt-2.5"
        :aria-label="$t('library.books_shown')"
        :options="scopeOptions"
      />
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

    <!-- Series-only, and the last row in that context (groupEditions is hidden
         then) — so no bottom border, matching the groupEditions row below. -->
    <button
      v-if="seriesContext"
      class="flex items-center justify-between gap-5 w-full text-left py-3.5"
      @click="countSideEntries = !countSideEntries"
    >
      <span class="min-w-0">
        <span class="block text-xs text-text-primary">{{
          $t("library.count_side_entries")
        }}</span>
        <span
          class="block text-[10px] text-text-secondary mt-0.5 leading-snug"
          >{{ $t("library.count_side_entries_sub") }}</span
        >
      </span>
      <AppToggle :model-value="countSideEntries" />
    </button>

    <!-- Hidden when grouped by series: series shelves always collapse editions
         into one card per work (see index.vue's groupedAllBooks), so the toggle
         would be inert there. Mutually exclusive with the countSideEntries row
         above — exactly one is the last row, hence both carry no bottom border,
         so neither doubles up with the #extra slot's leading divider. -->
    <button
      v-if="!seriesContext"
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
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppToggle from "@/components/AppToggle.vue";
import AppSegmented from "@/components/AppSegmented.vue";
import type { OwnershipScope } from "@/types/library";

const showStatusIcons = defineModel<boolean>("showStatusIcons", {
  required: true,
});
const groupEditions = defineModel<boolean>("groupEditions", {
  required: true,
});
const ownershipScope = defineModel<OwnershipScope>("ownershipScope", {
  required: true,
});
const mainOnly = defineModel<boolean>("mainOnly", { required: true });
const viewMode = defineModel<"list" | "tile">("viewMode", { default: "list" });

const props = withDefaults(
  defineProps<{ seriesContext: boolean; showViewRow?: boolean }>(),
  { showViewRow: false },
);

const { t } = useI18n();

// "Missing" only means anything on series shelves, so outside that context it's
// hidden and a persisted "missing" reads as plain "all".
const scopeOptions = computed(() => {
  const opts: { value: OwnershipScope; label: string }[] = [
    { value: "owned", label: t("library.scope_owned") },
    { value: "all", label: t("library.scope_all") },
  ];
  if (props.seriesContext)
    opts.push({ value: "missing", label: t("library.scope_missing") });
  return opts;
});
const scope = computed<OwnershipScope>({
  get: () =>
    !props.seriesContext && ownershipScope.value === "missing"
      ? "all"
      : ownershipScope.value,
  set: (v) => {
    ownershipScope.value = v;
  },
});

// The stored flag is "main entries only"; the label reads better inverted —
// what the user perceives is whether side-stories count toward "3 / 7".
const countSideEntries = computed({
  get: () => !mainOnly.value,
  set: (v) => {
    mainOnly.value = !v;
  },
});
</script>
