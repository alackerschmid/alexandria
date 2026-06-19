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
          class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1"
          >{{ $t('auth.email') }}</label
        >
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          :disabled="loading"
          class="w-full bg-transparent text-text-primary text-base outline-none placeholder:text-charcoal-border disabled:opacity-50"
          placeholder="you@example.com"
        />
      </div>

      <!-- Password -->
      <div class="border-b border-charcoal-border mb-10 pb-2">
        <label
          class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1"
          >{{ $t('auth.password') }}</label
        >
        <input
          v-model="password"
          type="password"
          :autocomplete="isLogin ? 'current-password' : 'new-password'"
          :disabled="loading"
          class="w-full bg-transparent text-text-primary text-base outline-none placeholder:text-charcoal-border disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      <!-- Submit -->
      <button
        type="submit"
        :disabled="loading"
        class="w-full bg-text-primary text-charcoal py-4 text-xs font-bold tracking-[0.25em] uppercase mb-5 hover:opacity-80 transition-opacity disabled:opacity-40"
      >
        {{ loading ? '—' : isLogin ? $t('auth.sign_in') : $t('auth.create_account') }}
      </button>

      <!-- Continue as guest -->
      <div class="text-center">
        <button
          type="button"
          :disabled="loading"
          class="text-xs text-text-secondary/50 tracking-wide hover:text-text-secondary transition-colors disabled:opacity-40"
          @click="$router.push('/scanner')"
        >
          {{ $t('auth.continue_as_guest') }} →
        </button>
      </div>
    </form>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import { useGuestStore } from "@/stores/guest";
import AppFooter from "@/components/AppFooter.vue";
import AppHeader from "@/components/AppHeader.vue";

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

function setMode(login: boolean) {
  isLogin.value = login;
  error.value = "";
}

const submit = async () => {
  if (!email.value || !password.value) return;

  loading.value = true;
  error.value = "";

  try {
    const endpoint = isLogin.value
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

    router.push({ name: "dashboard" });
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>
