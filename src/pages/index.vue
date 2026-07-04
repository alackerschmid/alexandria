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

    <!-- Scrim (sits above page content, below search dropdown) -->
    <v-fade-transition>
      <div
        v-if="searchFocused"
        class="fixed inset-0 z-[50] bg-black/30 backdrop-blur-[2px] cursor-default"
        @click="searchFocused = false"
      />
    </v-fade-transition>

    <!-- ── Search hero ──────────────────────────────────────────────────────── -->
    <div
      class="border-b border-charcoal-border px-6 md:px-10 pt-10 md:pt-14 pb-8 md:pb-10 flex flex-col items-center shrink-0"
    >
      <!-- Heading + count -->
      <div class="flex items-baseline gap-4 mb-7 self-start md:self-center">
        <h1
          class="font-heading text-4xl md:text-5xl font-bold text-text-primary leading-none"
        >
          {{ $t("library.heading") }}
        </h1>
        <span
          class="font-mono text-[11px] text-text-secondary/60 tracking-[0.08em]"
        >
          {{ $t("library.total_count", { n: allBooks.length }) }}
        </span>
      </div>

      <!-- Search wrapper (lifts above scrim when focused) -->
      <div
        class="w-full max-w-2xl relative"
        :class="searchFocused ? 'z-[60]' : 'z-[2]'"
      >
        <!-- Bar -->
        <div
          class="flex items-center gap-3 border bg-search-bg px-5 py-4 cursor-text transition-all duration-200"
          :class="
            searchFocused
              ? 'border-orange-neon -translate-y-[3px] scale-[1.012] shadow-[0_22px_55px_-14px_rgba(0,0,0,0.6)] ring-4 ring-orange-neon/10'
              : 'border-search-border'
          "
          @click="onSearchBarClick"
        >
          <span class="text-orange-neon text-lg leading-none shrink-0">⌕</span>
          <!-- Input + highlight overlay wrapper -->
          <div class="flex-1 min-w-0 relative">
            <!-- Highlight overlay (behind the input, synced via translateX on scroll) -->
            <div
              aria-hidden="true"
              class="absolute inset-0 flex items-center pointer-events-none overflow-hidden"
            >
              <div
                class="whitespace-pre text-base"
                :style="{ transform: `translateX(-${searchScrollLeft}px)` }"
              >
                <template v-for="(seg, i) in searchSegments" :key="i">
                  <span v-if="seg.role === 'key'" class="text-orange-neon">{{
                    seg.text
                  }}</span>
                  <span v-else class="text-text-primary">{{ seg.text }}</span>
                </template>
              </div>
            </div>
            <!-- Actual input — text is transparent so overlay shows through -->
            <input
              ref="searchRef"
              v-model="search"
              type="text"
              role="combobox"
              :aria-label="$t('library.search_field_label')"
              :aria-expanded="searchFocused"
              aria-autocomplete="list"
              aria-controls="library-search-listbox"
              :aria-activedescendant="
                searchFocused && activeIndex >= 0
                  ? `library-search-option-${activeIndex}`
                  : undefined
              "
              :placeholder="$t('library.search_placeholder_smart')"
              class="relative w-full bg-transparent text-transparent caret-text-primary text-base outline-none focus-ring-none placeholder:text-text-secondary/40"
              :class="{ 'token-selecting': tokenSelecting }"
              @focus="searchFocused = true"
              @blur="onSearchBlur"
              @keydown="onSearchKeydown"
              @mousedown="tokenSelecting = false"
              @scroll="
                searchScrollLeft = ($event.target as HTMLInputElement)
                  .scrollLeft
              "
            />
          </div>
          <button
            v-if="search"
            class="text-text-secondary hover:text-text-primary transition-colors shrink-0"
            :aria-label="$t('library.clear_search')"
            @mousedown.prevent
            @click.stop="
              search = '';
              searchRef?.focus();
            "
          >
            <v-icon icon="mdi-close" size="15" />
          </button>
          <kbd
            v-else
            class="hidden md:flex shrink-0 font-mono text-[10px] text-text-secondary/40 tracking-[0.1em] border border-charcoal-border px-1.5 py-0.5 leading-none"
          >
            ⌘K
          </kbd>
        </div>

        <!-- Autocomplete dropdown -->
        <v-slide-y-transition>
          <div
            v-if="searchFocused"
            id="library-search-listbox"
            role="listbox"
            class="absolute top-full left-0 right-0 mt-3 bg-charcoal-light border border-charcoal-border shadow-[0_28px_64px_-18px_rgba(0,0,0,0.85)] overflow-hidden"
            @mousedown.prevent
          >
            <!-- Header -->
            <div
              class="flex items-center justify-between px-[18px] py-[13px] border-b border-charcoal-border/60"
            >
              <span
                class="font-mono text-[10px] tracking-[0.2em] uppercase text-text-secondary"
                >{{ dropdownHeading }}</span
              >
              <span class="font-mono text-[10px] text-text-secondary/50">{{
                $t("library.filtered_count", { n: baseFiltered.length })
              }}</span>
            </div>

            <!-- Prefix chips (empty state) -->
            <div
              v-if="suggestions[0]?.kind === 'prefix'"
              class="flex flex-wrap gap-2.5 px-[18px] py-4 border-b border-charcoal-border/40"
            >
              <button
                v-for="(s, i) in suggestions"
                :id="`library-search-option-${i}`"
                :key="s.token"
                role="option"
                :aria-selected="i === activeIndex"
                class="flex items-center gap-2 px-3 py-2 border bg-charcoal-light transition-colors"
                :class="
                  i === activeIndex
                    ? 'border-orange-neon text-orange-neon'
                    : 'border-charcoal-border hover:border-orange-neon'
                "
                @mousedown.prevent="applySuggestion(s)"
              >
                <v-icon :icon="s.icon" size="12" color="primary" />
                <span
                  class="font-mono text-[13px] text-orange-neon tracking-[0.02em]"
                  >{{ s.token }}</span
                >
              </button>
            </div>

            <!-- Stacked suggestion rows -->
            <template v-else>
              <div
                v-for="(s, i) in suggestions"
                :id="`library-search-option-${i}`"
                :key="i"
                role="option"
                :aria-selected="i === activeIndex"
                class="flex items-center gap-3.5 px-[18px] py-[13px] cursor-pointer border-b border-charcoal-border/30 transition-colors"
                :class="
                  i === activeIndex
                    ? 'bg-white/[0.04]'
                    : 'hover:bg-white/[0.03]'
                "
                @mousedown.prevent="applySuggestion(s)"
              >
                <v-icon
                  :icon="s.icon"
                  size="13"
                  :color="s.kind === 'book' ? undefined : 'primary'"
                  class="shrink-0 w-[22px]"
                  :class="s.kind === 'book' ? 'text-text-secondary/50' : ''"
                />
                <!-- <span v-if="s.kind !== 'book'" class="font-mono text-[13px] text-orange-neon tracking-[0.02em] shrink-0 whitespace-nowrap">{{ s.token }}:</span> -->
                <span
                  class="text-[14px] text-text-primary min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                  >{{ s.label }}</span
                >
                <span
                  class="ml-auto text-[11px] text-text-secondary/70 shrink-0 whitespace-nowrap"
                  >{{ s.typeLabel }}</span
                >
              </div>
            </template>

            <!-- Footer -->
            <div
              class="flex items-center gap-4 px-[18px] py-[11px] bg-charcoal/80"
            >
              <span class="font-mono text-[10px] text-text-secondary/60"
                ><span class="text-text-secondary">↑↓</span>
                {{ $t("library.kbd_navigate") }}</span
              >
              <span class="font-mono text-[10px] text-text-secondary/60"
                ><span class="text-text-secondary">↵</span>
                {{ $t("library.kbd_select") }}</span
              >
              <span class="font-mono text-[10px] text-text-secondary/60"
                ><span class="text-text-secondary">esc</span>
                {{ $t("library.kbd_dismiss") }}</span
              >
            </div>
          </div>
        </v-slide-y-transition>
      </div>

      <!-- Active parsed-token pills -->
      <div
        v-if="parsedSearch.tokens.length"
        class="flex items-center gap-2 mt-3 w-full max-w-2xl flex-wrap"
      >
        <span
          class="text-[10px] text-text-secondary/50 tracking-[0.18em] uppercase"
          >{{ $t("library.search_active") }}</span
        >
        <span
          v-for="tok in parsedSearch.tokens"
          :key="tok"
          class="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase text-text-primary border border-charcoal-border/60 bg-charcoal-light px-2.5 py-1"
        >
          {{ tok }}
          <button
            class="text-text-secondary/60 hover:text-text-primary ml-1"
            :aria-label="$t('library.remove_filter', { token: tok })"
            @click="removeToken(tok)"
          >
            ×
          </button>
        </span>
      </div>
    </div>

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

    <!-- ── Grouped shelves (one row per group, expandable) ────────────────────── -->
    <div v-else-if="!loading && isGrouped" class="flex-1 pb-28 pt-9">
      <div
        v-for="group in pagedGroups"
        :key="group.key"
        class="px-6 md:px-10 mb-9"
      >
        <div>
          <!-- Group header -->
          <div class="flex items-baseline gap-3 pb-4">
            <h2 class="contents">
              <button
                v-if="group.seriesId != null"
                class="font-heading text-2xl font-bold hover:text-orange-neon transition-colors text-left min-w-0 truncate"
                :class="'text-text-primary'"
                @click="$router.push(`/series/${group.seriesId}`)"
              >
                {{ group.label }}
              </button>
              <span
                v-else
                class="font-heading text-2xl font-bold min-w-0 truncate"
                :class="
                  group.complete ? 'text-orange-neon' : 'text-text-primary'
                "
              >
                {{ group.label }}
              </span>
            </h2>
            <span
              class="font-mono text-[10px] text-text-secondary/50 shrink-0"
              >{{ group.countLabel }}</span
            >
            <span
              v-if="group.complete"
              class="shrink-0 font-mono text-[8px] tracking-[0.16em] uppercase text-orange-neon border border-orange-neon/40 bg-orange-neon/10 px-1.5 py-0.5"
            >
              {{ $t("library.complete") }}
            </span>
            <span
              class="flex-1 h-px"
              :class="
                group.complete ? 'bg-orange-neon/25' : 'bg-charcoal-border'
              "
            />
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
              v-for="entry in shelfVisible(group)"
              :key="entry.key"
              :title="entry.title"
              :cover-url="entry.cover_url"
              :ordinal="entry.ordinal"
              :owned="entry.owned"
              :status="entry.status"
              :author="entry.author"
              @select="onEntrySelect(entry)"
            />
          </div>

          <!-- List shelf -->
          <div v-else class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5">
            <template v-for="entry in shelfVisible(group)" :key="entry.key">
              <LibraryRowCard
                v-if="entry.book"
                :book="entry.book"
                @cycle-status="cycleStatus(entry.book)"
                @select="openDetail(entry.book)"
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
      </div>

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
          v-for="book in pagedBooks"
          :key="book.id"
          :title="book.title || book.isbn"
          :cover-url="book.cover_url ?? null"
          :ordinal="null"
          :owned="true"
          :status="book.status"
          :author="book.author"
          @select="openDetail(book)"
        />
      </div>

      <!-- List -->
      <div v-else class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <LibraryRowCard
          v-for="book in pagedBooks"
          :key="book.id"
          :book="book"
          @cycle-status="cycleStatus(book)"
          @select="openDetail(book)"
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
      :model-value="!!detailIsbn && !!selectedBook"
      :book="selectedBook"
      :guest="isGuest"
      @update:model-value="
        (v) => {
          if (!v) closeDetail();
        }
      "
      @cycle-status="cycleStatus(selectedBook!)"
      @set-status="(s) => setStatus(selectedBook!, s)"
      @delete="
        closeDetail();
        openDeleteDialog(selectedBook!);
      "
      @refreshed="handleRefreshed"
    />

    <!-- Delete confirmation -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#ffffff'">
        <v-card-title
          class="font-heading text-xl pt-6 px-6 font-bold text-text-primary"
        >
          {{ $t("library.remove_heading") }}
        </v-card-title>
        <v-card-text class="px-6 text-sm text-text-secondary">
          {{
            $t("library.remove_body", {
              title: bookToDelete?.title || bookToDelete?.isbn,
            })
          }}
          <p v-if="deleteFailed" class="text-error mt-2">
            {{ $t("library.error_delete") }}
          </p>
        </v-card-text>
        <v-card-actions class="px-4 pb-4 gap-2">
          <v-spacer />
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary px-1.5"
            @click="deleteDialog = false"
          >
            {{ $t("library.cancel") }}
          </v-btn>
          <v-btn
            variant="flat"
            size="small"
            color="error"
            rounded="0"
            class="text-[10px] tracking-[0.2em] uppercase px-1.5"
            :loading="deleting"
            @click="confirmDelete"
          >
            {{ $t("library.remove") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AppToast
      v-model="errorToast"
      :message="errorMessage"
      type="error"
      :timeout="4000"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useGuestStore } from "@/stores/guest";
import { useLocaleStore } from "@/stores/locale";
import { useApi } from "@/composables/useApi";
import { useDeleteScan } from "@/composables/useDeleteScan";
import { useScanStatus } from "@/composables/useScanStatus";
import {
  useLibrarySearch,
  cfIcon,
  type SuggestionFacet,
} from "@/composables/useLibrarySearch";
import { useLibraryGrouping } from "@/composables/useLibraryGrouping";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useDetailRoute } from "@/composables/useDetailRoute";
import { useGroupDimensions } from "@/composables/useGroupDimensions";
import { sortByCreatedAt } from "@/utils/book-display";
import type { Book, ReadStatus } from "@/types/book";
import type { GroupBy, SortOption } from "@/types/library";
import AppHeader from "@/components/AppHeader.vue";
import AppToast from "@/components/AppToast.vue";
import AppFooter from "@/components/AppFooter.vue";
import LibraryRowCard from "@/components/LibraryRowCard.vue";
import LibraryCoverCard from "@/components/LibraryCoverCard.vue";
import LibraryGhostRow from "@/components/LibraryGhostRow.vue";
import LibraryDisplaySettings from "@/components/LibraryDisplaySettings.vue";
import LibraryGroupTabs from "@/components/LibraryGroupTabs.vue";
import AppSelect from "@/components/AppSelect.vue";
import BookDetail from "@/components/BookDetail.vue";
import AppPagination from "@/components/AppPagination.vue";
import { useLibraryDefaultsStore } from "@/stores/libraryDefaults";
import { useDisplay } from "vuetify";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const guestStore = useGuestStore();
const localeStore = useLocaleStore();
const { apiFetch } = useApi();
const { setStatus: applyStatus, cycleStatus: applyCycle } = useScanStatus();
const fieldDefsStore = useFieldDefsStore();
const libraryDefaultsStore = useLibraryDefaultsStore();
const {
  detailIsbn,
  openDetail: openDetailRoute,
  closeDetail,
} = useDetailRoute();
const { groupOptions, customFieldMetas } = useGroupDimensions();

