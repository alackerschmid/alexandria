<template>
  <div
    v-if="fieldDefsStore.defs.length"
    class="mb-8 pt-8 border-t border-charcoal-border"
  >
    <div
      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-4"
    >
      {{ $t("detail.custom_fields") }}
    </div>

    <div class="flex flex-col gap-4 max-w-md">
      <div v-for="def in fieldDefsStore.defs" :key="def.id">
        <label
          :id="`custom-field-label-${def.id}`"
          class="text-[10px] text-text-secondary/60 tracking-[0.1em] uppercase mb-1.5 block"
          >{{ def.name }}</label
        >

        <!-- tag: multi-value input with global-delete suggestions -->
        <TagInput
          v-if="def.type === 'tag'"
          :model-value="(customFieldValues[def.id] as string[]) ?? []"
          :suggestions="fieldDefsStore.tagValues[def.id] ?? []"
          :placeholder="$t('detail.tag_add')"
          :confirming-value="confirmingValueFor(def.id)"
          :delete-title="$t('detail.tag_delete')"
          :delete-confirm-title="
            (tag: string) => $t('detail.tag_delete_confirm', { tag })
          "
          :aria-labelledby="`custom-field-label-${def.id}`"
          @update:model-value="onTagChange(def.id, $event)"
          @open="onTagOpen(def.id)"
          @close="confirmingTag = null"
          @delete-suggestion="confirmDeleteTag(def.id, $event)"
        />

        <!-- date -->
        <input
          v-else-if="def.type === 'date'"
          type="date"
          :aria-labelledby="`custom-field-label-${def.id}`"
          :value="(customFieldValues[def.id] as string) ?? ''"
          class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          @change="
            onValueChange(def.id, ($event.target as HTMLInputElement).value)
          "
        />

        <!-- integer: plain text + digit sanitization rather than type="number", which
             both accepts non-integer input ("e", "+", ".") for scientific notation and
             draws a spinner that doesn't match the app's styled controls -->
        <input
          v-else-if="def.type === 'integer'"
          type="text"
          inputmode="numeric"
          :aria-labelledby="`custom-field-label-${def.id}`"
          :value="(customFieldValues[def.id] as string) ?? ''"
          class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          @input="onIntegerInput(def.id, $event)"
          @blur="saveCustomFields"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />

        <!-- select -->
        <div v-else-if="def.type === 'select'" class="relative">
          <button
            :ref="(el) => setSelectButtonRef(def.id, el as Element | null)"
            type="button"
            :aria-labelledby="`custom-field-label-${def.id}`"
            aria-haspopup="listbox"
            :aria-expanded="openSelectId === def.id"
            :aria-controls="`custom-field-listbox-${def.id}`"
            :aria-activedescendant="
              openSelectId === def.id && highlightedIndex >= 0
                ? `custom-field-option-${def.id}-${highlightedIndex}`
                : undefined
            "
            class="w-full flex items-center justify-between gap-2 bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon transition-colors"
            @click="toggleSelect(def)"
            @blur="closeSelect"
            @keydown.down.prevent="moveHighlight(def, 1)"
            @keydown.up.prevent="moveHighlight(def, -1)"
            @keydown.enter.prevent="chooseHighlighted(def)"
            @keydown.space.prevent="chooseHighlighted(def)"
            @keydown.escape="closeSelect"
          >
            <span class="truncate">{{ selectedLabel(def) }}</span>
            <span
              class="text-text-secondary text-[10px] transition-transform duration-150 shrink-0"
              :class="{ 'rotate-180': openSelectId === def.id }"
              >▾</span
            >
          </button>

          <div
            v-if="openSelectId === def.id"
            :id="`custom-field-listbox-${def.id}`"
            role="listbox"
            class="absolute left-0 right-0 z-10 border border-charcoal-border bg-charcoal-light shadow-xl py-1 max-h-56 overflow-y-auto"
            :class="openDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'"
          >
            <button
              v-for="(opt, idx) in selectOptions(def)"
              :id="`custom-field-option-${def.id}-${idx}`"
              :key="opt.value"
              type="button"
              role="option"
              :aria-selected="((customFieldValues[def.id] as string) ?? '') === opt.value"
              class="flex items-center w-full px-4 py-2.5 text-left text-xs transition-colors"
              :class="[
                ((customFieldValues[def.id] as string) ?? '') === opt.value
                  ? 'text-orange-neon'
                  : 'text-text-secondary hover:text-text-primary',
                idx === highlightedIndex ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]',
              ]"
              @mousedown.prevent="chooseOption(def, opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- text -->
        <input
          v-else
          type="text"
          :aria-labelledby="`custom-field-label-${def.id}`"
          :value="(customFieldValues[def.id] as string) ?? ''"
          :placeholder="$t('detail.custom_field_value')"
          class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          @input="
            setLocalValue(def.id, ($event.target as HTMLInputElement).value)
          "
          @blur="saveCustomFields"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
      </div>
    </div>

    <p
      v-if="cfError"
      class="text-[10px] text-error tracking-widest uppercase mt-3"
    >
      {{ $t("detail.edit_error") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useApi } from "@/composables/useApi";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { parseTagList } from "@/utils/tags";
import type { Book } from "@/types/book";
import type { CustomFieldValue } from "@/components/BookDetail.vue";
import TagInput from "@/components/book-detail/TagInput.vue";

const props = defineProps<{
  book: Book;
  guest?: boolean;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  refreshed: [updated: { custom_field_values: CustomFieldValue[] }];
}>();

const { t } = useI18n();
const { apiFetch } = useApi();
const fieldDefsStore = useFieldDefsStore();

// Per-field model: a string for text/integer/select/date, a string[] for tag.
const customFieldValues = ref<Record<number, string | string[]>>({});
const cfError = ref(false);
const confirmingTag = ref<string | null>(null); // `${defId}:${value}` awaiting delete-confirm

function selectOptions(def: { options?: string[] }) {
  return [
    { value: "", label: t("detail.custom_field_unset") },
    ...(def.options ?? []).map((opt) => ({ value: opt, label: opt })),
  ];
}

// Plain-HTML themed dropdown for select-type fields (kept off Vuetify, like its
// text/integer/date/tag siblings — see CLAUDE.md's CustomFieldsPanel styling note).
// Only one field's menu is open at a time, so a single id + highlight index suffice.
const openSelectId = ref<number | null>(null);
const highlightedIndex = ref(-1);
const openDirection = ref<"down" | "up">("down");
const selectButtonEls = new Map<number, HTMLElement>();

function setSelectButtonRef(id: number, el: Element | null) {
  if (el instanceof HTMLElement) selectButtonEls.set(id, el);
  else selectButtonEls.delete(id);
}

function selectedLabel(def: { id: number; options?: string[] }) {
  const opts = selectOptions(def);
  const val = (customFieldValues.value[def.id] as string) ?? "";
  return opts.find((o) => o.value === val)?.label ?? val;
}

// The listbox caps at max-h-56 (224px); flip above the trigger when there's
// less than that free below it but more room above (e.g. a field near the
// bottom of the scrollable detail panel), so the menu never renders off-screen.
const LISTBOX_MAX_HEIGHT = 224;

function openSelect(def: { id: number; options?: string[] }) {
  openSelectId.value = def.id;
  const val = (customFieldValues.value[def.id] as string) ?? "";
  highlightedIndex.value = selectOptions(def).findIndex((o) => o.value === val);
  const btn = selectButtonEls.get(def.id);
  const rect = btn?.getBoundingClientRect();
  const spaceBelow = rect ? window.innerHeight - rect.bottom : Infinity;
  const spaceAbove = rect?.top ?? 0;
  openDirection.value =
    spaceBelow < LISTBOX_MAX_HEIGHT && spaceAbove > spaceBelow ? "up" : "down";
}

function closeSelect() {
  openSelectId.value = null;
}

function toggleSelect(def: { id: number; options?: string[] }) {
  if (openSelectId.value === def.id) {
    closeSelect();
    return;
  }
  openSelect(def);
}

function moveHighlight(def: { id: number; options?: string[] }, delta: number) {
  if (openSelectId.value !== def.id) {
    openSelect(def);
    return;
  }
  const max = selectOptions(def).length - 1;
  highlightedIndex.value = Math.min(max, Math.max(0, highlightedIndex.value + delta));
}

function chooseOption(def: { id: number }, value: string) {
  onValueChange(def.id, value);
  closeSelect();
}

function chooseHighlighted(def: { id: number; options?: string[] }) {
  if (openSelectId.value !== def.id) {
    openSelect(def);
    return;
  }
  const opts = selectOptions(def);
  const opt = opts[highlightedIndex.value];
  if (opt) {
    chooseOption(def, opt.value);
  } else {
    closeSelect();
  }
}

function valueFromBook(def: { id: number; type: string }): string | string[] {
  const raw =
    props.book.custom_field_values?.find((v) => v.field_def_id === def.id)
      ?.value ?? null;
  return def.type === "tag" ? parseTagList(raw) : (raw ?? "");
}

// Reconcile the local editor model with the current schema, preserving values the
// user may be editing. Existing in-shape entries are kept; only new/removed fields
// (or a field whose type changed) are (re)derived from the saved book values.
function reconcileCustomFields() {
  const next: Record<number, string | string[]> = {};
  for (const def of fieldDefsStore.defs) {
    const existing = customFieldValues.value[def.id];
    const inShape =
      def.type === "tag"
        ? Array.isArray(existing)
        : typeof existing === "string";
    next[def.id] = inShape ? existing : valueFromBook(def);
  }
  customFieldValues.value = next;
}

// Full reset only when the book identity changes — so an external refresh of the
// *same* book (e.g. enrichment poll) can't clobber unsaved in-progress edits.
watch(
  () => props.book.isbn,
  () => {
    customFieldValues.value = {};
    reconcileCustomFields();
  },
  { immediate: true },
);
// Schema changes (definitions loaded / field added / removed) only add or drop keys.
watch(() => fieldDefsStore.defs, reconcileCustomFields, { deep: true });

function setLocalValue(id: number, value: string) {
  customFieldValues.value = { ...customFieldValues.value, [id]: value };
}

// Strips everything but digits and a leading minus sign, keeping "integer" fields
// actually integer-only instead of relying on <input type="number">'s scientific-
// notation-friendly parsing (which happily accepts "e", "+", ".").
function sanitizeInteger(raw: string): string {
  const negative = raw.startsWith("-");
  const digits = raw.replace(/\D/g, "");
  return negative ? `-${digits}` : digits;
}

function onIntegerInput(id: number, e: Event) {
  const el = e.target as HTMLInputElement;
  const sanitized = sanitizeInteger(el.value);
  if (sanitized !== el.value) el.value = sanitized;
  setLocalValue(id, sanitized);
}

function onValueChange(id: number, value: string) {
  setLocalValue(id, value);
  saveCustomFields();
}

function onTagChange(id: number, value: unknown) {
  const arr = (Array.isArray(value) ? value : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  const unique = [...new Set(arr)];
  customFieldValues.value = { ...customFieldValues.value, [id]: unique };
  for (const tag of unique) fieldDefsStore.addTagValueLocal(id, tag);
  saveCustomFields();
}

function onTagOpen(id: number) {
  fieldDefsStore.loadTagValues(id);
}

function confirmingValueFor(id: number): string | null {
  if (!confirmingTag.value) return null;
  const [defId, ...rest] = confirmingTag.value.split(":");
  return Number(defId) === id ? rest.join(":") : null;
}

async function confirmDeleteTag(id: number, value: string) {
  const key = `${id}:${value}`;
  if (confirmingTag.value !== key) {
    confirmingTag.value = key;
    return;
  }
  confirmingTag.value = null;
  const res = await fieldDefsStore.deleteTagValueEverywhere(id, value);
  if (!res.ok) {
    cfError.value = true;
    return;
  }
  // Server stripped the tag from every book (including this one) — reflect it locally.
  const current = customFieldValues.value[id];
  if (Array.isArray(current) && current.includes(value)) {
    customFieldValues.value = {
      ...customFieldValues.value,
      [id]: current.filter((v) => v !== value),
    };
    emitCustomFieldsRefreshed();
  }
}

// Serialize the local model into the API value list (tag arrays → JSON; empty → "").
function customFieldsPayload() {
  return fieldDefsStore.defs.map((def) => {
    const v = customFieldValues.value[def.id];
    let value = "";
    if (def.type === "tag") {
      const arr = (Array.isArray(v) ? v : [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      value = arr.length ? JSON.stringify(arr) : "";
    } else if (typeof v === "string") {
      value = v;
    }
    return { field_def_id: def.id, value };
  });
}

function emitCustomFieldsRefreshed() {
  const custom_field_values = customFieldsPayload().map((v) => ({
    field_def_id: v.field_def_id,
    value: v.value || null,
  }));
  emit("refreshed", { custom_field_values });
}

// Auto-saves are chained so they apply in call order. The endpoint replaces all
// values at once, so overlapping requests arriving out of order could otherwise
// drop a field; each queued save also rebuilds its payload from the latest model.
let saveQueue: Promise<void> = Promise.resolve();

function saveCustomFields() {
  saveQueue = saveQueue.then(doSaveCustomFields);
  return saveQueue;
}

async function doSaveCustomFields() {
  if (props.readonly || props.guest) return;
  cfError.value = false;
  try {
    const res = await apiFetch("/api/books/custom-fields", {
      method: "PATCH",
      body: JSON.stringify({
        isbn: props.book.isbn,
        values: customFieldsPayload(),
      }),
    });
    if (!res.ok) throw new Error();
    emitCustomFieldsRefreshed();
  } catch {
    cfError.value = true;
  }
}
</script>
