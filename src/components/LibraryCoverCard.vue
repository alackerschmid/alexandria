<template>
  <div
    class="cursor-pointer group min-w-0"
    :style="{ opacity: owned ? 1 : 0.5 }"
    role="button"
    tabindex="0"
    @click="$emit('select')"
    @keydown.enter="$emit('select')"
    @keydown.space.prevent="$emit('select')"
  >
    <div class="relative aspect-2/3 overflow-hidden bg-charcoal-light mb-1.5">
      <!-- Cover image -->
      <img
        v-if="coverUrl"
        :src="coverUrl"
        :alt="title || $t('series.untitled')"
        class="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
      />

      <!-- No cover found -->
      <PlaceholderCover
        v-else
        :title="title"
        :ghost="!owned"
        text-class="text-[30px]"
        :icon-size="28"
        :show-missing-indicator="!owned"
      />

      <!-- Status dot (owned only) -->
      <div
        v-if="owned"
        role="img"
        :aria-label="statusLabel"
        :title="statusLabel"
        class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
        style="box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4)"
        :style="{ background: statusColor }"
      />

      <!-- Novella / side-entry badge -->
      <span
        v-if="isNovella"
        class="absolute bottom-1.5 left-1.5 font-mono text-[7px] tracking-[0.12em] text-[#cbc4ba] px-1 py-0.5"
        style="background: rgba(0, 0, 0, 0.55)"
      >
        {{ $t("library.novella") }}
      </span>
    </div>

    <p
      class="text-[10px] font-heading font-bold leading-snug line-clamp-2"
      :class="owned ? 'text-text-primary' : 'text-text-secondary'"
    >
      {{ title || "—"
      }}<span v-if="ordinal != null" class="font-normal text-text-secondary/70">
        #{{ ordinal }}</span
      >
    </p>
    <p
      v-if="!owned"
      class="font-mono text-[8px] tracking-[0.14em] text-text-secondary/50 uppercase mt-0.5"
    >
      {{ $t("library.unowned") }}
    </p>
    <p
      v-else-if="author"
      class="text-[9px] text-text-secondary/70 mt-0.5 truncate"
    >
      {{ author }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import type { ReadStatus } from "@/types/book";
import { STATUS_META, useBookStatus } from "@/composables/useBookStatus";
import PlaceholderCover from "@/components/PlaceholderCover.vue";

const props = defineProps<{
  title: string | null;
  coverUrl: string | null;
  ordinal: number | null;
  owned: boolean;
  status?: ReadStatus;
  author?: string | null;
}>();

defineEmits<{ select: [] }>();

const { statusConfig } = useBookStatus();

const isNovella = computed(
  () => props.ordinal != null && !Number.isInteger(props.ordinal),
);
const statusLabel = computed(
  () => statusConfig.value[props.status ?? "unread"].label,
);

const statusColor = computed(
  () => STATUS_META[props.status ?? "unread"].themeColor,
);
</script>
