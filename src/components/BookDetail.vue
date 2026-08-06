<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="mode === 'full'"
    :max-width="mode === 'card' ? 560 : undefined"
    @update:model-value="onDialogModel"
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
              <!-- Hidden while editing: collapsing to the card would leave the draft alive but
                   off-screen, with no way back to it and no prompt that it exists. -->
              <button
                v-if="!editing"
                class="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
                @click="mode = 'card'"
              >
                <v-icon icon="mdi-arrow-left" size="16" />
                <span class="text-[10px] tracking-[0.18em] uppercase">{{
                  $t("detail.back_to_card")
                }}</span>
              </button>
              <span v-else />
              <div class="flex items-center gap-2">
                <button
                  v-if="editing"
                  class="text-text-secondary/50 hover:text-text-secondary transition-colors disabled:opacity-40"
                  :aria-label="$t('detail.edit_cancel')"
                  :disabled="saving"
                  @click="requestExit(() => (editing = false))"
                >
                  <v-icon icon="mdi-close" size="18" />
                </button>
                <button
                  class="text-text-secondary/50 hover:text-text-secondary transition-colors ml-1 disabled:opacity-40"
                  :aria-label="$t('detail.close')"
                  :disabled="saving"
                  @click="requestExit(() => $emit('update:modelValue', false))"
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
                    @go-series="goToSeries"
                    @filter="filterBy"
                  />
                </DetailMeasure>
              </div>

              <DetailTabs v-model="activeTab" :tabs="tabItems" />

              <!-- In the All view the selected tab is "All", so *this container* is its panel —
                   the individual sections are just sections. With a single tab selected the
                   container is anonymous and that pane carries the role instead. -->
              <DetailMeasure
                id="detail-panel-all"
                :role="isAllView ? 'tabpanel' : undefined"
                :aria-labelledby="isAllView ? 'detail-tab-all' : undefined"
                class="py-8 md:py-10 pb-24 flex flex-col gap-13"
              >
                <DetailSection
                  v-if="showPane('overview')"
                  section-key="overview"
                  :panel="isPanel('overview')"
                  :title="$t('detail.tab_overview')"
                  :rule="isAllView"
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
                  :rule="isAllView"
                  :collapsed="collapsed.has('record')"
                  @toggle="toggleSection('record')"
                >
                  <RecordPane
                    :book="book"
                    @set-status="$emit('set-status', $event)"
                    @set-owning-status="$emit('set-owning-status', $event)"
                    @set-rating="$emit('set-rating', $event)"
                  />
                </DetailSection>

                <DetailSection
                  v-if="showPane('details')"
                  section-key="details"
                  :panel="isPanel('details')"
                  :title="$t('detail.tab_details')"
                  :rule="isAllView"
                  :collapsed="collapsed.has('details')"
                  :summary="
                    $t('detail.section_fields', { n: fieldCount }, fieldCount)
                  "
                  @toggle="toggleSection('details')"
                >
                  <DetailsPane
                    :book="book"
                    :refreshing="refreshing"
                    :refresh-error="refreshError"
                    :guest="guest"
                    :readonly="readonly"
                    @filter="filterBy"
                    @refresh="refresh"
                    @edit="enterEdit"
                  />
                </DetailSection>

                <DetailSection
                  v-if="showPane('review')"
                  section-key="review"
                  :panel="isPanel('review')"
                  :title="$t('detail.tab_review')"
                  :rule="isAllView"
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
                  :rule="isAllView"
                  :collapsed="collapsed.has('editions')"
                  :summary="editionsSummary"
                  @toggle="toggleSection('editions')"
                >
                  <EditionsPane
                    :editions="editions"
                    :active-isbn="book.isbn"
                    :loading="editionsLoading"
                    :work-linked="book.work_id != null"
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
              v-model:draft="draft"
              v-model:custom-values="customValues"
              :book="book"
              :guest="guest"
              :saving="saving"
              :save-error="saveError"
              :field-errors="fieldErrors"
              :missing-required="missingRequired"
              @submit="save"
              @tag-deleted="onTagDeleted"
            />
          </div>

          <!-- edit mode footer -->
          <div
            v-if="editing"
            class="sticky bottom-0 z-10 border-t border-charcoal-border bg-charcoal"
          >
            <DetailMeasure class="flex justify-between items-center py-3">
              <AppButton
                variant="ghost"
                size="sm"
                :disabled="saving"
                @click="requestExit(() => (editing = false))"
              >
                {{ $t("detail.edit_cancel") }}
              </AppButton>
              <!-- Outside the <form> element, so it submits by id rather than by position. -->
              <AppButton
                type="submit"
                form="book-edit-form"
                size="sm"
                :loading="saving"
                :disabled="!dirty"
                :aria-describedby="dirty ? undefined : 'edit-no-changes'"
              >
                {{ $t("detail.edit_save") }}
              </AppButton>
              <span id="edit-no-changes" class="sr-only">{{
                $t("detail.edit_no_changes")
              }}</span>
            </DetailMeasure>
          </div>
        </div>
      </div>

      <!-- Not `v-model`: Escape on this nested dialog closes it directly, which has to drop the
           pending exit too, or the *next* Cancel would fire the one this dismissed. -->
      <ConfirmDialog
        :model-value="confirmDiscardOpen"
        danger
        :title="$t('detail.edit_discard_title')"
        :body="$t('detail.edit_discard_body')"
        :confirm-label="$t('detail.edit_discard_confirm')"
        :cancel-label="$t('detail.edit_keep_editing')"
        @update:model-value="$event || cancelDiscard()"
        @confirm="confirmDiscard"
      />
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
import { onBeforeRouteUpdate, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useApi } from "@/composables/useApi";
import { useDetailRoute } from "@/composables/useDetailRoute";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useLocaleStore } from "@/stores/locale";
import { formatDateTime } from "@/utils/book-display";
import { useEnrichmentPoll } from "@/composables/useEnrichmentPoll";
import { useWorkEditions } from "@/composables/useWorkEditions";
import {
  buildTabs,
  detailsFieldCount,
  resolveActiveTab,
  DEFAULT_TAB,
  type TabKey,
} from "@/utils/detail-tabs";
import {
  customFieldModel,
  customFieldsChanged,
  customFieldsPayload,
  missingRequiredFields,
  type CustomFieldModel,
} from "@/utils/custom-fields";
import {
  draftFromBook,
  overrideChanges,
  validateOverrides,
  type EditDraft,
  type OverrideErrors,
} from "@/utils/book-edit";
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
import BookEditForm from "@/components/book-detail/BookEditForm.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import type { BookWithOverrides, OwningStatus, ReadStatus } from "@/types/book";

