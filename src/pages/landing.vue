<template>
  <div class="bg-charcoal h-screen overflow-hidden flex flex-col">

    <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
    <header class="shrink-0 flex justify-end items-center px-6 md:px-16 py-3 md:py-4 border-b border-charcoal-border">
      <div class="flex items-center gap-1">
        <v-btn
          variant="text"
          color="primary"
          size="small"
          class="text-[10px] tracking-widest font-mono"
          @click="localeStore.toggle()"
        >
          {{ localeStore.locale === 'en' ? 'DE' : 'EN' }}
        </v-btn>
        <v-btn
          :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          variant="text"
          color="primary"
          size="small"
          @click="themeStore.toggle()"
        />
        <button
          class="ml-2 md:ml-4 text-text-primary text-[10px] md:text-[11px] font-medium tracking-[0.18em] uppercase border-b border-text-primary/50 pb-[3px] hover:border-text-primary transition-colors"
          @click="$router.push('/login')"
        >
          {{ $t('auth.sign_in') }}
        </button>
      </div>
    </header>

    <!-- ── Main ────────────────────────────────────────────────────────────── -->
    <div class="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">

      <!-- Left: hero + scanner + CTAs -->
      <div class="flex-none md:flex-1 px-6 md:px-16 py-6 md:py-0 flex flex-col justify-start md:justify-center gap-5 md:gap-7 overflow-hidden">

        <p class="text-[9px] md:text-[10px] tracking-[0.3em] uppercase text-orange-neon font-mono font-bold">
          {{ $t('app_name') }}
        </p>

        <h1 class="font-heading text-[2.2rem] md:text-6xl font-black text-text-primary leading-[1.02]">
          {{ $t('marketing.heading') }}
        </h1>

        <p class="text-[13px] md:text-base text-text-secondary leading-relaxed max-w-xs md:max-w-sm">
          {{ $t('marketing.body') }}
        </p>

        <!-- Scanner + CTAs row -->
        <div class="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">

          <!-- Scanner widget -->
          <div
            class="relative flex items-center justify-center w-full md:w-[300px] bg-charcoal-light border border-charcoal-border shrink-0"
            style="height: 110px;"
          >
            <!-- Barcode -->
            <div
              class="w-[168px] h-14 opacity-80"
              style="background: repeating-linear-gradient(90deg, #e8e4dd 0 3px, transparent 3px 7px, #e8e4dd 7px 9px, transparent 9px 12px, #e8e4dd 12px 16px, transparent 16px 22px);"
            />
            <!-- Corner brackets -->
            <div class="absolute top-3.5 left-3.5 w-5 h-5 border-l-2 border-t-2 border-text-primary" />
            <div class="absolute top-3.5 right-3.5 w-5 h-5 border-r-2 border-t-2 border-text-primary" />
            <div class="absolute bottom-3.5 left-3.5 w-5 h-5 border-l-2 border-b-2 border-text-primary" />
            <div class="absolute bottom-3.5 right-3.5 w-5 h-5 border-r-2 border-b-2 border-text-primary" />
            <!-- Animated scan line -->
            <div class="scanner-line absolute h-[2px] w-[180px]" style="left: 50%; background: rgba(255,102,0,0.7);" />
          </div>

          <!-- CTAs -->
          <div class="flex flex-col gap-3">
            <button
              class="w-full md:w-auto bg-text-primary text-charcoal text-xs font-bold tracking-[0.2em] uppercase py-3.75 px-7 hover:opacity-80 transition-opacity text-center"
              @click="$router.push('/login?mode=register')"
            >
              {{ $t('marketing.cta_primary') }}
            </button>
            <button
              class="text-text-primary text-[11px] font-medium tracking-[0.2em] uppercase text-center hover:opacity-70 transition-opacity"
              @click="$router.push('/login')"
            >
              {{ $t('marketing.cta_secondary') }} →
            </button>
          </div>

        </div>
      </div>

      <!-- Right: library card preview -->
      <div class="flex-none md:w-[400px] border-t md:border-t-0 md:border-l border-charcoal-border flex flex-col overflow-hidden">

        <!-- Card header -->
        <div class="shrink-0 flex justify-between items-end px-6 py-4 md:py-5 border-b border-charcoal-border">
          <div>
            <p class="font-mono text-[9px] text-text-secondary tracking-[0.3em] uppercase mb-1.5">
              {{ $t('marketing.preview_section') }}
            </p>
            <h2 class="font-heading font-black text-xl md:text-[25px] text-text-primary leading-none">
              {{ $t('marketing.preview_title') }}
            </h2>
          </div>
          <p class="font-mono text-[9px] text-text-secondary tracking-[0.12em] uppercase">
            {{ demoBooks.length }} {{ $t('marketing.preview_count') }}
          </p>
        </div>

        <!-- Book list -->
        <div class="overflow-hidden">
          <div
            v-for="(book, i) in demoBooks"
            :key="book.title"
            class="flex gap-3.5 px-6 py-3.5 md:py-4 border-b border-charcoal-border"
            :class="{ 'hidden md:flex': i === 3 }"
          >
            <!-- Spine placeholder -->
            <div class="w-9 h-[50px] md:h-14 flex-none bg-charcoal border border-charcoal-border relative shrink-0">
              <div class="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />
            </div>
            <!-- Info -->
            <div class="min-w-0 flex-1">
              <p class="font-heading font-bold text-[13px] md:text-sm text-text-primary leading-snug">
                {{ book.title }}
              </p>
              <p class="font-mono text-[10px] text-text-secondary mt-1">{{ book.author }}</p>
              <div class="flex items-center gap-1.5 mt-2">
                <div
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :style="{ background: statusDot(book.status) }"
                />
                <span
                  class="text-[9px] tracking-[0.15em] uppercase font-medium"
                  :style="{ color: statusColor(book.status) }"
                >
                  {{ $t(`book.${book.status}`) }}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>


</div>
</template>

<script lang="ts" setup>
import { useThemeStore } from '@/stores/theme'
import { useLocaleStore } from '@/stores/locale'

const themeStore = useThemeStore()
const localeStore = useLocaleStore()

const demoBooks = [
  { title: 'Meditations',               author: 'Marcus Aurelius',  status: 'read'    as const },
  { title: 'Walden',                    author: 'Henry D. Thoreau', status: 'reading' as const },
  { title: 'The Odyssey',               author: 'Homer',            status: 'read'    as const },
  { title: 'On the Origin of Species',  author: 'Charles Darwin',   status: 'unread'  as const },
]

function statusDot(s: 'read' | 'reading' | 'unread'): string {
  if (s === 'reading') return 'rgb(var(--v-theme-primary))'
  if (s === 'read')    return 'rgb(var(--v-theme-success))'
  return 'rgba(138,128,120,0.3)'
}

function statusColor(s: 'read' | 'reading' | 'unread'): string {
  if (s === 'reading') return 'rgb(var(--v-theme-primary))'
  if (s === 'read')    return 'rgba(138,128,120,0.6)'
  return 'rgba(138,128,120,0.35)'
}
</script>

<style scoped>
@keyframes scanline {
  0%, 100% { transform: translate(-50%, -22px); opacity: 0.65; }
  50%       { transform: translate(-50%,  22px); opacity: 0.15; }
}
.scanner-line {
  animation: scanline 2.4s ease-in-out infinite;
}
</style>
