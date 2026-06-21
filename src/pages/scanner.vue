<template>
  <div class="flex flex-col h-screen bg-black overflow-hidden">
    <!-- Camera / scanner area -->
    <div class="flex-1 relative overflow-hidden touch-none select-none">
      <!-- Camera (always running) -->
      <div
        ref="scannerContainer"
        class="scanner-viewport absolute inset-0"
      ></div>

      <!-- Flash overlay: brief orange pulse on detection -->
      <div
        class="absolute inset-0 bg-orange-neon pointer-events-none z-20 transition-opacity duration-150"
        :class="flash ? 'opacity-60' : 'opacity-0'"
      />

      <!-- Manual mode: charcoal backdrop so nothing shows through -->
      <div v-if="manualMode" class="absolute inset-0 z-0 bg-charcoal" />

      <!-- ── Top nav bar ──────────────────────────────────────────────────────── -->
      <div
        class="absolute top-0 inset-x-0 z-30 flex justify-between items-center px-4 md:px-6 py-3.5"
        :class="manualMode ? 'bg-charcoal border-b border-charcoal-border' : ''"
        :style="
          manualMode
            ? ''
            : 'background: linear-gradient(180deg, rgba(0,0,0,.6), transparent)'
        "
      >
        <!-- Back to library -->
        <button
          class="flex items-center gap-3 hover:opacity-80 transition-opacity"
          @click="router.push('/library')"
        >
          <span
            class="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            :class="
              manualMode
                ? 'bg-charcoal-light border border-charcoal-border text-text-primary'
                : 'border border-white/15 text-white'
            "
            :style="manualMode ? '' : 'background: rgba(20,19,16,.7)'"
          >
            <v-icon icon="mdi-arrow-left" size="18" />
          </span>
          <span
            class="text-[10px] tracking-[0.22em] uppercase"
            :class="manualMode ? 'text-text-secondary' : 'text-white/55'"
          >
            {{ $t("scanner.back_library") }}
          </span>
        </button>

        <!-- Session counter pill -->
        <button
          v-if="sessionBooks.length"
          class="flex items-center gap-2.5 px-3.5 py-2 hover:opacity-90 transition-opacity"
          style="
            background: rgba(20, 19, 16, 0.7);
            border: 1px solid rgba(255, 102, 0, 0.45);
          "
          @click="showReview = true"
        >
          <span
            class="w-1.5 h-1.5 rounded-full bg-orange-neon animate-pulse shrink-0"
          />
          <span
            class="text-white text-[11px] font-bold tracking-[0.14em] uppercase"
          >
            {{ $t("scanner.saved_count", { n: sessionBooks.length }) }}
          </span>
        </button>
      </div>

      <!-- ── Manual-entry screen (camera unavailable, or desktop default) ──────── -->
      <Transition name="fade">
        <div
          v-if="
            manualMode &&
            (scanState === 'scanning' || scanState === 'detecting')
          "
          class="absolute inset-0 z-25 bg-charcoal flex flex-col md:flex-row"
        >
          <!-- Entry form -->
          <div
            class="flex-1 flex flex-col px-8 md:px-14 pt-24 md:pt-0 md:justify-center md:border-r border-charcoal-border"
          >
            <form
              class="w-full max-w-md mx-auto md:mx-0 pb-12"
              @submit.prevent="submitManualIsbn"
            >
              <p
                class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3"
              >
                {{
                  cameraFailed
                    ? $t("scanner.manual_label")
                    : $t("scanner.add_label")
                }}
              </p>
              <h1
                class="font-heading text-5xl font-bold text-text-primary leading-[1.05] mb-5"
              >
                {{ $t("scanner.isbn_heading") }}
              </h1>
              <div class="flex items-start gap-2.5 mb-12">
                <v-icon
                  :icon="
                    cameraFailed ? 'mdi-camera-off-outline' : 'mdi-barcode'
                  "
                  size="15"
                  class="text-text-secondary/70 mt-0.5 shrink-0"
                />
                <p class="text-sm text-text-secondary leading-relaxed">
                  {{
                    cameraFailed
                      ? $t("scanner.camera_unavailable")
                      : $t("scanner.barcode_hint")
                  }}
                </p>
              </div>

              <div
                class="border-b mb-12 pb-2 transition-colors"
                :class="{
                  'border-charcoal-border': isbnState === 'hidden',
                  'border-success': isbnState === 'valid',
                  'border-error': isbnState === 'invalid',
                }"
              >
                <label
                  class="block text-[10px] tracking-[0.2em] uppercase mb-1 transition-colors"
                  :class="{
                    'text-text-secondary': isbnState === 'hidden',
                    'text-success': isbnState === 'valid',
                    'text-error': isbnState === 'invalid',
                  }"
                >
                  {{ $t("scanner.isbn_label") }}
                </label>
                <input
                  ref="manualEntryInput"
                  :value="manualIsbn"
                  type="text"
                  inputmode="numeric"
                  :disabled="scanState === 'detecting'"
                  placeholder="978…"
                  class="w-full bg-transparent text-text-primary text-lg font-mono tracking-wider outline-none placeholder:text-charcoal-border disabled:opacity-50"
                  @input="onIsbnInput"
                />
              </div>

              <button
                type="submit"
                :disabled="scanState === 'detecting'"
                class="w-full bg-orange-neon text-black py-4 text-xs font-bold tracking-[0.25em] uppercase transition-opacity disabled:opacity-50"
              >
                {{
                  scanState === "detecting"
                    ? $t("scanner.looking_up")
                    : $t("scanner.look_up")
                }}
              </button>

              <!-- Desktop: optional webcam fallback -->
              <button
                v-if="mdAndUp && !cameraFailed"
                type="button"
                class="mt-6 self-center flex items-center gap-2 text-[10px] text-text-secondary tracking-[0.2em] uppercase hover:text-text-primary transition-colors"
                @click="useCamera"
              >
                <v-icon icon="mdi-camera-outline" size="14" />
                {{ $t("scanner.use_camera") }}
              </button>
            </form>
          </div>

          <!-- Desktop: live session list -->
          <div
            v-if="mdAndUp"
            class="w-105 shrink-0 flex flex-col px-10 pt-24 pb-8"
          >
            <div class="flex justify-between items-baseline mb-1">
              <span
                class="text-[10px] text-text-secondary tracking-[0.26em] uppercase"
              >
                {{ $t("scanner.added_session") }}
              </span>
              <span class="font-mono text-[11px] text-orange-neon">
                {{ sessionBooks.length }}
              </span>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto">
              <p
                v-if="!sessionBooks.length"
                class="text-xs text-text-secondary/60 mt-6"
              >
                {{ $t("scanner.point_at_barcode") }}
              </p>
              <div
                v-for="b in sessionBooks"
                :key="b.isbn"
                class="flex gap-3.5 items-start py-4 border-b border-charcoal-border"
              >
                <div
                  class="w-9 h-14 shrink-0 relative overflow-hidden"
                  style="background: #232220; border: 1px solid #2e2b28"
                >
                  <img
                    v-if="b.coverUrl"
                    :src="b.coverUrl"
                    class="absolute inset-0 w-full h-full object-cover"
                  />
                  <div
                    v-else
                    class="absolute left-0 top-0 bottom-0 w-0.75 bg-orange-neon"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <p
                    class="font-heading font-bold text-sm text-text-primary leading-snug truncate"
                  >
                    {{ b.title }}
                  </p>
                  <p class="text-[11px] text-text-secondary mt-0.5 truncate">
                    {{ b.author }}
                  </p>
                  <span
                    class="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase mt-2"
                    :style="{ color: STATUS_COLORS[b.status] }"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full"
                      :style="{ background: STATUS_COLORS[b.status] }"
                    />
                    {{ statusLabels[b.status] }}
                  </span>
                </div>
                <div class="flex flex-col items-end gap-1.5 shrink-0">
                  <span
                    class="font-mono text-[9px] text-text-secondary/55 whitespace-nowrap pt-0.5"
                  >
                    {{ sessionTime(b.addedAt) }}
                  </span>
                  <button
                    class="text-text-secondary/45 hover:text-error transition-colors"
                    :title="$t('scanner.remove')"
                    @click="removeSessionBook(b)"
                  >
                    <v-icon icon="mdi-delete-outline" size="15" />
                  </button>
                </div>
              </div>
            </div>

            <button
              v-if="sessionBooks.length"
              class="shrink-0 mt-4 border border-charcoal-border text-text-primary text-[11px] font-bold tracking-[0.18em] uppercase py-4 hover:opacity-80 transition-opacity"
              @click="router.push('/library')"
            >
              {{ $t("scanner.done_library") }}
            </button>
          </div>
        </div>
      </Transition>

      <!-- ── Scanning frame + detecting status ────────────────────────────────── -->
      <div
        v-if="
          !manualMode && (scanState === 'scanning' || scanState === 'detecting')
        "
        class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
      >
        <div
          class="relative"
          style="
            width: 320px;
            height: 128px;
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
          "
        >
          <!-- Corner marks only — no inner fill -->
          <div
            class="absolute top-0 left-0 w-10 h-10 border-l-2 border-t-2 transition-all duration-200"
            :class="
              scanState === 'detecting' ? 'border-white' : 'border-white/40'
            "
          />
          <div
            class="absolute top-0 right-0 w-10 h-10 border-r-2 border-t-2 transition-all duration-200"
            :class="
              scanState === 'detecting' ? 'border-white' : 'border-white/40'
            "
          />
          <div
            class="absolute bottom-0 left-0 w-10 h-10 border-l-2 border-b-2 transition-all duration-200"
            :class="
              scanState === 'detecting' ? 'border-white' : 'border-white/40'
            "
          />
          <div
            class="absolute bottom-0 right-0 w-10 h-10 border-r-2 border-b-2 transition-all duration-200"
            :class="
              scanState === 'detecting' ? 'border-white' : 'border-white/40'
            "
          />

          <!-- Horizontal scan line (visible while idle) -->
          <div
            v-if="scanState === 'scanning'"
            class="absolute inset-x-4 top-1/2 -translate-y-1/2 h-2px bg-orange-neon/50 scan-line"
          />

          <!-- Guide text — anchored below the frame -->
          <div
            v-if="scanState === 'scanning'"
            class="absolute top-full left-1/2 -translate-x-1/2 mt-6 whitespace-nowrap pointer-events-none"
          >
            <span class="text-[10px] tracking-[0.25em] uppercase text-white/40">
              {{ $t("scanner.point_at_barcode") }}
            </span>
          </div>

          <!-- "Looking up" pill — anchored below the frame -->
          <Transition name="fade">
            <div
              v-if="scanState === 'detecting'"
              class="absolute top-full left-1/2 -translate-x-1/2 mt-6 flex items-center gap-2.5 px-5 py-2.5 whitespace-nowrap pointer-events-none"
              style="
                background: rgba(17, 17, 16, 0.88);
                border: 1px solid rgba(255, 102, 0, 0.55);
              "
            >
              <span
                class="w-1.5 h-1.5 rounded-full bg-orange-neon animate-pulse shrink-0"
              />
              <span
                class="text-white text-xs font-bold tracking-[0.2em] uppercase"
                >{{ $t("scanner.looking_up") }}</span
              >
            </div>
          </Transition>
        </div>
      </div>

      <!-- ── Session shelf peek (mobile camera view) ──────────────────────────── -->
      <Transition name="fade">
        <div
          v-if="
            !manualMode &&
            !mdAndUp &&
            scanState === 'scanning' &&
            sessionBooks.length
          "
          class="absolute inset-x-0 bottom-0 z-20 px-4 pt-12 pb-4 pointer-events-none"
          style="
            background: linear-gradient(
              180deg,
              rgba(17, 17, 16, 0) 0%,
              #111110 28%
            );
          "
        >
          <div class="flex justify-between items-center mb-3">
            <span class="text-[10px] text-white/50 tracking-[0.26em] uppercase">
              {{ $t("scanner.scanned_session") }}
            </span>
            <button
              class="flex items-center gap-1.5 text-orange-neon text-[10px] tracking-[0.18em] uppercase pointer-events-auto"
              @click="showReview = true"
            >
              {{ $t("scanner.review") }}
              <v-icon icon="mdi-chevron-up" size="14" />
            </button>
          </div>
          <div class="flex gap-2.5">
            <div
              v-for="b in sessionBooks.slice(0, 3)"
              :key="b.isbn"
              class="flex gap-2.5 items-center flex-1 min-w-0"
              style="
                background: #1c1b19;
                border: 1px solid #2e2b28;
                padding: 9px 11px;
              "
            >
              <div
                class="w-6 h-8.5 shrink-0 relative overflow-hidden"
                style="background: #232220; border: 1px solid #2e2b28"
              >
                <img
                  v-if="b.coverUrl"
                  :src="b.coverUrl"
                  class="absolute inset-0 w-full h-full object-cover"
                />
                <div
                  v-else
                  class="absolute left-0 top-0 bottom-0 w-0.5 bg-orange-neon"
                />
              </div>
              <div class="min-w-0">
                <p
                  class="font-heading font-bold text-[11px] text-white leading-tight truncate"
                >
                  {{ b.title }}
                </p>
                <p class="text-[9px] text-white/50 mt-0.5 truncate">
                  {{ b.author }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- ── Detected-book sheet ──────────────────────────────────────────────── -->
      <Transition name="slide-up">
        <div
          v-if="
            (scanState === 'preview' || scanState === 'saving') && detectedBook
          "
          class="absolute bottom-0 left-0 right-0 z-40 md:flex md:justify-center md:pointer-events-none"
        >
          <div
            class="px-6 pt-6 pb-8 md:max-w-md md:w-full md:mb-12 md:border md:border-charcoal-border md:pointer-events-auto"
            style="background: #111110"
          >
            <!-- Drag handle (mobile) -->
            <div
              class="md:hidden w-9 h-1 rounded-sm mx-auto mb-5"
              style="background: #2e2b28"
            />

            <!-- Match indicator -->
            <div class="flex items-center gap-2 mb-4">
              <span
                class="w-1.5 h-1.5 rounded-full shrink-0"
                :style="{ background: detectedIndicator.color }"
              />
              <span
                class="text-[10px] tracking-[0.24em] uppercase font-medium"
                :style="{ color: detectedIndicator.color }"
              >
                {{ detectedIndicator.label }}
              </span>
            </div>

            <!-- Book info -->
            <div class="flex gap-4 mb-6">
              <img
                v-if="detectedBook.coverUrl"
                :src="detectedBook.coverUrl"
                class="w-20 h-30 object-cover shrink-0"
              />
              <div
                v-else
                class="w-20 h-30 flex items-center justify-center shrink-0"
                style="background: #1c1b19; border: 1px solid #2e2b28"
              >
                <v-icon icon="mdi-book-outline" size="28" color="grey" />
              </div>

              <div class="flex-1 min-w-0">
                <p
                  v-if="detectedBook.notFound"
                  class="text-lg text-white/40 italic leading-snug mb-1"
                >
                  {{ $t("scanner.unknown_book") }}
                </p>
                <p
                  v-else
                  class="font-heading text-xl font-black text-white leading-tight line-clamp-3 mb-2"
                >
                  {{ detectedBook.title }}
                </p>
                <p
                  v-if="!detectedBook.notFound"
                  class="text-[13px] text-white/65"
                >
                  {{ detectedBook.author }}
                </p>

                <!-- Metadata chips -->
                <div
                  v-if="detectedMeta.length"
                  class="flex flex-wrap gap-1.5 mt-4"
                >
                  <span
                    v-for="(chip, i) in detectedMeta"
                    :key="i"
                    class="font-mono text-[10px] text-white/55 px-2 py-1"
                    style="border: 1px solid #2e2b28"
                  >
                    {{ chip }}
                  </span>
                </div>
                <p v-else class="text-[10px] text-white/30 font-mono mt-3">
                  {{ detectedBook.isbn }}
                </p>
              </div>
            </div>

            <!-- Already in the library: read-only summary, no save -->
            <template v-if="detectedBook.duplicate">
              <div
                v-if="detectedBook.currentStatus"
                class="flex items-center gap-2.5 mb-6"
              >
                <span
                  class="text-[10px] text-white/50 tracking-[0.24em] uppercase"
                >
                  {{ $t("scanner.shelved_as") }}
                </span>
                <span
                  class="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase"
                  :style="{ color: STATUS_COLORS[detectedBook.currentStatus] }"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{
                      background: STATUS_COLORS[detectedBook.currentStatus],
                    }"
                  />
                  {{ statusLabels[detectedBook.currentStatus] }}
                </span>
              </div>
              <button
                class="w-full bg-orange-neon text-black py-4 text-xs font-bold tracking-[0.25em] uppercase transition-opacity hover:opacity-90"
                @click="scanAgain"
              >
                {{ $t("scanner.continue_scanning") }}
              </button>
            </template>

            <!-- Guest limit reached: prompt to create account -->
            <template v-else-if="isGuest && guestStore.isAtLimit">
              <p class="text-sm font-bold text-white mb-1">
                {{ $t("guest.limit_heading") }}
              </p>
              <p class="text-xs text-white/50 mb-6">
                {{ $t("guest.limit_body") }}
              </p>
              <button
                class="w-full bg-orange-neon text-black py-4 text-xs font-bold tracking-[0.25em] uppercase mb-3"
                @click="router.push('/login?mode=register')"
              >
                {{ $t("guest.register") }}
              </button>
              <button
                class="w-full text-white/40 text-xs tracking-[0.2em] uppercase py-2"
                @click="scanAgain"
              >
                {{ $t("guest.sign_in") }}
              </button>
            </template>

            <!-- Normal save actions -->
            <template v-else>
              <!-- Status picker -->
              <p
                class="text-[10px] text-white/50 tracking-[0.24em] uppercase mb-2.5"
              >
                {{ $t("scanner.shelve_as") }}
              </p>
              <div class="flex gap-2 mb-6">
                <button
                  v-for="s in STATUS_ORDER"
                  :key="s"
                  type="button"
                  class="flex-1 flex items-center justify-center gap-1.5 py-3 text-[10px] tracking-[0.14em] uppercase transition-colors"
                  :style="
                    selectedStatus === s
                      ? `border: 1px solid ${STATUS_COLORS[s]}; background: ${STATUS_TINT[s]}; color: #f0ede8`
                      : 'border: 1px solid #2e2b28; color: #8a8078'
                  "
                  @click="selectedStatus = s"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{ background: STATUS_COLORS[s] }"
                  />
                  {{ statusLabels[s] }}
                </button>
              </div>

              <button
                class="w-full bg-orange-neon text-black py-4 text-xs font-bold tracking-[0.25em] uppercase mb-3 transition-opacity disabled:opacity-40"
                :disabled="scanState === 'saving'"
                @click="saveBook"
              >
                {{
                  scanState === "saving"
                    ? "—"
                    : detectedBook.notFound
                      ? $t("scanner.save_isbn")
                      : $t("scanner.save_book")
                }}
              </button>
              <button
                class="w-full text-white/40 text-xs tracking-[0.2em] uppercase py-2 disabled:opacity-40"
                :disabled="scanState === 'saving'"
                @click="scanAgain"
              >
                {{ $t("scanner.discard") }}
              </button>
            </template>
          </div>
        </div>
      </Transition>

      <!-- ── Session review (bottom sheet, sized to content) ──────────────────── -->
      <Transition name="slide-up">
        <div
          v-if="showReview"
          class="absolute bottom-0 left-0 right-0 z-50 md:flex md:justify-center md:pointer-events-none"
        >
          <div
            class="bg-charcoal border-t border-charcoal-border flex flex-col max-h-[85vh] md:max-h-[80vh] md:max-w-md md:w-full md:mb-12 md:border md:border-charcoal-border md:pointer-events-auto"
          >
            <!-- Header -->
            <div
              class="shrink-0 flex items-center gap-3 px-4 md:px-6 py-3.5 border-b border-charcoal-border"
            >
              <button
                class="w-9 h-9 rounded-full bg-charcoal-light border border-charcoal-border flex items-center justify-center text-text-primary shrink-0 hover:opacity-80 transition-opacity"
                @click="showReview = false"
              >
                <v-icon icon="mdi-chevron-down" size="20" />
              </button>
              <div class="min-w-0">
                <p
                  class="text-[9px] text-text-secondary tracking-[0.26em] uppercase"
                >
                  {{ $t("scanner.this_session") }}
                </p>
                <p
                  class="font-heading font-black text-lg text-text-primary leading-tight"
                >
                  {{
                    $t(
                      "scanner.session_count",
                      { n: sessionBooks.length },
                      sessionBooks.length,
                    )
                  }}
                </p>
              </div>
            </div>

            <!-- List -->
            <div class="flex-1 min-h-0 overflow-y-auto">
              <TransitionGroup name="list">
                <div
                  v-for="b in sessionBooks"
                  :key="b.isbn"
                  class="relative overflow-hidden border-b border-charcoal-border"
                >
                  <!-- Delete affordance, revealed while swiping left -->
                  <div
                    class="absolute inset-0 flex items-center justify-end px-6 pointer-events-none"
                    style="background: rgb(var(--v-theme-error))"
                  >
                    <v-icon
                      icon="mdi-delete-outline"
                      size="20"
                      style="color: #fff"
                    />
                  </div>
                  <!-- Row content (swipes on touch; delete button on desktop) -->
                  <div
                    class="relative flex gap-4 items-start py-5 px-4 md:px-6 bg-charcoal"
                    :class="swipeIsbn === b.isbn ? '' : 'swipe-snap'"
                    :style="{
                      transform: `translateX(${swipeIsbn === b.isbn ? swipeX : 0}px)`,
                    }"
                    @touchstart="onSwipeStart(b.isbn, $event)"
                    @touchmove="onSwipeMove($event)"
                    @touchend="onSwipeEnd(b)"
                    @touchcancel="onSwipeCancel"
                  >
                    <div
                      class="w-12 h-18 shrink-0 relative overflow-hidden"
                      style="background: #232220; border: 1px solid #2e2b28"
                    >
                      <img
                        v-if="b.coverUrl"
                        :src="b.coverUrl"
                        class="absolute inset-0 w-full h-full object-cover"
                      />
                      <div
                        v-else
                        class="absolute left-0 top-0 bottom-0 w-0.75 bg-orange-neon"
                      />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p
                        class="font-heading font-bold text-base text-text-primary leading-snug"
                      >
                        {{ b.title }}
                      </p>
                      <p class="text-xs text-text-secondary mt-1">
                        {{ b.author }}
                      </p>
                      <div class="flex items-center gap-3 mt-2.5">
                        <span
                          class="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase"
                          :style="{ color: STATUS_COLORS[b.status] }"
                        >
                          <span
                            class="w-1.5 h-1.5 rounded-full"
                            :style="{ background: STATUS_COLORS[b.status] }"
                          />
                          {{ statusLabels[b.status] }}
                        </span>
                        <span
                          class="font-mono text-[9px] text-text-secondary/55 tracking-wide"
                        >
                          {{ b.isbn }}
                        </span>
                      </div>
                    </div>
                    <div class="flex flex-col items-end gap-2 shrink-0 pt-1">
                      <span
                        class="font-mono text-[9px] text-text-secondary/55 whitespace-nowrap"
                      >
                        {{ sessionTime(b.addedAt) }}
                      </span>
                      <button
                        class="hidden md:flex text-text-secondary/45 hover:text-error transition-colors"
                        :title="$t('scanner.remove')"
                        @click="removeSessionBook(b)"
                      >
                        <v-icon icon="mdi-delete-outline" size="16" />
                      </button>
                    </div>
                  </div>
                </div>
              </TransitionGroup>
            </div>

            <!-- Footer actions -->
            <div
              class="shrink-0 px-4 md:px-6 py-4 border-t border-charcoal-border flex gap-3"
            >
              <button
                class="w-36 shrink-0 border border-charcoal-border text-text-primary text-[11px] font-bold tracking-[0.18em] uppercase py-4 hover:opacity-80 transition-opacity"
                @click="showReview = false"
              >
                {{ $t("scanner.scan_more") }}
              </button>
              <button
                class="flex-1 bg-orange-neon text-black text-[11px] font-bold tracking-[0.18em] uppercase py-4 hover:opacity-90 transition-opacity"
                @click="router.push('/library')"
              >
                {{ $t("scanner.done_library") }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Toast -->
      <AppToast
        v-model="toast"
        :message="toastMessage"
        :type="toastType"
        location="bottom"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import { useAuthStore } from "@/stores/auth";
import { useGuestStore } from "@/stores/guest";
import { useApi } from "@/composables/useApi";
import type { ReadStatus } from "@/components/BookCard.vue";
import Quagga from "@ericblade/quagga2";
import AppToast, { type ToastType } from "@/components/AppToast.vue";

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const guestStore = useGuestStore();
const { mdAndUp } = useDisplay();
const { apiFetch } = useApi();

const isGuest = computed(() => !authStore.isAuthenticated);
const API_BASE = import.meta.env.VITE_API_URL || "";

// ── Debug toggles ─────────────────────────────────────────────────────────────
// Set to false to keep the camera UI even when Quagga fails (useful for testing
// the camera overlay on desktop without triggering manual-entry fallback).
const FALLBACK_TO_MANUAL_ON_CAMERA_FAIL = false;

// ── Status presentation ─────────────────────────────────────────────────────────
const STATUS_ORDER: ReadStatus[] = ["unread", "reading", "read"];
const STATUS_COLORS: Record<ReadStatus, string> = {
  unread: "#8a8078",
  reading: "#ff6600",
  read: "#22c55e",
};
const STATUS_TINT: Record<ReadStatus, string> = {
  unread: "rgba(138,128,120,0.12)",
  reading: "rgba(255,102,0,0.10)",
  read: "rgba(34,197,94,0.10)",
};
const statusLabels = computed<Record<ReadStatus, string>>(() => ({
  unread: t("book.unread"),
  reading: t("book.reading"),
  read: t("book.read"),
}));

// ── State machine ─────────────────────────────────────────────────────────────

type ScanState = "scanning" | "detecting" | "preview" | "saving";

interface BookPreview {
  isbn: string;
  title: string;
  author: string;
  year?: string;
  pages?: number;
  language?: string;
  publisher?: string;
  coverUrl?: string;
  notFound?: boolean;
  duplicate?: boolean;
  currentStatus?: ReadStatus;
}

const scanState = ref<ScanState>("scanning");
const detectedBook = ref<BookPreview | null>(null);
const selectedStatus = ref<ReadStatus>("read");
const flash = ref(false);

// Metadata chips for the detected-book sheet (year · pages · language · publisher).
const detectedMeta = computed<string[]>(() => {
  const b = detectedBook.value;
  if (!b || b.notFound) return [];
  const chips: string[] = [];
  if (b.year) chips.push(b.year);
  if (b.pages) chips.push(t("book.pages", { n: b.pages }));
  if (b.language) chips.push(b.language.toUpperCase());
  if (b.publisher) chips.push(b.publisher);
  return chips;
});

const DUPLICATE_COLOR = "#e8a838";

// Indicator shown at the top of the detected-book sheet — green match, amber
// duplicate, grey no-match.
const detectedIndicator = computed(() => {
  const b = detectedBook.value;
  if (!b) return { color: "#8a8078", label: "" };
  if (b.duplicate)
    return { color: DUPLICATE_COLOR, label: t("scanner.in_library") };
  if (b.notFound) return { color: "#8a8078", label: t("scanner.no_match") };
  return { color: "#22c55e", label: t("scanner.match_found") };
});

// ── Session shelf ──────────────────────────────────────────────────────────────
// Books added during this scanning session — drives the counter pill, the camera
// shelf peek, the desktop list and the full-screen review.

interface SessionBook {
  isbn: string;
  title: string;
  author: string;
  status: ReadStatus;
  coverUrl?: string;
  addedAt: number;
  // Server scan id when saved online (authenticated) — needed to delete it.
  // Absent for guest scans and offline-queued saves.
  scanId?: number;
}

const sessionBooks = ref<SessionBook[]>([]);
const showReview = ref(false);

function recordSession(book: BookPreview, status: ReadStatus, scanId?: number) {
  sessionBooks.value.unshift({
    isbn: book.isbn,
    title: book.title || book.isbn,
    author: book.author || t("book.unknown_author"),
    status,
    coverUrl: book.coverUrl,
    addedAt: Date.now(),
    scanId,
  });
}

function sessionTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return t("scanner.time_now");
  return t("scanner.time_min_ago", { n: mins });
}

