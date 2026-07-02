<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { useAuthStore, WELCOME_SEEN_KEY } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

function markSeen() {
  localStorage.setItem(WELCOME_SEEN_KEY, '1')
}
function skip() {
  markSeen()
  router.push({ name: authStore.isAuthenticated ? 'dashboard' : 'library' })
}
function start() {
  markSeen()
  router.push({ name: 'scanner' })
}
</script>

<template>
  <div class="bg-charcoal min-h-screen flex flex-col">

    <!-- Header -->
    <header class="shrink-0 flex justify-between items-center px-5 md:px-11 py-5 border-b border-charcoal-border">
      <span class="text-orange-neon font-mono text-[9px] md:text-[10px] font-bold tracking-[0.28em] md:tracking-[0.35em] uppercase leading-snug max-w-[150px] md:max-w-none">
        {{ $t('app_name') }}
      </span>
      <button
        class="text-text-secondary font-mono text-[10px] md:text-[11px] tracking-[0.18em] uppercase hover:text-text-primary transition-colors"
        @click="skip"
      >
        {{ $t('welcome.skip') }}
      </button>
    </header>

    <!-- Body -->
    <div class="flex-1 flex flex-col min-h-0">

      <!-- Padded content -->
      <div class="flex-1 flex flex-col min-h-0 px-[22px] md:px-11 pt-[22px] md:pt-[34px] gap-[18px] md:gap-6">

        <!-- Title section -->
        <div class="shrink-0 flex justify-between items-end">
          <div>
            <p class="text-orange-neon font-mono text-[9px] md:text-[10px] tracking-[0.3em] uppercase mb-[11px] md:mb-[14px]">
              {{ $t('welcome.eyebrow') }}
            </p>
            <h1 class="font-heading font-black text-[33px] md:text-[50px] leading-[0.96] md:leading-[0.98] text-text-primary tracking-[-0.015em] md:tracking-[-0.02em] m-0">
              {{ $t('welcome.heading') }}
            </h1>
          </div>
          <p class="hidden md:block text-sm leading-[1.55] text-text-secondary text-right max-w-[300px]">
            {{ $t('welcome.subtitle') }}
          </p>
        </div>

        <!-- ── MOBILE: scan hero + feature rows ─────────────────────────────── -->
        <div class="md:hidden flex-1 flex flex-col overflow-y-auto">

          <!-- Scan hero tile -->
          <div class="bg-charcoal-light border border-charcoal-border p-[18px] mb-4 shrink-0">
            <div class="flex items-baseline gap-2 mb-[9px]">
              <span class="font-mono text-[11px] text-orange-neon">01</span>
              <span class="text-[9px] tracking-[0.22em] uppercase text-text-secondary font-bold">{{ $t('welcome.f1_label') }}</span>
            </div>
            <div class="flex items-end justify-between gap-3 mb-3.5">
              <h2 class="font-heading font-black text-2xl text-text-primary leading-tight">{{ $t('welcome.f1_title') }}</h2>
              <div class="text-[11px] leading-[1.4] text-text-secondary text-right shrink-0 max-w-[118px]">{{ $t('welcome.f1_body_short') }}</div>
            </div>
            <div class="scanner-viewport scanner-viewport--sm">
              <div class="barcode"></div>
              <span class="corner tl"></span>
              <span class="corner tr"></span>
              <span class="corner bl"></span>
              <span class="corner br"></span>
              <div class="scan-beam"></div>
            </div>
          </div>

          <!-- Feature rows 02–05 -->
          <!-- 02 Customize -->
          <div class="flex items-center gap-3.5 border-t border-charcoal-border py-3">
            <div class="w-[50px] shrink-0">
              <div class="font-mono text-[11px] text-orange-neon">02</div>
              <div class="text-[8px] tracking-[0.14em] uppercase text-text-secondary mt-1">{{ $t('welcome.f2_label') }}</div>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="font-heading font-bold text-base text-text-primary leading-[1.1]">{{ $t('welcome.f2_title') }}</h2>
              <div class="text-[11px] leading-[1.4] text-text-secondary mt-0.5">{{ $t('welcome.f2_body') }}</div>
            </div>
            <div class="shrink-0 flex items-center gap-1.5 px-2.5 py-2" style="border: 1px dashed rgba(255,102,0,0.5)">
              <span class="font-mono text-xs text-orange-neon font-bold leading-none">+</span>
              <span class="font-mono text-[9px] tracking-[0.1em] text-orange-neon uppercase">{{ $t('welcome.f2_cta') }}</span>
            </div>
          </div>

          <!-- 03 Track -->
          <div class="flex items-center gap-3.5 border-t border-charcoal-border py-3">
            <div class="w-[50px] shrink-0">
              <div class="font-mono text-[11px] text-orange-neon">03</div>
              <div class="text-[8px] tracking-[0.14em] uppercase text-text-secondary mt-1">{{ $t('welcome.f3_label') }}</div>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="font-heading font-bold text-base text-text-primary leading-[1.1]">{{ $t('welcome.f3_title') }}</h2>
              <div class="text-[11px] leading-[1.4] text-text-secondary mt-0.5">{{ $t('welcome.f3_body') }}</div>
            </div>
            <div class="shrink-0 flex flex-col gap-[5px] items-end">
              <span class="inline-flex items-center gap-1.5 px-2 py-[3px] border border-charcoal-border">
                <span class="w-1.5 h-1.5 rounded-full" style="background: rgb(var(--v-theme-success))"></span>
                <span class="text-[8px] tracking-[0.1em] uppercase font-medium" style="color: rgb(var(--v-theme-success))">{{ $t('book.read') }}</span>
              </span>
              <span class="inline-flex items-center gap-1.5 px-2 py-[3px]" style="border: 1px solid rgba(255,102,0,0.5)">
                <span class="w-1.5 h-1.5 rounded-full" style="background: rgb(var(--v-theme-primary))"></span>
                <span class="text-[8px] tracking-[0.1em] uppercase font-medium text-orange-neon">{{ $t('book.reading') }}</span>
              </span>
              <span class="inline-flex items-center gap-1.5 px-2 py-[3px] border border-charcoal-border">
                <span class="w-1.5 h-1.5 rounded-full text-text-secondary" style="background: var(--color-text-secondary)"></span>
                <span class="text-[8px] tracking-[0.1em] uppercase font-medium text-text-secondary">{{ $t('book.unread') }}</span>
              </span>
            </div>
          </div>

          <!-- 04 Search -->
          <div class="flex items-center gap-3.5 border-t border-charcoal-border py-3">
            <div class="w-[50px] shrink-0">
              <div class="font-mono text-[11px] text-orange-neon">04</div>
              <div class="text-[8px] tracking-[0.14em] uppercase text-text-secondary mt-1">{{ $t('welcome.f4_label') }}</div>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="font-heading font-bold text-base text-text-primary leading-[1.1]">{{ $t('welcome.f4_title') }}</h2>
              <div class="text-[11px] leading-[1.4] text-text-secondary mt-0.5">{{ $t('welcome.f4_body') }}</div>
            </div>
            <div class="shrink-0 flex items-center gap-2 bg-charcoal border border-charcoal-border px-[11px] py-[9px] w-[104px]">
              <span class="w-[11px] h-[11px] rounded-full border-2 border-text-secondary shrink-0"></span>
              <span class="text-[11px] text-text-primary">pretentious<span class="blink-cursor">&nbsp;</span></span>
            </div>
          </div>

          <!-- 05 Series -->
          <div class="flex items-center gap-3.5 border-t border-charcoal-border py-3">
            <div class="w-[50px] shrink-0">
              <div class="font-mono text-[11px] text-orange-neon">05</div>
              <div class="text-[8px] tracking-[0.14em] uppercase text-text-secondary mt-1">{{ $t('welcome.f5_label') }}</div>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="font-heading font-bold text-base text-text-primary leading-[1.1]">{{ $t('welcome.f5_title') }}</h2>
              <div class="text-[11px] leading-[1.4] text-text-secondary mt-0.5">{{ $t('welcome.f5_body') }}</div>
            </div>
            <div class="shrink-0 w-[104px]">
              <div class="flex justify-between items-baseline mb-1.5">
                <span class="text-[9px] text-text-secondary font-heading">Malazan</span>
                <span class="font-mono text-[10px] text-orange-neon">4/27</span>
              </div>
              <div class="flex gap-[3px]">
                <div v-for="i in 7" :key="i" class="flex-1 h-[7px]"
                  :style="i <= 4 ? 'background: rgb(var(--v-theme-primary))' : 'background: var(--color-charcoal-border)'">
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ── DESKTOP: Bento grid ────────────────────────────────────────────── -->
        <div class="hidden md:grid flex-1 min-h-0" style="grid-template-columns: 1.35fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 14px;">

          <!-- 01 Scan hero (row span 2) -->
          <div class="row-span-2 bg-charcoal-light border border-charcoal-border p-[26px] flex flex-col">
            <div class="flex items-baseline gap-3 mb-2.5">
              <span class="font-mono text-xs text-orange-neon tracking-[0.08em]">01</span>
              <span class="text-[10px] tracking-[0.25em] uppercase text-text-secondary font-bold">{{ $t('welcome.f1_label') }}</span>
            </div>
            <h2 class="font-heading font-black text-[34px] text-text-primary leading-[1.0] tracking-[-0.01em] mb-2.5">{{ $t('welcome.f1_title') }}</h2>
            <p class="text-[13.5px] leading-[1.55] text-text-secondary mb-[22px] max-w-[300px]">{{ $t('welcome.f1_body') }}</p>
            <div class="flex-1 flex items-center justify-center min-h-0">
              <div class="scanner-viewport scanner-viewport--lg">
                <div class="barcode barcode--lg"></div>
                <span class="corner corner--lg tl"></span>
                <span class="corner corner--lg tr"></span>
                <span class="corner corner--lg bl"></span>
                <span class="corner corner--lg br"></span>
                <div class="scan-beam scan-beam--lg"></div>
              </div>
            </div>
          </div>

          <!-- 02 Customize -->
          <div class="bg-charcoal-light border border-charcoal-border p-[22px] flex flex-col">
            <div class="flex items-baseline gap-2.5 mb-2">
              <span class="font-mono text-[11px] text-orange-neon">02</span>
              <span class="text-[9px] tracking-[0.22em] uppercase text-text-secondary font-bold">{{ $t('welcome.f2_label') }}</span>
            </div>
            <h2 class="font-heading font-bold text-[21px] text-text-primary leading-[1.05] mb-[13px]">{{ $t('welcome.f2_title') }}</h2>
            <p class="text-xs leading-[1.5] text-text-secondary mb-[13px]">{{ $t('welcome.f2_body') }}</p>
            <div class="mt-auto bg-charcoal border border-charcoal-border">
              <div class="flex justify-between items-center px-3 py-2 border-b border-charcoal-border">
                <span class="font-mono text-[9px] tracking-[0.14em] text-text-secondary uppercase">SHELF</span>
                <span class="font-mono text-[10px] text-text-primary">A-3 · BY WINDOW</span>
              </div>
              <div class="flex justify-between items-center px-3 py-2 border-b border-charcoal-border">
                <span class="font-mono text-[9px] tracking-[0.14em] text-text-secondary uppercase">CONDITION</span>
                <span class="font-mono text-[10px] text-text-primary">FINE · 1ST ED.</span>
              </div>
              <div class="flex justify-between items-center px-3 py-2">
                <span class="font-mono text-[9px] tracking-[0.14em] text-text-secondary uppercase">LENT TO</span>
                <span class="font-mono text-[10px] text-text-primary">SOPHIE K.</span>
              </div>
              <div class="flex items-center gap-2 px-3 py-[9px] border-t border-dashed" style="border-color: rgba(255,102,0,0.4); background: rgba(255,102,0,0.06)">
                <span class="font-mono text-xs text-orange-neon font-bold leading-none">+</span>
                <span class="font-mono text-[9px] tracking-[0.14em] text-orange-neon uppercase">{{ $t('welcome.f2_cta_full') }}</span>
              </div>
            </div>
          </div>

          <!-- 03 Track -->
          <div class="bg-charcoal-light border border-charcoal-border p-[22px] flex flex-col">
            <div class="flex items-baseline gap-2.5 mb-2">
              <span class="font-mono text-[11px] text-orange-neon">03</span>
              <span class="text-[9px] tracking-[0.22em] uppercase text-text-secondary font-bold">{{ $t('welcome.f3_label') }}</span>
            </div>
            <h2 class="font-heading font-bold text-[21px] text-text-primary leading-[1.05] mb-[14px]">{{ $t('welcome.f3_title') }}</h2>
            <p class="text-xs leading-[1.5] text-text-secondary mb-[13px]">{{ $t('welcome.f3_body') }}</p>
            <div class="mt-auto flex flex-col gap-2">
              <div class="inline-flex items-center gap-2 self-start px-3 py-1.5 border border-charcoal-border bg-charcoal">
                <span class="w-[7px] h-[7px] rounded-full" style="background: rgb(var(--v-theme-success))"></span>
                <span class="text-[10px] tracking-[0.12em] uppercase font-medium" style="color: rgb(var(--v-theme-success))">{{ $t('book.read') }}</span>
              </div>
              <div class="inline-flex items-center gap-2 self-start px-3 py-1.5 bg-charcoal" style="border: 1px solid rgba(255,102,0,0.5)">
                <span class="w-[7px] h-[7px] rounded-full" style="background: rgb(var(--v-theme-primary))"></span>
                <span class="text-[10px] tracking-[0.12em] uppercase font-medium text-orange-neon">{{ $t('book.reading') }}</span>
              </div>
              <div class="inline-flex items-center gap-2 self-start px-3 py-1.5 border border-charcoal-border bg-charcoal">
                <span class="w-[7px] h-[7px] rounded-full" style="background: var(--color-text-secondary)"></span>
                <span class="text-[10px] tracking-[0.12em] uppercase font-medium text-text-secondary">{{ $t('book.unread') }}</span>
              </div>
            </div>
          </div>

          <!-- 04 Search -->
          <div class="bg-charcoal-light border border-charcoal-border p-[22px] flex flex-col">
            <div class="flex items-baseline gap-2.5 mb-2">
              <span class="font-mono text-[11px] text-orange-neon">04</span>
              <span class="text-[9px] tracking-[0.22em] uppercase text-text-secondary font-bold">{{ $t('welcome.f4_label') }}</span>
            </div>
            <h2 class="font-heading font-bold text-[21px] text-text-primary leading-[1.05] mb-[14px]">{{ $t('welcome.f4_title') }}</h2>
            <p class="text-xs leading-[1.5] text-text-secondary mb-[13px]">{{ $t('welcome.f4_body') }}</p>
            <div class="mt-auto">
              <div class="flex items-center gap-2.5 bg-charcoal border border-charcoal-border px-[13px] py-[11px]">
                <span class="w-3 h-3 rounded-full border-2 border-text-secondary shrink-0"></span>
                <span class="text-[13px] text-text-primary">yeah of course I've read it<span class="blink-cursor">&nbsp;</span></span>
              </div>
              <div class="flex justify-between items-baseline pt-[9px] border-b border-charcoal-border">
                <span class="text-xs text-text-primary font-heading">Infinite Jest</span>
                <span class="font-mono text-[9px] text-text-secondary">David Foster Wallace</span>
              </div>
              <div class="flex justify-between items-baseline pt-[9px]">
                <span class="text-xs text-text-primary font-heading">Gravity's Rainbow</span>
                <span class="font-mono text-[9px] text-text-secondary">Thomas Pynchon</span>
              </div>
            </div>
          </div>

          <!-- 05 Series -->
          <div class="bg-charcoal-light border border-charcoal-border p-[22px] flex flex-col">
            <div class="flex items-baseline gap-2.5 mb-2">
              <span class="font-mono text-[11px] text-orange-neon">05</span>
              <span class="text-[9px] tracking-[0.22em] uppercase text-text-secondary font-bold">{{ $t('welcome.f5_label') }}</span>
            </div>
            <h2 class="font-heading font-bold text-[21px] text-text-primary leading-[1.05] mb-1.5">{{ $t('welcome.f5_title') }}</h2>
            <p class="text-xs leading-[1.5] text-text-secondary">{{ $t('welcome.f5_body') }}</p>
            <div class="mt-auto">
              <div class="flex justify-between items-baseline mb-[9px]">
                <span class="text-[11px] text-text-primary font-heading font-bold">Malazan Book of the Fallen</span>
                <span class="font-mono text-[11px] text-orange-neon">4 / 7</span>
              </div>
              <div class="flex gap-[5px]">
                <div v-for="i in 7" :key="i" class="flex-1 h-2"
                  :style="i <= 4 ? 'background: rgb(var(--v-theme-primary))' : 'background: var(--color-charcoal-border)'">
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

      <!-- CTA band (full width, outside padding) -->
      <div class="shrink-0 flex items-center justify-between px-5 md:px-[30px] py-[17px] md:py-[22px] mt-4 md:mt-0"
        style="background: rgb(var(--v-theme-primary))">
        <div class="font-heading font-black text-[18px] md:text-[26px] leading-tight tracking-[-0.01em] max-w-[150px] md:max-w-none"
          style="color: #111110">
          {{ $t('welcome.cta_headline') }}
        </div>
        <button
          class="flex items-center gap-[9px] md:gap-3 px-[17px] md:px-[26px] py-[13px] md:py-[15px] shrink-0 hover:opacity-90 transition-opacity"
          style="background: #111110"
          @click="start"
        >
          <div class="flex gap-1">
            <span class="w-[9px] h-[9px] md:w-[11px] md:h-[11px]" style="border-left: 2px solid #f0ede8; border-top: 2px solid #f0ede8"></span>
            <span class="w-[9px] h-[9px] md:w-[11px] md:h-[11px]" style="border-right: 2px solid #f0ede8; border-top: 2px solid #f0ede8"></span>
          </div>
          <span class="text-[10px] md:text-xs font-bold tracking-[0.16em] md:tracking-[0.2em] uppercase" style="color: #f0ede8">
            {{ $t('welcome.cta_label') }}
          </span>
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
@keyframes scanline {
  0%, 100% { transform: translate(-50%, -24px); opacity: 0.6; }
  50%       { transform: translate(-50%,  24px); opacity: 0.12; }
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.25; }
}

