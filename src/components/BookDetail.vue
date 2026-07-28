<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="mode === 'full'"
    :max-width="mode === 'card' ? 560 : undefined"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- ── CARD MODE ─────────────────────────────────────────────────────── -->
    <template v-if="mode === 'card'">
      <BookDetailCard
        :book="book"
        :poll-timed-out="pollTimedOut"
        :guest="guest"
        :readonly="readonly"
        @close="$emit('update:modelValue', false)"
        @expand="expand"
        @cycle-status="$emit('cycle-status')"
        @open-rating="$emit('open-rating')"
        @go-series="goToSeries"
        @filter="filterBy"
      />
    </template>

    <!-- ── FULL MODE ──────────────────────────────────────────────────────── -->
    <template v-else>
      <!-- One scroll container for everything, with the top bar and edit footer stuck to its
           edges rather than sitting outside it. A separate non-scrolling header would centre on
           the full viewport while the body centres inside its own scrollbar-narrowed content box,
           so the two would disagree by the scrollbar's width — visible as the header's "back"
           label not lining up with the content beneath it. -->
      <div ref="bodyEl" class="bg-charcoal h-dvh overflow-y-auto">
        <!-- `min-h-full` + a `flex-1` content region so the sticky edit footer still lands at the
             bottom of the viewport when the form is shorter than the screen, instead of floating
             directly under it. -->
        <div class="min-h-full flex flex-col">
          <!-- Back and close only. Editing folded into the record row, delete moved to the footer
             where it can't be hit by accident, refresh down beside the facts it repopulates. -->
          <div
            class="sticky top-0 z-10 border-b border-charcoal-border bg-charcoal"
          >
            <DetailMeasure class="flex items-center justify-between py-4">
              <button
                class="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
                @click="mode = 'card'"
              >
                <v-icon icon="mdi-arrow-left" size="16" />
                <span class="text-[10px] tracking-[0.18em] uppercase">{{
                  $t("detail.back_to_card")
                }}</span>
              </button>
              <div class="flex items-center gap-2">
                <button
                  v-if="editing"
                  class="text-text-secondary/50 hover:text-text-secondary transition-colors"
                  :aria-label="$t('detail.edit_cancel')"
                  @click="editing = false"
                >
                  <v-icon icon="mdi-close" size="18" />
                </button>
                <button
                  class="text-text-secondary/50 hover:text-text-secondary transition-colors ml-1"
                  :aria-label="$t('detail.close')"
                  @click="$emit('update:modelValue', false)"
                >
                  <v-icon icon="mdi-close" size="20" />
                </button>
              </div>
            </DetailMeasure>
          </div>

          <div class="flex-1">
            <template v-if="!editing">
              <!-- Bands are full-bleed; only their contents sit on the measure. -->
              <div class="bg-charcoal-light border-b border-charcoal-border">
                <DetailMeasure class="py-6 md:py-9">
                  <DetailMasthead
                    :book="book"
                    :poll-timed-out="pollTimedOut"
                    :guest="guest"
                    :readonly="readonly"
                    @set-status="$emit('set-status', $event)"
                    @set-owning-status="$emit('set-owning-status', $event)"
                    @set-rating="$emit('set-rating', $event)"
                    @edit="enterEdit"
                    @go-series="goToSeries"
                    @filter="filterBy"
                  />
                </DetailMeasure>
              </div>

              <DetailTabs v-if="hasTabs" v-model="activeTab" :tabs="tabItems" />

              <!-- In the All view the selected tab is "All", so *this container* is its panel —
                   the individual sections are just sections. With a single tab selected the
                   container is anonymous and that pane carries the role instead. -->
              <DetailMeasure
                id="detail-panel-all"
                :role="hasTabs && activeTab === 'all' ? 'tabpanel' : undefined"
                :aria-labelledby="
                  hasTabs && activeTab === 'all' ? 'detail-tab-all' : undefined
                "
                class="py-8 md:py-10 pb-24 flex flex-col gap-13"
              >
                <DetailSection
                  v-if="showPane('overview')"
                  section-key="overview"
                  :panel="isPanel('overview')"
                  :title="$t('detail.tab_overview')"
                  :rule="showRules"
                  :collapsed="collapsed.has('overview')"
                  @toggle="toggleSection('overview')"
                >
                  <OverviewPane
                    v-model:expanded="descriptionExpanded"
                    :book="book"
                    @filter="filterBy"
                  />
                </DetailSection>

                <DetailSection
                  v-if="showPane('record')"
                  section-key="record"
                  :panel="isPanel('record')"
                  :title="$t('detail.your_record')"
                  :rule="showRules"
                  :collapsed="collapsed.has('record')"
                  :summary="recordSummary"
                  @toggle="toggleSection('record')"
                >
                  <RecordPane
                    :book="book"
                    :guest="guest"
                    @set-status="$emit('set-status', $event)"
                    @set-owning-status="$emit('set-owning-status', $event)"
                    @set-rating="$emit('set-rating', $event)"
                    @edit="enterEdit"
                  />
                </DetailSection>

                <DetailSection
                  v-if="showPane('details')"
                  section-key="details"
                  :panel="isPanel('details')"
                  :title="$t('detail.tab_details')"
                  :rule="showRules"
                  :collapsed="collapsed.has('details')"
                  :summary="
                    $t('detail.section_fields', { n: fieldCount }, fieldCount)
                  "
                  @toggle="toggleSection('details')"
                >
                  <DetailsPane
                    :book="book"
                    :refreshing="refreshing"
                    :guest="guest"
                    :readonly="readonly"
                    @filter="filterBy"
                    @refresh="refresh"
                  />
                </DetailSection>

                <DetailSection
                  v-if="showPane('review')"
                  section-key="review"
                  :panel="isPanel('review')"
                  :title="$t('detail.tab_review')"
                  :rule="showRules"
                  :collapsed="collapsed.has('review')"
                  :summary="reviewSummary"
                  @toggle="toggleSection('review')"
                >
                  <ReviewPane
                    :book="book"
                    @open-rating="$emit('open-rating')"
                    @focus-rating="focusRating"
                  />
                </DetailSection>

                <DetailSection
                  v-if="showPane('editions')"
                  section-key="editions"
                  :panel="isPanel('editions')"
                  :title="$t('detail.tab_editions')"
                  :rule="showRules"
                  :collapsed="collapsed.has('editions')"
                  :summary="
                    $t(
                      'detail.editions_total',
                      { n: editions.length },
                      editions.length,
                    )
                  "
                  @toggle="toggleSection('editions')"
                >
                  <EditionsPane
                    :editions="editions"
                    :active-isbn="book.isbn"
                    @show-all="editionsDialogOpen = true"
                    @select="onSelectEdition"
                  />
                </DetailSection>

                <!-- Remove sits at the very bottom, opposite the acquisition date: a one-way action
                   that should take a deliberate scroll to reach, not a top-bar icon. -->
                <div
                  class="flex items-center justify-between gap-5 pt-4 border-t border-charcoal-border"
                >
                  <button
                    v-if="!readonly"
                    class="text-[10px] tracking-[0.16em] uppercase text-error/80 hover:text-error transition-colors"
                    @click="$emit('delete')"
                  >
                    {{ $t("detail.remove_from_library") }}
                  </button>
                  <span v-else />
                  <span class="font-mono text-[10.5px] text-text-secondary">
                    {{ $t("detail.added") }} {{ formattedAdded }}
                  </span>
                </div>
              </DetailMeasure>

              <EditionsDialog
                v-model="editionsDialogOpen"
                :book="book"
                :guest="guest"
                :readonly="readonly"
                @refreshed="onEditionsRefreshed"
                @select="onSelectEdition"
              />
            </template>

            <!-- edit mode: every editable field on one screen -->
            <BookEditForm
              v-else
              v-model:form="form"
              v-model:custom-values="customValues"
              :book="book"
              :guest="guest"
              :save-error="saveError"
              @tag-deleted="onTagDeleted"
            />
          </div>

          <!-- edit mode footer -->
          <div
            v-if="editing"
            class="sticky bottom-0 z-10 border-t border-charcoal-border bg-charcoal"
          >
            <DetailMeasure class="flex justify-between items-center py-3">
              <AppButton variant="ghost" size="sm" @click="editing = false">
                {{ $t("detail.edit_cancel") }}
              </AppButton>
              <AppButton size="sm" :loading="saving" @click="save">
                {{ $t("detail.edit_save") }}
              </AppButton>
            </DetailMeasure>
          </div>
        </div>
      </div>
    </template>
  </v-dialog>
