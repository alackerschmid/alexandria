<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="mode === 'full'"
    :max-width="mode === 'card' ? 560 : undefined"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- ── CARD MODE ─────────────────────────────────────────────────────── -->
    <template v-if="mode === 'card'">
      <div
        class="bg-charcoal-light border border-charcoal-border flex flex-col"
      >
        <!-- header: cover + meta -->
        <div class="flex gap-5 p-7">
          <!-- cover -->
          <div class="w-24 h-36 shrink-0 relative overflow-hidden">
            <img
              v-if="book.cover_url"
              :src="book.cover_url"
              :alt="book.title || book.isbn"
              class="w-full h-full object-cover"
            />
            <PlaceholderCover
              v-else
              :title="book.title || book.isbn"
              text-class="text-2xl"
              :icon-size="18"
            />
          </div>

          <!-- meta -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-3">
              <h2
                class="font-heading font-bold text-2xl text-text-primary leading-tight mb-1 flex items-center gap-1.5"
              >
                {{ book.title || book.isbn }}
                <OverrideDot
                  v-if="book.title_overridden"
                  class="w-1.5 h-1.5 shrink-0"
                />
              </h2>
              <button
                class="shrink-0 text-text-secondary/50 hover:text-text-secondary transition-colors pt-0.5"
                :aria-label="$t('detail.close')"
                @click="$emit('update:modelValue', false)"
              >
                <v-icon icon="mdi-close" size="18" />
              </button>
            </div>

            <AuthorChips :book="book" @select="filterBy('author', $event)" />

            <!-- series label -->
            <button
              v-if="book.series_id"
              class="flex items-center gap-1.5 text-[10px] tracking-[0.14em] uppercase text-text-secondary/70 hover:text-orange-neon transition-colors mb-3"
              @click="goToSeries"
            >
              <span class="text-orange-neon">♦</span>
              {{ book.series_name || $t("detail.series")
              }}{{
                book.series_ordinal != null
                  ? ` · ${$t("detail.series_position", { n: book.series_ordinal })}`
                  : ""
              }}
            </button>
            <span
              v-else-if="book.enrichment_status === 'done'"
              class="flex items-center text-[10px] tracking-[0.14em] uppercase text-text-secondary/40 mb-3"
            >
              {{ $t("detail.standalone") }}
            </span>

            <!-- status pill -->
            <button
              v-if="!readonly"
              class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase font-medium transition-colors"
              :class="STATUS_CONFIG[book.status].textClass"
              @click="$emit('cycle-status')"
            >
              <span
                class="w-1.5 h-1.5 rounded-full shrink-0"
                :class="STATUS_CONFIG[book.status].dotClass"
              />
              {{ STATUS_CONFIG[book.status].label }}
            </button>
            <span
              v-else
              class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-text-secondary/50"
            >
              <span
                class="w-1.5 h-1.5 rounded-full shrink-0 bg-charcoal-border"
              />
              {{ STATUS_CONFIG[book.status].label }}
            </span>

            <!-- enrichment indicator -->
            <EnrichmentBadge
              class="mt-1.5"
              :status="book.enrichment_status"
              :guest="guest"
              :readonly="readonly"
            />
          </div>
        </div>

        <!-- synopsis snippet -->
        <div
          v-if="book.description"
          class="border-t border-charcoal-border px-7 py-5"
        >
          <p
            class="text-[13px] leading-relaxed text-text-secondary line-clamp-3"
          >
            {{ book.description }}
          </p>
          <!-- <button
            class="mt-3 text-[10px] tracking-[0.16em] uppercase text-orange-neon hover:opacity-70 transition-opacity"
            @click="expand"
          >
            {{ $t('detail.show_more') }} →
          </button> -->
        </div>

        <!-- quick facts -->
        <div class="grid grid-cols-3 border-t border-charcoal-border">
          <div class="py-4 px-3 text-center border-r border-charcoal-border">
            <div
              class="font-heading font-bold text-xl text-text-primary leading-none"
            >
              {{ publishYear }}
            </div>
            <div
              class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2"
            >
              {{ $t("detail.published") }}
            </div>
          </div>
          <div class="py-4 px-3 text-center border-r border-charcoal-border">
            <div
              v-if="book.number_of_pages_median"
              class="font-heading font-bold text-xl text-text-primary leading-none"
            >
              {{ book.number_of_pages_median }}
            </div>
            <v-tooltip
              v-else-if="book.reference_page_count"
              location="top"
              max-width="260"
              :text="$t('detail.reference_pages_tooltip')"
            >
              <template #activator="{ props: tooltipProps }">
                <div
                  v-bind="tooltipProps"
                  class="font-heading font-bold text-xl text-text-primary/70 leading-none cursor-help"
                >
                  ≈{{ book.reference_page_count }}
                </div>
              </template>
            </v-tooltip>
            <div
              v-else
              class="font-heading font-bold text-xl text-text-primary leading-none"
            >
              —
            </div>
            <div
              class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2"
            >
              {{ $t("detail.pages") }}
            </div>
          </div>
          <div class="py-4 px-3 text-center overflow-hidden min-w-0">
            <button
              v-if="book.genres?.length"
              class="block w-full font-heading font-bold text-xl text-text-primary leading-none truncate hover:text-orange-neon transition-colors"
              @click="filterBy('genre', book.genres[0])"
            >
              {{ firstGenre }}
            </button>
            <div
              v-else
              class="block w-full font-heading font-bold text-xl text-text-primary leading-none truncate"
            >
              {{ firstGenre }}
            </div>
            <div
              class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2"
            >
              {{ $t("detail.genres") }}
            </div>
          </div>
        </div>

        <!-- footer -->
        <div
          class="border-t border-charcoal-border flex items-center justify-between px-5 py-4 bg-charcoal/30"
        >
          <button
            class="flex items-center gap-2 bg-orange-neon px-5 py-3 text-[12px] tracking-[0.14em] uppercase font-bold hover:opacity-90 transition-opacity"
            style="color: #111110"
            @click="expand"
          >
            {{ $t("detail.expand") }}
            <v-icon icon="mdi-arrow-expand" size="14" style="color: #111110" />
          </button>
          <button
            class="text-[11px] tracking-[0.16em] uppercase text-text-secondary hover:text-text-primary transition-colors"
            @click="$emit('update:modelValue', false)"
          >
            {{ $t("detail.close") }}
          </button>
        </div>
      </div>
    </template>

    <!-- ── FULL MODE ──────────────────────────────────────────────────────── -->
    <template v-else>
      <div class="bg-charcoal flex flex-col h-dvh">
        <!-- sticky top bar -->
        <div
          class="shrink-0 flex items-center justify-between px-6 md:px-10 py-4 border-b border-charcoal-border bg-charcoal z-10"
        >
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
            <template v-if="!editing">
              <button
                v-if="!guest && !readonly"
                class="text-text-secondary/50 hover:text-text-secondary transition-colors"
                :aria-label="$t('detail.edit')"
                @click="enterEdit"
              >
                <v-icon icon="mdi-pencil-outline" size="18" />
              </button>
              <button
                v-if="!guest && !readonly"
                class="transition-colors disabled:opacity-30"
                :class="enrichmentButtonClass"
                :disabled="refreshing"
                :aria-label="
                  refreshing ? $t('detail.loading') : $t('detail.refresh')
                "
                @click="refresh"
              >
                <v-icon
                  icon="mdi-refresh"
                  size="18"
                  :class="refreshing ? 'animate-spin' : ''"
                />
              </button>
              <button
                v-if="!readonly"
                class="text-error/60 hover:text-error transition-colors"
                :aria-label="$t('detail.remove')"
                @click="$emit('delete')"
              >
                <v-icon icon="mdi-delete-outline" size="18" />
              </button>
            </template>
            <template v-else>
              <button
                class="text-text-secondary/50 hover:text-text-secondary transition-colors"
                :aria-label="$t('detail.edit_cancel')"
                @click="editing = false"
              >
                <v-icon icon="mdi-close" size="18" />
              </button>
            </template>
            <button
              class="text-text-secondary/50 hover:text-text-secondary transition-colors ml-1"
              :aria-label="$t('detail.close')"
              @click="$emit('update:modelValue', false)"
            >
              <v-icon icon="mdi-close" size="20" />
            </button>
          </div>
        </div>

        <!-- scrollable body -->
        <div class="flex-1 overflow-y-auto">
          <!-- view mode -->
          <template v-if="!editing">
            <div
              class="w-full md:max-w-[66.6667%] mx-auto px-6 md:px-10 py-10 md:py-14 flex flex-col md:flex-row items-start gap-10 lg:gap-14"
            >
              <!-- cover column (desktop only) -->
              <div
                class="hidden md:flex md:w-56 lg:w-64 shrink-0 flex-col items-center pt-2"
              >
                <div class="w-48 h-72 relative">
                  <img
                    v-if="book.cover_url"
                    :src="book.cover_url"
                    :alt="book.title || book.isbn"
                    class="w-full h-full object-cover shadow-2xl"
                  />
                  <PlaceholderCover
                    v-else
                    :title="book.title || book.isbn"
                    text-class="text-5xl"
                    :icon-size="28"
                    class="shadow-2xl"
                  />
                </div>

                <!-- edition details (desktop) -->
                <EditionDetails :book="book" class="w-full mt-6" />

                <!-- other editions -->
                <button
                  v-if="book.work_id"
                  class="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-text-secondary hover:text-text-primary transition-colors"
                  @click="editionsDialogOpen = true"
                >
                  <v-icon icon="mdi-book-multiple-outline" size="14" />
                  {{ $t("detail.view_editions") }}
                </button>
              </div>

              <!-- main column + sidebar -->
              <div
                class="flex-1 min-w-0 w-full flex flex-col lg:flex-row items-start gap-10 lg:gap-14"
              >
                <!-- main column -->
                <div class="flex-1 min-w-0 w-full">
                  <!-- title -->
                  <h1
                    class="font-heading font-bold text-3xl md:text-5xl text-text-primary leading-tight tracking-tight mb-3 flex items-start gap-2"
                  >
                    {{ book.title || book.isbn }}
                    <OverrideDot
                      v-if="book.title_overridden"
                      class="w-2 h-2 shrink-0 mt-2"
                    />
                  </h1>

                  <!-- series (moved between title and author) -->
                  <button
                    v-if="book.series_id"
                    class="flex items-center gap-1.5 text-[11px] tracking-[0.14em] uppercase text-text-secondary/70 hover:text-orange-neon transition-colors mb-3"
                    @click="goToSeries"
                  >
                    <v-icon icon="mdi-bookshelf" size="12" />
                    {{ book.series_name || $t("detail.series")
                    }}{{
                      book.series_ordinal != null
                        ? ` · ${$t("detail.series_position", { n: book.series_ordinal })}`
                        : ""
                    }}
                  </button>
                  <span
                    v-else-if="book.enrichment_status === 'done'"
                    class="flex items-center text-[11px] tracking-[0.14em] uppercase text-text-secondary/40 mb-3"
                  >
                    {{ $t("detail.standalone") }}
                  </span>

                  <!-- author -->
                  <AuthorChips
                    :book="book"
                    size="expanded"
                    @select="filterBy('author', $event)"
                  />

                  <!-- enrichment status (full view) -->
                  <EnrichmentBadge
                    class="mb-6 -mt-4"
                    :status="book.enrichment_status"
                    :guest="guest"
                    :readonly="readonly"
                    :icon-size="11"
                  />

                  <!-- synopsis -->
                  <div v-if="book.description" class="mb-10">
                    <div
                      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3 flex items-center gap-1.5"
                    >
                      {{ $t("detail.description") }}
                      <OverrideDot
                        v-if="book.description_overridden"
                        class="w-1.5 h-1.5"
                      />
                    </div>
                    <p class="text-[15px] leading-relaxed text-text-secondary">
                      {{ book.description }}
                    </p>
                  </div>

                  <!-- genres (moved below description) -->
                  <div v-if="book.genres?.length" class="mb-10">
                    <div
                      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3"
                    >
                      {{ $t("detail.genres") }}
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-2">
                      <button
                        v-for="genre in book.genres"
                        :key="genre"
                        class="text-[10px] tracking-[0.3em] uppercase font-bold text-orange-neon hover:opacity-70 transition-opacity"
                        @click="filterBy('genre', genre)"
                      >
                        {{ genre }}
                      </button>
                    </div>
                  </div>

                  <!-- first line -->
                  <div v-if="book.first_line" class="mb-10">
                    <div
                      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3"
                    >
                      {{ $t("detail.first_line") }}
                    </div>
                    <p
                      class="text-[14px] leading-relaxed text-text-secondary italic border-l-2 border-charcoal-border pl-4"
                    >
                      {{ book.first_line }}
                    </p>
                  </div>

                  <!-- epigraph -->
                  <div v-if="book.epigraph" class="mb-10">
                    <div
                      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3"
                    >
                      {{ $t("detail.epigraph") }}
                    </div>
                    <p
                      class="text-[14px] leading-relaxed text-text-secondary italic border-l-2 border-charcoal-border pl-4"
                    >
                      {{ book.epigraph }}
                    </p>
                  </div>

                  <!-- edition details (mobile only; desktop shows this under the cover) -->
                  <EditionDetails :book="book" class="md:hidden" />

                  <EditionsDialog
                    v-model="editionsDialogOpen"
                    :book="book"
                    :guest="guest"
                    :readonly="readonly"
                    @refreshed="$emit('refreshed', $event)"
                  />
                </div>

                <!-- sidebar: your record -->
                <div
                  class="w-full lg:w-80 shrink-0 border border-charcoal-border p-7"
                >
                  <div
                    class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-5"
                  >
                    {{ $t("detail.your_record") }}
                  </div>

                  <!-- status picker -->
                  <div
                    v-if="!readonly"
                    class="pb-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-3"
                    >
                      {{ $t("library.filter_status") }}
                    </div>
                    <div
                      class="relative flex w-full rounded-full p-1"
                      style="background: rgba(255, 255, 255, 0.045)"
                      role="radiogroup"
                      :aria-label="$t('library.filter_status')"
                    >
                      <div
                        class="absolute top-1 bottom-1 rounded-full transition-[left] duration-200 ease-out"
                        :style="statusThumbStyle"
                      />
                      <button
                        v-for="s in STATUS_ORDER"
                        :key="s"
                        type="button"
                        role="radio"
                        :aria-checked="book.status === s"
                        class="relative z-10 flex-1 py-2 text-[10px] tracking-[0.13em] uppercase font-semibold transition-colors"
                        :class="
                          book.status !== s
                            ? 'text-text-secondary/60 hover:text-text-secondary'
                            : ''
                        "
                        :style="
                          book.status === s
                            ? { color: STATUS_META[s].color }
                            : ''
                        "
                        @click="$emit('set-status', s)"
                      >
                        {{ statusLabels[s] }}
                      </button>
                    </div>
                  </div>

                  <!-- owning status picker -->
                  <div
                    v-if="!readonly"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-3"
                    >
                      {{ $t("owning.label") }}
                    </div>
                    <div
                      class="relative flex w-full rounded-full p-1"
                      style="background: rgba(255, 255, 255, 0.045)"
                      role="radiogroup"
                      :aria-label="$t('owning.label')"
                    >
                      <div
                        class="absolute top-1 bottom-1 rounded-full transition-[left] duration-200 ease-out"
                        :style="owningThumbStyle"
                      />
                      <button
                        v-for="s in OWNING_ORDER"
                        :key="s"
                        type="button"
                        role="radio"
                        :aria-checked="book.owning_status === s"
                        class="relative z-10 flex-1 py-2 text-[10px] tracking-[0.13em] uppercase font-semibold transition-colors"
                        :class="
                          book.owning_status !== s
                            ? 'text-text-secondary/60 hover:text-text-secondary'
                            : ''
                        "
                        :style="
                          book.owning_status === s
                            ? { color: OWNING_META[s].color }
                            : ''
                        "
                        @click="$emit('set-owning-status', s)"
                      >
                        {{ owningLabels[s] }}
                      </button>
                    </div>
                  </div>

                  <div class="pb-4 border-b border-charcoal-border/50">
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                    >
                      {{ $t("detail.added") }}
                    </div>
                    <div class="text-sm text-text-primary">
                      {{ formattedAdded }}
                    </div>
                  </div>

                  <!-- wikidata work metadata -->
                  <div
                    v-if="book.form_of_work"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                    >
                      {{ $t("detail.form_of_work") }}
                    </div>
                    <button
                      class="text-sm text-text-primary hover:text-orange-neon transition-colors text-left"
                      :aria-label="
                        $t('detail.filter_by', {
                          field: $t('detail.form_of_work'),
                          value: book.form_of_work,
                        })
                      "
                      @click="filterBy('form', book.form_of_work!)"
                    >
                      {{ book.form_of_work }}
                    </button>
                  </div>
                  <div
                    v-if="book.language_of_work"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                    >
                      {{ $t("detail.language_of_work") }}
                    </div>
                    <button
                      class="text-sm text-text-primary hover:text-orange-neon transition-colors text-left"
                      :aria-label="
                        $t('detail.filter_by', {
                          field: $t('detail.language_of_work'),
                          value: book.language_of_work,
                        })
                      "
                      @click="
                        filterBy('original_language', book.language_of_work!)
                      "
                    >
                      {{ book.language_of_work }}
                    </button>
                  </div>
                  <div
                    v-if="book.main_subject"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                    >
                      {{ $t("detail.main_subject") }}
                    </div>
                    <div class="text-sm text-text-primary">
                      {{ book.main_subject }}
                    </div>
                  </div>
                  <div
                    v-if="book.narrative_locations?.length"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                    >
                      {{ $t("detail.narrative_locations") }}
                    </div>
                    <div
                      class="text-sm text-text-primary flex flex-wrap items-baseline gap-x-1.5"
                    >
                      <template
                        v-for="(loc, i) in book.narrative_locations"
                        :key="loc"
                      >
                        <button
                          class="hover:text-orange-neon transition-colors"
                          :aria-label="
                            $t('detail.filter_by', {
                              field: $t('detail.narrative_locations'),
                              value: loc,
                            })
                          "
                          @click="filterBy('location', loc)"
                        >
                          {{ loc }}</button
                        ><span
                          v-if="i < book.narrative_locations!.length - 1"
                          class="text-text-secondary/40"
                          >·</span
                        >
                      </template>
                    </div>
                  </div>
                  <div
                    v-if="book.countries_of_origin?.length"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <div
                      class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                    >
                      {{ $t("detail.countries_of_origin") }}
                    </div>
                    <div
                      class="text-sm text-text-primary flex flex-wrap items-baseline gap-x-1.5"
                    >
                      <template
                        v-for="(c, i) in book.countries_of_origin"
                        :key="c"
                      >
                        <button
                          class="hover:text-orange-neon transition-colors"
                          :aria-label="
                            $t('detail.filter_by', {
                              field: $t('detail.countries_of_origin'),
                              value: c,
                            })
                          "
                          @click="filterBy('country', c)"
                        >
                          {{ c }}</button
                        ><span
                          v-if="i < book.countries_of_origin!.length - 1"
                          class="text-text-secondary/40"
                          >·</span
                        >
                      </template>
                    </div>
                  </div>

                  <!-- awards & nominations (collapsed behind a count) -->
                  <div
                    v-if="book.awards?.length || book.nominations?.length"
                    class="py-4 border-b border-charcoal-border/50"
                  >
                    <button
                      class="w-full flex items-center justify-between gap-2 text-left"
                      :aria-expanded="recognitionExpanded"
                      @click="recognitionExpanded = !recognitionExpanded"
                    >
                      <span
                        class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60"
                      >
                        {{ $t("detail.recognition") }}
                      </span>
                      <span
                        class="flex items-center gap-1 text-[11px] font-mono text-text-secondary/60"
                      >
                        {{
                          (book.awards?.length ?? 0) +
                          (book.nominations?.length ?? 0)
                        }}
                        <v-icon
                          :icon="
                            recognitionExpanded
                              ? 'mdi-chevron-up'
                              : 'mdi-chevron-down'
                          "
                          size="14"
                        />
                      </span>
                    </button>
                    <div
                      v-if="recognitionExpanded"
                      class="mt-3 flex flex-col gap-3"
                    >
                      <div v-if="book.awards?.length">
                        <div
                          class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                        >
                          {{ $t("detail.awards") }}
                        </div>
                        <div
                          class="text-sm text-text-primary leading-relaxed flex flex-wrap items-baseline gap-x-1.5"
                        >
                          <template v-for="(a, i) in book.awards" :key="a">
                            <button
                              class="hover:text-orange-neon transition-colors text-left"
                              :aria-label="
                                $t('detail.filter_by', {
                                  field: $t('detail.awards'),
                                  value: a,
                                })
                              "
                              @click="filterBy('award', a)"
                            >
                              {{ a }}</button
                            ><span
                              v-if="i < book.awards!.length - 1"
                              class="text-text-secondary/40"
                              >·</span
                            >
                          </template>
                        </div>
                      </div>
                      <div v-if="book.nominations?.length">
                        <div
                          class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
                        >
                          {{ $t("detail.nominations") }}
                        </div>
                        <div
                          class="text-sm text-text-primary leading-relaxed flex flex-wrap items-baseline gap-x-1.5"
                        >
                          <template v-for="(a, i) in book.nominations" :key="a">
                            <button
                              class="hover:text-orange-neon transition-colors text-left"
                              :aria-label="
                                $t('detail.filter_by', {
                                  field: $t('detail.nominations'),
                                  value: a,
                                })
                              "
                              @click="filterBy('award', a)"
                            >
                              {{ a }}</button
                            ><span
                              v-if="i < book.nominations!.length - 1"
                              class="text-text-secondary/40"
                              >·</span
                            >
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- custom fields (always editable) -->
                  <CustomFieldsPanel
                    v-if="!readonly && !guest"
                    :book="book"
                    :guest="guest"
                    :readonly="readonly"
                    @refreshed="$emit('refreshed', $event)"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- edit mode -->
          <BookEditForm
            v-else
            v-model:form="form"
            :book="book"
            :save-error="saveError"
          />
        </div>

        <!-- edit mode footer -->
        <div
          v-if="editing"
          class="shrink-0 border-t border-charcoal-border flex justify-between items-center px-4 py-3 bg-charcoal"
        >
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            @click="editing = false"
          >
            {{ $t("detail.edit_cancel") }}
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            color="primary"
            class="text-[10px] tracking-[0.2em] uppercase"
            :loading="saving"
            @click="save"
          >
            {{ $t("detail.edit_save") }}
          </v-btn>
        </div>
      </div>
    </template>
  </v-dialog>
