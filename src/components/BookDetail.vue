<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div
      class="bg-charcoal-light border border-charcoal-border flex flex-col max-h-[90vh]"
    >
      <!-- Header -->
      <div class="flex items-start gap-4 p-6">
        <img
          v-if="book.cover_url"
          :src="book.cover_url"
          class="w-16 h-24 object-cover shrink-0"
        />
        <div
          v-else
          class="w-16 h-24 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0"
        >
          <v-icon icon="mdi-book-outline" size="24" color="primary" />
        </div>

        <div class="flex-1 min-w-0">
          <!-- View mode -->
          <template v-if="!editing">
            <div class="font-heading text-xl font-bold text-text-primary leading-snug mb-1 flex items-center gap-1.5">
              {{ book.title || book.isbn }}
              <span v-if="book.title_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
            </div>
            <div class="text-sm text-text-secondary mb-2">
              {{ book.author || $t('book.unknown_author') }}
            </div>
            <button
              v-if="book.series_id"
              class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-text-secondary/70 hover:text-orange-neon transition-colors mb-3"
              @click="goToSeries"
            >
              <v-icon icon="mdi-bookshelf" size="11" />
              {{ book.series_name
                  || $t('detail.series') }}{{ book.series_ordinal != null ? ` · ${$t('detail.series_position', { n: book.series_ordinal })}` : '' }}
            </button>
            <span
              v-else-if="book.enrichment_status === 'done'"
              class="flex items-center text-[10px] tracking-[0.15em] uppercase text-text-secondary/40 mb-3"
            >
              {{ $t('detail.standalone') }}
            </span>
            <button
              class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase transition-colors"
              :class="STATUS_CONFIG[book.status].class"
              @click="$emit('cycle-status')"
            >
              <v-icon :icon="STATUS_CONFIG[book.status].icon" size="10" />
              {{ STATUS_CONFIG[book.status].label }}
            </button>
            <div
              v-if="!guest && book.enrichment_status && book.enrichment_status !== 'done'"
              class="flex items-center gap-1 mt-1.5"
              :class="book.enrichment_status === 'failed' ? 'text-error/60' : 'text-text-secondary/30'"
            >
              <v-icon
                :icon="book.enrichment_status === 'failed' ? 'mdi-alert-circle-outline' : 'mdi-progress-clock'"
                size="10"
              />
              <span class="text-[9px] tracking-[0.15em] uppercase">
                {{ $t(`detail.enrichment_${book.enrichment_status}`) }}
              </span>
            </div>
          </template>
          <!-- Edit mode: title input (author is managed via the works model, not editable) -->
          <template v-else>
            <input
              v-model="form.title"
              class="w-full bg-transparent font-heading text-xl font-bold text-text-primary leading-snug mb-2 border-b border-charcoal-border pb-1 outline-none focus:border-orange-neon"
              :placeholder="book.isbn"
            />
            <div class="text-sm text-text-secondary/60">
              {{ book.author || $t('book.unknown_author') }}
            </div>
          </template>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <template v-if="!editing">
            <button
              v-if="!guest"
              class="text-text-secondary/50 hover:text-text-secondary transition-colors"
              @click="enterEdit"
            >
              <v-icon icon="mdi-pencil-outline" size="18" />
            </button>
            <button
              v-if="!guest"
              class="transition-colors disabled:opacity-30"
              :class="enrichmentButtonClass"
              :disabled="refreshing"
              @click="refresh"
            >
              <v-icon
                icon="mdi-refresh"
                size="18"
                :class="refreshing ? 'animate-spin' : ''"
              />
            </button>
            <button
              class="text-text-secondary/50 hover:text-text-secondary transition-colors"
              @click="$emit('update:modelValue', false)"
            >
              <v-icon icon="mdi-close" size="18" />
            </button>
          </template>
          <template v-else>
            <button
              class="text-text-secondary/50 hover:text-text-secondary transition-colors"
              @click="editing = false"
            >
              <v-icon icon="mdi-close" size="18" />
            </button>
          </template>
        </div>
      </div>

      <!-- Scrollable body -->
      <div class="overflow-y-auto flex-1">
        <!-- View mode body -->
        <template v-if="!editing">
          <div
            v-if="book.description"
            class="border-t border-charcoal-border px-6 py-4 cursor-pointer"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            <p
              class="text-xs text-text-secondary leading-relaxed transition-all"
              :class="descriptionExpanded ? '' : 'line-clamp-3'"
            >
              {{ book.description }}
            </p>
            <span class="text-[10px] text-text-secondary/50 tracking-[0.15em] uppercase mt-2 inline-flex items-center gap-1">
              {{ descriptionExpanded ? $t('detail.show_less') : $t('detail.show_more') }}
              <span v-if="book.description_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
            </span>
          </div>

          <div
            class="border-t border-charcoal-border px-6 py-4 grid grid-cols-2 gap-y-4"
          >
            <div v-if="book.publisher">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 flex items-center gap-1">
                {{ $t('detail.publisher') }}
                <span v-if="book.publisher_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
              </div>
              <div class="text-xs text-text-primary">{{ book.publisher }}</div>
            </div>
            <div v-if="book.language">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 flex items-center gap-1">
                {{ $t('detail.language') }}
                <span v-if="book.language_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
              </div>
              <div class="text-xs text-text-primary uppercase">
                {{ book.language }}
              </div>
            </div>
            <div v-if="book.publish_date">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 flex items-center gap-1">
                {{ $t('detail.published') }}
                <span v-if="book.publish_date_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
              </div>
              <div class="text-xs text-text-primary">{{ formatPublishDate(book.publish_date) }}</div>
            </div>
            <div v-if="book.number_of_pages_median">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 flex items-center gap-1">
                {{ $t('detail.pages') }}
                <span v-if="book.pages_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
              </div>
              <div class="text-xs text-text-primary">
                {{ book.number_of_pages_median }}
              </div>
            </div>
            <div class="col-span-2">
              <div
                class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1"
              >
                {{ $t('detail.isbn') }}
              </div>
              <div class="text-xs text-text-primary font-mono">
                {{ book.isbn }}
              </div>
            </div>
            <div v-if="book.original_pub_date">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1">
                {{ $t('detail.original_pub_date') }}
              </div>
              <div class="text-xs text-text-primary">{{ book.original_pub_date }}</div>
            </div>
            <div v-if="book.genres?.length" class="col-span-2">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1">
                {{ $t('detail.genres') }}
              </div>
              <div class="text-xs text-text-primary">{{ book.genres!.join(' · ') }}</div>
            </div>
          </div>

          <!-- Awards and nominations -->
          <div
            v-if="book.awards?.length || book.nominations?.length"
            class="border-t border-charcoal-border px-6 py-4"
          >
            <div v-if="book.awards?.length" :class="book.nominations?.length ? 'mb-3' : ''">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1">
                {{ $t('detail.awards') }}
              </div>
              <div class="text-xs text-text-primary leading-relaxed">{{ book.awards!.join(' · ') }}</div>
            </div>
            <div v-if="book.nominations?.length">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1">
                {{ $t('detail.nominations') }}
              </div>
              <div class="text-xs text-text-primary leading-relaxed">{{ book.nominations!.join(' · ') }}</div>
            </div>
          </div>

          <!-- Other editions of the same work -->
          <div
            v-if="otherEditions.length"
            class="border-t border-charcoal-border px-6 py-4"
          >
            <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-3">
              {{ $t('detail.other_editions') }}
            </div>
            <div class="flex flex-col gap-2">
              <div
                v-for="ed in otherEditions"
                :key="ed.isbn"
                class="flex items-center gap-3"
              >
                <img
                  v-if="ed.cover_url"
                  :src="ed.cover_url"
                  class="w-8 h-12 object-cover shrink-0"
                />
                <div
                  v-else
                  class="w-8 h-12 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0"
                >
                  <v-icon icon="mdi-book-outline" size="14" color="primary" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-xs text-text-primary truncate">{{ ed.title || ed.isbn }}</div>
                  <div class="text-[10px] text-text-secondary/60 flex items-center gap-2">
                    <span v-if="ed.language" class="uppercase">{{ ed.language }}</span>
                    <span
                      v-if="ed.scan_id"
                      class="text-orange-neon tracking-[0.15em] uppercase"
                    >{{ $t('detail.edition_in_library') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Custom fields -->
          <div
            v-if="fieldDefsStore.defs.length"
            class="border-t border-charcoal-border px-6 py-4 grid grid-cols-2 gap-y-4"
          >
            <div v-for="def in fieldDefsStore.defs" :key="def.id">
              <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1">
                {{ def.name }}
              </div>
              <div class="text-xs text-text-primary">{{ customFieldMap.get(def.id) || '—' }}</div>
            </div>
          </div>
        </template>

        <!-- Edit mode body -->
        <template v-else>
          <div
            class="border-t border-charcoal-border px-6 py-4 flex flex-col gap-4"
          >
            <div>
              <label
                class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
              >
                {{ $t('detail.description') }}
              </label>
              <textarea
                v-model="form.description"
                rows="4"
                class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 resize-none outline-none focus:border-orange-neon"
              />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label
                  class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
                >
                  {{ $t('detail.publisher') }}
                </label>
                <input
                  v-model="form.publisher"
                  class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
                />
              </div>
              <div>
                <label
                  class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
                >
                  {{ $t('detail.language') }}
                </label>
                <input
                  v-model="form.language"
                  class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
                />
              </div>
              <div>
                <label
                  class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
                >
                  {{ $t('detail.published') }}
                </label>
                <input
                  v-model="form.publish_date"
                  class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
                />
              </div>
              <div>
                <label
                  class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
                >
                  {{ $t('detail.pages') }}
                </label>
                <input
                  v-model.number="form.number_of_pages_median"
                  type="number"
                  min="1"
                  class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
                />
              </div>
            </div>
            <div>
              <label
                class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
              >
                {{ $t('detail.cover_url') }}
              </label>
              <input
                v-model="form.cover_url"
                class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
              />
            </div>

            <!-- Custom fields editor -->
            <div>
              <label
                class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-2 block"
              >
                {{ $t('detail.custom_fields') }}
              </label>
              <div
                v-for="def in fieldDefsStore.defs"
                :key="def.id"
                class="flex gap-2 mb-2 items-center"
              >
                <div class="w-28 shrink-0 text-[10px] text-text-secondary/60 tracking-[0.1em] uppercase truncate pt-2">
                  {{ def.name }}
                </div>
                <input
                  v-model="customFieldValues[def.id]"
                  :placeholder="$t('detail.custom_field_value')"
                  class="flex-1 bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon"
                />
                <button
                  class="shrink-0 transition-colors"
                  :class="confirmingDeleteId === def.id ? 'text-error' : 'text-text-secondary/30 hover:text-text-secondary/60'"
                  :title="confirmingDeleteId === def.id ? $t('detail.custom_field_confirm_delete') : $t('detail.custom_field_delete')"
                  @click="deleteFieldDefinition(def.id)"
                  @blur="confirmingDeleteId = null"
                >
                  <v-icon :icon="confirmingDeleteId === def.id ? 'mdi-delete' : 'mdi-delete-outline'" size="16" />
                </button>
              </div>

              <!-- Add field -->
              <div v-if="addingField" class="flex gap-2 mt-1 items-center">
                <input
                  v-model="newFieldName"
                  :placeholder="$t('detail.custom_field_name')"
                  class="flex-1 bg-charcoal border border-orange-neon text-xs text-text-primary px-3 py-2 outline-none"
                  @keyup.enter="createFieldDefinition"
                  @keyup.escape="addingField = false; newFieldName = ''"
                />
                <button
                  class="text-orange-neon hover:text-orange-neon/70 transition-colors shrink-0"
                  @click="createFieldDefinition"
                >
                  <v-icon icon="mdi-check" size="16" />
                </button>
                <button
                  class="text-text-secondary/40 hover:text-text-secondary/70 transition-colors shrink-0"
                  @click="addingField = false; newFieldName = ''"
                >
                  <v-icon icon="mdi-close" size="16" />
                </button>
              </div>
              <button
                v-else
                class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-text-secondary/60 hover:text-orange-neon transition-colors mt-1"
                @click="addingField = true"
              >
                <v-icon icon="mdi-plus" size="14" />
                {{ $t('detail.add_custom_field') }}
              </button>
            </div>

            <p
              v-if="saveError"
              class="text-[10px] text-error tracking-widest uppercase"
            >
              {{ $t('detail.edit_error') }}
            </p>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div
        class="border-t border-charcoal-border flex justify-between items-center px-4 py-3"
      >
        <template v-if="!editing">
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            @click="$emit('update:modelValue', false)"
          >
            {{ $t('detail.close') }}
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            color="error"
            class="text-[10px] tracking-[0.2em] uppercase"
            prepend-icon="mdi-delete-outline"
            @click="$emit('delete')"
          >
            {{ $t('detail.remove') }}
          </v-btn>
        </template>
        <template v-else>
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            @click="editing = false"
          >
            {{ $t('detail.edit_cancel') }}
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            color="primary"
            class="text-[10px] tracking-[0.2em] uppercase"
            :loading="saving"
            @click="save"
          >
            {{ $t('detail.edit_save') }}
          </v-btn>
        </template>
      </div>
    </div>
  </v-dialog>
</template>

<script lang="ts">
import type { Book } from "@/types/book";

export interface CustomFieldValue {
  field_def_id: number;
  value: string | null;
}

export interface BookWithOverrides extends Book {
  title_overridden?: number;
  cover_url_overridden?: number;
  language_overridden?: number;
  publish_date_overridden?: number;
  pages_overridden?: number;
  description_overridden?: number;
  publisher_overridden?: number;
  custom_field_values?: CustomFieldValue[] | null;
}

export interface WorkEdition {
  isbn: string;
  title: string | null;
  language: string | null;
  cover_url: string | null;
  scan_id: number | null;
}
</script>

<script lang="ts" setup>
import { ref, reactive, watch, computed, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useApi } from "@/composables/useApi";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useLocaleStore } from "@/stores/locale";
import { BCP47 } from "@/plugins/i18n";

const props = defineProps<{
  modelValue: boolean;
  book: BookWithOverrides;
  guest?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "cycle-status": [];
  delete: [];
  refreshed: [updated: Partial<BookWithOverrides>];
}>();

const { t } = useI18n();
const { apiFetch } = useApi();
const fieldDefsStore = useFieldDefsStore();
const localeStore = useLocaleStore();
const router = useRouter();

// Formats Google Books publishedDate strings (YYYY / YYYY-MM / YYYY-MM-DD) in the active locale.
function formatPublishDate(date: string | null | undefined): string {
  if (!date) return '';
  const loc = BCP47[localeStore.locale] ?? 'en-GB';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    const [y, m] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc, { year: 'numeric', month: 'long' });
  }
  return date;
}

