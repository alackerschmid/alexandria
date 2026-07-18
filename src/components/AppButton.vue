<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    class="app-btn"
    :class="[
      `app-btn--${variant}`,
      `app-btn--${size}`,
      { 'app-btn--block': block, 'app-btn--outlined': outlined },
    ]"
  >
    <v-progress-circular
      v-if="loading"
      indeterminate
      :size="size === 'lg' ? 16 : 14"
      width="2"
    />
    <slot />
  </button>
</template>

<script setup lang="ts">
// The app's single action-button primitive. Variants map to the four semantic
// roles used across the app; `inverse` is the ink/white marketing treatment on
// dark heroes (landing/login). Segmented selectors and the toggle switch are
// deliberately NOT this component — they're stateful pickers, not actions.
//
// Colors come from theme-reactive tokens: `primary` fills with the user's chosen
// accent (Vuetify theme `primary`, kept in sync by App.vue), so it — unlike the
// static `orange-neon` Tailwind token — actually follows the accent everywhere.
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger" | "inverse";
    size?: "sm" | "md" | "lg";
    /** Stretch to the full width of the container. */
    block?: boolean;
    /** Hairline-outline treatment instead of a solid fill (currently only `danger`). */
    outlined?: boolean;
    loading?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  {
    variant: "primary",
    size: "md",
    block: false,
    outlined: false,
    loading: false,
    disabled: false,
    type: "button",
  },
);
</script>

<style scoped>
.app-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-transform: uppercase;
  font-weight: 700;
  font-family: var(--font-body);
  white-space: nowrap;
  border: 1px solid transparent;
  transition:
    opacity 0.15s,
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}
.app-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Sizes ──────────────────────────────────────────────────────────────── */
.app-btn--sm {
  font-size: 10px;
  letter-spacing: 0.16em;
  padding: 8px 14px;
}
.app-btn--md {
  font-size: 11px;
  letter-spacing: 0.18em;
  padding: 12px 20px;
}
.app-btn--lg {
  font-size: 12px;
  letter-spacing: 0.22em;
  padding: 16px 24px;
}
.app-btn--block {
  width: 100%;
}

/* ── Variants ───────────────────────────────────────────────────────────── */
/* primary: accent fill — follows the user's chosen accent via theme primary. */
.app-btn--primary {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.app-btn--primary:not(:disabled):hover {
  opacity: 0.9;
}

/* secondary: control-strength outline over a transparent fill. */
.app-btn--secondary {
  color: var(--color-text-primary);
  border-color: var(--color-control-border);
}
.app-btn--secondary:not(:disabled):hover {
  border-color: var(--color-text-primary);
}

/* ghost: text only, no border or fill. */
.app-btn--ghost {
  color: var(--color-text-secondary);
}
.app-btn--ghost:not(:disabled):hover {
  color: var(--color-text-primary);
}

/* danger: error fill, or a hairline error outline when `outlined`. */
.app-btn--danger {
  background: var(--color-error);
  color: #fff;
}
.app-btn--danger:not(:disabled):hover {
  opacity: 0.9;
}
.app-btn--danger.app-btn--outlined {
  background: transparent;
  color: var(--color-error);
  border-color: var(--color-error);
}
.app-btn--danger.app-btn--outlined:not(:disabled):hover {
  opacity: 0.8;
}

/* inverse: ink/white fill — the marketing/auth primary treatment on dark heroes. */
.app-btn--inverse {
  background: var(--color-text-primary);
  color: var(--color-charcoal);
}
.app-btn--inverse:not(:disabled):hover {
  opacity: 0.8;
}
</style>
