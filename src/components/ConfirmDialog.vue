<template>
  <v-dialog
    :model-value="modelValue"
    :max-width="maxWidth"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card rounded="0" class="bg-charcoal-light">
      <v-card-title
        class="font-heading text-xl pt-6 px-6 text-text-primary"
        :class="danger ? 'font-black' : 'font-bold'"
        :style="danger ? 'color: rgb(var(--v-theme-error))' : undefined"
      >
        {{ title }}
      </v-card-title>
      <v-card-text class="px-6 text-sm text-text-secondary leading-relaxed">
        <slot>{{ body }}</slot>
      </v-card-text>
      <v-card-actions class="px-4 pb-4 gap-2">
        <v-spacer />
        <AppButton variant="ghost" size="sm" @click="onCancel">
          {{ cancelLabel }}
        </AppButton>
        <AppButton
          variant="danger"
          size="sm"
          :loading="loading"
          :disabled="confirmDisabled"
          @click="$emit('confirm')"
        >
          {{ confirmLabel }}
        </AppButton>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import AppButton from "@/components/AppButton.vue";

withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    /** Simple body text; ignored when the default slot is provided. */
    body?: string;
    loading?: boolean;
    confirmDisabled?: boolean;
    /** Renders the title in the error color (destructive intent). */
    danger?: boolean;
    maxWidth?: string | number;
  }>(),
  { loading: false, confirmDisabled: false, danger: false, maxWidth: 360 },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  confirm: [];
  cancel: [];
}>();

function onCancel() {
  emit("cancel");
  emit("update:modelValue", false);
}
</script>