const descriptionExpanded = ref(false);
const refreshing = ref(false);
const editing = ref(false);
const saving = ref(false);
const saveError = ref(false);
const customFieldValues = ref<Record<number, string>>({});
const customFieldMap = computed(() =>
  new Map(
    (props.book.custom_field_values ?? []).map((v) => [v.field_def_id, v.value]),
  ),
);
const addingField = ref(false);
const newFieldName = ref("");
const confirmingDeleteId = ref<number | null>(null);

const form = reactive({
  title: "",
  cover_url: "",
  language: "",
  publish_date: "",
  number_of_pages_median: null as number | null,
  description: "",
  publisher: "",
});

const otherEditions = ref<WorkEdition[]>([]);

// Poll GET /api/scans/:id after dialog opens so the enrichment_status indicator
// updates automatically once the background waitUntil job finishes.
// Fires at 5 s, then 8 s, 12 s, 15 s, 20 s after each previous check (5 attempts, ~60 s total).
const POLL_DELAYS = [5_000, 8_000, 12_000, 15_000, 20_000];
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function clearPoll() {
  if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
}

async function pollOnce(attempt: number) {
  if (!props.modelValue || props.guest || props.book.enrichment_status !== 'pending') return;
  try {
    const res = await apiFetch(`/api/scans/${props.book.id}?locale=${localeStore.locale}`);
    if (res.ok) {
      const data = await res.json();
      if (data.enrichment_status !== 'pending') {
        emit('refreshed', data);
        return;
      }
    }
  } catch {}
  if (attempt + 1 < POLL_DELAYS.length && props.modelValue) {
    pollTimer = setTimeout(() => pollOnce(attempt + 1), POLL_DELAYS[attempt + 1]);
  }
}

