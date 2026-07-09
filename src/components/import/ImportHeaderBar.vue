<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAccentStore } from "@/stores/accent";
import { STATUS_META } from "@/composables/useBookStatus";

const props = defineProps<{
  fileName: string;
  matchedCount: number;
  attentionCount: number;
  remaining: number;
}>();
defineEmits<{ cancel: []; finalize: [] }>();

const { t } = useI18n();
const accentStore = useAccentStore();

const canFinalize = computed(() => props.remaining === 0);
const attentionColor = computed(() =>
  props.remaining > 0 ? STATUS_META.dnf.color : STATUS_META.read.color,
);
</script>

<template>
  <div
    class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-charcoal-border px-6 md:px-8 py-5"
  >
    <div>
      <p
        class="font-mono text-[10px] tracking-[0.22em] uppercase text-text-secondary"
      >
        {{ t("import.header.eyebrow") }}
      </p>
      <div class="flex items-center gap-4 flex-wrap mt-2">
        <span class="font-mono text-[12px] text-text-primary truncate">
          {{ fileName }}
        </span>
        <span
          class="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase"
          :style="{ color: STATUS_META.read.color }"
        >
          <span
            class="w-[5px] h-[5px] rounded-full"
            :style="{ background: STATUS_META.read.color }"
          />
          {{ t("import.header.matched", { n: matchedCount }) }}
        </span>
        <span
          v-if="attentionCount > 0"
          class="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase"
          :style="{ color: attentionColor }"
        >
          <span
            class="w-[5px] h-[5px] rounded-full"
            :style="{ background: attentionColor }"
          />
          {{ t("import.header.needs_attention", { n: attentionCount }) }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-3 flex-none">
      <v-btn
        variant="outlined"
        rounded="0"
        elevation="0"
        size="small"
        class="text-[10px] tracking-[0.14em] uppercase px-4"
        @click="$emit('cancel')"
      >
        {{ t("import.header.cancel") }}
      </v-btn>
      <button
        type="button"
        :disabled="!canFinalize"
        class="font-mono text-[10px] font-bold tracking-[0.14em] uppercase px-5 py-3 transition-opacity disabled:cursor-not-allowed"
        :class="canFinalize ? '' : 'bg-charcoal-light text-text-secondary opacity-60'"
        :style="
          canFinalize ? { background: accentStore.color, color: '#111110' } : {}
        "
        @click="$emit('finalize')"
      >
        {{
          canFinalize
            ? t("import.header.finalize")
            : t("import.header.finalize_blocked", { n: remaining })
        }}
      </button>
    </div>
  </div>
</template>
