<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="mode === 'full'"
    :max-width="mode === 'card' ? 560 : undefined"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- ── CARD MODE ─────────────────────────────────────────────────────── -->
    <template v-if="mode === 'card'">
      <div class="bg-charcoal-light border border-charcoal-border flex flex-col">

        <!-- header: cover + meta -->
        <div class="flex gap-5 p-7">
          <!-- cover -->
          <div class="w-24 h-36 shrink-0 relative overflow-hidden">
            <img
              v-if="book.cover_url"
              :src="book.cover_url"
              class="w-full h-full object-cover"
            />
            <div
              v-else
              class="relative w-full h-full bg-charcoal border border-charcoal-border flex flex-col p-3 overflow-hidden"
            >
              <div class="absolute left-0 top-0 bottom-0 w-1 bg-orange-neon" />
              <div class="flex-1" />
              <div class="font-heading font-bold text-xs text-text-primary leading-tight pl-2 line-clamp-4">
                {{ book.title || book.isbn }}
              </div>
            </div>
          </div>

          <!-- meta -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-3">
              <h2 class="font-heading font-bold text-2xl text-text-primary leading-tight mb-1 flex items-center gap-1.5">
                {{ book.title || book.isbn }}
                <span v-if="book.title_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon shrink-0" />
              </h2>
              <button
                class="shrink-0 text-text-secondary/50 hover:text-text-secondary transition-colors pt-0.5"
                @click="$emit('update:modelValue', false)"
              >
                <v-icon icon="mdi-close" size="18" />
              </button>
            </div>

            <div class="text-sm text-text-secondary mb-3">
              {{ book.author || $t('book.unknown_author') }}
            </div>

            <!-- series label -->
            <button
              v-if="book.series_id"
              class="flex items-center gap-1.5 text-[10px] tracking-[0.14em] uppercase text-text-secondary/70 hover:text-orange-neon transition-colors mb-3"
              @click="goToSeries"
            >
              <span class="text-orange-neon">♦</span>
              {{ book.series_name || $t('detail.series') }}{{ book.series_ordinal != null ? ` · ${$t('detail.series_position', { n: book.series_ordinal })}` : '' }}
            </button>
            <span
              v-else-if="book.enrichment_status === 'done'"
              class="flex items-center text-[10px] tracking-[0.14em] uppercase text-text-secondary/40 mb-3"
            >
              {{ $t('detail.standalone') }}
            </span>

            <!-- status pill -->
            <button
              v-if="!readonly"
              class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase font-medium transition-colors"
              :class="STATUS_CONFIG[book.status].class"
              @click="$emit('cycle-status')"
            >
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="STATUS_CONFIG[book.status].dotClass" />
              {{ STATUS_CONFIG[book.status].label }}
            </button>
            <span
              v-else
              class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-text-secondary/50"
            >
              <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-charcoal-border" />
              {{ STATUS_CONFIG[book.status].label }}
            </span>

            <!-- enrichment indicator -->
            <div
              v-if="!guest && !readonly && book.enrichment_status && book.enrichment_status !== 'done'"
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
          </div>
        </div>

        <!-- synopsis snippet -->
        <div v-if="book.description" class="border-t border-charcoal-border px-7 py-5">
          <p class="text-[13px] leading-relaxed text-text-secondary line-clamp-3">
            {{ book.description }}
          </p>
          <button
            class="mt-3 text-[10px] tracking-[0.16em] uppercase text-orange-neon hover:opacity-70 transition-opacity"
            @click="expand"
          >
            {{ $t('detail.show_more') }} →
          </button>
        </div>

        <!-- quick facts -->
        <div class="grid grid-cols-3 border-t border-charcoal-border">
          <div class="py-4 px-3 text-center border-r border-charcoal-border">
            <div class="font-heading font-bold text-xl text-text-primary leading-none">{{ publishYear }}</div>
            <div class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2">{{ $t('detail.published') }}</div>
          </div>
          <div class="py-4 px-3 text-center border-r border-charcoal-border">
            <div class="font-heading font-bold text-xl text-text-primary leading-none">{{ book.number_of_pages_median || '—' }}</div>
            <div class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2">{{ $t('detail.pages') }}</div>
          </div>
          <div class="py-4 px-3 text-center overflow-hidden">
            <div class="font-heading font-bold text-xl text-text-primary leading-none truncate">{{ firstGenre }}</div>
            <div class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2">{{ $t('detail.genres') }}</div>
          </div>
        </div>

        <!-- footer -->
        <div class="border-t border-charcoal-border flex items-center justify-between px-5 py-4 bg-charcoal/30">
          <button
            class="text-[11px] tracking-[0.16em] uppercase text-text-secondary hover:text-text-primary transition-colors"
            @click="$emit('update:modelValue', false)"
          >
            {{ $t('detail.close') }}
          </button>
          <button
            class="flex items-center gap-2 bg-orange-neon px-5 py-3 text-[12px] tracking-[0.14em] uppercase font-bold hover:opacity-90 transition-opacity"
            style="color: #111110"
            @click="expand"
          >
            {{ $t('detail.expand') }}
            <v-icon icon="mdi-arrow-expand" size="14" style="color: #111110" />
          </button>
        </div>

      </div>
    </template>

    <!-- ── FULL MODE ──────────────────────────────────────────────────────── -->
    <template v-else>
      <div class="bg-charcoal flex flex-col h-screen">

        <!-- sticky top bar -->
        <div class="shrink-0 flex items-center justify-between px-6 md:px-10 py-4 border-b border-charcoal-border bg-charcoal z-10">
          <button
            class="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
            @click="mode = 'card'"
          >
            <v-icon icon="mdi-arrow-left" size="16" />
            <span class="text-[10px] tracking-[0.18em] uppercase">{{ $t('detail.back_to_card') }}</span>
          </button>
          <div class="flex items-center gap-2">
            <template v-if="!editing">
              <button
                v-if="!guest && !readonly"
                class="text-text-secondary/50 hover:text-text-secondary transition-colors"
                @click="enterEdit"
              >
                <v-icon icon="mdi-pencil-outline" size="18" />
              </button>
              <button
                v-if="!guest && !readonly"
                class="transition-colors disabled:opacity-30"
                :class="enrichmentButtonClass"
                :disabled="refreshing"
                @click="refresh"
              >
                <v-icon icon="mdi-refresh" size="18" :class="refreshing ? 'animate-spin' : ''" />
              </button>
              <button
                v-if="!readonly"
                class="text-error/60 hover:text-error transition-colors"
                @click="$emit('delete')"
              >
                <v-icon icon="mdi-delete-outline" size="18" />
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
            <button
              class="text-text-secondary/50 hover:text-text-secondary transition-colors ml-1"
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
            <div class="flex items-start">

              <!-- left: cover stage (desktop only, sticky) -->
              <div class="hidden md:flex md:w-72 lg:w-80 shrink-0 border-r border-charcoal-border px-8 py-14 flex-col items-center justify-center sticky top-0 self-start min-h-[calc(100vh-52px)]">
                <div class="w-48 h-72 lg:w-56 lg:h-84 relative">
                  <img
                    v-if="book.cover_url"
                    :src="book.cover_url"
                    class="w-full h-full object-cover shadow-2xl"
                  />
                  <div
                    v-else
                    class="relative w-full h-full bg-charcoal-light border border-charcoal-border flex flex-col p-6 overflow-hidden shadow-2xl"
                  >
                    <div class="absolute left-0 top-0 bottom-0 w-2 bg-orange-neon" />
                    <div class="flex-1" />
                    <div class="font-heading font-bold text-2xl text-text-primary leading-tight pl-3">
                      {{ book.title || book.isbn }}
                    </div>
                    <div v-if="book.author" class="text-sm text-text-secondary mt-3 pl-3">{{ book.author }}</div>
                  </div>
                </div>
                <!-- series link below cover -->
                <button
                  v-if="book.series_id"
                  class="mt-6 flex items-center gap-1.5 text-[10px] tracking-[0.14em] uppercase text-text-secondary/60 hover:text-orange-neon transition-colors text-center"
                  @click="goToSeries"
                >
                  <v-icon icon="mdi-bookshelf" size="11" />
                  {{ book.series_name || $t('detail.series') }}
                  <span v-if="book.series_ordinal != null"> · {{ $t('detail.series_position', { n: book.series_ordinal }) }}</span>
                </button>
              </div>

              <!-- right: detail content -->
              <div class="flex-1 min-w-0 px-6 md:px-10 lg:px-14 py-10 md:py-14">

                <!-- genre + series eyebrow -->
                <div class="flex items-center gap-3 mb-4 flex-wrap">
                  <span
                    v-if="book.genres?.length"
                    class="text-[10px] tracking-[0.3em] uppercase font-bold text-orange-neon"
                  >{{ book.genres[0] }}</span>
                  <button
                    v-if="book.series_id"
                    class="text-[10px] tracking-[0.16em] uppercase text-text-secondary/60 hover:text-text-secondary transition-colors"
                    @click="goToSeries"
                  >
                    · {{ book.series_name || $t('detail.series') }}{{ book.series_ordinal != null ? ` · ${$t('detail.series_position', { n: book.series_ordinal })}` : '' }}
                  </button>
                  <span
                    v-else-if="book.enrichment_status === 'done'"
                    class="text-[10px] tracking-[0.16em] uppercase text-text-secondary/40"
                  >· {{ $t('detail.standalone') }}</span>
                </div>

                <!-- title -->
                <h1 class="font-heading font-bold text-3xl md:text-5xl text-text-primary leading-tight tracking-tight mb-3 flex items-start gap-2">
                  {{ book.title || book.isbn }}
                  <span v-if="book.title_overridden" class="inline-block w-2 h-2 rounded-full bg-orange-neon shrink-0 mt-2" />
                </h1>

                <!-- author -->
                <button
                  v-if="book.author"
                  class="text-base text-text-secondary hover:text-orange-neon transition-colors mb-8 block"
                  @click="filterBy('author', book.author!)"
                >
                  {{ book.author }}
                </button>
                <div v-else class="text-base text-text-secondary mb-8">{{ $t('book.unknown_author') }}</div>

                <!-- enrichment status (full view) -->
                <div
                  v-if="!guest && !readonly && book.enrichment_status && book.enrichment_status !== 'done'"
                  class="flex items-center gap-1.5 mb-6 -mt-4"
                  :class="book.enrichment_status === 'failed' ? 'text-error/60' : 'text-text-secondary/30'"
                >
                  <v-icon
                    :icon="book.enrichment_status === 'failed' ? 'mdi-alert-circle-outline' : 'mdi-progress-clock'"
                    size="11"
                  />
                  <span class="text-[9px] tracking-[0.15em] uppercase">
                    {{ $t(`detail.enrichment_${book.enrichment_status}`) }}
                  </span>
                </div>

                <!-- status segmented control -->
                <div v-if="!readonly" class="mb-10">
                  <div class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3">
                    {{ $t('library.filter_status') }}
                  </div>
                  <div class="flex max-w-xs border border-charcoal-border">
                    <button
                      v-for="opt in STATUS_OPTIONS"
                      :key="opt.status"
                      class="flex-1 flex items-center justify-center gap-2 py-3 text-[11px] tracking-[0.14em] uppercase font-medium transition-all border-r border-charcoal-border last:border-r-0"
                      :class="book.status === opt.status
                        ? `bg-orange-neon/10 ${opt.activeClass}`
                        : 'text-text-secondary/50 hover:text-text-secondary'"
                      @click="$emit('set-status', opt.status)"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full shrink-0"
                        :class="book.status === opt.status ? opt.dotClass : 'bg-charcoal-border'"
                      />
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <!-- synopsis -->
                <div v-if="book.description" class="mb-10">
                  <div class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3 flex items-center gap-1.5">
                    {{ $t('detail.description') }}
                    <span v-if="book.description_overridden" class="w-1.5 h-1.5 rounded-full bg-orange-neon" />
                  </div>
                  <p class="text-[15px] leading-relaxed text-text-secondary">{{ book.description }}</p>
                </div>

                <!-- edition + your record grid -->
                <div class="grid md:grid-cols-2 gap-x-12 pt-8 border-t border-charcoal-border mb-10">
                  <!-- edition column -->
                  <div>
                    <div class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-4">
                      {{ $t('detail.edition') }}
                    </div>
                    <div v-if="book.publisher" class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0">
                        {{ $t('detail.publisher') }}
                        <span v-if="book.publisher_overridden" class="w-1 h-1 rounded-full bg-orange-neon" />
                      </span>
                      <button class="font-mono text-xs text-text-primary hover:text-orange-neon transition-colors text-right truncate" @click="filterBy('publisher', book.publisher!)">
                        {{ book.publisher }}
                      </button>
                    </div>
                    <div v-if="book.language" class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0">
                        {{ $t('detail.language') }}
                        <span v-if="book.language_overridden" class="w-1 h-1 rounded-full bg-orange-neon" />
                      </span>
                      <button class="font-mono text-xs text-text-primary uppercase hover:text-orange-neon transition-colors" @click="filterBy('language', book.language!)">
                        {{ book.language }}
                      </button>
                    </div>
                    <div v-if="book.publish_date" class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0">
                        {{ $t('detail.published') }}
                        <span v-if="book.publish_date_overridden" class="w-1 h-1 rounded-full bg-orange-neon" />
                      </span>
                      <span class="font-mono text-xs text-text-primary text-right">{{ formatPublishDate(book.publish_date) }}</span>
                    </div>
                    <div v-if="book.number_of_pages_median" class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0">
                        {{ $t('detail.pages') }}
                        <span v-if="book.pages_overridden" class="w-1 h-1 rounded-full bg-orange-neon" />
                      </span>
                      <span class="font-mono text-xs text-text-primary">{{ book.number_of_pages_median }}</span>
                    </div>
                    <div class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0">{{ $t('detail.isbn') }}</span>
                      <span class="font-mono text-xs text-text-primary text-right">{{ book.isbn }}</span>
                    </div>
                    <div v-if="book.original_pub_date" class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0">{{ $t('detail.original_pub_date') }}</span>
                      <span class="font-mono text-xs text-text-primary">{{ book.original_pub_date }}</span>
                    </div>
                  </div>

                  <!-- your record column -->
                  <div class="mt-8 md:mt-0">
                    <div class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-4">
                      {{ $t('detail.your_record') }}
                    </div>
                    <div class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0">{{ $t('library.filter_status') }}</span>
                      <span class="font-mono text-xs text-text-primary">{{ STATUS_CONFIG[book.status].label }}</span>
                    </div>
                    <div class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50">
                      <span class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0">{{ $t('detail.added') }}</span>
                      <span class="font-mono text-xs text-text-primary">{{ formattedAdded }}</span>
                    </div>

                    <!-- genres -->
                    <div v-if="book.genres?.length" class="pt-4">
                      <div class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-2">{{ $t('detail.genres') }}</div>
                      <div class="flex flex-wrap gap-1.5">
                        <template v-for="(genre, idx) in book.genres" :key="genre">
                          <button
                            class="text-xs text-text-primary hover:text-orange-neon transition-colors"
                            @click="filterBy('genre', genre)"
                          >{{ genre }}</button>
                          <span v-if="idx < book.genres!.length - 1" class="text-xs text-text-secondary/30 select-none" aria-hidden="true">·</span>
                        </template>
                      </div>
                    </div>

                    <!-- awards & nominations -->
                    <template v-if="book.awards?.length || book.nominations?.length">
                      <div v-if="book.awards?.length" class="pt-4">
                        <div class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-2">{{ $t('detail.awards') }}</div>
                        <div class="text-xs text-text-primary leading-relaxed">{{ book.awards!.join(' · ') }}</div>
                      </div>
                      <div v-if="book.nominations?.length" class="pt-4">
                        <div class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-2">{{ $t('detail.nominations') }}</div>
                        <div class="text-xs text-text-primary leading-relaxed">{{ book.nominations!.join(' · ') }}</div>
                      </div>
                    </template>
                  </div>
                </div>

                <!-- other editions -->
                <div v-if="otherEditions.length" class="mb-8">
                  <div class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3">{{ $t('detail.other_editions') }}</div>
                  <div class="flex flex-col gap-2">
                    <div v-for="ed in otherEditions" :key="ed.isbn" class="flex items-center gap-3">
                      <img v-if="ed.cover_url" :src="ed.cover_url" class="w-8 h-12 object-cover shrink-0" />
                      <div v-else class="w-8 h-12 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0">
                        <v-icon icon="mdi-book-outline" size="14" color="primary" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-xs text-text-primary truncate">{{ ed.title || ed.isbn }}</div>
                        <div class="text-[10px] text-text-secondary/60 flex items-center gap-2">
                          <span v-if="ed.language" class="uppercase">{{ ed.language }}</span>
                          <span v-if="ed.scan_id" class="text-orange-neon tracking-[0.15em] uppercase">
                            {{ $t('detail.edition_in_library') }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- custom fields (view mode) -->
                <div v-if="!readonly && fieldDefsStore.defs.length" class="mb-8 grid grid-cols-2 gap-y-4">
                  <div v-for="def in fieldDefsStore.defs" :key="def.id">
                    <div class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1">{{ def.name }}</div>
                    <div class="text-xs text-text-primary">{{ customFieldMap.get(def.id) || '—' }}</div>
                  </div>
                </div>

              </div>
            </div>
          </template>

          <!-- edit mode -->
          <template v-else>
            <div class="max-w-lg mx-auto px-6 py-10">
              <!-- title -->
              <input
                v-model="form.title"
                class="w-full bg-transparent font-heading text-xl font-bold text-text-primary leading-snug mb-2 border-b border-charcoal-border pb-1 outline-none focus:border-orange-neon"
                :placeholder="book.isbn"
              />
              <div class="text-sm text-text-secondary/60 mb-6">
                {{ book.author || $t('book.unknown_author') }}
              </div>

              <div class="flex flex-col gap-4">
                <div>
                  <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block">
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
                    <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block">
                      {{ $t('detail.publisher') }}
                    </label>
                    <input v-model="form.publisher" class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon" />
                  </div>
                  <div>
                    <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block">
                      {{ $t('detail.language') }}
                    </label>
                    <input v-model="form.language" class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon" />
                  </div>
                  <div>
                    <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block">
                      {{ $t('detail.published') }}
                    </label>
                    <input v-model="form.publish_date" class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon" />
                  </div>
                  <div>
                    <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block">
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
                  <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block">
                    {{ $t('detail.cover_url') }}
                  </label>
                  <input v-model="form.cover_url" class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 outline-none focus:border-orange-neon" />
                </div>

                <!-- custom fields editor -->
                <div>
                  <label class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-2 block">
                    {{ $t('detail.custom_fields') }}
                  </label>
                  <div v-for="def in fieldDefsStore.defs" :key="def.id" class="flex gap-2 mb-2 items-center">
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

                  <div v-if="addingField" class="flex gap-2 mt-1 items-center">
                    <input
                      v-model="newFieldName"
                      :placeholder="$t('detail.custom_field_name')"
                      class="flex-1 bg-charcoal border border-orange-neon text-xs text-text-primary px-3 py-2 outline-none"
                      @keyup.enter="createFieldDefinition"
                      @keyup.escape="addingField = false; newFieldName = ''"
                    />
                    <button class="text-orange-neon hover:text-orange-neon/70 transition-colors shrink-0" @click="createFieldDefinition">
                      <v-icon icon="mdi-check" size="16" />
                    </button>
                    <button class="text-text-secondary/40 hover:text-text-secondary/70 transition-colors shrink-0" @click="addingField = false; newFieldName = ''">
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

                <p v-if="saveError" class="text-[10px] text-error tracking-widest uppercase">
                  {{ $t('detail.edit_error') }}
                </p>
              </div>
            </div>
          </template>

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
        </div>

      </div>
    </template>

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
import type { ReadStatus } from "@/types/book";

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
  delete: [];
  refreshed: [updated: Partial<BookWithOverrides>];
}>();

