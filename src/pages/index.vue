<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <!-- Guest banner -->
    <div
      v-if="isGuest"
      class="px-6 md:px-10 py-3 border-b border-charcoal-border flex flex-wrap items-center justify-between gap-3 shrink-0"
    >
      <div class="text-xs text-text-secondary leading-relaxed">
        <span>{{
          $t("guest.banner", { used: guestStore.scans.length, max: 3 })
        }}</span>
        <span class="block text-text-secondary/60 mt-0.5">{{
          $t("guest.create_account")
        }}</span>
      </div>
      <div class="flex gap-2 shrink-0">
        <v-btn
          variant="text"
          size="small"
          color="primary"
          class="text-[10px] tracking-[0.15em] uppercase px-4"
          @click="$router.push('/login')"
        >
          {{ $t("guest.sign_in") }}
        </v-btn>
        <v-btn
          variant="flat"
          size="small"
          color="primary"
          rounded="0"
          elevation="0"
          class="text-[10px] tracking-[0.15em] uppercase px-4"
          @click="$router.push('/login?mode=register')"
        >
          {{ $t("guest.register") }}
        </v-btn>
      </div>
    </div>

    <LibrarySearchBar
      v-model="search"
      :known-keys="knownKeys"
      :parsed-search="parsedSearch"
      :facet-entries="facetEntries"
      :base-filtered="baseFiltered"
      :custom-field-metas="customFieldMetas"
      :total-count="allBooks.length"
      :filtered-count="groupedFiltered.length"
      :remove-token="removeToken"
      @select-book="openDetail"
    />

    <!-- ── Desktop control bar: group tabs + display + view ──────────────────── -->
    <div
      class="hidden md:flex items-end gap-4 px-10 border-b border-charcoal-border shrink-0"
    >
      <LibraryGroupTabs
        class="flex-1 min-w-0"
        :options="groupOptions"
        :model-value="groupBy"
        :sort-direction="sortDirection"
        @update:model-value="groupBy = $event"
        @update:sort-direction="sortDirection = $event"
      />
      <div class="flex items-center gap-4 self-center shrink-0">
        <!-- Display settings dropdown -->
        <v-menu
          v-model="displayMenuDesktop"
          :close-on-content-click="false"
          location="bottom end"
          offset="8"
        >
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="appearance-none bg-transparent inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors"
              :class="
                displayMenuDesktop
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              "
            >
              <v-icon icon="mdi-cog-outline" size="14" />
              {{ $t("library.display") }}
            </button>
          </template>
          <div
            class="bg-[#1a1917] border border-charcoal-border shadow-xl p-4 w-80"
          >
            <LibraryDisplaySettings
              v-model:main-only="mainOnly"
              v-model:highlight-complete="highlightComplete"
              v-model:show-unowned="showUnowned"
              v-model:show-status-icons="showStatusIcons"
              v-model:only-owned="onlyOwned"
              v-model:highlight-owning-border="highlightOwningBorder"
              v-model:group-editions="groupEditions"
              :series-context="seriesContext"
            >
              <template #extra>
                <div
                  class="flex items-center justify-between border-t border-charcoal-border pt-4 mt-2"
                >
                  <span class="text-xs text-text-primary">{{
                    $t("library.per_page")
                  }}</span>
                  <AppSelect
                    v-model="perPage"
                    :options="PAGE_SIZE_OPTIONS"
                    :min-width="70"
                  />
                </div>
              </template>
            </LibraryDisplaySettings>
          </div>
        </v-menu>

        <!-- View toggle -->
        <div class="flex">
          <button
            class="flex items-center justify-center w-8.5 h-7.5 border -ml-px first:ml-0 transition-colors"
            :class="
              viewMode === 'list'
                ? 'border-charcoal-border text-orange-neon bg-charcoal-light'
                : 'border-charcoal-border text-text-secondary hover:text-text-primary'
            "
            :aria-label="$t('library.view_list')"
            :aria-pressed="viewMode === 'list'"
            @click="viewMode = 'list'"
          >
            <v-icon icon="mdi-view-list" size="16" />
          </button>
          <button
            class="flex items-center justify-center w-8.5 h-7.5 border -ml-px first:ml-0 transition-colors"
            :class="
              viewMode === 'tile'
                ? 'border-charcoal-border text-orange-neon bg-charcoal-light'
                : 'border-charcoal-border text-text-secondary hover:text-text-primary'
            "
            :aria-label="$t('library.view_tile')"
            :aria-pressed="viewMode === 'tile'"
            @click="viewMode = 'tile'"
          >
            <v-icon icon="mdi-view-grid" size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- ── Mobile control bar: sticky, quick search + group trigger + display ── -->
    <div
      class="md:hidden sticky top-0 z-25 bg-charcoal border-b border-charcoal-border shrink-0"
    >
      <div class="flex items-center gap-2.5 px-6 py-3">
        <button
          class="flex items-center justify-center w-8.5 h-8.5 border transition-colors shrink-0"
          :class="
            mobileSearchOpen
              ? 'border-orange-neon text-orange-neon bg-orange-neon/10'
              : 'border-charcoal-border text-text-secondary'
          "
          :aria-label="$t('library.search_field_label')"
          :aria-pressed="mobileSearchOpen"
          @click="mobileSearchOpen = !mobileSearchOpen"
        >
          <v-icon icon="mdi-magnify" size="16" />
        </button>
        <button
          class="flex items-center gap-2.5 flex-1 min-w-0 bg-charcoal-light border border-charcoal-border px-3.5 py-3 text-left"
          @click="groupSheetOpen = true"
        >
          <span
            class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary/70 shrink-0"
            >{{ $t("library.group_by") }}</span
          >
          <span
            class="flex-1 min-w-0 truncate font-mono text-xs text-text-primary"
            >{{ currentGroupLabel }}</span
          >
          <span class="text-orange-neon text-sm shrink-0">{{
            sortDirection === "asc" ? "↑" : "↓"
          }}</span>
          <span class="text-text-secondary/60 text-[9px] shrink-0">▼</span>
        </button>
        <button
          class="flex items-center justify-center w-8.5 h-8.5 border border-charcoal-border text-text-secondary shrink-0"
          :aria-label="$t('library.display')"
          @click="displayMenu = true"
        >
          <v-icon icon="mdi-cog-outline" size="16" />
        </button>
      </div>

      <!-- Quick search: expands inline, shares the hero search state -->
      <div v-if="mobileSearchOpen" class="flex items-center gap-2.5 px-6 pb-3">
        <div
          class="flex items-center gap-2.5 flex-1 min-w-0 bg-search-bg border border-orange-neon px-3.5 py-2.5"
        >
          <v-icon icon="mdi-magnify" size="14" color="primary" />
          <input
            v-model="search"
            type="text"
            :aria-label="$t('library.search_field_label')"
            :placeholder="$t('library.search_placeholder_smart')"
            class="flex-1 min-w-0 bg-transparent text-text-primary text-xs outline-none placeholder:text-text-secondary/40"
          />
          <button
            v-if="search"
            class="text-text-secondary hover:text-text-primary transition-colors shrink-0"
            :aria-label="$t('library.clear_search')"
            @click="search = ''"
          >
            <v-icon icon="mdi-close" size="13" />
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile group picker bottom sheet -->
    <v-bottom-sheet v-model="groupSheetOpen">
      <div
        class="bg-charcoal-light border-t border-charcoal-border px-6 pt-4 pb-8 max-h-[78dvh] overflow-y-auto"
      >
        <div class="w-9 h-1 rounded bg-charcoal-border mx-auto mb-4" />
        <div class="flex items-center justify-between pb-1">
          <span
            class="font-mono text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            >{{ $t("library.group_by") }}</span
          >
          <button
            class="text-text-secondary text-lg leading-none"
            :aria-label="$t('detail.close')"
            @click="groupSheetOpen = false"
          >
            ✕
          </button>
        </div>
        <p class="text-[10px] text-text-secondary leading-snug pb-2">
          {{ $t("library.group_sheet_hint") }}
        </p>
        <button
          v-for="opt in groupOptions"
          :key="opt.value"
          class="flex items-center justify-between w-full text-left border-b border-charcoal-border py-3.5"
          @click="selectGroupMobile(opt.value)"
        >
          <span
            class="text-sm"
            :class="
              groupBy === opt.value
                ? 'text-text-primary'
                : 'text-text-secondary'
            "
            >{{ opt.label }}</span
          >
          <span
            v-if="groupBy === opt.value"
            class="inline-flex items-center gap-1.5 text-orange-neon font-mono text-[10px] tracking-widest"
          >
            <span class="text-sm leading-none">{{
              sortDirection === "asc" ? "↑" : "↓"
            }}</span>
            {{ sortDirection === "asc" ? "ASC" : "DESC" }}
          </span>
        </button>
      </div>
    </v-bottom-sheet>

    <!-- Display settings — mobile bottom sheet -->
    <v-bottom-sheet v-model="displayMenu">
      <div
        class="bg-charcoal-light border-t border-charcoal-border px-6 pt-4 pb-8"
      >
        <div class="w-9 h-1 rounded bg-charcoal-border mx-auto mb-4" />
        <LibraryDisplaySettings
          v-model:main-only="mainOnly"
          v-model:highlight-complete="highlightComplete"
          v-model:show-unowned="showUnowned"
          v-model:show-status-icons="showStatusIcons"
          v-model:only-owned="onlyOwned"
          v-model:highlight-owning-border="highlightOwningBorder"
          v-model:group-editions="groupEditions"
          v-model:view-mode="viewMode"
          show-view-row
          :series-context="seriesContext"
        >
          <template #extra>
            <div
              class="flex items-center justify-between border-t border-charcoal-border pt-4 mt-2"
            >
              <span class="text-xs text-text-primary">{{
                $t("library.per_page")
              }}</span>
              <AppSelect
                v-model="perPage"
                :options="PAGE_SIZE_OPTIONS"
                :min-width="70"
              />
            </div>
          </template>
        </LibraryDisplaySettings>
      </div>
    </v-bottom-sheet>

    <!-- ── Loading ──────────────────────────────────────────────────────────── -->
    <div v-if="loading" class="flex justify-center mt-20">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- ── Error ────────────────────────────────────────────────────────────── -->
    <div
      v-if="error"
      class="mx-6 md:mx-10 mt-6 pl-4 py-2 border-l-2 text-sm"
      style="
        border-color: rgb(var(--v-theme-error));
        color: rgb(var(--v-theme-error));
      "
    >
      {{ error }}
    </div>

    <!-- ── Empty library ────────────────────────────────────────────────────── -->
    <div
      v-if="!loading && allBooks.length === 0"
      class="px-6 md:px-10 pt-16 pb-8"
    >
      <p class="font-heading text-3xl font-bold text-text-primary mb-3">
        {{ $t("library.empty_heading") }}
      </p>
      <v-btn
        variant="text"
        color="primary"
        rounded="0"
        class="text-[10px] tracking-[0.15em] uppercase px-0 mt-1"
        append-icon="mdi-arrow-right"
        @click="$router.push('/scanner')"
      >
        {{ $t("library.empty_scan_cta") }}
      </v-btn>
    </div>

    <!-- ── No results ────────────────────────────────────────────────────────── -->
    <div
      v-else-if="!loading && allBooks.length > 0 && filteredBooks.length === 0"
      class="px-6 md:px-10 pt-16 pb-8"
    >
      <p class="text-sm text-text-secondary">{{ $t("library.no_results") }}</p>
    </div>

    <!-- ── Grouped shelves. Desktop packs short groups into a shared row instead of
         leaving gaps; mobile keeps the classic one-section-per-group layout below —
         packing several groups' tiny headers into one cramped mobile row reads as noise,
         not a fix, so packing is scoped to `md` and up. ── -->
    <div v-else-if="!loading && isGrouped" class="flex-1 px-6 md:px-10 pt-9 pb-28">
      <!-- Desktop: packed rows -->
      <template v-if="display.mdAndUp.value">
      <!-- Tile shelf -->
      <div v-if="viewMode === 'tile'">
        <div v-for="row in packedTileRows" :key="row.key" class="mb-7">
          <!-- Header strip: one segment per group represented in this row, sized to the
               columns it occupies. The divider only draws when a segment spans >1 card. -->
          <div
            v-if="row.segments.some((s) => s.groupLabel)"
            class="grid gap-x-3 md:gap-x-4 mb-2"
            :style="{
              gridTemplateColumns: `repeat(${coverPerRow}, minmax(0, 1fr))`,
            }"
          >
            <div
              v-for="seg in row.segments"
              :key="seg.key"
              class="min-w-0 flex items-baseline gap-2"
              :style="{ gridColumn: `span ${seg.span}` }"
            >
              <LibraryGroupHeader
                v-if="seg.groupLabel"
                :text="seg.groupLabel.text"
                :series-id="seg.groupLabel.seriesId"
                :complete="seg.groupLabel.complete"
                :count-label="seg.groupLabel.countLabel"
                :show-divider="seg.span > 1"
                @select="onGroupLabelSelect(seg.groupLabel.seriesId)"
              />
            </div>
          </div>

          <!-- Cards -->
          <div
            class="grid gap-x-3 md:gap-x-4 gap-y-6"
            :style="{
              gridTemplateColumns: `repeat(${coverPerRow}, minmax(0, 1fr))`,
            }"
          >
            <template v-for="seg in row.segments" :key="seg.key">
              <template v-for="slot in seg.slots" :key="slot.key">
                <LibraryCoverCard
                  v-if="slot.type === 'entry'"
                  :title="slot.entry.title"
                  :cover-url="slot.entry.cover_url"
                  :ordinal="slot.entry.ordinal"
                  :owned="slot.entry.owned"
                  :status="slot.entry.status"
                  :owning-status="slot.entry.owningStatus"
                  :author="slot.entry.author"
                  :hide-status="!showStatusIcons"
                  :edition-count="slot.entry.editionCount"
                  :expanded="!!slot.entry.book && expandedCards.has(slot.entry.book.id)"
                  @select="onEntrySelect(slot.entry)"
                  @toggle-editions="slot.entry.book && toggleCardExpand(slot.entry.book.id)"
                />
                <button
                  v-else
                  type="button"
                  class="flex flex-col min-w-0"
                  @click="toggleExpand(slot.groupKey)"
                >
                  <span
                    class="flex-1 aspect-2/3 flex flex-col items-center justify-center gap-1 border border-dashed border-charcoal-border text-text-secondary hover:text-text-primary hover:border-charcoal-border/60 transition-colors font-mono text-[9px] tracking-[0.1em] uppercase text-center px-1"
                  >
                    <v-icon :icon="slot.expanded ? 'mdi-minus' : 'mdi-plus'" size="14" />
                    {{
                      slot.expanded
                        ? $t("library.collapse")
                        : $t("library.show_all", { n: slot.count })
                    }}
                  </span>
                </button>
              </template>
            </template>
          </div>
        </div>
      </div>

      <!-- List shelf -->
      <div v-else>
        <div v-for="row in packedListRows" :key="row.key" class="mb-7">
          <div
            v-if="row.segments.some((s) => s.groupLabel)"
            class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5 mb-2"
          >
            <div
              v-for="seg in row.segments"
              :key="seg.key"
              class="min-w-0 flex items-baseline gap-2"
              :style="{ gridColumn: `span ${seg.span}` }"
            >
              <LibraryGroupHeader
                v-if="seg.groupLabel"
                :text="seg.groupLabel.text"
                :series-id="seg.groupLabel.seriesId"
                :complete="seg.groupLabel.complete"
                :count-label="seg.groupLabel.countLabel"
                :show-divider="seg.span > 1"
                @select="onGroupLabelSelect(seg.groupLabel.seriesId)"
              />
            </div>
          </div>

          <div class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5">
            <template v-for="seg in row.segments" :key="seg.key">
              <template v-for="slot in seg.slots" :key="slot.key">
                <LibraryRowCard
                  v-if="slot.type === 'entry' && slot.entry.book"
                  :book="slot.entry.book"
                  :hide-status="!showStatusIcons"
                  :expanded="expandedCards.has(slot.entry.book.id)"
                  :highlight-owning-border="highlightOwningBorder"
                  @cycle-status="cycleStatus(slot.entry.book)"
                  @select="openDetail(slot.entry.book)"
                  @select-edition="openDetail($event)"
                  @toggle-editions="toggleCardExpand(slot.entry.book.id)"
                />
                <LibraryGhostRow
                  v-else-if="slot.type === 'entry'"
                  :title="slot.entry.title"
                  :ordinal="slot.entry.ordinal"
                  @select="onEntrySelect(slot.entry)"
                />
                <button
                  v-else
                  type="button"
                  class="flex items-center justify-center gap-2 p-4 border border-dashed border-charcoal-border text-text-secondary hover:text-text-primary hover:border-charcoal-border/60 transition-colors font-mono text-[10px] tracking-[0.12em] uppercase"
                  @click="toggleExpand(slot.groupKey)"
                >
                  <v-icon :icon="slot.expanded ? 'mdi-minus' : 'mdi-plus'" size="14" />
                  {{
                    slot.expanded
                      ? $t("library.collapse")
                      : $t("library.show_all", { n: slot.count })
                  }}
                </button>
              </template>
            </template>
          </div>
        </div>
      </div>
      </template>

      <!-- Mobile: classic layout — one full-width header per group, one grid per group,
           no cross-group packing. -->
      <template v-else>
        <div v-for="group in pagedGroups" :key="group.key" class="mb-9">
          <div class="flex items-baseline gap-3 pb-4">
            <LibraryGroupHeader
              :text="group.label"
              :series-id="group.seriesId ?? null"
              :complete="group.complete"
              :count-label="group.countLabel"
              size="full"
              :link-highlights-complete="false"
              @select="onGroupLabelSelect(group.seriesId ?? null)"
            >
              <button
                v-if="shelfHasMore(group)"
                class="shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
                @click="toggleExpand(group.key)"
              >
                {{
                  expanded[group.key]
                    ? $t("library.collapse")
                    : $t("library.show_all", { n: shelfTotal(group) })
                }}
              </button>
            </LibraryGroupHeader>
          </div>

          <!-- Tile shelf -->
          <div
            v-if="viewMode === 'tile'"
            class="grid gap-3 md:gap-4"
            :style="{
              gridTemplateColumns: `repeat(${coverPerRow}, minmax(0, 1fr))`,
            }"
          >
            <LibraryCoverCard
              v-for="entry in shelfVisible(group).flatMap((entry) => expandEntry(entry))"
              :key="entry.key"
              :title="entry.title"
              :cover-url="entry.cover_url"
              :ordinal="entry.ordinal"
              :owned="entry.owned"
              :status="entry.status"
              :owning-status="entry.owningStatus"
              :author="entry.author"
              :hide-status="!showStatusIcons"
              :edition-count="entry.editionCount"
              :expanded="!!entry.book && expandedCards.has(entry.book.id)"
              @select="onEntrySelect(entry)"
              @toggle-editions="entry.book && toggleCardExpand(entry.book.id)"
            />
          </div>

          <!-- List shelf -->
          <div v-else class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5">
            <template v-for="entry in shelfVisible(group)" :key="entry.key">
              <LibraryRowCard
                v-if="entry.book"
                :book="entry.book"
                :hide-status="!showStatusIcons"
                :expanded="expandedCards.has(entry.book.id)"
                :highlight-owning-border="highlightOwningBorder"
                @cycle-status="cycleStatus(entry.book)"
                @select="openDetail(entry.book)"
                @select-edition="openDetail($event)"
                @toggle-editions="toggleCardExpand(entry.book.id)"
              />
              <LibraryGhostRow
                v-else
                :title="entry.title"
                :ordinal="entry.ordinal"
                @select="onEntrySelect(entry)"
              />
            </template>
          </div>
        </div>
      </template>

      <AppPagination
        :current-page="currentPage"
        :total-pages="totalPages"
        :range-start="(currentPage - 1) * pageSize + 1"
        :range-end="Math.min(currentPage * pageSize, paginatedCount)"
        :total="paginatedCount"
        @change="changePage"
      />
    </div>

    <!-- ── Ungrouped: flat tile or list ───────────────────────────────────────── -->
    <div v-else-if="!loading" class="flex-1 px-6 md:px-10 pt-6 pb-28">
      <!-- Tile -->
      <div
        v-if="viewMode === 'tile'"
        class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-9 xl:grid-cols-13 gap-3 md:gap-4"
      >
        <LibraryCoverCard
          v-for="book in pagedBooks.flatMap(expandBook)"
          :key="book.id"
          :title="book.title || book.isbn"
          :cover-url="book.cover_url ?? null"
          :ordinal="null"
          :owned="true"
          :status="book.status"
          :owning-status="book.owning_status"
          :author="authorDisplayName(book)"
          :hide-status="!showStatusIcons"
          :edition-count="book.editionCount"
          :expanded="expandedCards.has(book.id)"
          @select="openDetail(book)"
          @toggle-editions="toggleCardExpand(book.id)"
        />
      </div>

      <!-- List -->
      <div v-else class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <LibraryRowCard
          v-for="book in pagedBooks"
          :key="book.id"
          :book="book"
          :hide-status="!showStatusIcons"
          :expanded="expandedCards.has(book.id)"
          :highlight-owning-border="highlightOwningBorder"
          @cycle-status="cycleStatus(book)"
          @select="openDetail(book)"
          @select-edition="openDetail($event)"
          @toggle-editions="toggleCardExpand(book.id)"
        />
      </div>

      <AppPagination
        :current-page="currentPage"
        :total-pages="totalPages"
        :range-start="(currentPage - 1) * pageSize + 1"
        :range-end="Math.min(currentPage * pageSize, filteredBooks.length)"
        :total="filteredBooks.length"
        @change="changePage"
      />
    </div>

    <AppFooter class="mt-auto" />

    <!-- Book detail dialog -->
    <BookDetail
      v-if="selectedBook"
      :model-value="!!detailEditionIsbn && !!selectedBook"
      :book="selectedBook"
      :guest="isGuest"
      @update:model-value="
        (v) => {
          if (!v) closeDetail();
        }
      "
      @cycle-status="cycleStatus(selectedBook!)"
      @set-status="(s) => setStatus(selectedBook!, s)"
      @set-owning-status="(s) => setOwningStatus(selectedBook!, s)"
      @set-rating="(r) => setRating(selectedBook!, r)"
      @delete="
        closeDetail();
        openDeleteDialog(selectedBook!);
      "
      @refreshed="handleRefreshed"
      @switch-edition="onSwitchEdition"
    />

    <!-- Delete confirmation -->
    <ConfirmDialog
      v-model="deleteDialog"
      :title="$t('library.remove_heading')"
      :confirm-label="$t('library.remove')"
      :cancel-label="$t('library.cancel')"
      :loading="deleting"
      @confirm="confirmDelete"
    >
      {{
        $t("library.remove_body", {
          title: bookToDelete?.title || bookToDelete?.isbn,
        })
      }}
      <p v-if="deleteFailed" class="text-error mt-2">
        {{ $t("library.error_delete") }}
      </p>
    </ConfirmDialog>

    <AppToast
      v-model="errorToast"
      :message="errorMessage"
      type="error"
      :timeout="4000"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useGuestStore } from "@/stores/guest";
