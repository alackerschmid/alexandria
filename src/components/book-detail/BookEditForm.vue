<template>
  <!-- On the detail's own measure, like every other pane — the two-column field grid is what keeps
       an individual input from stretching the whole width. -->
  <DetailMeasure class="py-10 pb-16">
    <!-- A real form, so Enter submits and the footer's Save (which lives outside this element)
         can target it by id. `fieldset[disabled]` is what locks every control at once while a
         save is in flight — including CustomFieldsPanel's. -->
    <form id="book-edit-form" novalidate @submit.prevent="$emit('submit')">
      <h2 class="sr-only">{{ $t("detail.edit_fields") }}</h2>
      <fieldset :disabled="saving" class="min-w-0">
        <!-- title -->
        <label for="edit-title" class="sr-only">{{
          $t("scanner.title_label")
        }}</label>
        <input
          id="edit-title"
          ref="titleEl"
          :value="draft.values.title"
          :aria-invalid="fieldErrors.title ? 'true' : undefined"
          :aria-describedby="fieldErrors.title ? 'edit-title-err' : undefined"
          class="w-full bg-transparent font-heading text-xl font-bold text-text-primary leading-snug mb-2 border-b pb-1 focus-ring-none focus:border-orange-neon"
          :class="
            fieldErrors.title ? 'border-error' : 'border-charcoal-border'
          "
          :placeholder="revertPlaceholder('title') ?? book.isbn"
          @input="setField('title', $event)"
        />
        <div class="flex items-center gap-1.5 mb-1">
          <OverrideDot v-if="isOverridden(book, 'title')" class="w-1 h-1" />
          <button
            v-if="isOverridden(book, 'title') && !draft.reverted.has('title')"
            type="button"
            class="text-text-secondary/40 hover:text-orange-neon transition-colors"
            :title="$t('detail.edit_revert')"
            :aria-label="$t('detail.edit_revert')"
            @click="revert('title')"
          >
            <v-icon icon="mdi-restore" size="12" />
          </button>
        </div>
        <FieldError id="edit-title-err" :code="fieldErrors.title" />

        <!-- Authors are normalized per work, not stored on this copy, so there is nothing here to
             override — say so rather than leaving the omission to look like an oversight. -->
        <div class="text-sm text-text-secondary/60">
          {{ authorDisplayName(book) || $t("book.unknown_author") }}
        </div>
        <p class="text-[10px] text-text-secondary/40 leading-relaxed mt-1 mb-6">
          {{ $t("detail.edit_author_note") }}
        </p>

        <div class="flex flex-col gap-4">
          <div>
            <EditFieldLabel
              field-id="edit-description"
              :label="$t('detail.description')"
              :overridden="isOverridden(book, 'description')"
              :reverted="draft.reverted.has('description')"
              @revert="revert('description')"
            />
            <textarea
              id="edit-description"
              :value="draft.values.description"
              rows="6"
              :aria-invalid="fieldErrors.description ? 'true' : undefined"
              :aria-describedby="
                fieldErrors.description ? 'edit-description-err' : undefined
              "
              :placeholder="revertPlaceholder('description')"
              :class="['resize-y', inputClass('description')]"
              @input="setField('description', $event)"
            />
            <FieldError
              id="edit-description-err"
              :code="fieldErrors.description"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <EditFieldLabel
                field-id="edit-publisher"
                :label="$t('detail.publisher')"
                :overridden="isOverridden(book, 'publisher')"
                :reverted="draft.reverted.has('publisher')"
                @revert="revert('publisher')"
              />
              <input
                id="edit-publisher"
                :value="draft.values.publisher"
                :aria-invalid="fieldErrors.publisher ? 'true' : undefined"
                :aria-describedby="
                  fieldErrors.publisher ? 'edit-publisher-err' : undefined
                "
                :placeholder="revertPlaceholder('publisher')"
                :class="inputClass('publisher')"
                @input="setField('publisher', $event)"
              />
              <FieldError
                id="edit-publisher-err"
                :code="fieldErrors.publisher"
              />
            </div>

            <div>
              <EditFieldLabel
                field-id="edit-language"
                :label="$t('detail.language')"
                :overridden="isOverridden(book, 'language')"
                :reverted="draft.reverted.has('language')"
                @revert="revert('language')"
              />
              <input
                id="edit-language"
                :value="draft.values.language"
                :aria-invalid="fieldErrors.language ? 'true' : undefined"
                aria-describedby="edit-language-hint"
                :placeholder="revertPlaceholder('language')"
                :class="inputClass('language')"
                @input="setField('language', $event)"
              />
              <!-- The field takes a code but every read surface shows a name, so a user typing
                   "German" gets no feedback at all until it silently resolves to nothing. -->
              <p
                id="edit-language-hint"
                class="text-[10px] mt-1"
                :class="
                  languageName ? 'text-text-secondary/50' : 'text-error/80'
                "
              >
                {{ languageName ?? languageHint }}
              </p>
            </div>

            <div>
              <EditFieldLabel
                field-id="edit-publish-date"
                :label="$t('detail.published')"
                :overridden="isOverridden(book, 'publish_date')"
                :reverted="draft.reverted.has('publish_date')"
                @revert="revert('publish_date')"
              />
              <input
                id="edit-publish-date"
                :value="draft.values.publish_date"
                inputmode="numeric"
                :aria-invalid="fieldErrors.publish_date ? 'true' : undefined"
                aria-describedby="edit-publish-date-hint"
                :placeholder="
                  revertPlaceholder('publish_date') ??
                  $t('detail.edit_date_format')
                "
                :class="inputClass('publish_date')"
                @input="setField('publish_date', $event)"
              />
              <!-- Not <input type="date">: the catalogue's dominant forms are a bare year and a
                   year-month, neither of which a native date picker can express. -->
              <p
                id="edit-publish-date-hint"
                class="text-[10px] mt-1"
                :class="datePreview ? 'text-text-secondary/50' : 'text-error/80'"
              >
                {{ datePreview ?? $t("detail.edit_err_invalid_date") }}
              </p>
            </div>

            <div>
              <EditFieldLabel
                field-id="edit-pages"
                :label="$t('detail.pages')"
                :overridden="isOverridden(book, 'number_of_pages_median')"
                :reverted="draft.reverted.has('number_of_pages_median')"
                @revert="revert('number_of_pages_median')"
              />
              <!-- Digits only, like CustomFieldsPanel's integer field and for the same reason:
                   type="number" accepts "e"/"+"/"." for scientific notation and draws a spinner
                   that doesn't match anything else in the app. -->
              <input
                id="edit-pages"
                :value="draft.values.number_of_pages_median"
                type="text"
                inputmode="numeric"
                :aria-invalid="
                  fieldErrors.number_of_pages_median ? 'true' : undefined
                "
                :aria-describedby="
                  fieldErrors.number_of_pages_median
                    ? 'edit-pages-err'
                    : undefined
                "
                :placeholder="revertPlaceholder('number_of_pages_median')"
                :class="inputClass('number_of_pages_median')"
                @input="onPagesInput"
              />
              <FieldError
                id="edit-pages-err"
                :code="fieldErrors.number_of_pages_median"
              />
            </div>

            <div class="col-span-2">
              <EditFieldLabel
                field-id="edit-edition-name"
                :label="$t('detail.edition_name')"
                :overridden="isOverridden(book, 'edition_name')"
                :reverted="draft.reverted.has('edition_name')"
                @revert="revert('edition_name')"
              />
              <input
                id="edit-edition-name"
                :value="draft.values.edition_name"
                :aria-invalid="fieldErrors.edition_name ? 'true' : undefined"
                :aria-describedby="
                  fieldErrors.edition_name ? 'edit-edition-name-err' : undefined
                "
                :placeholder="revertPlaceholder('edition_name')"
                :class="inputClass('edition_name')"
                @input="setField('edition_name', $event)"
              />
              <FieldError
                id="edit-edition-name-err"
                :code="fieldErrors.edition_name"
              />
            </div>
          </div>

          <div>
            <EditFieldLabel
              field-id="edit-cover-url"
              :label="$t('detail.cover_url')"
              :overridden="isOverridden(book, 'cover_url')"
              :reverted="draft.reverted.has('cover_url')"
              @revert="revert('cover_url')"
            />
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <input
                  id="edit-cover-url"
                  :value="draft.values.cover_url"
                  type="url"
                  inputmode="url"
                  :aria-invalid="fieldErrors.cover_url ? 'true' : undefined"
                  :aria-describedby="
                    fieldErrors.cover_url ? 'edit-cover-url-err' : undefined
                  "
                  :placeholder="revertPlaceholder('cover_url')"
                  :class="inputClass('cover_url')"
                  @input="setField('cover_url', $event)"
                />
                <FieldError
                  id="edit-cover-url-err"
                  :code="fieldErrors.cover_url"
                />
              </div>
              <!-- A wrong URL is otherwise invisible until after Save, and a cover is the one
                   field where "looks right" is the only check that matters. -->
              <CoverImage
                :cover-url="previewCoverUrl"
                :title="draft.values.title || book.isbn"
                :alt="$t('detail.edit_cover_preview')"
                :icon-size="14"
                class="w-11 shrink-0 aspect-[2/3] object-cover border border-charcoal-border"
              />
            </div>
          </div>
        </div>

        <!-- Custom fields sit in the same form, behind the same Save: they are as much "the record"
             as the overrides above, and splitting them across two save models was what made the old
             panel commit silently on blur while this half waited for a button. -->
        <div
          v-if="!guest && fieldDefsStore.defs.length"
          class="mt-9 pt-8 border-t border-charcoal-border"
        >
          <div
            class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-4"
          >
            {{ $t("detail.custom_fields") }}
          </div>
          <CustomFieldsPanel
            v-model:values="customValues"
            :missing-required="missingRequired"
            @tag-deleted="(defId, value) => $emit('tag-deleted', defId, value)"
          />
        </div>

        <p
          v-if="saveError"
          class="text-[10px] text-error tracking-widest uppercase mt-6"
          role="alert"
        >
          {{ $t(saveError) }}
        </p>
      </fieldset>
    </form>
  </DetailMeasure>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { BookWithOverrides } from "@/types/book";