const isGuest = computed(() => !authStore.isAuthenticated);

// ── State ─────────────────────────────────────────────────────────────────────

const serverBooks = ref<Book[]>([]);
const loading = ref(false);
const error = ref("");

const search = ref("");
const groupBy = computed({
  get: () => libraryDefaultsStore.groupBy,
  set: (v) => libraryDefaultsStore.setGroupBy(v),
});
const sortDirection = computed({
  get: () => libraryDefaultsStore.sortDirection,
  set: (v) => libraryDefaultsStore.setSortDirection(v),
});
const viewMode = computed({
  get: () => libraryDefaultsStore.defaultView,
  set: (v) => libraryDefaultsStore.setView(v),
});
const searchRef = ref<HTMLInputElement | null>(null);

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
  useLibrarySearch({ books: allBooks, search, customFieldMetas, statusOf });

// Filtered and sorted — used by tile view and all non-series groupings.
const filteredBooks = computed<Book[]>(() =>
  sortByCreatedAt(baseFiltered.value, sortDirection.value),
);

const { allGroups } = useLibraryGrouping({
  baseFiltered,
  filteredBooks,
  groupBy,
  sortDirection,
  statusOf,
});

// ── Display settings (persisted) ───────────────────────────────────────────────
const mainOnly = computed({
  get: () => libraryDefaultsStore.mainOnly,
  set: (v) => libraryDefaultsStore.setMainOnly(v),
});
const highlightComplete = computed({
  get: () => libraryDefaultsStore.highlightComplete,
  set: (v) => libraryDefaultsStore.setHighlightComplete(v),
});
const showUnowned = computed({
  get: () => libraryDefaultsStore.showUnowned,
  set: (v) => libraryDefaultsStore.setShowUnowned(v),
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
  sortDirection.value = v === "none" ? "desc" : "asc";
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

// Series membership for grouped-by-series shelves (unowned reveal + completeness)
type SeriesEntry = {
  work_id: number;
  ordinal: number | null;
  title: string | null;
  owned: number;
  isbn: string | null;
  cover_url: string | null;
  scan_id: number | null;
};
const seriesMemberships = ref<
  Record<number, { id: number; name: string | null; entries: SeriesEntry[] }>
>({});

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

const errorToast = ref(false);
const errorMessage = ref("");

let fetchSeq = 0;

const perPage = ref<string>(String(libraryDefaultsStore.defaultPageSize));

const PAGE_SIZE_OPTIONS = [
  { value: "12", label: "12" },
  { value: "24", label: "24" },
  { value: "48", label: "48" },
  { value: "96", label: "96" },
  { value: "10000", label: t("library.per_page_all") },
];

// ── Autocomplete ──────────────────────────────────────────────────────────────

const searchFocused = ref(false);
const activeIndex = ref(-1);
const tokenSelecting = ref(false);
const showAllPrefixes = ref(false);
const CORE_PREFIX_KEYS = new Set(["status", "author", "genre", "series"]);

type SuggestionPrefix = {
  kind: "prefix";
  token: string;
  icon: string;
  label: string;
  typeLabel: string;
};
type SuggestionBook = {
  kind: "book";
  book: Book;
  icon: string;
  label: string;
  typeLabel: string;
  token: "";
};
type SuggestionExpand = {
  kind: "expand";
  token: string;
  icon: string;
  label: string;
  typeLabel: string;
};
type Suggestion =
  | SuggestionPrefix
  | SuggestionFacet
  | SuggestionBook
  | SuggestionExpand;

// ── Autocomplete prefix chips ───────────────────────────────────────────────────

const PREFIXES = computed(() => [
  {
    key: "status",
    icon: "mdi-progress-check",
    label: t("library.filter_status"),
  },
  {
    key: "author",
    icon: "mdi-account-outline",
    label: t("library.group_author"),
  },
  { key: "genre", icon: "mdi-tag-outline", label: t("library.group_genre") },
  { key: "series", icon: "mdi-bookshelf", label: t("library.group_series") },
  { key: "publisher", icon: "mdi-domain", label: t("library.group_publisher") },
  {
    key: "language",
    icon: "mdi-translate",
    label: t("library.group_language"),
  },
  {
    key: "award",
    icon: "mdi-trophy-outline",
    label: t("library.filter_awards"),
  },
  { key: "form", icon: "mdi-text-box-outline", label: t("library.group_form") },
  { key: "country", icon: "mdi-earth", label: t("library.group_country") },
  { key: "year", icon: "mdi-calendar-range", label: t("library.group_year") },
  {
    key: "subject",
    icon: "mdi-lightbulb-outline",
    label: t("library.group_subject"),
  },
  {
    key: "location",
    icon: "mdi-map-marker-outline",
    label: t("library.group_location"),
  },
  ...customFieldMetas.value
    .filter((m) => m.def.type !== "date" && m.def.type !== "integer")
    .map((m) => ({ key: m.slug, icon: cfIcon(m.def.type), label: m.def.name })),
]);

// ── Search highlight overlay ───────────────────────────────────────────────────

const HIGHLIGHT_PATTERN = computed(
  () => `((?:${[...knownKeys.value].join("|")}):)("(?:[^"]*)"?|\\S*)`,
);

interface SearchSegment {
  text: string;
  role: "key" | "plain";
}

// Keys whose handling doesn't affect the current text selection
const PRESERVES_SELECTION = new Set([
  "ArrowUp",
  "ArrowDown",
  "Tab",
  "Escape",
  "Shift",
  "Control",
  "Alt",
  "Meta",
]);

const searchSegments = computed<SearchSegment[]>(() => {
  const s = search.value;
  if (!s) return [];
  const re = new RegExp(HIGHLIGHT_PATTERN.value, "gi");
  const segments: SearchSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const [, key, val] = m;
    if (m.index > last)
      segments.push({ text: s.slice(last, m.index), role: "plain" });
    segments.push({ text: key, role: "key" });
    if (val) segments.push({ text: val, role: "plain" });
    last = re.lastIndex;
  }
  if (last < s.length) segments.push({ text: s.slice(last), role: "plain" });
  return segments;
});

const searchScrollLeft = ref(0);

// The trailing chunk the user is currently typing (after the last complete token)
const searchFragment = computed(() => {
  const s = search.value;
  // Find where the last *committed* structured token ends (key:value with a non-empty value).
  // Everything after that is the trailing fragment the user is still building (may contain spaces).
  const re = /\S+:"[^"]*"|"[^"]*"|\S+/g;
  let lastStructuredEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const part = m[0];
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).toLowerCase();
      const val = part
        .slice(colonIdx + 1)
        .replace(/^"|"$/g, "")
        .toLowerCase();
      if (knownKeys.value.has(key) && val)
        lastStructuredEnd = m.index + part.length;
    }
  }
  return s.slice(lastStructuredEnd).replace(/^\s+/, "");
});

