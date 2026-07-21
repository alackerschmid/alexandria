<template>
  <!-- Dot + ON/OFF label pairing — the same shape as the READ/UNREAD/DNF status
       tags on the cards, just toggling on/off. Presentational: the parent owns
       the click. -->
  <span
    class="inline-flex items-center gap-1 shrink-0 text-[10px] tracking-[0.12em] uppercase"
    :class="modelValue ? 'text-text-primary' : 'text-text-secondary'"
  >
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0"
      :class="modelValue ? (onColor ? '' : 'bg-orange-neon') : 'bg-charcoal-border'"
      :style="modelValue && onColor ? { background: onColor } : undefined"
    />
    {{ modelValue ? t("toggle.on") : t("toggle.off") }}
  </span>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";

defineProps<{
  modelValue: boolean;
  /** Accent-driven on-state color (e.g. the user's chosen accent), overriding the default orange-neon token. */
  onColor?: string;
}>();

const { t } = useI18n();
</script>
