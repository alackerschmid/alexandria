<template>
  <p
    v-if="code"
    :id="id"
    class="text-[10px] text-error tracking-wide mt-1"
    role="alert"
  >
    {{ $t(`detail.edit_err_${code}`) }}
  </p>
</template>

<script setup lang="ts">
// One field's validation message. The code is a stable machine string produced by
// `utils/book-edit.ts` or echoed from the worker's 400 body — neither side ships prose, so the
// same failure reads identically whether it was caught before the request or after it.
defineProps<{ id: string; code?: string }>();
</script>
