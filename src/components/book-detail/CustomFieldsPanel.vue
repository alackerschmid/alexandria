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
      <div
        v-for="def in fieldDefsStore.defs"
        :key="def.id"
        class="flex items-start gap-2"
      >
        <div class="flex-1 min-w-0">
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
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
            @change="
              onValueChange(def.id, ($event.target as HTMLInputElement).value)
            "
          />

          <!-- integer -->
          <input
            v-else-if="def.type === 'integer'"
            type="number"
            :aria-labelledby="`custom-field-label-${def.id}`"
            :value="(customFieldValues[def.id] as string) ?? ''"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
            @input="
              setLocalValue(def.id, ($event.target as HTMLInputElement).value)
            "
            @blur="saveCustomFields"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />

          <!-- select -->
          <select
            v-else-if="def.type === 'select'"
            :aria-labelledby="`custom-field-label-${def.id}`"
            :value="(customFieldValues[def.id] as string) ?? ''"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
            @change="
              onValueChange(def.id, ($event.target as HTMLSelectElement).value)
            "
          >
            <option value="">{{ $t("detail.custom_field_unset") }}</option>
            <option v-for="opt in def.options ?? []" :key="opt" :value="opt">
              {{ opt }}
            </option>
          </select>

          <!-- text -->
          <input
            v-else
            type="text"
            :aria-labelledby="`custom-field-label-${def.id}`"
            :value="(customFieldValues[def.id] as string) ?? ''"
            :placeholder="$t('detail.custom_field_value')"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
            @input="
              setLocalValue(def.id, ($event.target as HTMLInputElement).value)
            "
            @blur="saveCustomFields"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>

        <!-- delete field definition (removes the field from all books) -->
        <button
          class="shrink-0 transition-colors pt-7"
          :class="
            confirmingDeleteId === def.id
              ? 'text-error'
              : 'text-text-secondary/30 hover:text-text-secondary/60'
          "
          :title="
            confirmingDeleteId === def.id
              ? $t('detail.custom_field_confirm_delete')
              : $t('detail.custom_field_delete')
          "
          @click="deleteFieldDefinition(def.id)"
          @blur="confirmingDeleteId = null"
        >
          <v-icon
            :icon="
              confirmingDeleteId === def.id
                ? 'mdi-delete'
                : 'mdi-delete-outline'
            "
            size="16"
          />
        </button>
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

const { apiFetch } = useApi();
const fieldDefsStore = useFieldDefsStore();

// Per-field model: a string for text/integer/select/date, a string[] for tag.
const customFieldValues = ref<Record<number, string | string[]>>({});
const cfError = ref(false);
const confirmingTag = ref<string | null>(null); // `${defId}:${value}` awaiting delete-confirm
const confirmingDeleteId = ref<number | null>(null);

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

async function deleteFieldDefinition(id: number) {
  if (confirmingDeleteId.value !== id) {
    confirmingDeleteId.value = id;
    return;
  }
  try {
    const res = await apiFetch(`/api/field-definitions/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error();
    const { [id]: _removed, ...rest } = customFieldValues.value;
    customFieldValues.value = rest;
    confirmingDeleteId.value = null;
    fieldDefsStore.remove(id);
  } catch {
    cfError.value = true;
  }
}
</script>
