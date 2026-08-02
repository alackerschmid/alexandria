<template>
  <header
    class="shrink-0 flex justify-between items-center px-6 md:px-14 py-4 md:py-5.5 border-b border-charcoal-border"
  >
    <router-link
      to="/home"
      class="text-orange-neon font-mono text-[9px] md:text-[10px] font-bold tracking-[0.28em] md:tracking-[0.35em] uppercase leading-snug max-w-40 md:max-w-none"
    >
      {{ $t("app_name") }}
    </router-link>
    <div class="flex items-center gap-5 md:gap-8">
      <nav class="hidden md:flex items-center gap-8">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="text-[11px] tracking-[0.18em] uppercase transition-colors"
          :class="
            route.name === link.name
              ? 'text-text-primary border-b border-text-primary pb-px pointer-events-none'
              : 'text-text-secondary hover:text-text-primary'
          "
        >
          {{ link.label }}
        </router-link>
        <!-- Not part of useNavLinks: that list is also what MobileTabBar slices its two side
             slots out of, and a fifth entry would silently push one off the bar. This is a
             transient destination anyway, present only while an import is unfinished.
             Auth-gated like the chip in App.vue: the session outlives a logout (it lives in
             localStorage and rehydrates on boot), so without this the header on `/` and
             `/login` would offer a link the route guard bounces — and tell whoever signs in
             next that someone was mid-import. -->
        <router-link
          v-if="authStore.isAuthenticated && importStore.sessionActive"
          :to="{ name: 'import' }"
          class="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase transition-colors"
          :class="
            route.name === 'import'
              ? 'text-text-primary border-b border-text-primary pb-px pointer-events-none'
              : 'text-text-secondary hover:text-text-primary'
          "
        >
          <span class="w-1.5 h-1.5 rounded-full flex-none" :class="importDotClass" />
          {{ $t("home.nav_import") }}
        </router-link>
        <!-- Also outside useNavLinks, for the same four-entry reason. Shown from a flag the
             login response sets; the route guard and every /api/admin call check again. -->
        <router-link
          v-if="authStore.isAdmin"
          :to="{ name: 'admin' }"
          class="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase transition-colors"
          :class="
            route.name === 'admin'
              ? 'text-text-primary border-b border-text-primary pb-px pointer-events-none'
              : 'text-text-secondary hover:text-text-primary'
          "
        >
          <span class="w-1.5 h-1.5 rounded-full flex-none bg-orange-neon" />
          {{ $t("admin.nav") }}
        </router-link>
      </nav>
      <div class="flex items-center gap-1">
        <v-menu location="bottom end" :offset="8">
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="w-8 h-8 rounded-full border border-charcoal-border bg-charcoal-light flex items-center justify-center font-mono text-[11px] text-text-primary hover:opacity-70 transition-opacity"
              :aria-label="t('header.account_menu')"
            >
              {{ userInitial }}
            </button>
          </template>
          <div
            class="py-1 border border-charcoal-border bg-menu-surface"
            role="menu"
            style="min-width: 180px"
          >
            <button
              role="menuitem"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
              @click="themeStore.toggle()"
            >
              <v-icon
                :icon="
                  themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'
                "
                size="14"
                class="text-text-secondary shrink-0"
              />
              <span
                class="text-[11px] tracking-widest uppercase text-text-primary"
                >{{
                  themeStore.isDark
                    ? $t("home.theme_light")
                    : $t("home.theme_dark")
                }}</span
              >
            </button>
            <button
              role="menuitem"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
              @click="localeStore.toggle()"
            >
              <v-icon
                icon="mdi-translate"
                size="14"
                class="text-text-secondary shrink-0"
              />
              <span
                class="text-[11px] tracking-widest uppercase text-text-primary"
                >{{ localeStore.locale === "en" ? "Deutsch" : "English" }}</span
              >
            </button>
            <div
              v-if="authStore.isAuthenticated"
              class="border-t border-charcoal-border my-1"
            />
            <button
              v-if="authStore.isAuthenticated"
              role="menuitem"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
              @click="authStore.logout()"
            >
              <v-icon
                icon="mdi-logout"
                size="14"
                class="text-text-secondary shrink-0"
              />
              <span
                class="text-[11px] tracking-widest uppercase text-text-primary"
                >{{ $t("home.sign_out") }}</span
              >
            </button>
            <template v-else>
              <button
                role="menuitem"
                class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
                @click="router.push('/login')"
              >
                <v-icon
                  icon="mdi-login"
                  size="14"
                  class="text-text-secondary shrink-0"
                />
                <span
                  class="text-[11px] tracking-widest uppercase text-text-primary"
                  >{{ $t("auth.sign_in") }}</span
                >
              </button>
              <button
                role="menuitem"
                class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
                @click="router.push('/login?mode=register')"
              >
                <v-icon
                  icon="mdi-account-plus-outline"
                  size="14"
                  class="text-text-secondary shrink-0"
                />
                <span
                  class="text-[11px] tracking-widest uppercase text-text-primary"
                  >{{ $t("auth.create_account") }}</span
                >
              </button>
            </template>
          </div>
        </v-menu>
      </div>
    </div>
  </header>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import { useNavLinks } from "@/composables/useNavLinks";
import { useImportStore } from "@/stores/import";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const localeStore = useLocaleStore();
const importStore = useImportStore();
const { navLinks } = useNavLinks();

// Same three states the progress chip uses, so the two indicators can't disagree about what an
// import is doing: sending, interrupted mid-run, or done and awaiting review.
const importDotClass = computed(() => {
  if (importStore.isRunning) return "bg-primary animate-pulse";
  return importStore.sessionPaused ? "bg-warning" : "bg-success";
});

// "G" for guests; otherwise the first name's initial, falling back to the email.
const userInitial = computed(() => {
  if (!authStore.isAuthenticated) return "G";
  const source = authStore.firstname || authStore.email || "";
  return source.charAt(0).toUpperCase();
});
</script>
