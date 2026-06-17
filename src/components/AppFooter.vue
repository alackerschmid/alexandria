<template>
  <div
    class="mx-auto w-full max-w-300 px-6 md:px-10 pt-4 pb-8 flex flex-wrap justify-center gap-x-4 gap-y-1 items-center text-center text-[10px] text-text-secondary/30 font-mono tracking-wide"
  >
    <span>The Library of Alexandria</span> |
    <span>Latest update: {{ commitHash }}</span> |
    <span>Book data provided via OpenLibrary &amp; Google Books</span> |
    <router-link
      to="/privacy"
      class="hover:text-text-secondary/60 transition-colors"
    >
      Privacy
    </router-link>
  </div>
</template>

<script setup lang="ts">
const commitHash = __COMMIT_HASH__;
</script>
