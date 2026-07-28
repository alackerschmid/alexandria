<template>
  <div class="border-b border-charcoal-border">
    <DetailMeasure class="relative">
      <div
        ref="scroller"
        role="tablist"
        :aria-label="$t('detail.tabs_label')"
        class="flex gap-6 md:gap-9 pt-4 md:pt-5 overflow-x-auto no-scrollbar"
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
          <span
            v-if="tab.dot"
            class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0"
            aria-hidden="true"
          />
        </button>
      </div>
      <!-- Fade only on the left: "All" is the last tab and the default, so the row opens scrolled
           to its end and it is the start of the list that runs off-screen. -->
      <div
        class="md:hidden pointer-events-none absolute left-6 top-0 bottom-0 w-10 bg-gradient-to-r from-charcoal to-transparent"
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
  /** Attention marker — the Review tab carries one until a review is written. */
  dot?: boolean;
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

// The active tab has to be brought into view rather than assumed visible: "All" is the default
// and sits last, so on a narrow screen the row starts scrolled past its own beginning. `inline:
// "nearest"` keeps an already-visible tab still — this must not yank the row on every click.
async function revealActive() {
  await nextTick();
  tabEls
    .get(props.modelValue)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

watch(() => props.modelValue, revealActive, { immediate: true });
watch(() => props.tabs.map((t) => t.key).join(","), revealActive);

// A viewport change can push the active tab out of view without the tab or the set changing at
// all — going from desktop to mobile is exactly that, and it would leave "All" selected but
// off-screen with the row parked at its start.
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
