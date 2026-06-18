<template>
  <v-snackbar
    :model-value="modelValue"
    :timeout="timeout"
    :location="location"
    color="transparent"
    variant="flat"
    :elevation="0"
    rounded="0"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div
      class="flex items-stretch bg-charcoal-light border border-charcoal-border elevation-2"
    >
      <div class="w-0.75 shrink-0" :class="ACCENT[type]" />
      <div class="flex items-center px-4 py-3.5">
        <span class="text-sm font-body text-text-primary tracking-wide">{{ message }}</span>
      </div>
    </div>
  </v-snackbar>
</template>

<script setup lang="ts">
import type { Anchor } from "vuetify";

export type ToastType = "success" | "warning" | "error";

withDefaults(
  defineProps<{
    modelValue: boolean;
    message: string;
    type?: ToastType;
    timeout?: number;
    location?: Anchor;
  }>(),
  { type: "success", timeout: 3000, location: "top end" }
);

defineEmits<{ "update:modelValue": [value: boolean] }>();

const ACCENT: Record<ToastType, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};
</script>