// ISBNs already handled this session — prevents accidental re-scans while
// the camera is still pointed at the same barcode after saving (and ensures the
// duplicate sheet shows at most once per book per session).
const sessionScanned = new Set<string>();

// Books already in the library, keyed by ISBN → current status. Populated on
// mount and kept in sync on save/delete; drives duplicate detection.
const libraryBooks = new Map<string, ReadStatus>();

async function loadLibraryIsbns() {
  if (isGuest.value) {
    guestStore.scans.forEach((b) => libraryBooks.set(b.isbn, b.status));
    return;
  }
  try {
    const res = await apiFetch(`/api/scans?limit=500`);
    if (res.ok) {
      const data: { isbn: string; status: ReadStatus }[] = await res.json();
      data.forEach((b) => libraryBooks.set(b.isbn, b.status));
    }
  } catch {}
}

// ── Manual ISBN entry ─────────────────────────────────────────────────────────

const manualIsbn = ref("");
const cameraFailed = ref(false);

// 'hidden' = too short to judge, 'valid' = 10 or 13 digits, 'invalid' = wrong length
const isbnState = computed<'hidden' | 'valid' | 'invalid'>(() => {
  const len = manualIsbn.value.length;
  if (len < 10) return 'hidden';
  if (len === 10 || len === 13) return 'valid';
  return 'invalid';
});
// Desktop opts into the camera explicitly; mobile starts it automatically.
const cameraActive = ref(false);
const manualEntryInput = ref<HTMLInputElement | null>(null);

