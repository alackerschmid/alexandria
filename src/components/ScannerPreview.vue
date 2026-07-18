<template>
  <div
    :class="[
      'scanner-viewport',
      `scanner-viewport--${size}`,
      dark ? '' : 'scanner-viewport--adaptive',
    ]"
  >
    <div :class="['barcode', size === 'lg' ? 'barcode--lg' : '']"></div>
    <span :class="['corner', 'tl', size === 'lg' ? 'corner--lg' : '']"></span>
    <span :class="['corner', 'tr', size === 'lg' ? 'corner--lg' : '']"></span>
    <span :class="['corner', 'bl', size === 'lg' ? 'corner--lg' : '']"></span>
    <span :class="['corner', 'br', size === 'lg' ? 'corner--lg' : '']"></span>
    <div :class="['scan-beam', size === 'lg' ? 'scan-beam--lg' : '']"></div>
  </div>
</template>

<script lang="ts" setup>
withDefaults(
  defineProps<{
    size?: "sm" | "lg";
    /** False makes the box follow the app theme instead of staying permanently dark. */
    dark?: boolean;
  }>(),
  { size: "sm", dark: true },
);
</script>

<style scoped>
@keyframes scanline {
  0%,
  100% {
    transform: translate(-50%, -24px);
    opacity: 0.6;
  }
  50% {
    transform: translate(-50%, 24px);
    opacity: 0.12;
  }
}

/* Dark by default — mirrors scanner.vue's live camera view, which is also
   always-dark. Pass `:dark="false"` to follow the app theme instead (used on
   the light-adaptive landing page). */
.scanner-viewport {
  --sp-bg: #111110;
  --sp-border: #2e2b28;
  --sp-corner: #f0ede8;
  position: relative;
  background: var(--sp-bg);
  border: 1px solid var(--sp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.scanner-viewport--adaptive {
  --sp-bg: var(--color-charcoal-light);
  --sp-border: var(--color-charcoal-border);
  --sp-corner: var(--color-text-primary);
}
.scanner-viewport--sm {
  width: 100%;
  height: 104px;
}
.scanner-viewport--lg {
  width: 300px;
  height: 170px;
}

/* Barcode strip */
.barcode {
  width: 172px;
  height: 60px;
  opacity: 0.9;
  background: repeating-linear-gradient(
    90deg,
    #e8e4dd 0 3px,
    transparent 3px 7px,
    #e8e4dd 7px 9px,
    transparent 9px 12px,
    #e8e4dd 12px 16px,
    transparent 16px 22px
  );
}
.barcode--lg {
  height: 64px;
}

/* Corner brackets */
.corner {
  position: absolute;
  border-color: var(--sp-corner);
  border-style: solid;
  width: 20px;
  height: 20px;
}
.corner.tl {
  top: 14px;
  left: 14px;
  border-width: 2px 0 0 2px;
}
.corner.tr {
  top: 14px;
  right: 14px;
  border-width: 2px 2px 0 0;
}
.corner.bl {
  bottom: 14px;
  left: 14px;
  border-width: 0 0 2px 2px;
}
.corner.br {
  bottom: 14px;
  right: 14px;
  border-width: 0 2px 2px 0;
}

.corner--lg {
  width: 28px;
  height: 28px;
}
.corner--lg.tl {
  top: 18px;
  left: 18px;
}
.corner--lg.tr {
  top: 18px;
  right: 18px;
}
.corner--lg.bl {
  bottom: 18px;
  left: 18px;
}
.corner--lg.br {
  bottom: 18px;
  right: 18px;
}

/* Scan beam */
.scan-beam {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 188px;
  height: 2px;
  background: color-mix(in srgb, var(--color-orange-neon) 75%, transparent);
  animation: scanline 2.4s ease-in-out infinite;
}
.scan-beam--lg {
  width: 200px;
}
</style>