function startEnrichmentPoll() {
  clearPoll();
  if (props.guest || props.book.enrichment_status !== 'pending') return;
  pollTimer = setTimeout(() => pollOnce(0), POLL_DELAYS[0]);
}

onUnmounted(clearPoll);

async function loadOtherEditions() {
  otherEditions.value = [];
  if (!props.book.work_id) return;
  try {
    const res = await apiFetch(`/api/works/${props.book.work_id}/editions`);
    if (!res.ok) return;
    const editions = (await res.json()) as WorkEdition[];
    otherEditions.value = editions.filter((e) => e.isbn !== props.book.isbn);
  } catch {
    otherEditions.value = [];
  }
}

function goToSeries() {
  if (props.book.series_id == null) return;
  emit("update:modelValue", false);
  router.push(`/series/${props.book.series_id}`);
}

watch(
  () => props.book.isbn,
  () => {
    descriptionExpanded.value = false;
    editing.value = false;
    if (props.modelValue) { loadOtherEditions(); startEnrichmentPoll(); }
  },
);

watch(
  () => props.modelValue,
  (val) => {
    if (!val) { editing.value = false; clearPoll(); }
    else { loadOtherEditions(); startEnrichmentPoll(); }
  },
);

function cfSnapshot(): Record<number, string> {
  return Object.fromEntries(
    fieldDefsStore.defs.map((d) => [
      d.id,
      props.book.custom_field_values?.find((v) => v.field_def_id === d.id)?.value ?? "",
    ]),
  );
}

