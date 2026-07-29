<template>
  <div
    ref="rootEl"
    class="relative flex flex-wrap items-center gap-1.5 bg-charcoal border border-charcoal-border px-2 py-1.5 min-h-[34px] transition-colors cursor-text"
    :class="open ? 'border-orange-neon' : ''"
    @click="inputEl?.focus()"
  >
    <span
      v-for="tag in modelValue"
      :key="tag"
      class="inline-flex items-center gap-1 px-2 py-0.5 border border-charcoal-border bg-charcoal-light text-xs text-text-primary"
    >
      {{ tag }}
      <button
        class="text-text-secondary/50 hover:text-error transition-colors"
        :aria-label="$t('detail.tag_remove', { tag })"
        @click.stop="removeTag(tag)"
      >
        <v-icon icon="mdi-close" size="12" />
      </button>
    </span>

    <input
      ref="inputEl"
      v-model="query"
      type="text"
      role="combobox"
      :aria-expanded="open"
      aria-autocomplete="list"
      aria-controls="tag-input-listbox"
      :aria-activedescendant="
        open && highlighted >= 0 ? `tag-input-option-${highlighted}` : undefined
      "
      :aria-labelledby="ariaLabelledby"
      :placeholder="modelValue.length ? '' : placeholder"
      class="flex-1 min-w-[80px] bg-transparent text-xs text-text-primary py-0.5 focus-ring-none"
      @focus="openMenu"
      @keydown.enter.prevent="onEnter"
      @keydown.backspace="onBackspace"
      @keydown.down.prevent="moveHighlight(1)"
      @keydown.up.prevent="moveHighlight(-1)"
      @keydown.escape="onEscape"
    />

    <div
      v-if="open && filteredSuggestions.length"
      id="tag-input-listbox"
      role="listbox"
      class="absolute left-0 right-0 top-full mt-1 z-10 border border-charcoal-border bg-charcoal-light max-h-56 overflow-y-auto"
    >
      <div
        v-for="(item, idx) in filteredSuggestions"
        :id="`tag-input-option-${idx}`"
        :key="item"
        role="option"
        :aria-selected="idx === highlighted"
        class="flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer transition-colors"
        :class="
          idx === highlighted
            ? 'bg-white/[0.04] text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'
        "
        @mousedown.prevent="selectSuggestion(item)"
      >
        <span>{{ item }}</span>
        <button
          class="shrink-0 transition-colors"
          :class="
            confirmingValue === item
              ? 'text-error'
              : 'text-text-secondary/40 hover:text-error'
          "
          :title="
            confirmingValue === item ? deleteConfirmTitle?.(item) : deleteTitle
          "
          :aria-label="
            confirmingValue === item ? deleteConfirmTitle?.(item) : deleteTitle
          "
          @mousedown.stop.prevent="$emit('delete-suggestion', item)"
        >
          <v-icon
            :icon="confirmingValue === item ? 'mdi-delete' : 'mdi-close'"
            size="14"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string[];
  suggestions: string[];
  placeholder?: string;
  confirmingValue?: string | null;
  deleteTitle?: string;
  deleteConfirmTitle?: (tag: string) => string;
  ariaLabelledby?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
  open: [];
  close: [];
  "delete-suggestion": [value: string];
}>();

const rootEl = ref<HTMLElement>();
const inputEl = ref<HTMLInputElement>();
const query = ref("");
const open = ref(false);
const highlighted = ref(-1);

watch(open, (isOpen) => {
  if (!isOpen) emit("close");
});

const filteredSuggestions = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.suggestions.filter(
    (s) => !props.modelValue.includes(s) && (!q || s.toLowerCase().includes(q)),
  );
});

function openMenu() {
  open.value = true;
  highlighted.value = -1;
  emit("open");
}

function moveHighlight(delta: number) {
  if (!open.value) {
    openMenu();
    return;
  }
  const max = filteredSuggestions.value.length - 1;
  if (max < 0) return;
  highlighted.value = Math.min(max, Math.max(0, highlighted.value + delta));
}

function addTag(value: string) {
  const trimmed = value.trim();
  if (!trimmed || props.modelValue.includes(trimmed)) return;
  emit("update:modelValue", [...props.modelValue, trimmed]);
}

function removeTag(value: string) {
  emit(
    "update:modelValue",
    props.modelValue.filter((v) => v !== value),
  );
}

function selectSuggestion(value: string) {
  addTag(value);
  query.value = "";
  highlighted.value = -1;
  inputEl.value?.focus();
}

function onEnter() {
  if (highlighted.value >= 0 && filteredSuggestions.value[highlighted.value]) {
    selectSuggestion(filteredSuggestions.value[highlighted.value]);
    return;
  }
  addTag(query.value);
  query.value = "";
  highlighted.value = -1;
}

function onBackspace(e: KeyboardEvent) {
  if (query.value.length) return;
  const last = props.modelValue.at(-1);
  if (last === undefined) return;
  e.preventDefault();
  removeTag(last);
}

/**
 * Escape dismisses the suggestion list — but only when there is one on screen. Propagation is
 * stopped in exactly that case, because this input lives inside the book detail's `v-dialog`:
 * an unconditional `.stop` would make Escape do nothing at all when no list is open, and no
 * `.stop` at all lets the dialog close (destroying the unsaved edit draft) on the keypress the
 * user meant for the list.
 */
function onEscape(e: KeyboardEvent) {
  if (!open.value || !filteredSuggestions.value.length) return;
  e.stopPropagation();
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (!rootEl.value?.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener("mousedown", onClickOutside));
onBeforeUnmount(() =>
  document.removeEventListener("mousedown", onClickOutside),
);
</script>
