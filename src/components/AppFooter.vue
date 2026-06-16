<template>
  <div class="px-6 pt-4 pb-8 flex flex-wrap gap-x-4 gap-y-1 items-center text-[10px] text-text-secondary/30 font-mono tracking-wide uppercase">
    <span>Bookscan</span>
    <span>{{ commitHash }}</span>
    <span>Book data via OpenLibrary &amp; Google Books</span>
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