// The book detail dialog: a compact card that expands into a full-screen masthead-plus-panes view.
//
// The full view is a **masthead** (identity + the four things you set) over a **tabbed body**.
// "All" is the last tab: it stacks every pane in one scroll under mono section rules that double
// as disclosures, so the tabs read as a filter rather than a wall. Overview is what a book opens
// on. The tab set is the same for every book — see `utils/detail-tabs.ts` — so an empty pane says
// so rather than vanishing; only `readonly` (Record/Review) and the breakpoint (Record) drop one.
//
// `mode` is component-local state mirrored into the URL by `useDetailRoute` (`?view=full`), so a
// reload or a shared link lands back in the view the reader was actually in rather than snapping
// down to the card. The URL stays the single source of truth across a page load; within a session
// the ref leads and the query follows it.
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

const { detailView, setDetailView } = useDetailRoute();

// Seeded from the route so a deep link that mounts already-open starts full; the `modelValue`
// watcher below repeats this for the ordinary cold-load path, where the book resolves a tick
// after mount and the dialog opens only then.
const mode = ref<"card" | "full">(props.modelValue ? detailView.value : "card");
const editionsDialogOpen = ref(false);
const bodyEl = useTemplateRef<HTMLElement>("bodyEl");

function expand() {
  mode.value = "full";
}

