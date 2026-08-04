<template>
  <!-- The board's top strip: four at-a-glance signals plus the instance cell. Each pip carries a
       colored edge so its state reads before the number does. Pure presentation — the page
       decides what a reading is and what "no reading" looks like. -->
  <!-- Two nested gutters, both the same as <main>'s: the outer one stops the hairline at the
       page's content edge, the inner one holds the cells in from it. The rule staying wider than
       what it underlines is the strip's whole look — losing it collapses it into a plain row. -->
  <div class="px-5 md:px-10">
    <div
      class="grid grid-cols-2 md:grid-cols-5 px-5 md:px-10 border-b border-charcoal-border"
    >
      <div
        v-for="(pip, i) in readings"
        :key="pip.key"
        class="flex items-stretch border-charcoal-border border-b md:border-b-0 md:border-r"
        :class="i % 2 === 0 ? 'border-r' : ''"
        :title="pip.title"
      >
        <span class="w-1.5 flex-none" :class="signalBg(pip.level)" />
        <div class="px-4 py-3 md:px-5 md:py-3.5">
          <p
            class="font-mono text-[8px] md:text-[9px] tracking-[0.2em] uppercase text-text-secondary mb-1.5"
          >
            {{ pip.label }}
          </p>
          <p
            class="font-mono text-[17px] md:text-xl leading-none"
            :class="signalText(pip.level)"
          >
            {{ pip.value }}
          </p>
        </div>
      </div>

      <div class="col-span-2 md:col-span-1 flex items-stretch justify-between">
        <div class="px-4 py-3 md:px-5 md:py-3.5">
          <p
            class="font-mono text-[8px] md:text-[9px] tracking-[0.2em] uppercase text-text-secondary mb-1.5"
          >
            {{ $t("admin.pips.instance") }}
          </p>
          <p class="font-mono text-[11px] text-text-secondary">
            bookscan-worker
          </p>
        </div>
        <AppButton
          variant="secondary"
          size="sm"
          mono
          class="self-center"
          :loading="loading"
          @click="emit('refresh')"
        >
          {{ $t("admin.refresh") }}
        </AppButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppButton from "@/components/AppButton.vue";
import type { SignalLevel } from "@/utils/admin-signal";
import { signalBg, signalText } from "@/utils/admin-signal";

type PipReading = {
  key: string;
  label: string;
  /** Pre-formatted, including the caller's own "no reading" placeholder. */
  value: string;
  level: SignalLevel;
  /** Hover text, for a pip whose colour and number don't measure the same thing. */
  title?: string;
};

defineProps<{ readings: PipReading[]; loading: boolean }>();

const emit = defineEmits<{ refresh: [] }>();
</script>
