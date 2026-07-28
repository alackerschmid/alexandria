<template>
  <!-- Only the pane that *is* the selected tab carries tabpanel semantics. In the All view five
       panes are on screen at once and none of them is the selected tab — "All" is — so the
       tabpanel role belongs to the container around them (see BookDetail), not to each one. -->
  <section
    :id="`detail-panel-${sectionKey}`"
    :role="panel ? 'tabpanel' : undefined"
    :aria-labelledby="panel ? `detail-tab-${sectionKey}` : undefined"
  >
    <!-- The rule exists only in the All view. With a single tab active the tab itself already
         names the section, so a header repeating it would be noise. -->
    <button
      v-if="rule"
      type="button"
      class="w-full flex items-center gap-2.5 pb-3.5 border-b border-charcoal-border font-mono text-[10px] tracking-[0.22em] uppercase text-text-secondary/70 hover:text-text-primary transition-colors"
      :aria-expanded="!collapsed"
      :aria-controls="`detail-body-${sectionKey}`"
      @click="$emit('toggle')"
    >
      <!-- An icon rather than a text glyph: `⌄` (U+2304) and `›` (U+203A) sit at different
           heights in their em boxes, so swapping between them made the expanded state look
           mis-centred against the collapsed one. Same chevrons the Recognition disclosure uses. -->
      <v-icon
        :icon="collapsed ? 'mdi-chevron-right' : 'mdi-chevron-down'"
        size="14"
        class="shrink-0"
      />
      {{ title }}
      <span
        v-if="summary"
        class="ml-auto tracking-[0.08em] normal-case text-text-secondary/70"
        >{{ summary }}</span
      >
    </button>

    <!-- The body is inset a little from the measure the rule spans, so a pane's content sits
         *inside* its header rather than flush against the same edges. The inset is constant
         whether or not the rule is drawn, so switching from All to a single tab doesn't shift
         the content sideways. -->
    <div
      v-show="!rule || !collapsed"
      :id="`detail-body-${sectionKey}`"
      class="px-8 md:px-10"
      :class="rule ? 'pt-6' : ''"
    >
      <slot />
    </div>
  </section>
</template>

<script lang="ts" setup>
// One pane of the detail body. In the All view each pane is introduced by a mono section rule that
// doubles as a disclosure — clicking it collapses the pane to a one-line summary of what's inside.
// When a single tab is active the rule disappears and the pane renders bare.
defineProps<{
  sectionKey: string;
  title: string;
  /** True when this pane is the currently selected tab, and so is the view's `tabpanel`. False in
   *  the All view and when there is no tab row at all. */
  panel: boolean;
  /** Whether to draw the section rule at all — true only in the All view. */
  rule: boolean;
  collapsed: boolean;
  /** One-line "what's in here" shown on the rule, e.g. "11 fields" or "214 words". */
  summary?: string;
}>();

defineEmits<{ toggle: [] }>();
</script>
