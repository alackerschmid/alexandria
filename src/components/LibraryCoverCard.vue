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
    <div
      class="relative aspect-2/3 overflow-hidden bg-charcoal-light mb-1.5"
      :class="owningBorderClass"
    >
      <!-- Inset wrapper: shrinks the cover for 'unowned' so a gap of the card's own
           background shows between the dashed border and the image. -->
      <div class="absolute inset-0" :class="owningInsetClass">
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
      </div>

      <!-- Status dot (owned only) -->
      <div
        v-if="owned && !hideStatus"
        role="img"
        :aria-label="statusLabel"
        :title="statusLabel"
        class="absolute top-1 right-1 w-2.5 h-2.5 rounded-full ring-2 ring-black/70"
        :style="{ background: statusColor }"
      />

      <!-- Owning-status corner icon (want / lent_out only) -->
      <div
        v-if="owned && owningBadge"
        role="img"
        :aria-label="owningBadge.label"
        :title="owningBadge.label"
        class="absolute top-1 left-1 w-5.5 h-5.5 rounded-full flex items-center justify-center ring-2 ring-black/70"
        :style="{ background: owningBadge.color }"
      >
        <v-icon :icon="owningBadge.icon" size="14" color="white" />
      </div>

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
import type { OwningStatus, ReadStatus } from "@/types/book";
import { STATUS_META, useBookStatus } from "@/composables/useBookStatus";
import { OWNING_META, useOwningStatus } from "@/composables/useOwningStatus";
import PlaceholderCover from "@/components/PlaceholderCover.vue";

const props = defineProps<{
  title: string | null;
  coverUrl: string | null;
  ordinal: number | null;
  owned: boolean;
  status?: ReadStatus;
  owningStatus?: OwningStatus;
  author?: string | null;
  hideStatus?: boolean;
}>();

defineEmits<{ select: [] }>();

const { statusConfig } = useBookStatus();
const { owningBadge: getOwningBadge } = useOwningStatus();

const isNovella = computed(
  () => props.ordinal != null && !Number.isInteger(props.ordinal),
);
const statusLabel = computed(
  () => statusConfig.value[props.status ?? "unread"].label,
);

const statusColor = computed(
  () => STATUS_META[props.status ?? "unread"].themeColor,
);

const owningBorderClass = computed(
  () => OWNING_META[props.owningStatus ?? "owned"].borderClass,
);
// Shrinks the cover inward for "unowned" so the card's own background shows as a
// gap between the dashed border and the image, reinforcing the border treatment.
const owningInsetClass = computed(() =>
  (props.owningStatus ?? "owned") === "unowned" ? "p-1.5" : "",
);
const owningBadge = computed(() => getOwningBadge(props.owningStatus ?? "owned"));
</script>