</template>

<script lang="ts" setup>
import { ref, watch, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "@/composables/useApi";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useLocaleStore } from "@/stores/locale";
import { BCP47 } from "@/plugins/i18n";
import {
  useBookStatus,
  STATUS_ORDER,
  STATUS_META,
} from "@/composables/useBookStatus";
import {
  useOwningStatus,
  OWNING_ORDER,
  OWNING_META,
} from "@/composables/useOwningStatus";
import { useEnrichmentPoll } from "@/composables/useEnrichmentPoll";
import { bookYear } from "@/utils/book-display";
import AuthorChips from "@/components/book-detail/AuthorChips.vue";
import EnrichmentBadge from "@/components/book-detail/EnrichmentBadge.vue";
import EditionsDialog from "@/components/book-detail/EditionsDialog.vue";
import EditionDetails from "@/components/book-detail/EditionDetails.vue";
import CustomFieldsPanel from "@/components/book-detail/CustomFieldsPanel.vue";
import PlaceholderCover from "@/components/PlaceholderCover.vue";
import BookEditForm, {
  type EditForm,
} from "@/components/book-detail/BookEditForm.vue";
import OverrideDot from "@/components/OverrideDot.vue";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";

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
  delete: [];
  refreshed: [updated: Partial<BookWithOverrides>];
}>();