import { useLocaleStore } from "@/stores/locale";
import { useDeleteScan } from "@/composables/useDeleteScan";
import { useScanStatus } from "@/composables/useScanStatus";
import { useToast } from "@/composables/useToast";
import { useLibraryData } from "@/composables/useLibraryData";
import { useLibrarySearch } from "@/composables/useLibrarySearch";
import { useLibraryGrouping } from "@/composables/useLibraryGrouping";
import { useEditionGrouping } from "@/composables/useEditionGrouping";
import { useShelfGroups } from "@/composables/useShelfGroups";
import {
  packRows,
  type ShelfEntry,
  type PackedRow,
} from "@/utils/shelf-packing";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useDetailRoute } from "@/composables/useDetailRoute";
import { useGroupDimensions } from "@/composables/useGroupDimensions";
import { sortByCreatedAt, authorDisplayName } from "@/utils/book-display";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";
import type { GroupBy } from "@/types/library";
import AppHeader from "@/components/AppHeader.vue";
import AppToast from "@/components/AppToast.vue";
import AppFooter from "@/components/AppFooter.vue";
import LibraryRowCard from "@/components/LibraryRowCard.vue";
import LibraryCoverCard from "@/components/LibraryCoverCard.vue";
import LibraryGhostRow from "@/components/LibraryGhostRow.vue";
import LibraryGroupHeader from "@/components/LibraryGroupHeader.vue";
import LibrarySearchBar from "@/components/LibrarySearchBar.vue";
import LibraryDisplaySettings from "@/components/LibraryDisplaySettings.vue";
import LibraryGroupTabs from "@/components/LibraryGroupTabs.vue";
import AppSelect from "@/components/AppSelect.vue";
import BookDetail from "@/components/BookDetail.vue";
import AppPagination from "@/components/AppPagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useLibraryDefaultsStore } from "@/stores/libraryDefaults";
import { storeToRefs } from "pinia";
import { useDisplay } from "vuetify";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const guestStore = useGuestStore();
const localeStore = useLocaleStore();
const {
  setStatus: applyStatus,
  cycleStatus: applyCycle,
  setOwningStatus: applyOwningStatus,
  setRating: applyRating,
} = useScanStatus();
const fieldDefsStore = useFieldDefsStore();
const libraryDefaultsStore = useLibraryDefaultsStore();
const {
  detailEditionIsbn,
  openDetail: openDetailRoute,
  closeDetail,
} = useDetailRoute();
const { groupOptions, customFieldMetas } = useGroupDimensions();