const suggestions = computed<Suggestion[]>(() => {
  const frag = searchFragment.value.trim().toLowerCase();
  const titleLabel = t("library.facet_title");

  if (!frag) {
    // Empty/idle → show prefix chips, collapsed to the core set until expanded
    const list = showAllPrefixes.value
      ? PREFIXES.value
      : PREFIXES.value.filter((p) => CORE_PREFIX_KEYS.has(p.key));
    const chips: Suggestion[] = list.map((p) => ({
      kind: "prefix" as const,
      token: `${p.key}:`,
      icon: p.icon,
      label: p.label,
      typeLabel: p.label,
    }));
    if (!showAllPrefixes.value) {
      const remaining = PREFIXES.value.length - CORE_PREFIX_KEYS.size;
      chips.push({
        kind: "expand",
        token: t("library.search_show_more", { n: remaining }),
        icon: "mdi-dots-horizontal",
        label: t("library.search_show_more", { n: remaining }),
        typeLabel: "",
      });
    }
    return chips;
  }

  const results: Suggestion[] = [];
  const MAX = 8;

  // Typing inside a known key: eg "author:pyn"
  const matchedPrefix = PREFIXES.value.find((p) =>
    frag.startsWith(`${p.key}:`),
  );
  if (matchedPrefix) {
    const val = frag.slice(matchedPrefix.key.length + 1);
    const filtered = facetEntries.value
      .filter(
        (e) =>
          e.token.startsWith(`${matchedPrefix.key}:`) &&
          e.label.toLowerCase().includes(val),
      )
      .slice(0, MAX);
    return filtered.length
      ? filtered
      : [
          {
            kind: "facet",
            token: `${matchedPrefix.key}:`,
            icon: matchedPrefix.icon,
            label: t("library.search_no_matches"),
            typeLabel: matchedPrefix.label,
          },
        ];
  }

  // Free typing: match prefix words, facet values, and titles
  for (const p of PREFIXES.value) {
    if (p.key.startsWith(frag) || p.label.toLowerCase().startsWith(frag)) {
      results.push({
        kind: "prefix",
        token: `${p.key}:`,
        icon: p.icon,
        label: p.label,
        typeLabel: p.label,
      });
    }
  }
  for (const e of facetEntries.value) {
    if (e.label.toLowerCase().includes(frag)) {
      results.push(e);
      if (results.length >= MAX) break;
    }
  }
  if (results.length < MAX) {
    for (const b of baseFiltered.value) {
      if (b.title?.toLowerCase().includes(frag)) {
        results.push({
          kind: "book",
          book: b,
          icon: "mdi-book-outline",
          label: b.title!,
          typeLabel: titleLabel,
          token: "",
        });
        if (results.length >= MAX) break;
      }
    }
  }
  return results;
});

