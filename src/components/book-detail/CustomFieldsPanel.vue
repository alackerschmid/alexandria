<template>
  <div v-if="fieldDefsStore.defs.length">
    <div class="flex flex-col gap-4 max-w-md">
      <div v-for="def in fieldDefsStore.defs" :key="def.id">
        <label
          :id="`custom-field-label-${def.id}`"
          class="text-[10px] text-text-secondary/60 tracking-[0.1em] uppercase mb-1.5 block"
        >
          {{ def.name }}
          <template v-if="def.required">
            <span aria-hidden="true" class="text-orange-neon">*</span>
            <span class="sr-only">{{ $t("detail.edit_required") }}</span>
          </template>
        </label>

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
            @keydown.escape="onSelectEscape"
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
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />

        <p
          v-if="missingRequired.includes(def.id)"
          class="text-[10px] text-error tracking-wide mt-1"
          role="alert"
        >
          {{ $t("detail.edit_err_required") }}
        </p>
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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import type { CustomFieldModel } from "@/utils/custom-fields";
import TagInput from "@/components/book-detail/TagInput.vue";

// The per-type value editors for the user's custom fields. **Controlled** — the parent owns the
// model and the save; this component never calls the API for a value change. That is what lets the
// unified edit screen put custom fields and the metadata overrides behind one Cancel/Save, instead
// of the older behaviour where a blur silently committed half the form.
//
// The one exception is the tag *global* delete, which removes a value from every book in the
// library: that is a destructive cross-library action rather than a field edit, so it stays
// immediate and reports through `refreshed`.
//
// Deliberately plain Tailwind HTML rather than Vuetify controls (see src/CLAUDE.md) — a book can
// have several fields of different types and they must read as one uniform stack.
const model = defineModel<CustomFieldModel>("values", { required: true });

withDefaults(
  defineProps<{
    /** Ids of `required` definitions the last save attempt found empty. Client-side only — see
     *  `missingRequiredFields` in `utils/custom-fields.ts` for why the server doesn't enforce it. */
    missingRequired?: number[];
  }>(),
  { missingRequired: () => [] },
);

const emit = defineEmits<{
  /** The tag global-delete stripped this value from every book in the library, including this
   *  one. Carries the field and value so the parent can apply just that change rather than
   *  committing the whole in-progress draft. */
  "tag-deleted": [defId: number, value: string];
}>();

const { t } = useI18n();
const fieldDefsStore = useFieldDefsStore();

// Per-field model: a string for text/integer/select/date, a string[] for tag.
const customFieldValues = computed(() => model.value);
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

/**
 * Escape closes the option list — but only when one is open. Propagation is stopped in exactly
 * that case: this panel lives inside the book detail's `v-dialog`, so an Escape that bubbles
 * closes the whole dialog and discards the unsaved edit draft. Stopping it unconditionally would
 * instead make Escape dead in a closed select, which is the only key that dismisses the dialog.
 */
function onSelectEscape(e: KeyboardEvent) {
  if (openSelectId.value === null) return;
  e.stopPropagation();
  closeSelect();
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

function setLocalValue(id: number, value: string) {
  model.value = { ...model.value, [id]: value };
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
}

function onTagChange(id: number, value: unknown) {
  const arr = (Array.isArray(value) ? value : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  const unique = [...new Set(arr)];
  model.value = { ...model.value, [id]: unique };
  for (const tag of unique) fieldDefsStore.addTagValueLocal(id, tag);
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
  // Server stripped the tag from every book (including this one) — drop it from the draft too,
  // and tell the parent exactly *which* value went, so it can apply that one change to the saved
  // book. Handing over the whole draft here would commit unsaved edits the user could still cancel.
  const current = model.value[id];
  if (Array.isArray(current) && current.includes(value)) {
    model.value = {
      ...model.value,
      [id]: current.filter((v) => v !== value),
    };
  }
  emit("tag-deleted", id, value);
}
</script>
