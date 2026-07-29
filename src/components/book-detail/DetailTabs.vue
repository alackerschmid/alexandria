<template>
  <div class="border-b border-charcoal-border">
    <DetailMeasure class="relative">
      <div
        ref="scroller"
        role="tablist"
        :aria-label="$t('detail.tabs_label')"
        class="flex gap-6 md:gap-9 pt-4 md:pt-5 overflow-x-auto no-scrollbar"
        @scroll="updateFades"
        @keydown.left.prevent="step(-1)"
        @keydown.right.prevent="step(1)"
        @keydown.home.prevent="jump(0)"
        @keydown.end.prevent="jump(tabs.length - 1)"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :id="`detail-tab-${tab.key}`"
          :ref="(el) => setTabRef(tab.key, el as Element | null)"
          type="button"
          role="tab"
          :aria-selected="tab.key === modelValue"
          :aria-controls="`detail-panel-${tab.key}`"
          :tabindex="tab.key === modelValue ? 0 : -1"
          class="shrink-0 flex items-center gap-1.5 pb-3 -mb-px border-b-2 whitespace-nowrap text-[11px] tracking-[0.14em] uppercase transition-colors"
          :class="
            tab.key === modelValue
              ? 'font-bold text-text-primary border-orange-neon'
              : 'text-text-secondary hover:text-text-primary border-transparent'
          "
          @click="pick(tab.key)"
        >
          {{ tab.label }}
          <span
            v-if="tab.badge != null"
            class="font-mono normal-case tracking-normal opacity-60"
          >
            · {{ tab.badge }}
          </span>
        </button>
      </div>
      <!-- A fade on whichever side actually runs off-screen, rather than a fixed one. The row used
           to open at its *end* (the default tab was "All", the last one), so a left-only fade was
           right by construction; with `overview` — the first tab — as the default it opens at
           `scrollLeft: 0`, where that same fade would sit over the selected label and leave the
           real overflow on the right unmarked. -->
      <div
        v-if="fadeLeft"
        class="md:hidden pointer-events-none absolute left-6 top-0 bottom-0 w-10 bg-gradient-to-r from-charcoal to-transparent"
        aria-hidden="true"
      />
      <div
        v-if="fadeRight"
        class="md:hidden pointer-events-none absolute right-6 top-0 bottom-0 w-10 bg-gradient-to-l from-charcoal to-transparent"
        aria-hidden="true"
      />
    </DetailMeasure>
  </div>
</template>

<script lang="ts" setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import DetailMeasure from "@/components/book-detail/DetailMeasure.vue";

export interface DetailTab {
  key: string;
  label: string;
  /** Trailing count, e.g. the edition count on the Editions tab. */
  badge?: number;
}

const props = defineProps<{
  tabs: DetailTab[];
  modelValue: string;
}>();

const emit = defineEmits<{ "update:modelValue": [key: string] }>();

const scroller = ref<HTMLElement | null>(null);
const tabEls = new Map<string, HTMLElement>();

function setTabRef(key: string, el: Element | null) {
  if (el instanceof HTMLElement) tabEls.set(key, el);
  else tabEls.delete(key);
}

function pick(key: string) {
  emit("update:modelValue", key);
}

function jump(index: number) {
  const tab = props.tabs[index];
  if (!tab) return;
  pick(tab.key);
  tabEls.get(tab.key)?.focus();
}

function step(delta: number) {
  const i = props.tabs.findIndex((t) => t.key === props.modelValue);
  if (i === -1) return;
  jump(Math.min(props.tabs.length - 1, Math.max(0, i + delta)));
}

// Which edges still have row behind them. Recomputed on scroll, after a programmatic reveal and on
// resize — none of the three implies the others, and the tab row is short enough that a book with
// no overflow at all must end up with neither fade drawn.
const fadeLeft = ref(false);
const fadeRight = ref(false);

function updateFades() {
  const row = scroller.value;
  if (!row) return;
  const max = row.scrollWidth - row.clientWidth;
  // A pixel of slack: sub-pixel layout widths leave `scrollLeft` a hair short of `max` at the end.
  fadeLeft.value = row.scrollLeft > 1;
  fadeRight.value = row.scrollLeft < max - 1;
}

// The active tab has to be brought into view rather than assumed visible: the row is wider than a
// narrow screen, and the selected tab is not always one of the ones that fit.
//
// Deliberately not `scrollIntoView` — it can't be limited to one axis, so with the tab row scrolled
// above the fold it also scrolls the detail's *body* back up to reveal it. Since a ResizeObserver
// drives this, any window resize while the user was reading further down would throw their place
// away. Writing `scrollLeft` touches only the axis that needs it, and leaves an already-visible tab
// exactly where it is.
async function revealActive() {
  await nextTick();
  const row = scroller.value;
  if (!row) return;
  const tab = tabEls.get(props.modelValue);
  if (tab) {
    const left = tab.offsetLeft - row.clientWidth / 2 + tab.offsetWidth / 2;
    const max = row.scrollWidth - row.clientWidth;
    const target = Math.max(0, Math.min(max, left));
    // Don't fight a row that already shows the tab — only scroll when it is actually out of view.
    const start = row.scrollLeft;
    const visible =
      tab.offsetLeft >= start &&
      tab.offsetLeft + tab.offsetWidth <= start + row.clientWidth;
    if (!visible) row.scrollLeft = target;
  }
  updateFades();
}

watch(() => props.modelValue, revealActive, { immediate: true });
watch(() => props.tabs.map((t) => t.key).join(","), revealActive);

// A viewport change can push the active tab out of view — and change which edges overflow —
// without the tab or the set changing at all; going from desktop to mobile is exactly that.
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!scroller.value) return;
  observer = new ResizeObserver(() => revealActive());
  observer.observe(scroller.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<style scoped>
/* The tab row scrolls horizontally by design; a visible bar under six labels reads as a defect
   rather than an affordance, and the fade already signals there is more. This is the one place
   the app opts out of the global scrollbar styling. */
.no-scrollbar {
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
