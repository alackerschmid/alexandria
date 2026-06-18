<template>
  <div class="pt-14 flex justify-between items-center">
    <router-link
      to="/"
      class="text-orange-neon text-[10px] tracking-[0.35em] uppercase font-bold"
    >
      {{ $t('app_name') }}
    </router-link>
    <slot />
  </div>
</template>