import type { CustomFieldModel } from "@/utils/custom-fields";
import {
  isOverridden,
  PUBLISH_DATE_FORM,
  type EditDraft,
  type OverrideErrors,
  type OverrideField,
} from "@/utils/book-edit";
import { authorDisplayName, formatPublishDate } from "@/utils/book-display";
import { resolveLanguageName } from "@/utils/language";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useLocaleStore } from "@/stores/locale";
import CoverImage from "@/components/CoverImage.vue";
import OverrideDot from "@/components/OverrideDot.vue";
import CustomFieldsPanel from "@/components/book-detail/CustomFieldsPanel.vue";
import DetailMeasure from "@/components/book-detail/DetailMeasure.vue";
import EditFieldLabel from "@/components/book-detail/EditFieldLabel.vue";
import FieldError from "@/components/book-detail/FieldError.vue";

// **One screen with every editable field**: the per-user metadata overrides and the user's own
// custom fields. Both models are owned by the parent, which performs the saves and holds the
// dirty/validation state; this component is presentational apart from the draft edits themselves.
const draft = defineModel<EditDraft>("draft", { required: true });
const customValues = defineModel<CustomFieldModel>("customValues", {
  required: true,
});

const props = defineProps<{
  book: BookWithOverrides;
  /** A save is in flight — every control is locked, since closing mid-request loses the result. */
  saving: boolean;
  /** i18n key for a failure that can't be pinned on one field, or null. */
  saveError: string | null;
  fieldErrors: OverrideErrors;
  /** Ids of `required` custom fields left empty by the last save attempt. */
  missingRequired: number[];
  guest?: boolean;
}>();