const dropdownHeading = computed(() => {
  const frag = searchFragment.value.trim().toLowerCase();
  if (!frag) return t("library.search_refine");
  const pm = PREFIXES.value.find((p) => frag.startsWith(`${p.key}:`));
  if (pm) return t("library.search_values", { facet: pm.label });
  return t("library.search_matches");
});

function applySuggestion(s: Suggestion) {
  if (s.kind === "book") {
    openDetail(s.book);
    searchFocused.value = false;
    return;
  }
  if (s.kind === "expand") {
    showAllPrefixes.value = true;
    return;
  }
  const head = search.value.slice(
    0,
    search.value.length - searchFragment.value.length,
  );
  if (s.kind === "prefix") {
    search.value = head + s.token;
  } else {
    search.value = head + s.token + " ";
  }
  activeIndex.value = -1;
  searchRef.value?.focus();
}

function onSearchBarClick() {
  searchRef.value?.focus();
  searchFocused.value = true;
}

function onSearchBlur() {
  searchFocused.value = false;
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!PRESERVES_SELECTION.has(e.key)) tokenSelecting.value = false;
  if (e.key === "Backspace") {
    const el = searchRef.value;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    // If there's already a selection, let the browser delete it
    if (selectionStart !== selectionEnd) return;
    const cursor = selectionStart ?? 0;
    // Only intercept when cursor is at the very end
    if (cursor !== search.value.length) return;
    const s = search.value;
    // Skip trailing spaces to figure out what to select
    let contentEnd = cursor;
    while (contentEnd > 0 && s[contentEnd - 1] === " ") contentEnd--;
    if (contentEnd === 0) return;
    const char = s[contentEnd - 1];
    let selectStart: number;
    if (char === '"') {
      // Closing quote → select the quoted value ("…")
      const openQuote = s.lastIndexOf('"', contentEnd - 2);
      selectStart = openQuote !== -1 ? openQuote : contentEnd - 1;
    } else if (char === ":") {
      // Bare key: → select the entire key:
      let i = contentEnd - 1;
      while (i > 0 && s[i - 1] !== " ") i--;
      selectStart = i;
    } else {
      // Plain text or unquoted value — find the chunk since the last space
      const lastSpace = s.lastIndexOf(" ", contentEnd - 1);
      const chunkStart = lastSpace === -1 ? 0 : lastSpace + 1;
      const chunk = s.slice(chunkStart, contentEnd);
      const colonIdx = chunk.indexOf(":");
      if (
        colonIdx > 0 &&
        knownKeys.value.has(chunk.slice(0, colonIdx).toLowerCase())
      ) {
        // Known key:value → select only the value, leaving key: intact
        selectStart = chunkStart + colonIdx + 1;
      } else {
        // Plain word or unknown token → select the whole chunk
        selectStart = chunkStart;
      }
    }
    e.preventDefault();
    el.setSelectionRange(selectStart, cursor);
    tokenSelecting.value = true;
    return;
  }
  if (e.key === "Escape") {
    if (searchFocused.value) {
      searchFocused.value = false;
      e.preventDefault();
    } else {
      search.value = "";
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const len = suggestions.value.length;
    activeIndex.value =
      activeIndex.value >= len - 1 ? 0 : activeIndex.value + 1;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    const len = suggestions.value.length;
    activeIndex.value =
      activeIndex.value <= 0 ? len - 1 : activeIndex.value - 1;
    return;
  }
  if (e.key === "Enter") {
    if (activeIndex.value >= 0 && suggestions.value[activeIndex.value]) {
      e.preventDefault();
      applySuggestion(suggestions.value[activeIndex.value]);
    } else {
      searchFocused.value = false;
    }
    return;
  }
  // Reset keyboard nav on any other key
  activeIndex.value = -1;
}

