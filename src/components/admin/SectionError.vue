<template>
  <!-- One section's fetch failed. The other two loaded independently and stay live, so this
       says which request broke rather than replacing the whole board with an error page. -->
  <section>
    <div class="flex justify-between items-center mb-3.5">
      <SectionHeading :title="title" />
      <span
        class="font-mono text-[10px] tracking-[0.14em] uppercase text-signal-critical border border-signal-critical px-2 py-0.5"
      >
        {{ $t("admin.error.badge") }}
      </span>
    </div>
    <div
      class="border border-charcoal-border border-l-3 border-l-signal-critical bg-charcoal-light px-4 py-5 md:px-5.5 md:py-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4"
    >
      <div>
        <p class="font-mono text-[13px] md:text-sm text-text-primary mb-2">
          {{ $t("admin.error.title") }}
        </p>
        <p class="font-mono text-[11px] text-text-secondary leading-relaxed">
          {{ detail }}
        </p>
      </div>
      <AppButton
        variant="secondary"
        size="sm"
        mono
        class="self-start md:self-auto flex-none"
        :loading="retrying"
        @click="emit('retry')"
      >
        {{ $t("admin.error.retry") }}
      </AppButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import AppButton from "@/components/AppButton.vue";
import SectionHeading from "@/components/admin/SectionHeading.vue";

defineProps<{
  title: string;
  /** The failing request and its status, e.g. "GET /api/admin/usage — 500". */
  detail: string;
  retrying: boolean;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>