const { apiFetch } = useApi();
const { statusConfig: STATUS_CONFIG, statusLabels } = useBookStatus();
const { owningLabels } = useOwningStatus();
const fieldDefsStore = useFieldDefsStore();
const localeStore = useLocaleStore();
const router = useRouter();

// ── Mode ──────────────────────────────────────────────────────────────────────

const mode = ref<"card" | "full">("card");
const editionsDialogOpen = ref(false);

function expand() {
  mode.value = "full";
}

// ── Computed helpers ──────────────────────────────────────────────────────────

const publishYear = computed(() => bookYear(props.book) || "—");

// Shared geometry for the segmented-picker thumb (reading status + owning status).
function segmentedThumbStyle(index: number, n: number, tint: string, color: string) {
  return {
    left: `calc(4px + ${index} * (100% - 8px) / ${n})`,
    width: `calc((100% - 8px) / ${n})`,
    background: tint,
    border: `1px solid ${color}`,
  };
}

const statusThumbStyle = computed(() => {
  const meta = STATUS_META[props.book.status];
  return segmentedThumbStyle(
    STATUS_ORDER.indexOf(props.book.status),
    STATUS_ORDER.length,
    meta.tint,
    meta.color,
  );
});

const owningThumbStyle = computed(() => {
  const status = props.book.owning_status ?? "owned";
  const meta = OWNING_META[status];
  return segmentedThumbStyle(
    OWNING_ORDER.indexOf(status),
    OWNING_ORDER.length,
    meta.tint,
    meta.color,
  );
});

