<template>
  <div class="min-h-screen bg-charcoal flex flex-col px-8">
    <AppHeader />
    <div class="flex-1 flex flex-col justify-center pb-20">
      <p
        class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3"
      >
        {{ $t("not_found.code") }}
      </p>
      <h1
        class="font-heading text-5xl font-bold text-text-primary leading-[1.05] mb-6"
      >
        {{ $t("not_found.heading_line1") }}<br />{{ $t("not_found.heading_line2") }}
      </h1>
      <p class="text-sm text-text-secondary leading-relaxed mb-12">
        {{ $t("not_found.body") }}
      </p>
      <router-link
        to="/library"
        class="self-start text-xs font-bold tracking-[0.25em] uppercase border-b border-text-primary pb-0.5 text-text-primary hover:opacity-70 transition-opacity"
      >
        {{ $t("not_found.cta") }}
      </router-link>
    </div>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
</script>