// One writer for every path into and out of full mode — the masthead's back button, the
// switch-edition reset and the close reset all just assign `mode`. Guarded on `modelValue` so the
// reset that runs *as* the dialog closes doesn't race `closeDetail`, which strips `view` itself.
watch(mode, (value) => {
  if (props.modelValue) setDetailView(value);
});

// ── Tabs ──────────────────────────────────────────────────────────────────────

// `DEFAULT_TAB` comes from `detail-tabs` (one literal): `resolveActiveTab` only ever *replaces* a
// tab that no longer exists, so a freshly-opened book has to be seeded with it here, and reset to
// it on close.
const activeTab = ref<TabKey>(DEFAULT_TAB);
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

const { editions, loading: editionsLoading } = useWorkEditions({
  workId: () => props.book.work_id,
  enabled: () => props.modelValue && mode.value === "full",
  knownCount: () => props.book.editionCount,
});

// Deliberately not a function of `props.book`: the tab set no longer gates on content, so keeping
// it off the book means a status/rating/review write doesn't rebuild the row and re-run
// `resolveActiveTab` for a set that cannot have changed.
const tabs = computed(() =>
  buildTabs({
    readonly: props.readonly,
    editionCount: editions.value.length,
    mobile: isMobile.value,
  }),
);

const tabItems = computed(() =>
  tabs.value.map((tab) => ({
    key: tab.key,
    label: t(`detail.tab_${tab.key}`),
    badge: tab.badge,
  })),
);

/** One definition of "every pane is stacked". It decides both the section rules (the All view is
 *  the only place they're drawn — a single tab already names its pane) and which element carries
 *  `role="tabpanel"`. */
const isAllView = computed(() => activeTab.value === "all");

/** Whether this pane is the selected tab's panel — false in the All view, where the container
 *  holds that role instead. */
function isPanel(key: TabKey): boolean {
  return activeTab.value === key;
}

function showPane(key: TabKey): boolean {
  if (!tabs.value.some((tab) => tab.key === key)) return false;
  return isAllView.value || activeTab.value === key;
}

function toggleSection(key: TabKey) {
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
}

// Keep the active tab valid as the set changes — moving from an owned book to a readonly edition
// while Record or Review was selected must not leave a dead tab and a blank body.
watch(
  tabs,
  (list) => {
    activeTab.value = resolveActiveTab(list, activeTab.value);
  },
  { immediate: true },
);

// ── Section summaries (shown on a collapsed rule) ─────────────────────────────

// Custom fields are rows of the Details pane now, so they count towards its summary — every
// definition shows, valued or not, exactly as the two catalogue columns do. Gated on the same
// condition `DetailsPane` renders the column on, or a readonly edition's collapsed rule advertises
// rows the pane never draws.
const customFieldCount = computed(() =>
  props.guest || props.readonly ? 0 : fieldDefsStore.defs.length,
);

const fieldCount = computed(
  () => detailsFieldCount(props.book) + customFieldCount.value,
);

// No count until the lookup returns something — an empty rule reads better than "0 editions".
const editionsSummary = computed(() => {
  const n = editions.value.length;
  return n ? t("detail.editions_total", { n }, n) : undefined;
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
/** The i18n key for a failed enrichment refresh, or null. Cleared on each attempt. */
const refreshError = ref<string | null>(null);
const editing = ref(false);
const saving = ref(false);
/** The i18n key for a save failure the mask can't pin on a field (network, 5xx), or null. */
const saveError = ref<string | null>(null);
const fieldErrors = ref<OverrideErrors>({});
/** Custom field definition ids left empty despite `required`. */
const missingRequired = ref<number[]>([]);

const draft = ref<EditDraft>(draftFromBook(props.book));
const customValues = ref<CustomFieldModel>({});

// The diff is a pure function of draft + book rather than something `save()` builds on the way
// out, so "is there anything to save" and "what do we send" can never give different answers —
// which is what let Save stay enabled on an unchanged form and exit silently when pressed.
const metadataChanges = computed(() => overrideChanges(draft.value, props.book));
const customChanged = computed(
  () =>
    !props.guest &&
    customFieldsChanged(customValues.value, fieldDefsStore.defs, props.book),
);
const dirty = computed(
  () => Object.keys(metadataChanges.value).length > 0 || customChanged.value,
);

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
    // The tab goes back to the default with `mode`, and for the same reason: switching editions of
    // one work is a step inside a browse loop the user is already in, so it keeps their place.
    if (!sameWork) {
      mode.value = "card";
      activeTab.value = DEFAULT_TAB;
    }
    resetViewState();
    if (props.modelValue) startEnrichmentPoll();
  },
);

