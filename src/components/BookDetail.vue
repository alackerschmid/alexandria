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
            <div class="text-sm text-text-secondary mb-3 flex items-center gap-1.5">
              {{ book.author || $t('book.unknown_author') }}
              <span v-if="book.author_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
            </div>
            <button
              class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase transition-colors"
              :class="STATUS_CONFIG[book.status].class"
              @click="$emit('cycle-status')"
            >
              <v-icon :icon="STATUS_CONFIG[book.status].icon" size="10" />
              {{ STATUS_CONFIG[book.status].label }}
            </button>
          </template>
          <!-- Edit mode: title + author inputs -->
          <template v-else>
            <input
              v-model="form.title"
              class="w-full bg-transparent font-heading text-xl font-bold text-text-primary leading-snug mb-2 border-b border-charcoal-border pb-1 outline-none focus:border-orange-neon"
              :placeholder="book.isbn"
            />
            <input
              v-model="form.author"
              class="w-full bg-transparent text-sm text-text-secondary border-b border-charcoal-border pb-1 outline-none focus:border-orange-neon"
              :placeholder="$t('book.unknown_author')"
            />
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
              class="text-text-secondary/50 hover:text-text-secondary transition-colors disabled:opacity-30"
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
              <div class="text-xs text-text-primary">{{ book.publish_date }}</div>
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
import type { Book } from "./BookCard.vue";

export interface BookWithOverrides extends Book {
  title_overridden?: number;
  author_overridden?: number;
  cover_url_overridden?: number;
  language_overridden?: number;
  publish_date_overridden?: number;
  pages_overridden?: number;
  description_overridden?: number;
  publisher_overridden?: number;
}
</script>

<script lang="ts" setup>
import { ref, reactive, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";

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
const authStore = useAuthStore();
const API_BASE = import.meta.env.VITE_API_URL || "";

const descriptionExpanded = ref(false);
const refreshing = ref(false);
const editing = ref(false);
const saving = ref(false);
const saveError = ref(false);

const form = reactive({
  title: "",
  author: "",
  cover_url: "",
  language: "",
  publish_date: "",
  number_of_pages_median: null as number | null,
  description: "",
  publisher: "",
});

watch(
  () => props.book.isbn,
  () => {
    descriptionExpanded.value = false;
    editing.value = false;
  },
);

watch(
  () => props.modelValue,
  (val) => {
    if (!val) editing.value = false;
  },
);

function enterEdit() {
  form.title = props.book.title ?? "";
  form.author = props.book.author ?? "";
  form.cover_url = props.book.cover_url ?? "";
  form.language = props.book.language ?? "";
  form.publish_date = props.book.publish_date ?? "";
  form.number_of_pages_median = props.book.number_of_pages_median ?? null;
  form.description = props.book.description ?? "";
  form.publisher = props.book.publisher ?? "";
  saveError.value = false;
  editing.value = true;
}

async function save() {
  const s = (v: string) => v.trim() || null;
  const o = (v: string | null | undefined) => v ?? null;
  const on = (v: number | null | undefined) => v ?? null;

  const changes: Record<string, string | number | null> = {};
  if (s(form.title) !== o(props.book.title)) changes.title = s(form.title);
  if (s(form.author) !== o(props.book.author)) changes.author = s(form.author);
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

  if (!Object.keys(changes).length) {
    editing.value = false;
    return;
  }

  saveError.value = false;
  saving.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/books/override`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.token}`,
      },
      body: JSON.stringify({ isbn: props.book.isbn, changes }),
    });
    if (!res.ok) throw new Error();

    const updated: Partial<BookWithOverrides> = { ...changes } as Partial<BookWithOverrides>;
    if ("title" in changes) updated.title_overridden = changes.title != null ? 1 : 0;
    if ("author" in changes) updated.author_overridden = changes.author != null ? 1 : 0;
    if ("cover_url" in changes) updated.cover_url_overridden = changes.cover_url != null ? 1 : 0;
    if ("language" in changes) updated.language_overridden = changes.language != null ? 1 : 0;
    if ("publish_date" in changes) updated.publish_date_overridden = changes.publish_date != null ? 1 : 0;
    if ("number_of_pages_median" in changes)
      updated.pages_overridden = changes.number_of_pages_median != null ? 1 : 0;
    if ("description" in changes) updated.description_overridden = changes.description != null ? 1 : 0;
    if ("publisher" in changes) updated.publisher_overridden = changes.publisher != null ? 1 : 0;

    emit("refreshed", updated);
    editing.value = false;
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

const refresh = async () => {
  refreshing.value = true;
  try {
    const res = await fetch(
      `${API_BASE}/api/books/refresh?isbn=${props.book.isbn}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${authStore.token}` },
      },
    );
    if (!res.ok) throw new Error();
    const updated = await res.json();
    emit("refreshed", updated);
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