// The manual-entry screen is the primary view when the camera failed, or on
// desktop until the user explicitly chooses to use a webcam.
const manualMode = computed(
  () => cameraFailed.value || (mdAndUp.value && !cameraActive.value),
);

const focusManualEntry = () => {
  nextTick(() => manualEntryInput.value?.focus());
};

// Keep the manual-entry field focused each time we return to the scanning state
// (e.g. after saving or dismissing a preview) while in manual mode.
watch(scanState, (state) => {
  if (state === "scanning" && manualMode.value) focusManualEntry();
});

function onIsbnInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const filtered = input.value.replace(/[^0-9xX]/g, "").slice(0, 13);
  input.value = filtered;
  manualIsbn.value = filtered;
}

const submitManualIsbn = () => {
  const isbn = manualIsbn.value;
  if (isbn.length !== 10 && isbn.length !== 13) return;
  manualIsbn.value = "";
  onBarcodeDetected(isbn.toUpperCase());
};

// Desktop: start the webcam on demand from the manual-entry screen.
const useCamera = () => {
  cameraActive.value = true;
  nextTick(startScanner);
};

// ── Toast ─────────────────────────────────────────────────────────────────────

const toast = ref(false);
const toastMessage = ref("");
const toastType = ref<ToastType>("success");