defineEmits<{
  submit: [];
  /** A tag was deleted from every book in the library — an immediate server action, not part of
   *  this form's draft, so the parent has to reconcile the book it holds. */
  "tag-deleted": [defId: number, value: string];
}>();

const { t } = useI18n();
const fieldDefsStore = useFieldDefsStore();
const localeStore = useLocaleStore();
const titleEl = useTemplateRef<HTMLInputElement>("titleEl");

// This form is `v-else`-mounted only in edit mode, so mount *is* "entered edit". Deliberately not
// `useFocusTrap` — that composable is for non-`v-dialog` overlays, and its capture-phase Escape
// listener would fight both Vuetify's trap and the shell's unsaved-changes guard.
onMounted(() => titleEl.value?.focus());

const INPUT_BASE =
  "w-full bg-charcoal border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon";

function inputClass(field: OverrideField) {
  return [
    INPUT_BASE,
    props.fieldErrors[field] ? "border-error" : "border-charcoal-border",
  ];
}

function setValue(field: OverrideField, value: string) {
  const reverted = new Set(draft.value.reverted);
  // Typing takes the field back off the revert list — the two are alternatives, not a sequence.
  reverted.delete(field);
  draft.value = {
    values: { ...draft.value.values, [field]: value },
    reverted,
  };
}

function setField(field: OverrideField, e: Event) {
  setValue(field, (e.target as HTMLInputElement | HTMLTextAreaElement).value);
}

function onPagesInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const digits = el.value.replace(/\D/g, "");
  if (digits !== el.value) el.value = digits;
  setValue("number_of_pages_median", digits);
}

function revert(field: OverrideField) {
  draft.value = {
    values: { ...draft.value.values, [field]: "" },
    reverted: new Set(draft.value.reverted).add(field),
  };
}

/** A reverted field is blank but not empty-meaning — say what is going to happen to it. The
 *  catalogue value itself can't be shown: `GET /api/scans` only ever returns the merged one. */
function revertPlaceholder(field: OverrideField): string | undefined {
  return draft.value.reverted.has(field)
    ? t("detail.edit_reverts_to_catalogue")
    : undefined;
}

const languageHint = computed(() => t("detail.edit_err_invalid_language"));
const languageName = computed(() => {
  const raw = draft.value.values.language.trim();
  if (!raw) return " ";
  return resolveLanguageName(raw, localeStore.locale);
});

const datePreview = computed(() => {
  const raw = draft.value.values.publish_date.trim();
  if (!raw) return " ";
  if (!PUBLISH_DATE_FORM.test(raw)) return null;
  return formatPublishDate(raw, localeStore.locale);
});

// Debounced so the browser isn't asked to fetch a new image on every keystroke of a pasted URL.
const previewCoverUrl = ref(draft.value.values.cover_url || null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => draft.value.values.cover_url,
  (url) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewCoverUrl.value = url.trim() || null;
    }, 400);
  },
);
</script>
