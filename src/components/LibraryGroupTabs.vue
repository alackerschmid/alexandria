<template>
  <div
    ref="containerRef"
    class="relative flex items-end w-full min-w-0 overflow-hidden"
  >
    <span
      class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary/70 mr-3.5 pb-3 whitespace-nowrap"
    >
      {{ $t("library.group_by") }}
    </span>

    <button
      v-for="opt in visibleOptions"
      :key="opt.value"
      class="appearance-none bg-transparent cursor-pointer px-3.5 pt-2 pb-2.5 -mb-px inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase whitespace-nowrap transition-colors border-b-2"
      :class="
        opt.value === modelValue
          ? 'text-text-primary border-orange-neon'
          : 'text-text-secondary border-transparent hover:text-text-primary'
      "
      @click="pick(opt.value)"
    >
      {{ opt.label }}
      <span
        v-if="opt.value === modelValue"
        class="text-orange-neon text-[10px]"
        >{{ sortDirection === "asc" ? "↑" : "↓" }}</span
      >
    </button>

    <!-- Overflow "More" -->
    <v-menu
      v-if="overflowOptions.length"
      v-model="moreOpen"
      location="bottom end"
      offset="4"
    >
      <template #activator="{ props: menuProps }">
        <button
          v-bind="menuProps"
          class="appearance-none bg-transparent cursor-pointer px-3.5 pt-2 pb-2.5 -mb-px inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase whitespace-nowrap transition-colors border-b-2"
          :class="
            moreActive
              ? 'text-orange-neon border-orange-neon'
              : 'text-text-secondary border-transparent hover:text-text-primary'
          "
        >
          {{ $t("library.more") }}
          <span class="text-[7px]">▾</span>
        </button>
      </template>
      <div
        class="bg-charcoal-light border border-charcoal-border shadow-xl py-1 min-w-[200px]"
      >
        <button
          v-for="opt in overflowOptions"
          :key="opt.value"
          class="flex items-center justify-between w-full px-4 py-2.5 text-left text-[11px] tracking-[0.04em] transition-colors"
          :class="
            opt.value === modelValue
              ? 'text-orange-neon'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'
          "
          @click="pick(opt.value)"
        >
          {{ opt.label }}
          <span
            v-if="opt.value === modelValue"
            class="text-orange-neon text-[11px]"
            >{{ sortDirection === "asc" ? "↑" : "↓" }}</span
          >
        </button>
      </div>
    </v-menu>

    <!-- Hidden ghost row used to measure natural tab widths -->
    <div
      ref="ghostRef"
      aria-hidden="true"
      class="absolute top-0 left-0 flex items-end invisible pointer-events-none"
    >
      <span
        class="font-mono text-[9px] tracking-[0.2em] uppercase mr-3.5 pb-3 whitespace-nowrap"
        >{{ $t("library.group_by") }}</span
      >
      <span
        v-for="opt in options"
        :key="opt.value"
        class="px-3.5 pt-2 pb-2.5 inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase whitespace-nowrap"
        >{{ opt.label }} <span class="text-[10px]">↑</span></span
      >
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import type { GroupBy } from "@/types/library";

interface Option {
  value: GroupBy;
  label: string;
}

const props = defineProps<{
  options: Option[];
  modelValue: GroupBy;
  sortDirection: "asc" | "desc";
}>();
const emit = defineEmits<{
  "update:modelValue": [GroupBy];
  "update:sortDirection": ["asc" | "desc"];
}>();

const moreOpen = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const ghostRef = ref<HTMLElement | null>(null);

const labelW = ref(0);
const tabWidths = ref<number[]>([]);
const availW = ref(0);
const MORE_W = 76; // reserved width for the "More ▾" button when overflowing

function measure() {
  if (!containerRef.value || !ghostRef.value) return;
  availW.value = Math.floor(containerRef.value.clientWidth);
  const kids = [...ghostRef.value.children] as HTMLElement[];
  labelW.value = Math.ceil(kids[0]?.getBoundingClientRect().width ?? 0);
  tabWidths.value = kids
    .slice(1)
    .map((c) => Math.ceil(c.getBoundingClientRect().width));
}

const visibleCount = computed(() => {
  const ws = tabWidths.value;
  if (ws.length !== props.options.length || !availW.value)
    return props.options.length;
  const fit = (reserve: number) => {
    let used = labelW.value;
    let n = 0;
    for (let i = 0; i < ws.length; i++) {
      const tail = i < ws.length - 1 ? reserve : 0;
      if (used + ws[i] + tail <= availW.value) {
        used += ws[i];
        n++;
      } else break;
    }
    return n;
  };
  const n1 = fit(0);
  if (n1 >= ws.length) return ws.length;
  return Math.max(1, fit(MORE_W));
});

const visibleOptions = computed(() =>
  props.options.slice(0, visibleCount.value),
);
const overflowOptions = computed(() => props.options.slice(visibleCount.value));
const moreActive = computed(() =>
  overflowOptions.value.some((o) => o.value === props.modelValue),
);

function pick(v: GroupBy) {
  moreOpen.value = false;
  if (v === props.modelValue)
    emit(
      "update:sortDirection",
      props.sortDirection === "asc" ? "desc" : "asc",
    );
  else emit("update:modelValue", v);
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  nextTick(measure);
  ro = new ResizeObserver(() => measure());
  if (containerRef.value) ro.observe(containerRef.value);
});
onBeforeUnmount(() => ro?.disconnect());
watch(
  () => props.options.map((o) => o.label).join("|"),
  () => nextTick(measure),
);
</script>