// Reset activeIndex when suggestions change
watch(suggestions, () => {
  activeIndex.value = -1;
});

// Collapse the idle prefix chips back down once the user starts typing again
watch(searchFragment, (frag) => {
  if (frag) showAllPrefixes.value = false;
});

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

interface ShelfEntry {
  key: string;
  title: string | null;
  cover_url: string | null;
  ordinal: number | null;
  owned: boolean;
  status?: ReadStatus;
  author?: string | null;
  book?: Book;
  seriesId?: number | null;
}

interface ShelfGroup {
  key: string;
  label: string;
  seriesId?: number | null;
  complete: boolean;
  countLabel: string;
  entries: ShelfEntry[];
}

const bookById = computed(() => {
  const m = new Map<number, Book>();
  for (const b of allBooks.value) m.set(b.id, b);
  return m;
});

const bookToEntry = (b: Book): ShelfEntry => ({
  key: `b${b.id}`,
  title: b.title || b.isbn,
  cover_url: b.cover_url ?? null,
  ordinal: b.series_ordinal ?? null,
  owned: true,
  status: b.status,
  author: b.author,
  book: b,
  seriesId: b.series_id ?? null,
});

const shelfGroups = computed<ShelfGroup[]>(() =>
  allGroups.value.map((g): ShelfGroup => {
    // Series group with full membership → counts + completeness + unowned reveal.
    if (g.seriesId != null && seriesMemberships.value[g.seriesId]) {
      const members = seriesMemberships.value[g.seriesId].entries;
      const mainMembers = members.filter(
        (e) => e.ordinal != null && Number.isInteger(e.ordinal),
      );
      const ownedTotal = members.filter((e) => e.owned).length;
      const ownedMain = mainMembers.filter((e) => e.owned).length;
      const denom = mainOnly.value ? mainMembers.length : members.length;
      const numer = mainOnly.value ? ownedMain : ownedTotal;
      const complete = highlightComplete.value && denom > 0 && numer === denom;
      const pool = mainOnly.value ? mainMembers : members;
      const visible = showUnowned.value ? pool : pool.filter((e) => e.owned);
      const entries: ShelfEntry[] = visible.map((e) => {
        const book =
          e.scan_id != null ? bookById.value.get(e.scan_id) : undefined;
        return {
          key: `m${e.work_id}`,
          title: e.title,
          cover_url: book?.cover_url ?? e.cover_url ?? null,
          ordinal: e.ordinal,
          owned: !!e.owned,
          status: book?.status,
          author: book?.author ?? null,
          book,
          seriesId: g.seriesId,
        };
      });
      return {
        key: g.key,
        label: g.label,
        seriesId: g.seriesId,
        complete,
        countLabel: `${numer} / ${denom}`,
        entries,
      };
    }
    // Series fallback (membership not loaded yet) — owned-only against series_total.
    if (g.seriesId != null) {
      const total = g.seriesTotal ?? g.books.length;
      const complete =
        highlightComplete.value && total > 0 && g.books.length === total;
      return {
        key: g.key,
        label: g.label,
        seriesId: g.seriesId,
        complete,
        countLabel: `${g.books.length} / ${total}`,
        entries: g.books.map((b) => bookToEntry(b)),
      };
    }
    // Non-series groups (author/genre/standalone/…): plain count.
    return {
      key: g.key,
      label: g.label,
      seriesId: g.seriesId ?? null,
      complete: false,
      countLabel: String(g.books.length),
      entries: g.books.map((b) => bookToEntry(b)),
    };
  }),
);

