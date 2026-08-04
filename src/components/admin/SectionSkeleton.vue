<template>
  <!-- Holds the section's slot while its fetch is in flight, so the board doesn't reflow as the
       three requests land at different times. -->
  <section>
    <div
      class="w-2/5 h-3 mb-4 bg-charcoal-light animate-pulse"
      aria-hidden="true"
    />
    <div
      v-for="i in rows"
      :key="i"
      class="flex items-center gap-4 py-2.75 border-b border-charcoal-border/60"
      aria-hidden="true"
    >
      <span class="flex-none w-30 h-2 bg-charcoal-light animate-pulse" />
      <span class="flex-1 h-2 bg-charcoal-light animate-pulse" />
      <span class="flex-none w-20 h-2 bg-charcoal-light animate-pulse" />
    </div>
    <span class="sr-only">{{ $t("admin.loading") }}</span>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 });
</script>
