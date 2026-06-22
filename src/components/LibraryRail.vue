<template>
  <div class="flex flex-col gap-0 h-full overflow-y-auto">

    <!-- Search -->
    <div class="px-6 py-5 border-b border-charcoal-border">
      <div class="flex items-center gap-2 border-b border-charcoal-border pb-2">
        <v-icon icon="mdi-magnify" size="15" class="text-text-secondary shrink-0" />
        <input
          :value="search"
          type="search"
          :placeholder="$t('library.search_placeholder')"
          class="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-secondary/50"
          @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="search"
          class="text-text-secondary hover:text-text-primary transition-colors"
          @click="$emit('update:search', '')"
        >
          <v-icon icon="mdi-close" size="13" />
        </button>
      </div>
    </div>

    <!-- Group by -->
    <section class="px-6 py-5 border-b border-charcoal-border">
      <p class="text-[10px] text-text-secondary tracking-[0.24em] uppercase mb-3">
        {{ $t('library.group_by') }}
      </p>
      <div class="space-y-1">
        <label
          v-for="opt in GROUP_OPTIONS"
          :key="opt.value"
          class="flex items-center gap-3 py-1.5 cursor-pointer group"
        >
          <span
            class="w-3 h-3 rounded-full border flex items-center justify-center shrink-0 transition-colors"
            :class="groupBy === opt.value ? 'border-orange-neon' : 'border-charcoal-border'"
          >
            <span
              v-if="groupBy === opt.value"
              class="w-1.5 h-1.5 rounded-full bg-orange-neon"
            />
          </span>
          <span
            class="text-xs transition-colors"
            :class="groupBy === opt.value ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary/70'"
          >
            {{ opt.label }}
          </span>
          <input
            type="radio"
            :value="opt.value"
            :checked="groupBy === opt.value"
            class="sr-only"
            @change="$emit('update:groupBy', opt.value)"
          />
        </label>
      </div>
    </section>

    <!-- Sort by -->
    <section class="px-6 py-5 border-b border-charcoal-border">
      <p class="text-[10px] text-text-secondary tracking-[0.24em] uppercase mb-3">
        {{ $t('library.sort_by') }}
      </p>
      <div class="space-y-1">
        <label
          v-for="opt in SORT_OPTIONS"
          :key="opt.value"
          class="flex items-center gap-3 py-1.5 cursor-pointer group"
        >
          <span
            class="w-3 h-3 rounded-full border flex items-center justify-center shrink-0 transition-colors"
            :class="sortBy === opt.value ? 'border-orange-neon' : 'border-charcoal-border'"
          >
            <span
              v-if="sortBy === opt.value"
              class="w-1.5 h-1.5 rounded-full bg-orange-neon"
            />
          </span>
          <span
            class="text-xs transition-colors"
            :class="sortBy === opt.value ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary/70'"
          >
            {{ opt.label }}
          </span>
          <input
            type="radio"
            :value="opt.value"
            :checked="sortBy === opt.value"
            class="sr-only"
            @change="$emit('update:sortBy', opt.value)"
          />
        </label>
      </div>
    </section>

    <!-- Status -->
    <section class="px-6 py-5 border-b border-charcoal-border">
      <p class="text-[10px] text-text-secondary tracking-[0.24em] uppercase mb-3">
        {{ $t('library.filter_status') }}
      </p>
      <div class="space-y-1">
        <label
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          class="flex items-center gap-3 py-1.5 cursor-pointer group"
        >
          <span
            class="w-3 h-3 border flex items-center justify-center shrink-0 transition-colors"
            :class="filterStatus.has(opt.value) ? 'border-orange-neon bg-orange-neon' : 'border-charcoal-border'"
          >
            <v-icon
              v-if="filterStatus.has(opt.value)"
              icon="mdi-check"
              size="9"
              class="text-charcoal"
            />
          </span>
          <span
            class="text-xs flex-1 transition-colors"
            :class="filterStatus.has(opt.value) ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary/70'"
          >
            {{ opt.label }}
          </span>
          <span class="font-mono text-[10px] text-text-secondary/50">{{ statusCounts[opt.value] }}</span>
          <input
            type="checkbox"
            :value="opt.value"
            :checked="filterStatus.has(opt.value)"
            class="sr-only"
            @change="toggleStatus(opt.value)"
          />
        </label>
      </div>
    </section>

    <!-- Genre (only if any book has genre data) -->
    <section v-if="genreOptions.length" class="px-6 py-5 border-b border-charcoal-border">
      <p class="text-[10px] text-text-secondary tracking-[0.24em] uppercase mb-3">
        {{ $t('library.filter_genre') }}
      </p>
      <div class="space-y-1">
        <label
          v-for="opt in genreOptions"
          :key="opt.value"
          class="flex items-center gap-3 py-1.5 cursor-pointer group"
        >
          <span
            class="w-3 h-3 border flex items-center justify-center shrink-0 transition-colors"
            :class="filterGenres.has(opt.value) ? 'border-orange-neon bg-orange-neon' : 'border-charcoal-border'"
          >
            <v-icon
              v-if="filterGenres.has(opt.value)"
              icon="mdi-check"
              size="9"
              class="text-charcoal"
            />
          </span>
          <span
            class="text-xs flex-1 transition-colors"
            :class="filterGenres.has(opt.value) ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary/70'"
          >
            {{ opt.label }}
          </span>
          <span class="font-mono text-[10px] text-text-secondary/50">{{ opt.count }}</span>
          <input
            type="checkbox"
            :value="opt.value"
            :checked="filterGenres.has(opt.value)"
            class="sr-only"
            @change="toggleGenre(opt.value)"
          />
        </label>
      </div>
    </section>

    <!-- Awards (only if any book has award data) -->
    <section v-if="hasAnyAwards" class="px-6 py-5">
      <p class="text-[10px] text-text-secondary tracking-[0.24em] uppercase mb-3">
        {{ $t('library.filter_awards') }}
      </p>
      <label class="flex items-center gap-3 py-1.5 cursor-pointer group">
        <span
          class="w-3 h-3 border flex items-center justify-center shrink-0 transition-colors"
          :class="filterAwards ? 'border-orange-neon bg-orange-neon' : 'border-charcoal-border'"
        >
          <v-icon
            v-if="filterAwards"
            icon="mdi-check"
            size="9"
            class="text-charcoal"
          />
        </span>
        <span
          class="text-xs transition-colors"
          :class="filterAwards ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary/70'"
        >
          {{ $t('library.filter_awards_label') }}
        </span>
        <input
          type="checkbox"
          :checked="filterAwards"
          class="sr-only"
          @change="$emit('update:filterAwards', !filterAwards)"
        />
      </label>
    </section>

  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Book, ReadStatus } from '@/types/book'
