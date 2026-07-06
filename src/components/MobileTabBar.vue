<template>
  <nav
    class="md:hidden fixed inset-x-0 bottom-0 z-40 flex items-end justify-around bg-charcoal/95 backdrop-blur-sm border-t border-charcoal-border px-6 pt-2"
    :style="{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }"
  >
    <router-link
      :to="sideLinks[0].to"
      class="flex flex-col items-center gap-1 flex-1 py-1 transition-colors"
      :class="
        isActive(sideLinks[0].name) ? 'text-orange-neon' : 'text-text-secondary'
      "
    >
      <v-icon
        :icon="
          isActive(sideLinks[0].name)
            ? sideLinks[0].activeIcon
            : sideLinks[0].icon
        "
        size="20"
      />
      <span class="font-mono text-[8px] tracking-[0.12em] uppercase">{{
        sideLinks[0].label
      }}</span>
    </router-link>

    <div class="flex flex-col items-center gap-1 flex-1 py-1">
      <router-link
        to="/scanner"
        class="flex flex-col items-center justify-center -mt-7 w-16 h-16 rounded-full shrink-0"
        style="
          background: rgb(var(--v-theme-primary));
          box-shadow: 0 8px 22px rgba(255, 102, 0, 0.4);
        "
        :aria-label="$t('home.start_scanning')"
      >
        <v-icon icon="mdi-barcode" size="30" style="color: #111110" />
      </router-link>
    </div>

    <router-link
      :to="sideLinks[1].to"
      class="flex flex-col items-center gap-1 flex-1 py-1 transition-colors"
      :class="
        isActive(sideLinks[1].name) ? 'text-orange-neon' : 'text-text-secondary'
      "
    >
      <v-icon
        :icon="
          isActive(sideLinks[1].name)
            ? sideLinks[1].activeIcon
            : sideLinks[1].icon
        "
        size="20"
      />
      <span class="font-mono text-[8px] tracking-[0.12em] uppercase">{{
        sideLinks[1].label
      }}</span>
    </router-link>
  </nav>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useNavLinks } from "@/composables/useNavLinks";

const route = useRoute();
const { navLinks } = useNavLinks();
const isActive = (name: string) => route.name === name;

// The bottom bar always centers the scan action; the two side slots show
// whichever of Home/Library/Settings isn't the current section (the series
// detail page is reached from Library, so it counts as the library section).
const currentSection = computed(() =>
  route.name === "series" ? "library" : route.name,
);

const sideLinks = computed(() =>
  navLinks.value.filter(
    (l) => l.name !== "scanner" && l.name !== currentSection.value,
  ),
);
</script>