/* Scanner viewport */
.scanner-viewport {
  position: relative;
  background: #111110;
  border: 1px solid #2e2b28;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.scanner-viewport--sm  { width: 100%; height: 104px; }
.scanner-viewport--lg  { width: 300px; height: 170px; }

/* Barcode strip */
.barcode {
  width: 172px;
  height: 60px;
  opacity: 0.9;
  background: repeating-linear-gradient(
    90deg,
    #e8e4dd 0 3px,
    transparent 3px 7px,
    #e8e4dd 7px 9px,
    transparent 9px 12px,
    #e8e4dd 12px 16px,
    transparent 16px 22px
  );
}
.barcode--lg { height: 64px; }

/* Corner brackets */
.corner {
  position: absolute;
  border-color: #f0ede8;
  border-style: solid;
  width: 20px;
  height: 20px;
}
.corner.tl { top: 14px;    left: 14px;   border-width: 2px 0 0 2px; }
.corner.tr { top: 14px;    right: 14px;  border-width: 2px 2px 0 0; }
.corner.bl { bottom: 14px; left: 14px;   border-width: 0 0 2px 2px; }
.corner.br { bottom: 14px; right: 14px;  border-width: 0 2px 2px 0; }

.corner--lg { width: 28px; height: 28px; }
.corner--lg.tl { top: 18px;    left: 18px; }
.corner--lg.tr { top: 18px;    right: 18px; }
.corner--lg.bl { bottom: 18px; left: 18px; }
.corner--lg.br { bottom: 18px; right: 18px; }

/* Scan beam */
.scan-beam {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 188px;
  height: 2px;
  background: rgba(255, 102, 0, 0.75);
  animation: scanline 2.4s ease-in-out infinite;
}
.scan-beam--lg { width: 200px; }

/* Blinking cursor in search preview */
.blink-cursor {
  border-right: 2px solid rgb(var(--v-theme-primary));
  margin-left: 1px;
  animation: blink 1s step-end infinite;
}
</style>