const isGuest = computed(() => !authStore.isAuthenticated);

// ── State ─────────────────────────────────────────────────────────────────────

const loading = ref(false);
const { serverBooks, seriesMemberships, error, fetchBooks, fetchMemberships } =
  useLibraryData();

const search = ref("");
// Persisted display settings bind straight to the store's writable refs (each
// persists to localStorage on set — see libraryDefaults.ts). onlyOwned/groupEditions
// are pulled here, ahead of the search pipeline below, because it needs them at setup.
const {
  groupBy,
  sortDirection,
  defaultView: viewMode,
  onlyOwned,
  groupEditions,
  mainOnly,
  highlightComplete,
  showUnowned,
  highlightOwningBorder,
} = storeToRefs(libraryDefaultsStore);

// ── Search & grouping (see useLibrarySearch / useLibraryGrouping) ───────────────
const allBooks = computed<Book[]>(() =>
  isGuest.value ? guestStore.scans : serverBooks.value,
);

// Status used at the moment a book was last placed into the current filtered/grouped
// view. Cycling a book's status in-place pins its old bucket here so it doesn't jump
// or vanish out from under the user; cleared whenever the view is re-filtered.
const statusOverrides = ref(new Map<number, ReadStatus>());
const statusOf = (b: Book): ReadStatus =>
  statusOverrides.value.get(b.id) ?? b.status;
