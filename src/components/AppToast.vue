<template>
  <v-snackbar
    :model-value="modelValue"
    :timeout="timeout"
    :location="location"
    color="#111110"
    rounded="0"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="flex items-center gap-3 py-0.5">
      <v-icon :icon="ICON[type]" :color="type" size="16" class="shrink-0" />
      <span class="text-xs text-white tracking-wide">{{ message }}</span>
    </div>
  </v-snackbar>
</template>

<script setup lang="ts">
export type ToastType = "success" | "warning" | "error";

withDefaults(
  defineProps<{
    modelValue: boolean;
    message: string;
    type?: ToastType;
    timeout?: number;
    location?: "top" | "bottom" | "center";
  }>(),
  { type: "success", timeout: 3000, location: "bottom" }
);

defineEmits<{ "update:modelValue": [value: boolean] }>();

const ICON: Record<ToastType, string> = {
  success: "mdi-check-circle-outline",
  warning: "mdi-alert-outline",
  error: "mdi-alert-circle-outline",
};
</script>
