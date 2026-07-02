<template>
  <div class="min-h-screen bg-charcoal flex flex-col px-8">
    <!-- Header -->
    <AppHeader class="mb-16" />

    <!-- Content -->
    <div class="flex-1 pb-20 max-w-prose space-y-10">
      <div>
        <p
          class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3"
        >
          {{ $t("privacy.eyebrow") }}
        </p>
        <h1
          class="font-heading text-4xl font-bold text-text-primary leading-[1.05]"
        >
          {{ $t("privacy.heading_line1") }}<br />{{ $t("privacy.heading_line2") }}
        </h1>
      </div>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">
          {{ $t("privacy.data_collected_heading") }}
        </h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          {{ $t("privacy.data_collected_body") }}
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">
          {{ $t("privacy.storage_heading") }}
        </h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          {{ $t("privacy.storage_body") }}
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">
          {{ $t("privacy.third_parties_heading") }}
        </h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          {{ $t("privacy.third_parties_body") }}
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">
          {{ $t("privacy.retention_heading") }}
        </h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          {{ $t("privacy.retention_body") }}
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">
          {{ $t("privacy.contact_heading") }}
        </h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          <a
            href="mailto:alex@lackerschmid.website"
            class="text-text-primary underline underline-offset-4 hover:opacity-70 transition-opacity"
            >alex@lackerschmid.website</a
          >
        </p>
      </section>
    </div>

    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import AppFooter from "@/components/AppFooter.vue";
import AppHeader from "@/components/AppHeader.vue";
</script>
