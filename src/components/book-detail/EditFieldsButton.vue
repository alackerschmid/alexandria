<template>
  <button
    type="button"
    class="flex items-center justify-center gap-2 border border-control-border text-[10px] tracking-[0.13em] uppercase text-text-primary hover:border-orange-neon transition-colors"
    :class="block ? 'w-full h-[46px]' : 'px-3.5 py-2.5'"
  >
    <v-icon icon="mdi-pencil-outline" size="13" />
    {{ $t("detail.edit_fields") }}
  </button>
</template>

<script lang="ts" setup>
// The way into the unified edit screen. It appears in three places — the masthead cluster, the
// mobile Record rows, and beside the Record pane's custom-field list — which is exactly why it is
// a component: the three had already been written out longhand and would have drifted the first
// time the affordance was restyled.
//
// The click handler stays with the caller; this only owns how the control looks.
withDefaults(defineProps<{ block?: boolean }>(), { block: false });
</script>