const pagedGroups = computed<ShelfGroup[]>(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return shelfGroups.value.slice(start, start + pageSize.value);
});

// Collapsed shelves show one row; expanded show everything.
// While a search is active, always show all matches — no collapsing.
const hasActiveSearch = computed(() => search.value.trim().length > 0);
const shelfVisible = (g: ShelfGroup): ShelfEntry[] =>
  hasActiveSearch.value || expanded.value[g.key]
    ? g.entries
    : g.entries.slice(0, shelfRowSize.value);
const shelfTotal = (g: ShelfGroup): number => g.entries.length;
const shelfHasMore = (g: ShelfGroup): boolean =>
  !hasActiveSearch.value && shelfTotal(g) > shelfRowSize.value;

function onEntrySelect(entry: ShelfEntry) {
  if (entry.book) openDetail(entry.book);
  else if (entry.seriesId != null) router.push(`/series/${entry.seriesId}`);
}

// ── ⌘K keyboard shortcut ─────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    searchRef.value?.focus();
    searchRef.value?.select();
  }
}
onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

// ── Data fetching ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 500;
// Hard ceiling so a pagination/sort-stability bug (pages that never shrink below PAGE_SIZE)
// can't spin the loop forever — 40 pages is 20,000 books, far beyond any real library.
const MAX_PAGES = 40;

