<template>
  <div
    class="mx-auto w-full max-w-300 px-6 md:px-10 pt-4 pb-8 flex flex-wrap justify-center gap-x-4 gap-y-1 items-center text-center text-[11px] text-text-secondary font-mono tracking-wide"
  >
    <span>{{ $t("app_name") }}</span> <span aria-hidden="true">|</span>
    <span>{{ $t("footer.latest_update", { hash: commitHash }) }}</span>
    <span aria-hidden="true">|</span>
    <span>{{ $t("footer.data_credit") }}</span>
    <span aria-hidden="true">|</span>
    <router-link
      to="/privacy"
      class="hover:text-text-primary transition-colors underline underline-offset-2"
    >
      {{ $t("footer.privacy") }}
    </router-link>
  </div>
</template>

<script setup lang="ts">
const commitHash = __COMMIT_HASH__;
</script>