function pinStatus(book: Book) {
  if (!statusOverrides.value.has(book.id))
    statusOverrides.value.set(book.id, book.status);
}
watch([search, groupBy, sortDirection], () => {
  statusOverrides.value.clear();
});

const { knownKeys, parsedSearch, baseFiltered, facetEntries, removeToken } =
  useLibrarySearch({
    books: allBooks,
    search,
    customFieldMetas,
    statusOf,
    onlyOwned,
  });

// Collapses same-work editions into one synthetic card. Must run after search/filtering
// (baseFiltered), not before — see useEditionGrouping's doc comment.
const groupedFiltered = useEditionGrouping(baseFiltered, groupEditions);

// Filtered and sorted — used by tile view and all non-series groupings.
const filteredBooks = computed<Book[]>(() =>
  sortByCreatedAt(groupedFiltered.value, sortDirection.value),
);

const { allGroups } = useLibraryGrouping({
  baseFiltered: groupedFiltered,
  filteredBooks,
  groupBy,
  sortDirection,
  statusOf,
});

// Separate, unfiltered grouping pass (independent of search) purely to resolve which
// owned edition represents each work — the series-shelf branch below needs this
// regardless of any active search, mirroring how it already reads from allBooks today.
// Always enabled (not gated on the groupEditions display toggle): a series shelf always shows
// one card per work, so it needs a deliberate representative pick regardless of whether the
// *other* shelves are currently displaying editions collapsed or expanded.
const groupedAllBooks = useEditionGrouping(allBooks, true);