watch(
  () => props.modelValue,
  (val) => {
    if (!val) {
      mode.value = "card";
      activeTab.value = DEFAULT_TAB;
      resetViewState();
      clearPoll();
    } else {
      // A reload restores `?view=full` before the book has loaded, so the view has to be taken
      // from the route at the moment the dialog actually opens, not only at mount.
      mode.value = detailView.value;
      startEnrichmentPoll();
    }
  },
);

// The custom-field definitions, loaded as soon as this detail is showing a record that *has* them.
// Deliberately a watcher rather than an `onMounted` call: `series.vue` flips `readonly` on the same
// mounted `BookDetail` as the user moves between an edition they don't own and one they do, so a
// once-at-mount load leaves `defs` empty for the whole visit — `DetailsPane` would then assert "no
// custom fields yet" and `customFieldCount` would under-count the collapsed Details summary. The
// store early-returns once loaded, so re-entering the condition costs nothing.
watch(
  () => !props.guest && !props.readonly,
  (ownRecord) => {
    if (ownRecord) fieldDefsStore.load();
  },
  { immediate: true },
);

onMounted(() => {
  desktop.addEventListener("change", onBreakpointChange);
  window.addEventListener("beforeunload", onBeforeUnload);
});

onUnmounted(() => {
  desktop.removeEventListener("change", onBreakpointChange);
  window.removeEventListener("beforeunload", onBeforeUnload);
});

function enterEdit() {
  draft.value = draftFromBook(props.book);
  customValues.value = customFieldModel(props.book, fieldDefsStore.defs);
  fieldErrors.value = {};
  missingRequired.value = [];
  saveError.value = null;
  editing.value = true;
}

// ── Leaving the edit screen ───────────────────────────────────────────────────

const confirmDiscardOpen = ref(false);
let pendingExit: (() => void) | null = null;

/**
 * Every way out of the edit screen goes through here: Cancel, both top-bar X buttons, Escape,
 * a scrim click, and browser Back. Without it the draft is thrown away silently — and there is
 * no autosave to fall back on, since the whole point of this screen is one deliberate Save.
 */
function requestExit(after: () => void) {
  // A save in flight has already changed the server; unmounting now would drop the `refreshed`
  // patch and leave the list showing stale values until the next full refetch.
  if (saving.value) return;
  if (!editing.value || !dirty.value) {
    after();
    return;
  }
  pendingExit = after;
  confirmDiscardOpen.value = true;
}

function confirmDiscard() {
  confirmDiscardOpen.value = false;
  const exit = pendingExit;
  pendingExit = null;
  editing.value = false;
  exit?.();
}

function cancelDiscard() {
  confirmDiscardOpen.value = false;
  pendingExit = null;
}

/**
 * The dialog's own close paths — Escape and a scrim click both arrive as `false` here. Not
 * forwarding it is what keeps the dialog open, since `modelValue` is the host's prop; `persistent`
 * would block the same keypress but with a shake and no explanation of why.
 */
function onDialogModel(value: boolean) {
  if (value) {
    emit("update:modelValue", true);
    return;
  }
  requestExit(() => emit("update:modelValue", false));
}

// Browser Back leaves the detail by dropping `edition` from the query — the same route, so this
// is an *update*, not a leave, and `onBeforeRouteLeave` never sees it.
onBeforeRouteUpdate((to, from) => {
  if (to.query.edition === from.query.edition) return true;
  // Same rule as `requestExit`, which every other exit goes through: a save in flight has already
  // changed the server, so navigating now unmounts the component and drops the `refreshed` patch.
  // Refused outright rather than prompted — there is no draft left to discard, only a reply to wait for.
  if (saving.value) return false;
  if (!editing.value || !dirty.value) return true;
  pendingExit = () => router.replace(to.fullPath);
  confirmDiscardOpen.value = true;
  return false;
});