</template>

<script lang="ts" setup>
import {
  ref,
  watch,
  computed,
  onMounted,
  onUnmounted,
  useTemplateRef,
} from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useApi } from "@/composables/useApi";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useLocaleStore } from "@/stores/locale";
import { formatDateTime } from "@/utils/book-display";
import { useEnrichmentPoll } from "@/composables/useEnrichmentPoll";
import { useWorkEditions } from "@/composables/useWorkEditions";
import {
  buildTabs,
  detailsFieldCount,
  resolveActiveTab,
  type TabKey,
} from "@/utils/detail-tabs";
import {
  customFieldModel,
  customFieldsChanged,
  customFieldsPayload,
  customFieldValues as toCustomFieldValues,
  type CustomFieldModel,
} from "@/utils/custom-fields";
import { stripTagValue } from "@/utils/tags";
import { reviewWordCount } from "@/utils/review";
import AppButton from "@/components/AppButton.vue";
import BookDetailCard from "@/components/book-detail/BookDetailCard.vue";
import DetailMeasure from "@/components/book-detail/DetailMeasure.vue";
import DetailMasthead from "@/components/book-detail/DetailMasthead.vue";
import DetailTabs from "@/components/book-detail/DetailTabs.vue";
import DetailSection from "@/components/book-detail/DetailSection.vue";
import OverviewPane from "@/components/book-detail/OverviewPane.vue";
import RecordPane from "@/components/book-detail/RecordPane.vue";
import DetailsPane from "@/components/book-detail/DetailsPane.vue";
import ReviewPane from "@/components/book-detail/ReviewPane.vue";
import EditionsPane from "@/components/book-detail/EditionsPane.vue";
import EditionsDialog from "@/components/book-detail/EditionsDialog.vue";
import BookEditForm, {
  type EditForm,
} from "@/components/book-detail/BookEditForm.vue";
import type { BookWithOverrides, OwningStatus, ReadStatus } from "@/types/book";

