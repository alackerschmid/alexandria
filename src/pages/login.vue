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
          {{ localeStore.locale === 'en' ? 'DE' : 'EN' }}
        </v-btn>
        <v-btn
          :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          variant="text"
          color="primary"
          size="small"
          :aria-label="themeStore.isDark ? $t('home.theme_light') : $t('home.theme_dark')"
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
        {{ isLogin ? $t('auth.sign_in_heading') : $t('auth.register_heading') }}
      </h1>
      <p class="text-text-secondary text-sm mb-8">
        {{ isLogin ? $t('auth.sign_in_subtitle') : $t('auth.register_subtitle') }}
      </p>

      <!-- Mode toggle pills -->
      <div class="flex gap-2 mb-10">
        <button
          type="button"
          class="flex-1 py-2 px-4 text-[10px] tracking-[0.2em] uppercase border transition-colors"
          :class="isLogin
            ? 'border-text-primary text-text-primary'
            : 'border-charcoal-border text-text-secondary/50 hover:text-text-secondary hover:border-text-secondary/30'"
          @click="setMode(true)"
        >
          {{ $t('auth.sign_in') }}
        </button>
        <button
          type="button"
          class="flex-1 py-2 px-4 text-[10px] tracking-[0.2em] uppercase border transition-colors"
          :class="!isLogin
            ? 'border-text-primary text-text-primary'
            : 'border-charcoal-border text-text-secondary/50 hover:text-text-secondary hover:border-text-secondary/30'"
          @click="setMode(false)"
        >
          {{ $t('auth.create_account') }}
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
          >{{ $t('auth.email') }}</label
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
          >{{ $t('auth.password') }}</label
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
      <LoadingButton
        type="submit"
        :loading="loading"
        class="bg-text-primary text-charcoal mb-5 hover:opacity-80"
      >
        {{ loading ? $t('detail.loading') : isLogin ? $t('auth.sign_in') : $t('auth.create_account') }}
      </LoadingButton>

      <!-- Continue as guest — secondary action, more prominent than a text link
           but quieter than the filled sign-in button above. -->
      <button
        type="button"
        :disabled="loading"
        class="w-full border border-charcoal-border text-text-primary py-3.5 text-xs font-bold tracking-[0.25em] uppercase hover:border-text-primary transition-colors disabled:opacity-40"
        @click="continueAsGuest"
      >
        {{ $t('auth.continue_as_guest') }}
      </button>
    </form>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore, WELCOME_SEEN_KEY } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import { useGuestStore } from "@/stores/guest";
import AppFooter from "@/components/AppFooter.vue";
import AppHeader from "@/components/AppHeader.vue";
import LoadingButton from "@/components/LoadingButton.vue";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const localeStore = useLocaleStore();
const guestStore = useGuestStore();

const isLogin = ref(route.query.mode !== "register");
const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const API_BASE = import.meta.env.VITE_API_URL || "";

function continueAsGuest() {
  const dest = localStorage.getItem(WELCOME_SEEN_KEY) ? '/library' : '/welcome'
  router.push(dest)
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

    authStore.setAuth(data.token, data.email, data.firstname ?? null);

    // Sync any guest scans to the new/existing account
    if (guestStore.scans.length > 0) {
      await guestStore.syncToAccount(data.token);
    }

    router.push({ name: wasLogin ? 'dashboard' : 'welcome' });
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>
