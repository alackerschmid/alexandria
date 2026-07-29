<template>
  <div class="flex items-center gap-1.5 mb-1 min-h-[14px]">
    <label
      :for="fieldId"
      class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase"
    >
      {{ label }}
    </label>
    <OverrideDot v-if="overridden" class="w-1 h-1 shrink-0" />
    <!-- The one way to *remove* an override rather than replace it. Emptying the field does the
         same thing server-side, but reads as deleting the value rather than restoring one, and
         gives no hint that a catalogue value is waiting underneath. -->
    <button
      v-if="overridden && !reverted"
      type="button"
      class="text-text-secondary/40 hover:text-orange-neon transition-colors disabled:opacity-40"
      :title="$t('detail.edit_revert')"
      :aria-label="$t('detail.edit_revert')"
      @click="$emit('revert')"
    >
      <v-icon icon="mdi-restore" size="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import OverrideDot from "@/components/OverrideDot.vue";

// A field label in the edit mask, carrying the same "manually edited" dot the read-only ledger
// uses (EditionDetails, OverviewPane) plus the revert affordance that only makes sense here.
defineProps<{
  /** The input's `id`, so the label actually labels it. */
  fieldId: string;
  label: string;
  overridden: boolean;
  /** Already reverted in this draft — the button is spent until the user types again. */
  reverted: boolean;
}>();

defineEmits<{ revert: [] }>();
</script>
