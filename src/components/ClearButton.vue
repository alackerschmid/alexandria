<script setup lang="ts">
// The ✕ that unsets a value, for controls that can only ever *set* one — the rating rows in
// `RecordControls` (both layouts) and the scanner's rate-as picker, whose stars deliberately lost
// their toggle-to-clear (see RatingStars). One component so the icon size, the hover colour and the
// tooltip can't drift between the places that render it; three hand-rolled copies had already
// diverged on all three within one change.
//
// Positioning stays the host's — the stacked rating row places it absolutely inside the row's
// border so the stars stay optically centred — and a native @click falls through to the button.
defineProps<{ label: string }>();
</script>

<template>
  <button
    type="button"
    class="text-text-secondary/60 hover:text-text-primary transition-colors"
    :aria-label="label"
    :title="label"
  >
    <v-icon icon="mdi-close" size="15" />
  </button>
</template>