// The book detail dialog: a compact card that expands into a full-screen masthead-plus-panes view.
//
// The full view is a **masthead** (identity + the four things you set) over a **tabbed body**.
// "All" is the last tab and the default: it stacks every pane in one scroll under mono section
// rules that double as disclosures, so the tabs read as a filter rather than a wall. Which tabs
// exist is derived from the book — see `utils/detail-tabs.ts`; a pane that would be empty never
// becomes a tab, and Review is the one exception (always offered, dotted until it's written).
//
// `mode` is deliberately component-local rather than routed, matching the pre-existing behaviour:
// the URL identifies the *book* (`useDetailRoute`), not how far into it you are.
const props = defineProps<{
  modelValue: boolean;
  book: BookWithOverrides;
  guest?: boolean;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "cycle-status": [];
  "set-status": [status: ReadStatus];
  "set-owning-status": [status: OwningStatus];
  /** A rating set straight from the masthead stars — the host owns the per-work fan-out. */
  "set-rating": [rating: number | null];
  /** Ask the host page to raise the rating/review prompt for this book — the dialog is owned
   *  there, so a status change from a library card can raise the same one (useRatingPrompt). */
  "open-rating": [];
  delete: [];
  refreshed: [updated: Partial<BookWithOverrides>];
  "switch-edition": [payload: { isbn: string; scanId: number }];
}>();

const { apiFetch } = useApi();
const { t } = useI18n();
const fieldDefsStore = useFieldDefsStore();
const localeStore = useLocaleStore();
const router = useRouter();