// ── Display settings (persisted) ───────────────────────────────────────────────
// Backed by a separate persisted default per view (list vs tile) — see
// showStatusIconsList/Tile in libraryDefaults.ts — so the toggle always reflects
// and updates whichever view is currently active.
const showStatusIcons = computed({
  get: () =>
    viewMode.value === "tile"
      ? libraryDefaultsStore.showStatusIconsTile
      : libraryDefaultsStore.showStatusIconsList,
  set: (v) => {
    if (viewMode.value === "tile")
      libraryDefaultsStore.showStatusIconsTile = v;
    else libraryDefaultsStore.showStatusIconsList = v;
  },
});
const displayMenu = ref(false);
const displayMenuDesktop = ref(false);
const groupSheetOpen = ref(false);
const mobileSearchOpen = ref(false);

const currentGroupLabel = computed(
  () => groupOptions.value.find((o) => o.value === groupBy.value)?.label ?? "",
);

// Reset sort direction to a sensible default when the group changes.
watch(groupBy, (v) => {
  sortDirection.value = v === "none" || v === "rating" ? "desc" : "asc";
});

// Mobile group picker: re-tapping the active group flips sort direction (matches mockup).
function selectGroupMobile(v: GroupBy) {
  if (groupBy.value === v)
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
  else {
    groupBy.value = v;
    groupSheetOpen.value = false;
  }
}
// Per-group shelf expansion (key = group key)
const expanded = ref<Record<string, boolean>>({});
function toggleExpand(key: string) {
  expanded.value[key] = !expanded.value[key];
}