import type { GroupBy, SortOption } from '@/types/library'

export type { GroupBy, SortOption }

const props = defineProps<{
  books: Book[]          // all books (unfiltered), for computing counts
  search: string
  groupBy: GroupBy
  sortBy: SortOption
  filterStatus: Set<ReadStatus>
  filterGenres: Set<string>
  filterAwards: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:groupBy': [value: GroupBy]
  'update:sortBy': [value: SortOption]
  'update:filterStatus': [value: Set<ReadStatus>]
  'update:filterGenres': [value: Set<string>]
  'update:filterAwards': [value: boolean]
}>()

const { t } = useI18n()

const GROUP_OPTIONS = computed(() => [
  { value: 'none' as GroupBy,   label: t('library.group_none') },
  { value: 'author' as GroupBy, label: t('library.group_author') },
  { value: 'series' as GroupBy, label: t('library.group_series') },
  { value: 'genre' as GroupBy,  label: t('library.group_genre') },
  { value: 'status' as GroupBy, label: t('library.group_status') },
])

const SORT_OPTIONS = computed(() => [
  { value: 'date_desc' as SortOption,  label: t('library.sort_date_desc') },
  { value: 'date_asc' as SortOption,   label: t('library.sort_date_asc') },
  { value: 'title_asc' as SortOption,  label: t('library.sort_title_asc') },
  { value: 'title_desc' as SortOption, label: t('library.sort_title_desc') },
  { value: 'author_asc' as SortOption, label: t('library.sort_author_asc') },
])

const STATUS_OPTIONS = computed(() => [
  { value: 'unread' as ReadStatus,  label: t('book.unread') },
  { value: 'reading' as ReadStatus, label: t('book.reading') },
  { value: 'read' as ReadStatus,    label: t('book.read') },
])

const statusCounts = computed(() => ({
  unread:  props.books.filter(b => b.status === 'unread').length,
  reading: props.books.filter(b => b.status === 'reading').length,
  read:    props.books.filter(b => b.status === 'read').length,
}))

// Derive genre options from the library: count books per primary genre, sort by count desc.
// Books with no genres contribute to "Unclassified" shown last.
const genreOptions = computed(() => {
  const counts = new Map<string, number>()
  let unclassified = 0
  for (const b of props.books) {
    const primary = b.genres?.[0]
    if (primary) {
      counts.set(primary, (counts.get(primary) ?? 0) + 1)
    } else if (b.enrichment_status === 'done') {
      unclassified++
    }
  }
  const opts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([genre, count]) => ({ value: genre, label: genre, count }))
  if (unclassified) {
    opts.push({ value: '__unclassified__', label: t('library.unclassified'), count: unclassified })
  }
  return opts
})

const hasAnyAwards = computed(() =>
  props.books.some(b => b.awards?.length || b.nominations?.length)
)

function toggleStatus(val: ReadStatus) {
  const next = new Set(props.filterStatus)
  next.has(val) ? next.delete(val) : next.add(val)
  emit('update:filterStatus', next)
}

function toggleGenre(val: string) {
  const next = new Set(props.filterGenres)
  next.has(val) ? next.delete(val) : next.add(val)
  emit('update:filterGenres', next)
}
</script>
