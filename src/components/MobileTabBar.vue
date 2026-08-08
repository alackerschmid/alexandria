<template>
  <nav
    class="md:hidden fixed inset-x-0 bottom-0 z-40 flex items-end justify-around bg-charcoal/95 backdrop-blur-sm border-t border-charcoal-border px-6 pt-2"
    :style="{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }"
  >
    <router-link
      v-for="(link, i) in sideLinks"
      :key="link.name"
      :to="link.to"
      class="flex flex-col items-center gap-1 flex-1 py-1 transition-colors"
      :class="[
        isActive(link.name) ? 'text-orange-neon' : 'text-text-secondary',
        // The scan button is the middle child, so the first slot renders before it and the
        // second after. Without this a one-slot bar would put its link on the wrong side.
        i === 0 ? 'order-1' : 'order-3',
      ]"
    >
      <v-icon
        :icon="isActive(link.name) ? link.activeIcon : link.icon"
        size="20"
      />
      <span class="font-mono text-[8px] tracking-[0.12em] uppercase">{{
        link.label
      }}</span>
    </router-link>

    <div class="order-2 flex flex-col items-center gap-1 flex-1 py-1">
      <router-link
        to="/scanner"
        class="flex flex-col items-center justify-center -mt-7 w-16 h-16 rounded-full shrink-0 shadow-[0_8px_22px_var(--tw-shadow-color)] shadow-orange-neon/40"
        style="background: rgb(var(--v-theme-primary))"
        :aria-label="$t('home.start_scanning')"
      >
        <v-icon icon="mdi-barcode" size="30" style="color: #111110" />
      </router-link>
    </div>
  </nav>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useNavLinks } from "@/composables/useNavLinks";

const route = useRoute();
const { navLinks } = useNavLinks();
const isActive = (name: string) => route.name === name;

/**
 * Which destinations may occupy the bar's two side slots, best first.
 *
 * Explicit, and deliberately not "whatever `navLinks` filters down to": the old code sliced the
 * filtered list and indexed `[0]`/`[1]`, so the moment that list didn't reduce to exactly two
 * entries a destination vanished with nothing to say so — which is what adding a fourth section
 * did. Naming the priority here means a new nav entry changes the bar only if it is put in this
 * list, and where it lands is a decision someone made rather than an accident of array order.
 *
 * `settings` is last on purpose: it is the least-visited of the four and, unlike the other
 * three, has a second mobile route in via the header's account menu. `scanner` is absent
 * because it owns the centre button.
 */
const MOBILE_SLOT_PRIORITY = ["dashboard", "library", "stats", "settings"];

// The bottom bar always centers the scan action; the two side slots show the highest-priority
// destinations that aren't the current section (the series detail page is reached from Library,
// so it counts as the library section).
const currentSection = computed(() =>
  route.name === "series" ? "library" : route.name,
);

const sideLinks = computed(() => {
  const byName = new Map(navLinks.value.map((l) => [l.name, l]));
  return MOBILE_SLOT_PRIORITY.filter((name) => name !== currentSection.value)
    .map((name) => byName.get(name))
    .filter((l) => l !== undefined)
    .slice(0, 2);
});
</script>