// A reload or tab close can't be intercepted with our own dialog, only with the browser's.
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!editing.value || !dirty.value) return;
  e.preventDefault();
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
  if (saving.value) return;

  const changes = metadataChanges.value;
  const defs = fieldDefsStore.defs;
  const custom = customChanged.value;

  fieldErrors.value = validateOverrides(changes);
  missingRequired.value = props.guest
    ? []
    : missingRequiredFields(customValues.value, defs);
  saveError.value = null;
  if (
    Object.keys(fieldErrors.value).length ||
    missingRequired.value.length
  )
    return;

  if (!Object.keys(changes).length && !custom) {
    editing.value = false;
    return;
  }

  saving.value = true;
  // Whatever the *first* request applied, even if the second one fails: the server has already
  // changed, so swallowing this would leave the screen disagreeing with the database.
  let applied: Partial<BookWithOverrides> | null = null;
  try {
    // Two endpoints, one Save: metadata overrides and custom field values are separate resources
    // server-side, but the user filled in one form and must not end up with half of it applied.
    // Sequential rather than parallel so a failing first request doesn't leave the second landing
    // silently after the error is already shown.
    if (Object.keys(changes).length) {
      // `locale` because the reply is a merged scan row: `series_name` is locale-joined, so
      // omitting it echoes back English and the host spreads that over the displayed book.
      const res = await apiFetch(`/api/books/override?locale=${localeStore.locale}`, {
        method: "PATCH",
        body: JSON.stringify({ isbn: props.book.isbn, changes }),
      });
      // Both routes answer with the merged scan row, so the override flags and any value the
      // server resolved (a cleared override falling back to the catalogue, or to a sibling
      // edition's description) come from the one place that knows them.
      applied = await readSavedRow(res);
    }

    if (custom) {
      const res = await apiFetch(`/api/books/custom-fields?locale=${localeStore.locale}`, {
        method: "PATCH",
        body: JSON.stringify({
          isbn: props.book.isbn,
          values: customFieldsPayload(customValues.value, defs),
        }),
      });
      applied = { ...applied, ...(await readSavedRow(res)) };
    }

    if (applied) emit("refreshed", applied);
    editing.value = false;
  } catch (err) {
    if (applied) emit("refreshed", applied);
    if (err instanceof OverrideValidationError) {
      fieldErrors.value = err.fields;
      saveError.value = "detail.edit_error";
    } else {
      saveError.value =
        err instanceof SaveFailed ? "detail.edit_error" : "detail.edit_error_network";
    }
  } finally {
    saving.value = false;
  }
}

class SaveFailed extends Error {}
class OverrideValidationError extends Error {
  constructor(readonly fields: OverrideErrors) {
    super("validation_failed");
  }
}

/** Unwrap a save response into the merged scan row, turning a rejection into the error the mask
 *  knows how to present. A 400 carries per-field codes; anything else is a bare failure. */
async function readSavedRow(res: Response): Promise<Partial<BookWithOverrides>> {
  if (res.ok) return (await res.json()) as Partial<BookWithOverrides>;
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      fields?: OverrideErrors;
    } | null;
    if (body?.error === "validation_failed" && body.fields)
      throw new OverrideValidationError(body.fields);
  }
  throw new SaveFailed();
}

// ── Enrichment refresh ────────────────────────────────────────────────────────

const refresh = async () => {
  refreshing.value = true;
  refreshError.value = null;
  try {
    const res = await apiFetch(`/api/books/refresh?isbn=${props.book.isbn}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error();
    await res.json();
    emit("refreshed", { enrichment_status: "pending" as const });
    startEnrichmentPoll();
  } catch {
    // The throw used to escape a try/finally with no catch: an unhandled rejection, and no sign
    // at all on the one retry a user has for a failed enrichment — the spinner simply stopped.
    refreshError.value = "detail.refresh_error";
  } finally {
    refreshing.value = false;
  }
};
</script>