// Per-card edition expansion (key = the representative book's id). Toggled by the
// ×N badge, distinct from `expanded` above (which shows more shelf rows, not editions).
const expandedCards = ref<Set<number>>(new Set());
function toggleCardExpand(id: number) {
  const next = new Set(expandedCards.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedCards.value = next;
}

// Injects a work-card's *other* owned editions right after it when expanded — the
// collapsed/representative card itself always stays put, since its ×N badge is the only
// way to collapse again (replacing it entirely would strand the user with no way back).
function expandBook(b: Book): Book[] {
  if (!b.editionCount || b.editionCount <= 1 || !expandedCards.value.has(b.id))
    return [b];
  const others = (b.editions ?? []).filter((e) => e.id !== b.id);
  return [b, ...others];
}
function expandEntry(e: ShelfEntry): ShelfEntry[] {
  if (!e.book) return [e];
  const book = e.book;
  // Keep the original entry (not a re-derived bookToEntry) for the representative slot —
  // series-shelf entries carry fields (seriesId, key) that bookToEntry doesn't reconstruct.
  return expandBook(book).map((b) => (b.id === book.id ? e : bookToEntry(b)));
}

// Responsive shelf row sizing (collapsed = one row).
const display = useDisplay();
const coverPerRow = computed(() => {
  if (display.xlAndUp.value) return 8;
  if (display.lgAndUp.value) return 7;
  if (display.mdAndUp.value) return 6;
  if (display.smAndUp.value) return 5;
  return 4;
});
const listPerRow = computed(() =>
  display.xlAndUp.value ? 4 : display.mdAndUp.value ? 2 : 1,
);
const shelfRowSize = computed(() =>
  viewMode.value === "tile" ? coverPerRow.value : listPerRow.value,
);

const isGrouped = computed(() => groupBy.value !== "none");
const seriesContext = computed(() => groupBy.value === "series");

const selectedBook = ref<Book | null>(null);

const {
  visible: errorToast,
  message: errorMessage,
  showToast,
} = useToast();

const perPage = ref<string>(String(libraryDefaultsStore.defaultPageSize));

const PAGE_SIZE_OPTIONS = [
  { value: "12", label: "12" },
  { value: "24", label: "24" },
  { value: "48", label: "48" },
  { value: "96", label: "96" },
  { value: "10000", label: t("library.per_page_all") },
];

// ── Pagination ────────────────────────────────────────────────────────────────

const currentPage = ref(1);

const pageSize = computed(() => parseInt(perPage.value, 10));

watch(perPage, (val) => {
  libraryDefaultsStore.setPageSize(parseInt(val, 10));
});

// When grouped, a "page" holds pageSize groups (shelves); otherwise pageSize books.
const paginatedCount = computed(() =>
  isGrouped.value ? shelfGroups.value.length : filteredBooks.value.length,
);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(paginatedCount.value / pageSize.value)),
);