const showToast = (message: string, type: ToastType = "success") => {
  toastMessage.value = message;
  toastType.value = type;
  toast.value = true;
};

// ── Book lookup ───────────────────────────────────────────────────────────────

async function lookupBook(isbn: string): Promise<BookPreview | null> {
  try {
    const endpoint = isGuest.value
      ? `${API_BASE}/api/books/guest-lookup?isbn=${isbn}`
      : `${API_BASE}/api/books/lookup?isbn=${isbn}`;
    const headers: Record<string, string> = isGuest.value
      ? {}
      : { Authorization: `Bearer ${authStore.token}` };
    const res = await fetch(endpoint, { headers });
    if (res.ok) {
      const book = await res.json();
      if (book.notFound) return null;
      return {
        isbn: book.isbn,
        title: book.title ?? "",
        author: book.author ?? t("book.unknown_author"),
        year: book.publish_date?.slice(0, 4),
        pages: book.number_of_pages_median ?? undefined,
        language: book.language ?? undefined,
        publisher: book.publisher ?? undefined,
        coverUrl: book.cover_url ?? undefined,
      };
    }
  } catch {}
  return null;
}

// ── Detection handler ─────────────────────────────────────────────────────────

const onBarcodeDetected = async (isbn: string) => {
  if (scanState.value !== "scanning") return;

  // Already handled this session — ignore silently so the camera can keep running
  // (and so a just-saved book in view doesn't immediately re-trigger the sheet).
  if (sessionScanned.has(isbn)) return;

  const duplicate = libraryBooks.has(isbn);

  scanState.value = "detecting";
  flash.value = true;
  navigator.vibrate?.(50);
  setTimeout(() => (flash.value = false), 200);

  const book = await lookupBook(isbn);
  detectedBook.value = {
    ...(book ?? { isbn, title: "", author: "", notFound: true }),
    duplicate,
    currentStatus: duplicate ? libraryBooks.get(isbn) : undefined,
  };
  selectedStatus.value = "read";
  scanState.value = "preview";

  // A duplicate gets shown once, then suppressed for the rest of the session.
  if (duplicate) sessionScanned.add(isbn);
};

