<template>
  <!-- The board's section title. One definition of the instrument-panel heading scale, so a
       change to the tracking or the accent is one edit rather than five that must stay
       byte-identical — an error section in particular has to match the section it replaces, or
       the page jumps when a fetch fails. -->
  <h2
    class="font-mono text-[10px] md:text-[11px] tracking-[0.24em] md:tracking-[0.28em] uppercase text-orange-neon"
  >
    {{ title }}
  </h2>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();
</script>
