<template>
  <!-- `force-dark` on the panel, not inherited: a v-dialog teleports to the overlay container at
       the app root, outside the board's own force-dark subtree, so without this a drill-down would
       open as a near-white panel over a near-black board in light mode. -->
  <v-dialog
    :model-value="modelValue"
    max-width="1000"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div
      class="force-dark bg-charcoal-light border border-charcoal-border flex flex-col max-h-[80dvh]"
    >
      <div
        class="shrink-0 flex items-start justify-between gap-4 px-4 py-3.5 md:px-5.5 md:py-4 border-b border-charcoal-border"
      >
        <div class="min-w-0">
          <h2
            class="font-mono text-[10px] tracking-[0.24em] uppercase text-text-secondary"
          >
            {{ title }}
          </h2>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5">
            <span class="font-mono text-[11px] text-text-primary">{{
              meta
            }}</span>
            <!-- What was clicked, with a way back out to the unfiltered list — otherwise the only
                 route from one filter to another is closing the dialog and clicking again. -->
            <span
              v-if="chipLabel"
              class="flex items-center gap-1.5 border border-charcoal-border pl-2 pr-1 py-0.5"
            >
              <span class="font-mono text-[10px] text-signal-warn">{{
                chipLabel
              }}</span>
              <button
                type="button"
                class="text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                :title="clearFilterLabel"
                :aria-label="clearFilterLabel"
                @click="emit('clear-filter')"
              >
                <v-icon icon="mdi-close" size="12" />
              </button>
            </span>
          </div>
        </div>
        <button
          type="button"
          class="flex-none text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          :aria-label="$t('admin.close')"
          @click="emit('update:modelValue', false)"
        >
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <!-- The board's own load / fail / retry convention, from the component that owns it — a
           dialog fails the way a section does. Only the two state branches are inset: the list
           itself is full-bleed, so its rows can rule edge to edge. -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        <AdminSection
          :section="section"
          :title="title"
          :rows="5"
          titled
          state-class="px-4 py-4 md:px-5.5"
          @retry="emit('retry')"
        >
          <p
            v-if="isEmpty"
            class="px-4 py-10 text-center text-xs text-text-secondary"
          >
            {{ emptyLabel }}
          </p>
          <slot v-else />
        </AdminSection>
      </div>

      <!-- Only when the list is short of the count that opened it, so a capped list can't read as
           the whole story. -->
      <div
        v-if="footer"
        class="shrink-0 px-4 py-2.5 md:px-5.5 border-t border-charcoal-border font-mono text-[10px] text-chart-muted"
      >
        {{ footer }}
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts" generic="T">
import type { Section } from "@/types/admin";
import AdminSection from "@/components/admin/AdminSection.vue";

defineProps<{
  modelValue: boolean;
  title: string;
  /** The one-line summary under the title — window, count, whatever the list is of. */
  meta: string;
  /** The active filter, or null when the list is unfiltered. Renders the clearable chip. */
  chipLabel?: string | null;
  clearFilterLabel?: string;
  /** Same shape the board's sections use, so a dialog loads and fails the way they do. */
  section: Section<T>;
  /** Decided by the caller — only it knows which collection is the list. */
  isEmpty: boolean;
  emptyLabel: string;
  /** Truncation note, or null when the list is complete. */
  footer?: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "clear-filter": [];
  retry: [];
}>();
</script>