function enterEdit() {
  form.title = props.book.title ?? "";
  form.cover_url = props.book.cover_url ?? "";
  form.language = props.book.language ?? "";
  form.publish_date = props.book.publish_date ?? "";
  form.number_of_pages_median = props.book.number_of_pages_median ?? null;
  form.description = props.book.description ?? "";
  form.publisher = props.book.publisher ?? "";
  customFieldValues.value = cfSnapshot();
  addingField.value = false;
  newFieldName.value = "";
  confirmingDeleteId.value = null;
  saveError.value = false;
  editing.value = true;
}

async function createFieldDefinition() {
  const name = newFieldName.value.trim();
  if (!name) return;
  try {
    const res = await apiFetch("/api/field-definitions", {
      method: "POST",
      body: JSON.stringify({ name, type: "text" }),
    });
    if (!res.ok) throw new Error();
    const def = (await res.json()) as { id: number; name: string; type: string };
    customFieldValues.value[def.id] = "";
    newFieldName.value = "";
    addingField.value = false;
    fieldDefsStore.add(def);
  } catch {
    saveError.value = true;
  }
}

async function deleteFieldDefinition(id: number) {
  if (confirmingDeleteId.value !== id) {
    confirmingDeleteId.value = id;
    return;
  }
  try {
    const res = await apiFetch(`/api/field-definitions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    delete customFieldValues.value[id];
    confirmingDeleteId.value = null;
    fieldDefsStore.remove(id);
  } catch {
    saveError.value = true;
  }
}

async function save() {
  const s = (v: string) => v.trim() || null;
  const o = (v: string | null | undefined) => v ?? null;
  const on = (v: number | null | undefined) => v ?? null;

  const changes: Record<string, string | number | null> = {};
  if (s(form.title) !== o(props.book.title)) changes.title = s(form.title);
  if (s(form.cover_url) !== o(props.book.cover_url)) changes.cover_url = s(form.cover_url);
  if (s(form.language) !== o(props.book.language)) changes.language = s(form.language);
  if (s(form.publish_date) !== o(props.book.publish_date)) changes.publish_date = s(form.publish_date);
  if (s(form.description) !== o(props.book.description)) changes.description = s(form.description);
  if (s(form.publisher) !== o(props.book.publisher)) changes.publisher = s(form.publisher);

  const newPages =
    form.number_of_pages_median && form.number_of_pages_median > 0
      ? form.number_of_pages_median
      : null;
  if (newPages !== on(props.book.number_of_pages_median))
    changes.number_of_pages_median = newPages;

  const customFieldsChanged =
    JSON.stringify(cfSnapshot()) !== JSON.stringify(customFieldValues.value);

  if (!Object.keys(changes).length && !customFieldsChanged) {
    editing.value = false;
    return;
  }

  saveError.value = false;
  saving.value = true;
  try {
    const saves: Promise<Response>[] = [];
    if (Object.keys(changes).length) {
      saves.push(apiFetch("/api/books/override", {
        method: "PATCH",
        body: JSON.stringify({ isbn: props.book.isbn, changes }),
      }));
    }
    if (customFieldsChanged) {
      saves.push(apiFetch("/api/books/custom-fields", {
        method: "PATCH",
        body: JSON.stringify({
          isbn: props.book.isbn,
          values: Object.entries(customFieldValues.value).map(([id, value]) => ({
            field_def_id: Number(id),
            value,
          })),
        }),
      }));
    }
    const results = await Promise.all(saves);
    if (results.some((r) => !r.ok)) throw new Error();

    const updated: Partial<BookWithOverrides> = { ...changes } as Partial<BookWithOverrides>;
    if ("title" in changes) updated.title_overridden = changes.title != null ? 1 : 0;
    if ("cover_url" in changes) updated.cover_url_overridden = changes.cover_url != null ? 1 : 0;
    if ("language" in changes) updated.language_overridden = changes.language != null ? 1 : 0;
    if ("publish_date" in changes) updated.publish_date_overridden = changes.publish_date != null ? 1 : 0;
    if ("number_of_pages_median" in changes)
      updated.pages_overridden = changes.number_of_pages_median != null ? 1 : 0;
    if ("description" in changes) updated.description_overridden = changes.description != null ? 1 : 0;
    if ("publisher" in changes) updated.publisher_overridden = changes.publisher != null ? 1 : 0;
    updated.custom_field_values = fieldDefsStore.defs.map((d) => ({
      field_def_id: d.id,
      value: customFieldValues.value[d.id] ?? null,
    }));

    emit("refreshed", updated);
    editing.value = false;
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

const enrichmentButtonClass = computed(() => {
  if (props.book.enrichment_status === 'failed') return 'text-error/70 hover:text-error'
  if (props.book.enrichment_status === 'pending') return 'text-orange-neon/40 hover:text-orange-neon/70'
  return 'text-text-secondary/50 hover:text-text-secondary'
})

const refresh = async () => {
  refreshing.value = true;
  try {
    const res = await apiFetch(`/api/books/refresh?isbn=${props.book.isbn}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error();
    await res.json();
    // Don't spread the BookRow — it carries books.id which would overwrite the scan id
    // that the enrichment poll relies on. The poll fetches the full updated scan row once
    // the background waitUntil job settles.
    emit("refreshed", { enrichment_status: 'pending' as const });
    startEnrichmentPoll();
  } finally {
    refreshing.value = false;
  }
};

const STATUS_CONFIG = computed(() => ({
  unread: {
    label: t("book.unread"),
    icon: "mdi-circle-outline",
    class: "text-text-secondary/40 hover:text-text-secondary",
  },
  reading: {
    label: t("book.reading"),
    icon: "mdi-book-open-outline",
    class: "text-orange-neon",
  },
  read: {
    label: t("book.read"),
    icon: "mdi-check-circle-outline",
    class: "text-[#22c55e]",
  },
}));
</script>
