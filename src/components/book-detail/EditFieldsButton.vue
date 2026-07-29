<template>
  <button
    type="button"
    class="flex items-center justify-center gap-2 px-3.5 py-2.5 border border-control-border text-[10px] tracking-[0.13em] uppercase text-text-primary hover:border-orange-neon transition-colors"
  >
    <v-icon icon="mdi-pencil-outline" size="13" />
    {{ $t("detail.edit_fields") }}
  </button>
</template>

<script lang="ts" setup>
// The way into the unified edit screen — one entry point, at the foot of the Details pane beside
// Refresh, because that pane is where every field the form writes is displayed. It stays its own
// component rather than markup in `DetailsPane` so the affordance can move again without being
// re-styled from scratch, as it already has once (it used to sit in the masthead cluster and the
// mobile Record rows, written out longhand in both).
//
// The click handler stays with the caller; this only owns how the control looks.
</script>