// Flat (ungrouped) book pagination.
const pagedBooks = computed<Book[]>(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredBooks.value.slice(start, start + pageSize.value);
});

// Reset to page 1 whenever the visible set or view changes.
watch([filteredBooks, sortDirection, groupBy, perPage], () => {
  currentPage.value = 1;
});

function changePage(p: number) {
  currentPage.value = p;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Shelf enrichment (counts, completeness, unowned reveal) ─────────────────────
const {
  bookToEntry,
  shelfGroups,
  pagedGroups,
  shelfVisible,
  shelfTotal,
  shelfHasMore,
  packedShelfVisible,
} = useShelfGroups({
  allGroups,
  groupedAllBooks,
  seriesMemberships,
  parsedSearch,
  search,
  mainOnly,
  highlightComplete,
  showUnowned,
  onlyOwned,
  shelfRowSize,
  expanded,
  currentPage,
  pageSize,
});

function onEntrySelect(entry: ShelfEntry) {
  if (entry.book) openDetail(entry.book);
  else if (entry.seriesId != null) router.push(`/series/${entry.seriesId}`);
}

// ── Packed grouped-shelf rendering (bin-packer: see packRows in utils/shelf-packing) ─
// Recomputes every group's row placement whenever any single group's collapse state
// (`expanded`) or any single card's edition state (`expandedCards`) changes, not just
// the touched group's — because packing is cross-group (a group's row-count change
// shifts where every later group starts), that recompute is inherent to sharing rows
// across groups at all, not something a finer-grained cache could avoid without
// abandoning the packing itself.
const packedTileRows = computed<PackedRow[]>(() =>
  packRows(
    coverPerRow.value,
    pagedGroups.value,
    (g, hasMore) =>
      packedShelfVisible(g, hasMore).flatMap((entry) => expandEntry(entry)),
    shelfHasMore,
    (g) => !!expanded.value[g.key],
  ),
);
const packedListRows = computed<PackedRow[]>(() =>
  packRows(
    listPerRow.value,
    pagedGroups.value,
    packedShelfVisible,
    shelfHasMore,
    (g) => !!expanded.value[g.key],
  ),
);

function onGroupLabelSelect(seriesId: number | null) {
  if (seriesId != null) router.push(`/series/${seriesId}`);
}

// ── Status cycling ────────────────────────────────────────────────────────────

const notifyStatusError = () => {
  showToast(t("library.error_update_status"), "error");
};

// The book objects flowing through shelf/list rendering (bookToEntry, useEditionGrouping)
// are freshly spread copies rebuilt on every recompute, not the canonical reactive item in
// serverBooks/guestStore. Mutating a copy in place either doesn't trigger a re-render (plain
// object) or never makes it back to the source of truth (so it's lost on the next recompute,
// e.g. returning from the detail view). Resolve to the canonical instance before mutating.
const booksById = computed(() => {
  const m = new Map<number, Book>();
  for (const b of allBooks.value) m.set(b.id, b);
  return m;
});
function resolveBook(book: Book): Book {
  return booksById.value.get(book.id) ?? book;
}

const cycleStatus = (book: Book) => {
  const target = resolveBook(book);
  pinStatus(target);
  return applyCycle(target).catch(notifyStatusError);
};

const setStatus = (book: Book, newStatus: ReadStatus) => {
  const target = resolveBook(book);
  pinStatus(target);
  return applyStatus(target, newStatus).catch(notifyStatusError);
};

const setOwningStatus = (book: Book, newStatus: OwningStatus) => {
  return applyOwningStatus(resolveBook(book), newStatus).catch(notifyStatusError);
};

const setRating = (book: Book, rating: number | null) => {
  return applyRating(resolveBook(book), rating).catch(notifyStatusError);
};

// ── Detail & delete ───────────────────────────────────────────────────────────

const openDetail = (book: Book) => {
  selectedBook.value = resolveBook(book);
  openDetailRoute(book.work_id, book.isbn);
};

// Switching editions from within the detail carousel is just another owned scan in this
// same user's library — no extra fetch needed, unlike series.vue's readonly reference case.
function onSwitchEdition(payload: { isbn: string; scanId: number }) {
  const book = allBooks.value.find((b) => b.isbn === payload.isbn);
  if (book) openDetail(book);
}

// Resolve selectedBook from the URL (handles Back/Forward and deep links)
watch(
  [detailEditionIsbn, allBooks],
  ([isbn]) => {
    if (!isbn) {
      selectedBook.value = null;
      return;
    }
    if (selectedBook.value?.isbn !== isbn)
      selectedBook.value =
        allBooks.value.find((b) => b.isbn === isbn) ?? selectedBook.value;
  },
  { immediate: true },
);

function handleRefreshed(updated: Partial<Book>) {
  if (!selectedBook.value) return;
  const merged = { ...selectedBook.value, ...updated } as Book;
  selectedBook.value = merged;
  const idx = serverBooks.value.findIndex((b) => b.id === merged.id);
  if (idx !== -1) serverBooks.value[idx] = merged;
}

const {
  deleteDialog,
  bookToDelete,
  deleting,
  deleteFailed,
  openDeleteDialog,
  confirmDelete,
} = useDeleteScan({
  onDeleted: (book) => {
    serverBooks.value = serverBooks.value.filter((b) => b.id !== book.id);
  },
  onGuestDelete: (book) => {
    if (!isGuest.value) return false;
    guestStore.removeScan(book.isbn!);
    return true;
  },
});

// ── URL ↔ search sync ─────────────────────────────────────────────────────────

// Sync search from URL query param — runs on mount and whenever the route changes
// (handles clicking a filter while already on the library page)
watch(
  () => route.query.q,
  (q) => {
    const val = typeof q === "string" ? q : "";
    if (val !== search.value) search.value = val;
  },
  { immediate: true },
);

// Keep URL in sync as search changes — preserve the book param if a detail is open
watch(search, (val) => {
  const current = typeof route.query.q === "string" ? route.query.q : "";
  if (val === current) return;
  const next: Record<string, string> = {};
  if (val) next.q = val;
  if (route.query.book) next.book = String(route.query.book);
  router.replace({ query: next });
});

// ── Init ──────────────────────────────────────────────────────────────────────

// Freshly fetched rows supersede any pinned status buckets from in-place edits.
const clearStatusPins = () => statusOverrides.value.clear();

onMounted(async () => {
  if (authStore.isAuthenticated) {
    loading.value = true;
    await Promise.all([
      fetchBooks(clearStatusPins),
      fetchMemberships(),
      fieldDefsStore.load(),
    ]);
    loading.value = false;
  }
});

watch(
  () => localeStore.locale,
  async () => {
    if (!authStore.isAuthenticated) return;
    loading.value = true;
    await Promise.all([fetchBooks(clearStatusPins), fetchMemberships()]);
    loading.value = false;
  },
);
</script>
