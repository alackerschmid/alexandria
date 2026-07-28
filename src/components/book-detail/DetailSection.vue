<template>
  <section
    :id="`detail-panel-${sectionKey}`"
    role="tabpanel"
    :aria-labelledby="`detail-tab-${sectionKey}`"
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
      <span class="text-xs shrink-0" aria-hidden="true">{{
        collapsed ? "›" : "⌄"
      }}</span>
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
      class="px-4 md:px-5"
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
  /** Whether to draw the section rule at all — true only in the All view. */
  rule: boolean;
  collapsed: boolean;
  /** One-line "what's in here" shown on the rule, e.g. "11 fields" or "214 words". */
  summary?: string;
}>();

defineEmits<{ toggle: [] }>();
</script>