const { t } = useI18n();
const { apiFetch } = useApi();
const fieldDefsStore = useFieldDefsStore();
const localeStore = useLocaleStore();
const router = useRouter();

// ── Mode ──────────────────────────────────────────────────────────────────────

const mode = ref<'card' | 'full'>('card');

function expand() { mode.value = 'full'; }

// ── Computed helpers ──────────────────────────────────────────────────────────

const publishYear = computed(() => {
  const d = props.book.publish_date || props.book.original_pub_date;
  if (!d) return '—';
  return String(d).slice(0, 4);
});

const firstGenre = computed(() => props.book.genres?.[0] ?? '—');

const formattedAdded = computed(() => {
  if (!props.book.created_at) return '—';
  const loc = BCP47[localeStore.locale] ?? 'en-GB';
  return new Date(props.book.created_at).toLocaleDateString(loc, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
});

// ── Formatting ────────────────────────────────────────────────────────────────

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

// ── Edit state ────────────────────────────────────────────────────────────────

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

// ── Other editions ────────────────────────────────────────────────────────────

const otherEditions = ref<WorkEdition[]>([]);

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

// ── Enrichment polling ────────────────────────────────────────────────────────

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
  if (props.guest || props.readonly || props.book.enrichment_status !== 'pending') return;
  pollTimer = setTimeout(() => pollOnce(0), POLL_DELAYS[0]);
}

