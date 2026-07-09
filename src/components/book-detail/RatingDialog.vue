<template>
  <v-dialog
    :model-value="modelValue"
    max-width="320"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="bg-charcoal-light border border-charcoal-border p-6">
      <div
        class="text-[10px] tracking-[0.16em] uppercase text-text-secondary/60 mb-1.5"
      >
        {{ $t("detail.rate_book") }}
      </div>
      <div
        class="font-mono text-[28px] mb-4"
        :style="{ color: rating != null ? RATING_COLOR : '#6b625b' }"
      >
        {{ rating ?? 0
        }}<span class="text-[13px] text-text-secondary/60">{{
          $t("detail.of_ten")
        }}</span>
      </div>
      <div class="mb-5">
        <RatingDots
          :rating="rating"
          size="lg"
          interactive
          @update:rating="$emit('set-rating', $event)"
        />
      </div>
      <div class="flex items-center justify-between">
        <button
          class="text-[11px] text-text-secondary/60 hover:text-text-secondary transition-colors"
          @click="$emit('set-rating', null)"
        >
          {{ $t("detail.clear_rating") }}
        </button>
        <button
          class="text-[11px] tracking-[0.08em] uppercase font-semibold bg-text-primary px-4.5 py-2 hover:opacity-90 transition-opacity"
          style="color: var(--color-charcoal)"
          @click="$emit('update:modelValue', false)"
        >
          {{ $t("detail.done") }}
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import RatingDots from "@/components/RatingDots.vue";
import { RATING_COLOR } from "@/composables/useRating";

defineProps<{
  modelValue: boolean;
  rating: number | null;
}>();

defineEmits<{
  "update:modelValue": [value: boolean];
  "set-rating": [rating: number | null];
}>();
</script>
