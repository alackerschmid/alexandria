<template>
  <!-- A settings section whose whole content is "here is a thing, go there to do it" — the import
       wizard and the admin board. The accent outline is bound rather than a Tailwind class because
       the accent is a user preset resolved at runtime, so it can't be a compiled utility. -->
  <div
    class="flex items-center justify-between gap-6 border border-charcoal-border p-6"
  >
    <div>
      <p class="text-[15px] text-text-primary font-medium">
        {{ description }}
      </p>
    </div>
    <router-link
      :to="to"
      class="flex-none border font-mono text-[10px] tracking-[0.16em] uppercase px-[22px] py-3 whitespace-nowrap transition-colors"
      :style="{
        color: 'rgb(var(--v-theme-on-background))',
        borderColor: accentStore.color,
      }"
    >
      {{ label }}
    </router-link>
  </div>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { useAccentStore } from "@/stores/accent";

defineProps<{
  description: string;
  to: RouteLocationRaw;
  label: string;
}>();

const accentStore = useAccentStore();
</script>