onUnmounted(clearPoll);

// ── Navigation ────────────────────────────────────────────────────────────────

function goToSeries() {
  if (props.book.series_id == null) return;
  emit("update:modelValue", false);
  router.push(`/series/${props.book.series_id}`);
}

function filterBy(field: 'author' | 'genre' | 'publisher' | 'language', value: string) {
  emit("update:modelValue", false);
  router.push(`/library?q=${encodeURIComponent(`${field}:"${value}"`)}`);
}

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(
  () => props.book.isbn,
  () => {
    mode.value = 'card';
    descriptionExpanded.value = false;
    editing.value = false;
    if (props.modelValue) { loadOtherEditions(); startEnrichmentPoll(); }
  },
);

watch(
  () => props.modelValue,
  (val) => {
    if (!val) { mode.value = 'card'; editing.value = false; clearPoll(); }
    else { loadOtherEditions(); startEnrichmentPoll(); }
  },
);

// ── Custom field helpers ──────────────────────────────────────────────────────

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

// ── Enrichment refresh ────────────────────────────────────────────────────────

const enrichmentButtonClass = computed(() => {
  if (props.book.enrichment_status === 'failed') return 'text-error/70 hover:text-error';
  if (props.book.enrichment_status === 'pending') return 'text-orange-neon/40 hover:text-orange-neon/70';
  return 'text-text-secondary/50 hover:text-text-secondary';
});

