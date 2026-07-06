<template>
  <v-snackbar
    :model-value="modelValue"
    :timeout="effectiveTimeout"
    :location="location"
    color="transparent"
    variant="flat"
    :elevation="0"
    rounded="0"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div
      :role="type === 'error' ? 'alert' : 'status'"
      :aria-live="type === 'error' ? 'assertive' : 'polite'"
      class="flex items-stretch bg-charcoal-light border border-charcoal-border elevation-2"
    >
      <div class="w-0.75 shrink-0" :class="ACCENT[type]" />
      <div class="flex items-center gap-2.5 px-4 py-3.5">
        <v-icon :icon="ICON[type]" size="16" :color="type" />
        <span class="text-sm font-body text-text-primary tracking-wide">{{
          message
        }}</span>
        <button
          class="text-text-secondary/50 hover:text-text-secondary transition-colors ml-1"
          :aria-label="$t('detail.close')"
          @click="$emit('update:modelValue', false)"
        >
          <v-icon icon="mdi-close" size="14" />
        </button>
      </div>
    </div>
  </v-snackbar>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Anchor } from "vuetify";

export type ToastType = "success" | "warning" | "error";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    message: string;
    type?: ToastType;
    timeout?: number;
    location?: Anchor;
  }>(),
  { type: "success", timeout: 3000, location: "top end" },
);

defineEmits<{ "update:modelValue": [value: boolean] }>();

// Errors never auto-dismiss — the visible close button above is the only way
// out, so a slow reader can't lose the message to a timer.
const effectiveTimeout = computed(() =>
  props.type === "error" ? -1 : props.timeout,
);

const ACCENT: Record<ToastType, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};

const ICON: Record<ToastType, string> = {
  success: "mdi-check-circle-outline",
  warning: "mdi-alert-outline",
  error: "mdi-alert-circle-outline",
};
</script>