const fetchBooks = async () => {
  const seq = ++fetchSeq;
  try {
    const allBooks: Book[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await apiFetch(
        `/api/scans?limit=${PAGE_SIZE}&offset=${offset}&locale=${localeStore.locale}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch books");
      if (seq !== fetchSeq) return;
      allBooks.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    serverBooks.value = allBooks;
    statusOverrides.value.clear();
  } catch (err: any) {
    if (seq !== fetchSeq) return;
    error.value = err.message;
  }
};

// Full series membership (incl. unowned entries) for the grouped-by-series shelves.
// Failure here is non-fatal: shelves fall back to owned-only counts.
const fetchMemberships = async () => {
  try {
    const res = await apiFetch(`/api/series?locale=${localeStore.locale}`);
    if (!res.ok) return;
    seriesMemberships.value = await res.json();
  } catch {
    /* non-fatal */
  }
};

// ── Status cycling ────────────────────────────────────────────────────────────

const notifyStatusError = () => {
  errorMessage.value = t("library.error_update_status");
  errorToast.value = true;
};

const cycleStatus = (book: Book) => {
  pinStatus(book);
  return applyCycle(book).catch(notifyStatusError);
};

const setStatus = (book: Book, newStatus: ReadStatus) => {
  pinStatus(book);
  return applyStatus(book, newStatus).catch(notifyStatusError);
};

// ── Detail & delete ───────────────────────────────────────────────────────────

const openDetail = (book: Book) => {
  selectedBook.value = book;
  openDetailRoute(book.isbn);
};

// Resolve selectedBook from the URL (handles Back/Forward and deep links)
watch(
  [detailIsbn, allBooks],
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

onMounted(async () => {
  if (authStore.isAuthenticated) {
    loading.value = true;
    await Promise.all([
      fetchBooks(),
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
    await Promise.all([fetchBooks(), fetchMemberships()]);
    loading.value = false;
  },
);
</script>

<style scoped>
/* Orange selection highlight when a whole token was selected via backspace */
input.token-selecting::selection {
  background-color: rgba(255, 102, 0, 0.35);
}
</style>
