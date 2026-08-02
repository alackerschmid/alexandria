<template>
  <div class="min-h-screen bg-charcoal flex flex-col px-8">
    <!-- Wordmark + controls -->
    <AppHeader>
      <div class="flex items-center gap-1">
        <v-btn
          variant="text"
          color="primary"
          size="small"
          class="text-[10px] tracking-widest font-mono"
          @click="localeStore.toggle()"
        >
          {{ localeStore.locale === "en" ? "DE" : "EN" }}
        </v-btn>
        <v-btn
          :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          variant="text"
          color="primary"
          size="small"
          :aria-label="
            themeStore.isDark ? $t('home.theme_light') : $t('home.theme_dark')
          "
          @click="themeStore.toggle()"
        />
      </div>
    </AppHeader>

    <!-- Form -->
    <form
      class="flex-1 flex flex-col justify-center pb-20 w-full max-w-sm mx-auto"
      @submit.prevent="submit"
    >
      <h1
        class="font-heading text-5xl font-bold text-text-primary leading-[1.1] mb-3"
      >
        {{ isLogin ? $t("auth.sign_in_heading") : $t("auth.register_heading") }}
      </h1>
      <p class="text-text-secondary text-sm mb-8">
        {{
          isLogin ? $t("auth.sign_in_subtitle") : $t("auth.register_subtitle")
        }}
      </p>

      <!-- Mode toggle pills -->
      <div class="flex gap-2 mb-10">
        <button
          type="button"
          class="flex-1 py-2 px-4 text-[10px] tracking-[0.2em] uppercase border transition-colors"
          :class="
            isLogin
              ? 'border-text-primary text-text-primary'
              : 'border-charcoal-border text-text-secondary/50 hover:text-text-secondary hover:border-text-secondary/30'
          "
          @click="setMode(true)"
        >
          {{ $t("auth.sign_in") }}
        </button>
        <button
          type="button"
          class="flex-1 py-2 px-4 text-[10px] tracking-[0.2em] uppercase border transition-colors"
          :class="
            !isLogin
              ? 'border-text-primary text-text-primary'
              : 'border-charcoal-border text-text-secondary/50 hover:text-text-secondary hover:border-text-secondary/30'
          "
          @click="setMode(false)"
        >
          {{ $t("auth.create_account") }}
        </button>
      </div>

      <div
        v-if="error"
        class="mb-8 pl-4 py-1 border-l-2 text-sm"
        style="
          border-color: rgb(var(--v-theme-error));
          color: rgb(var(--v-theme-error));
        "
      >
        {{ error }}
      </div>

      <!-- Email -->
      <div class="border-b border-charcoal-border mb-7 pb-2">
        <label
          for="login-email"
          class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1"
          >{{ $t("auth.email") }}</label
        >
        <input
          id="login-email"
          v-model="email"
          type="email"
          autocomplete="email"
          :disabled="loading"
          class="w-full bg-transparent text-text-primary text-base placeholder:text-charcoal-border disabled:opacity-50"
          placeholder="you@example.com"
        />
      </div>

      <!-- Password -->
      <div class="border-b border-charcoal-border mb-10 pb-2">
        <label
          for="login-password"
          class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1"
          >{{ $t("auth.password") }}</label
        >
        <input
          id="login-password"
          v-model="password"
          type="password"
          :autocomplete="isLogin ? 'current-password' : 'new-password'"
          :disabled="loading"
          class="w-full bg-transparent text-text-primary text-base placeholder:text-charcoal-border disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      <!-- Submit -->
      <AppButton
        type="submit"
        variant="inverse"
        size="lg"
        block
        :loading="loading"
        class="mb-5"
      >
        {{
          loading
            ? $t("detail.loading")
            : isLogin
              ? $t("auth.sign_in")
              : $t("auth.create_account")
        }}
      </AppButton>

      <!-- Continue as guest — secondary action, more prominent than a text link
           but quieter than the filled sign-in button above. -->
      <AppButton
        variant="secondary"
        size="lg"
        block
        :disabled="loading"
        @click="continueAsGuest"
      >
        {{ $t("auth.continue_as_guest") }}
      </AppButton>
    </form>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore, WELCOME_SEEN_KEY } from "@/stores/auth";
import { usePreferencesStore } from "@/stores/preferences";
import { useThemeStore } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import AppFooter from "@/components/AppFooter.vue";
import AppHeader from "@/components/AppHeader.vue";
import AppButton from "@/components/AppButton.vue";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const preferencesStore = usePreferencesStore();
const themeStore = useThemeStore();
const localeStore = useLocaleStore();

const isLogin = ref(route.query.mode !== "register");
const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const API_BASE = import.meta.env.VITE_API_URL || "";

function continueAsGuest() {
  const dest = localStorage.getItem(WELCOME_SEEN_KEY) ? "/library" : "/welcome";
  router.push(dest);
}

function setMode(login: boolean) {
  isLogin.value = login;
  error.value = "";
}

const submit = async () => {
  if (!email.value || !password.value) return;

  const wasLogin = isLogin.value;
  loading.value = true;
  error.value = "";

  try {
    const endpoint = wasLogin
      ? `${API_BASE}/api/auth/login`
      : `${API_BASE}/api/auth/register`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, password: password.value }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Authentication failed");
    }

    // Before setAuth: that's what flips the token, and the preferences store's watcher runs
    // synchronously off it. Seeded, it skips the GET round-trip. `?? {}` keeps an older worker
    // deploy working — an absent field just takes the same path as an empty server blob.
    preferencesStore.seed(data.preferences ?? {});
    authStore.setAuth(
      data.token,
      data.email,
      data.firstname ?? null,
      data.is_admin === true,
    );

    // Guest scan migration is handled centrally in App.vue (reacts to isAuthenticated),
    // so it also retries any scans that failed to sync on a previous login.

    router.push({ name: wasLogin ? "dashboard" : "welcome" });
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>