// ── Offline queue ─────────────────────────────────────────────────────────────

interface QueuedBook {
  isbn: string;
  status?: ReadStatus;
}

const QUEUE_KEY = "bookscan_queue_v3";

function enqueue(book: QueuedBook) {
  const q: QueuedBook[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  if (!q.some((b) => b.isbn === book.isbn)) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...q, book]));
  }
}

async function patchStatus(id: number, status: ReadStatus) {
  try {
    await apiFetch(`/api/scans/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  } catch {}
}

async function postScan(
  book: QueuedBook,
): Promise<{ result: "saved" | "duplicate"; id?: number }> {
  const res = await apiFetch(`/api/scans`, {
    method: "POST",
    body: JSON.stringify({ isbn: book.isbn }),
  });
  if (res.status === 409) return { result: "duplicate" };
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
  const saved = await res.json();
  return { result: "saved", id: saved?.id };
}

async function drainQueue() {
  const q: QueuedBook[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  if (!q.length) return;
  const remaining: QueuedBook[] = [];
  let authExpired = false;
  for (const book of q) {
    if (authExpired) {
      remaining.push(book);
      continue;
    }
    try {
      const res = await apiFetch(`/api/scans`, {
        method: "POST",
        body: JSON.stringify({ isbn: book.isbn }),
      });
      if (res.status === 401) {
        authExpired = true;
        remaining.push(book);
      } else if (res.status !== 409 && !res.ok) {
        remaining.push(book);
      } else if (res.ok) {
        // Backfill the server scan id onto the matching session entry so it can
        // still be deleted, and apply any non-default status.
        try {
          const saved = await res.json();
          if (saved?.id) {
            const entry = sessionBooks.value.find((b) => b.isbn === book.isbn);
            if (entry) entry.scanId = saved.id;
            if (book.status && book.status !== "unread") {
              await patchStatus(saved.id, book.status);
            }
          }
        } catch {}
      }
    } catch {
      remaining.push(book);
    }
  }
  if (authExpired) {
    showToast(t("scanner.toast_session_expired"), "warning");
  }
  remaining.length
    ? localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
    : localStorage.removeItem(QUEUE_KEY);
}

// ── Actions ───────────────────────────────────────────────────────────────────

const saveBook = async () => {
  if (!detectedBook.value) return;
  const book = detectedBook.value;
  const status = selectedStatus.value;

  // Guest path
  if (isGuest.value) {
    if (guestStore.isAtLimit) return;
    const result = guestStore.addScan(
      {
        isbn: book.isbn,
        title: book.title || null,
        author: book.author || null,
        cover_url: book.coverUrl ?? null,
        publish_date: book.year ? `${book.year}` : null,
      },
      status,
    );
    if (result === "ok") {
      sessionScanned.add(book.isbn);
      libraryBooks.set(book.isbn, status);
      recordSession(book, status);
    }
    detectedBook.value = null;
    scanState.value = "scanning";
    return;
  }

  // Authenticated path
  scanState.value = "saving";
  const queued: QueuedBook = { isbn: book.isbn, status };
  try {
    const { result, id } = await postScan(queued);
    sessionScanned.add(book.isbn);
    libraryBooks.set(book.isbn, status);
    // result === "duplicate" → already in the library; nothing to add to the session.
    if (result === "saved") {
      if (status !== "unread" && id) await patchStatus(id, status);
      recordSession(book, status, id);
    }
  } catch {
    if (!navigator.onLine) {
      enqueue(queued);
      sessionScanned.add(book.isbn);
      libraryBooks.set(book.isbn, status);
      recordSession(book, status);
      showToast(t("scanner.toast_will_sync"), "warning");
    } else {
      showToast(t("scanner.toast_failed"), "error");
      scanState.value = "preview";
      return;
    }
  }

  detectedBook.value = null;
  scanState.value = "scanning";
};

const scanAgain = () => {
  detectedBook.value = null;
  selectedStatus.value = "read";
  scanState.value = "scanning";
};

// ── Removing session books ──────────────────────────────────────────────────────

function dequeue(isbn: string) {
  const q: QueuedBook[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  const filtered = q.filter((b) => b.isbn !== isbn);
  filtered.length
    ? localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered))
    : localStorage.removeItem(QUEUE_KEY);
}

async function removeSessionBook(book: SessionBook) {
  // Optimistically drop it from the session UI and the local indices.
  sessionBooks.value = sessionBooks.value.filter((b) => b.isbn !== book.isbn);
  sessionScanned.delete(book.isbn);
  libraryBooks.delete(book.isbn);
  if (!sessionBooks.value.length) showReview.value = false;

  if (isGuest.value) {
    guestStore.removeScan(book.isbn);
    return;
  }
  if (book.scanId) {
    // Saved online — delete the server scan.
    try {
      await apiFetch(`/api/scans/${book.scanId}`, { method: "DELETE" });
    } catch {}
  } else {
    // Saved offline and still pending — drop it from the sync queue.
    dequeue(book.isbn);
  }
}

// ── Swipe-to-delete (touch) ─────────────────────────────────────────────────────

const swipeIsbn = ref<string | null>(null);
const swipeX = ref(0);
let swipeStartX = 0;
let swipeStartY = 0;

function onSwipeStart(isbn: string, e: TouchEvent) {
  swipeIsbn.value = isbn;
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
  swipeX.value = 0;
}

function onSwipeMove(e: TouchEvent) {
  if (swipeIsbn.value === null) return;
  const dx = e.touches[0].clientX - swipeStartX;
  const dy = e.touches[0].clientY - swipeStartY;
  // Once the gesture is clearly horizontal, take over from vertical scrolling.
  if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
  swipeX.value = Math.min(0, dx);
}

function onSwipeEnd(book: SessionBook) {
  if (swipeIsbn.value === null) return;
  const triggered = swipeX.value < -120;
  swipeIsbn.value = null;
  swipeX.value = 0;
  if (triggered) removeSessionBook(book);
}

function onSwipeCancel() {
  swipeIsbn.value = null;
  swipeX.value = 0;
}

// ── Camera lifecycle ──────────────────────────────────────────────────────────

const scannerContainer = ref<HTMLDivElement | null>(null);
let scannerStarted = false;

// Require 2 consecutive reads of the same code before firing — filters noise
// without adding perceptible delay at typical camera frame rates.
const detectionBuffer: string[] = [];
const REQUIRED_HITS = 2;

const onQuaggaDetected = (result: { codeResult: { code: string | null } }) => {
  const code = result.codeResult.code;
  if (!code) return;

  detectionBuffer.push(code);
  if (detectionBuffer.length > REQUIRED_HITS) detectionBuffer.shift();

  if (
    detectionBuffer.length === REQUIRED_HITS &&
    detectionBuffer.every((c) => c === code)
  ) {
    detectionBuffer.length = 0;
    onBarcodeDetected(code);
  }
};

const startScanner = () => {
  if (!scannerContainer.value) return;

  Quagga.init(
    {
      inputStream: {
        type: "LiveStream",
        target: scannerContainer.value,
        constraints: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      locator: { patchSize: "medium", halfSample: true },
      // numOfWorkers: 0 avoids Vite/worker-blob compatibility issues
      numOfWorkers: 0,
      decoder: { readers: ["ean_reader", "ean_8_reader"] },
      locate: true,
    },
    (err: unknown) => {
      if (err) {
        console.error(err);
        if (FALLBACK_TO_MANUAL_ON_CAMERA_FAIL) {
          cameraFailed.value = true;
          focusManualEntry();
        }
        return;
      }
      Quagga.start();
      scannerStarted = true;
    },
  );

  Quagga.onDetected(onQuaggaDetected);
};

onMounted(() => {
  drainQueue();
  loadLibraryIsbns();
  window.addEventListener("online", drainQueue);
  // Desktop defaults to manual entry; the camera is opt-in there.
  if (manualMode.value) {
    focusManualEntry();
  } else {
    startScanner();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("online", drainQueue);
  Quagga.offDetected(onQuaggaDetected);
  if (scannerStarted) Quagga.stop();
});
</script>

<style>
/* Quagga2 inserts <video> and a debug <canvas> into .scanner-viewport */
.scanner-viewport video {
  object-fit: cover !important;
  width: 100% !important;
  height: 100% !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
}
canvas.drawingBuffer {
  display: none !important;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Swipe-to-delete: snap the row back when not actively dragging. */
.swipe-snap {
  transition: transform 0.2s ease;
}

/* Session list removal (swipe past threshold, or desktop delete button). */
.list-leave-active {
  transition: all 0.25s ease;
}
.list-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

@keyframes scan {
  0%,
  100% {
    opacity: 0.5;
    transform: translateY(-12px);
  }
  50% {
    opacity: 0.15;
    transform: translateY(12px);
  }
}
.scan-line {
  animation: scan 2s ease-in-out infinite;
}
</style>