// ── Mode ──────────────────────────────────────────────────────────────────────

const mode = ref<"card" | "full">("card");
const editionsDialogOpen = ref(false);
const bodyEl = useTemplateRef<HTMLElement>("bodyEl");

function expand() {
  mode.value = "full";
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const activeTab = ref<TabKey>("all");
const collapsed = ref(new Set<TabKey>());

// Whether the Record tab has to exist, i.e. whether the masthead's control cluster is hidden.
//
// This *must* be the same test the CSS makes, not an equivalent-looking one: the cluster's
// visibility is `hidden md:flex`, so asking `window.innerWidth < 840` instead would be a second,
// independently-rounded answer to the same question. `innerWidth` is an integer while the media
// query compares the fractional layout width, so at some zoom levels the two disagree — and when
// they do, the user gets no Record tab *and* no masthead controls: no way to set status, ownership
// or rating at all. `matchMedia` with the identical query can't drift.
const desktop = window.matchMedia("(min-width: 840px)");
const isMobile = ref(!desktop.matches);
const onBreakpointChange = (e: MediaQueryListEvent) => {
  isMobile.value = !e.matches;
};

const { editions } = useWorkEditions({
  workId: () => props.book.work_id,
  enabled: () => props.modelValue && mode.value === "full",
  knownCount: () => props.book.editionCount,
});

const tabs = computed(() =>
  buildTabs({
    book: props.book,
    readonly: props.readonly,
    customFieldCount: props.guest ? 0 : fieldDefsStore.defs.length,
    editionCount: editions.value.length,
    mobile: isMobile.value,
  }),
);

const tabItems = computed(() =>
  tabs.value.map((tab) => ({
    key: tab.key,
    label: t(`detail.tab_${tab.key}`),
    badge: tab.badge,
    dot: tab.dot,
  })),
);

/** False when a book yields a single pane — then there is no tab row and no "All". */
const hasTabs = computed(() => tabs.value.length > 1);

/** The All view is the only place section rules are drawn — a single tab already names its pane.
 *  `all` only ever exists alongside other tabs, so this needs no separate `hasTabs` test. */
const showRules = computed(() => activeTab.value === "all");

/** Whether this pane is the selected tab's panel — false in the All view, where the container
 *  holds that role instead, and false when there is no tab row to be a panel of. */
function isPanel(key: TabKey): boolean {
  return hasTabs.value && activeTab.value === key;
}

function showPane(key: TabKey): boolean {
  if (!tabs.value.some((tab) => tab.key === key)) return false;
  return activeTab.value === "all" || activeTab.value === key;
}

function toggleSection(key: TabKey) {
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
}

// Keep the active tab valid as the set changes — switching to a book with no description while
// Overview was selected must not leave a dead tab and a blank body.
watch(
  tabs,
  (list) => {
    activeTab.value = resolveActiveTab(list, activeTab.value);
  },
  { immediate: true },
);

// ── Section summaries (shown on a collapsed rule) ─────────────────────────────

const fieldCount = computed(() => detailsFieldCount(props.book));

const recordSummary = computed(() => {
  const n = props.guest ? 0 : fieldDefsStore.defs.length;
  return n ? t("detail.section_fields", { n }, n) : "";
});

const reviewSummary = computed(() => {
  if (!props.book.review) return t("detail.review_add");
  const words = reviewWordCount(props.book.review);
  return t("detail.review_words", { n: words }, words);
});

// ── Computed helpers ──────────────────────────────────────────────────────────

const formattedAdded = computed(
  () => formatDateTime(props.book.created_at, localeStore.locale) ?? "—",
);

// ── Edit state ────────────────────────────────────────────────────────────────

const descriptionExpanded = ref(false);
const refreshing = ref(false);
const editing = ref(false);
const saving = ref(false);
const saveError = ref(false);

const form = ref<EditForm>({
  title: "",
  cover_url: "",
  language: "",
  publish_date: "",
  number_of_pages_median: null,
  description: "",
  publisher: "",
});

const customValues = ref<CustomFieldModel>({});

// ── Enrichment polling ────────────────────────────────────────────────────────

// The poll ran its full schedule and the row was still pending — the work is queued behind the
// sweeper's backlog, not failing. Local-only: the server state really is still 'pending', so this
// must not be emitted as a `refreshed` patch.
const pollTimedOut = ref(false);

const { startEnrichmentPoll: runEnrichmentPoll, clearPoll } = useEnrichmentPoll(
  {
    isOpen: () => props.modelValue,
    scanId: () => props.book.id,
    status: () => props.book.enrichment_status,
    guest: () => !!props.guest,
    readonly: () => !!props.readonly,
    onResolved: (data) => emit("refreshed", data as Partial<BookWithOverrides>),
    onExhausted: () => (pollTimedOut.value = true),
  },
);

function startEnrichmentPoll() {
  pollTimedOut.value = false;
  runEnrichmentPoll();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function goToSeries() {
  if (props.book.series_id == null) return;
  router.push(`/series/${props.book.series_id}`);
}

function filterBy(
  field:
    | "author"
    | "genre"
    | "form"
    | "original_language"
    | "location"
    | "country"
    | "award",
  value: string,
) {
  router.push(`/library?q=${encodeURIComponent(`${field}:"${value}"`)}`);
}

/** "Rate it first" from the empty review pane — the stars live in the masthead (or, on mobile, the
 *  Record pane), so send the user there rather than opening a dialog they didn't ask for. */
function focusRating() {
  if (isMobile.value && tabs.value.some((tab) => tab.key === "record")) {
    activeTab.value = "record";
    return;
  }
  bodyEl.value?.scrollTo({ top: 0, behavior: "smooth" });
}

function onEditionsRefreshed(updated: Partial<BookWithOverrides>) {
  emit("refreshed", updated);
}

/** Another owned edition of this work was picked — ask the host to open that scan's detail. Same
 *  work, so the `lastWorkId` watcher below keeps the view in full mode rather than snapping back
 *  to the card. */
function onSelectEdition(isbn: string, scanId: number) {
  emit("switch-edition", { isbn, scanId });
}

// ── Watchers ──────────────────────────────────────────────────────────────────

function resetViewState() {
  descriptionExpanded.value = false;
  collapsed.value = new Set();
  editing.value = false;
}

// Tracks the previous book's work_id so switching editions of the *same* work doesn't snap the
// view back to card mode — only opening an unrelated book should.
let lastWorkId = props.book.work_id;
watch(
  () => props.book.isbn,
  () => {
    const sameWork =
      props.book.work_id != null && props.book.work_id === lastWorkId;
    lastWorkId = props.book.work_id;
    if (!sameWork) mode.value = "card";
    resetViewState();
    if (props.modelValue) startEnrichmentPoll();
  },
);

watch(
  () => props.modelValue,
  (val) => {
    if (!val) {
      mode.value = "card";
      resetViewState();
      clearPoll();
    } else {
      startEnrichmentPoll();
    }
  },
);

onMounted(() => {
  if (!props.guest && !props.readonly) fieldDefsStore.load();
  desktop.addEventListener("change", onBreakpointChange);
});

onUnmounted(() => desktop.removeEventListener("change", onBreakpointChange));

function enterEdit() {
  form.value.title = props.book.title ?? "";
  form.value.cover_url = props.book.cover_url ?? "";
  form.value.language = props.book.language ?? "";
  form.value.publish_date = props.book.publish_date ?? "";
  form.value.number_of_pages_median = props.book.number_of_pages_median ?? null;
  form.value.description = props.book.description ?? "";
  form.value.publisher = props.book.publisher ?? "";
  customValues.value = customFieldModel(props.book, fieldDefsStore.defs);
  saveError.value = false;
  editing.value = true;
}

/**
 * A tag global-delete already hit the server and stripped the value from every book, so the book
 * this component was handed is now stale by exactly that one value.
 *
 * Only that value is removed — the patch is built from the book's *saved* `custom_field_values`,
 * never from the edit draft. Sending the draft would commit whatever else the user has typed but
 * not saved, so a subsequent Cancel would leave those edits showing until the next refetch.
 */
function onTagDeleted(defId: number, value: string) {
  const saved = props.book.custom_field_values;
  if (!saved) return;
  emit("refreshed", {
    custom_field_values: saved.map((v) =>
      v.field_def_id === defId
        ? { ...v, value: stripTagValue(v.value, value) }
        : v,
    ),
  });
}

async function save() {
  const s = (v: string) => v.trim() || null;
  const o = (v: string | null | undefined) => v ?? null;
  const on = (v: number | null | undefined) => v ?? null;

  const changes: Record<string, string | number | null> = {};
  if (s(form.value.title) !== o(props.book.title))
    changes.title = s(form.value.title);
  if (s(form.value.cover_url) !== o(props.book.cover_url))
    changes.cover_url = s(form.value.cover_url);
  if (s(form.value.language) !== o(props.book.language))
    changes.language = s(form.value.language);
  if (s(form.value.publish_date) !== o(props.book.publish_date))
    changes.publish_date = s(form.value.publish_date);
  if (s(form.value.description) !== o(props.book.description))
    changes.description = s(form.value.description);
  if (s(form.value.publisher) !== o(props.book.publisher))
    changes.publisher = s(form.value.publisher);

  const newPages =
    form.value.number_of_pages_median && form.value.number_of_pages_median > 0
      ? form.value.number_of_pages_median
      : null;
  if (newPages !== on(props.book.number_of_pages_median))
    changes.number_of_pages_median = newPages;

  const defs = fieldDefsStore.defs;
  const customChanged =
    !props.guest && customFieldsChanged(customValues.value, defs, props.book);

  if (!Object.keys(changes).length && !customChanged) {
    editing.value = false;
    return;
  }

  saveError.value = false;
  saving.value = true;
  try {
    const updated: Partial<BookWithOverrides> = {};

    // Two endpoints, one Save: metadata overrides and custom field values are separate resources
    // server-side, but the user filled in one form and must not end up with half of it applied.
    // Sequential rather than parallel so a failing first request doesn't leave the second landing
    // silently after the error is already shown.
    if (Object.keys(changes).length) {
      const res = await apiFetch("/api/books/override", {
        method: "PATCH",
        body: JSON.stringify({ isbn: props.book.isbn, changes }),
      });
      if (!res.ok) throw new Error();
      Object.assign(updated, changes as Partial<BookWithOverrides>);
      if ("title" in changes)
        updated.title_overridden = changes.title != null ? 1 : 0;
      if ("cover_url" in changes)
        updated.cover_url_overridden = changes.cover_url != null ? 1 : 0;
      if ("language" in changes)
        updated.language_overridden = changes.language != null ? 1 : 0;
      if ("publish_date" in changes)
        updated.publish_date_overridden = changes.publish_date != null ? 1 : 0;
      if ("number_of_pages_median" in changes)
        updated.pages_overridden =
          changes.number_of_pages_median != null ? 1 : 0;
      if ("description" in changes)
        updated.description_overridden = changes.description != null ? 1 : 0;
      if ("publisher" in changes)
        updated.publisher_overridden = changes.publisher != null ? 1 : 0;
    }

    if (customChanged) {
      const res = await apiFetch("/api/books/custom-fields", {
        method: "PATCH",
        body: JSON.stringify({
          isbn: props.book.isbn,
          values: customFieldsPayload(customValues.value, defs),
        }),
      });
      if (!res.ok) throw new Error();
      updated.custom_field_values = toCustomFieldValues(
        customValues.value,
        defs,
      );
    }

    emit("refreshed", updated);
    editing.value = false;
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

// ── Enrichment refresh ────────────────────────────────────────────────────────

const refresh = async () => {
  refreshing.value = true;
  try {
    const res = await apiFetch(`/api/books/refresh?isbn=${props.book.isbn}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error();
    await res.json();
    emit("refreshed", { enrichment_status: "pending" as const });
    startEnrichmentPoll();
  } finally {
    refreshing.value = false;
  }
};
</script>