const refresh = async () => {
  refreshing.value = true;
  try {
    const res = await apiFetch(`/api/books/refresh?isbn=${props.book.isbn}`, { method: "POST" });
    if (!res.ok) throw new Error();
    await res.json();
    emit("refreshed", { enrichment_status: 'pending' as const });
    startEnrichmentPoll();
  } finally {
    refreshing.value = false;
  }
};

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = computed(() => ({
  unread: {
    label: t("book.unread"),
    icon: "mdi-circle-outline",
    class: "text-text-secondary/40 hover:text-text-secondary",
    dotClass: "bg-text-secondary/40",
  },
  reading: {
    label: t("book.reading"),
    icon: "mdi-book-open-outline",
    class: "text-orange-neon",
    dotClass: "bg-orange-neon",
  },
  read: {
    label: t("book.read"),
    icon: "mdi-check-circle-outline",
    class: "text-[#22c55e]",
    dotClass: "bg-[#22c55e]",
  },
}));

const STATUS_OPTIONS = computed(() => [
  {
    status: 'unread' as ReadStatus,
    label: t('book.unread'),
    dotClass: 'bg-text-secondary/40',
    activeClass: 'text-text-secondary',
  },
  {
    status: 'reading' as ReadStatus,
    label: t('book.reading'),
    dotClass: 'bg-orange-neon',
    activeClass: 'text-orange-neon',
  },
  {
    status: 'read' as ReadStatus,
    label: t('book.read'),
    dotClass: 'bg-[#22c55e]',
    activeClass: 'text-[#22c55e]',
  },
]);
</script>
