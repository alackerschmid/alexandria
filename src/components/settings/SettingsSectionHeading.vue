<template>
  <div class="mb-6">
    <div class="flex items-baseline gap-4 mb-1.5">
      <h2
        class="font-heading font-black text-[22px] text-text-primary leading-none"
      >
        {{ title }}
      </h2>
      <span class="flex-1 h-px bg-charcoal-border" />
    </div>
    <p
      v-if="description"
      class="text-[13px] text-text-secondary max-w-lg leading-relaxed"
    >
      {{ description }}
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title?: string; description?: string }>();
</script>
