<template>
  <div class="app-seg" :class="`app-seg--${size}`" role="group" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="app-seg__opt"
      :class="
        opt.value === modelValue
          ? `app-seg__opt--active-${variant}`
          : 'app-seg__opt--idle'
      "
      :aria-pressed="opt.value === modelValue"
      :aria-label="opt.ariaLabel || opt.label"
      @click="emit('update:modelValue', opt.value)"
    >
      <v-icon v-if="opt.icon" :icon="opt.icon" :size="size === 'sm' ? 14 : 16" />
      <span v-if="opt.label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
// The app's segmented (single-select) control: a connected group of options bound
// to a v-model. `fill` (the default) fills the active option with the user's accent
// and is what every labelled settings-style row uses — the settings page and the
// library's display-options panel alike; `highlight` tints the active option's text
// with the accent over a subtle raised fill, and is reserved for toolbar chrome
// (the library's inline view toggle), where an accent fill would shout. Both
// track the accent via theme `primary` (unlike the old inline copies, which pinned
// the static orange-neon token). NOT for the scanner's per-status colored pickers
// (dark-locked, per-option colors) or the login auth-mode pills (a bespoke one-off).
withDefaults(
  defineProps<{
    options: {
      value: T;
      label?: string;
      icon?: string;
      /** Accessible name for icon-only options (falls back to `label`). */
      ariaLabel?: string;
    }[];
    modelValue: T;
    variant?: "fill" | "highlight";
    size?: "sm" | "md";
    /** Accessible name for the group as a whole. */
    ariaLabel?: string;
  }>(),
  { variant: "fill", size: "md" },
);

const emit = defineEmits<{ "update:modelValue": [value: T] }>();
</script>

<style scoped>
.app-seg {
  display: inline-flex;
  flex-wrap: wrap;
  /* Raised surface + a control-strength border so the group reads as an
     actionable control against near-white light-mode backgrounds. */
  background: var(--color-charcoal-light);
  border: 1px solid var(--color-control-border);
  overflow: hidden;
}
.app-seg__opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  /* Inactive labels stay quieter than the active option but keep a legible
     contrast (the muted text-secondary was too faint on light backgrounds). */
  color: color-mix(in srgb, var(--color-text-primary) 68%, transparent);
  transition:
    color 0.15s,
    background-color 0.15s;
}
.app-seg__opt:not(:first-child) {
  border-left: 1px solid var(--color-control-border);
}
.app-seg--sm .app-seg__opt {
  padding: 6px 12px;
}
.app-seg--md .app-seg__opt {
  padding: 8px 16px;
}

/* fill: active option filled with the accent (dark, legible text via on-primary). */
.app-seg__opt--active-fill {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 700;
}
/* highlight: accent-tinted text over a subtle, surface-agnostic raised fill. */
.app-seg__opt--active-highlight {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.app-seg__opt--idle:hover {
  color: var(--color-text-primary);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