const firstGenre = computed(() => props.book.genres?.[0] ?? "—");

const formattedAdded = computed(() => {
  if (!props.book.created_at) return "—";
  const loc = BCP47[localeStore.locale] ?? "en-GB";
  return new Date(props.book.created_at).toLocaleDateString(loc, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
});

// ── Edit state ────────────────────────────────────────────────────────────────

const descriptionExpanded = ref(false);
const refreshing = ref(false);
const recognitionExpanded = ref(false);
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

// ── Enrichment polling ────────────────────────────────────────────────────────

const { startEnrichmentPoll, clearPoll } = useEnrichmentPoll({
  isOpen: () => props.modelValue,
  scanId: () => props.book.id,
  status: () => props.book.enrichment_status,
  guest: () => !!props.guest,
  readonly: () => !!props.readonly,
  onResolved: (data) => emit("refreshed", data as Partial<BookWithOverrides>),
});

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

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(
  () => props.book.isbn,
  () => {
    mode.value = "card";
    descriptionExpanded.value = false;
    recognitionExpanded.value = false;
    editing.value = false;
    if (props.modelValue) startEnrichmentPoll();
  },
);

watch(
  () => props.modelValue,
  (val) => {
    if (!val) {
      mode.value = "card";
      editing.value = false;
      clearPoll();
    } else {
      startEnrichmentPoll();
    }
  },
);

onMounted(() => {
  if (!props.guest && !props.readonly) fieldDefsStore.load();
});

function enterEdit() {
  form.value.title = props.book.title ?? "";
  form.value.cover_url = props.book.cover_url ?? "";
  form.value.language = props.book.language ?? "";
  form.value.publish_date = props.book.publish_date ?? "";
  form.value.number_of_pages_median = props.book.number_of_pages_median ?? null;
  form.value.description = props.book.description ?? "";
  form.value.publisher = props.book.publisher ?? "";
  saveError.value = false;
  editing.value = true;
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

  if (!Object.keys(changes).length) {
    editing.value = false;
    return;
  }

  saveError.value = false;
  saving.value = true;
  try {
    const res = await apiFetch("/api/books/override", {
      method: "PATCH",
      body: JSON.stringify({ isbn: props.book.isbn, changes }),
    });
    if (!res.ok) throw new Error();

    const updated: Partial<BookWithOverrides> = {
      ...changes,
    } as Partial<BookWithOverrides>;
    if ("title" in changes)
      updated.title_overridden = changes.title != null ? 1 : 0;
    if ("cover_url" in changes)
      updated.cover_url_overridden = changes.cover_url != null ? 1 : 0;
    if ("language" in changes)
      updated.language_overridden = changes.language != null ? 1 : 0;
    if ("publish_date" in changes)
      updated.publish_date_overridden = changes.publish_date != null ? 1 : 0;
    if ("number_of_pages_median" in changes)
      updated.pages_overridden = changes.number_of_pages_median != null ? 1 : 0;
    if ("description" in changes)
      updated.description_overridden = changes.description != null ? 1 : 0;
    if ("publisher" in changes)
      updated.publisher_overridden = changes.publisher != null ? 1 : 0;

    emit("refreshed", updated);
    editing.value = false;
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

// ── Enrichment refresh ────────────────────────────────────────────────────────

const enrichmentButtonClass = computed(() => {
  if (props.book.enrichment_status === "failed")
    return "text-error/70 hover:text-error";
  if (props.book.enrichment_status === "pending")
    return "text-orange-neon/40 hover:text-orange-neon/70";
  return "text-text-secondary/50 hover:text-text-secondary";
});

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
