<template>
  <div class="min-h-screen bg-charcoal flex flex-col px-8">
    <!-- Wordmark + theme toggle -->
    <div class="pt-14 flex justify-between items-center">
      <span class="text-orange-neon text-[10px] tracking-[0.35em] uppercase font-bold">Bookscan</span>
      <v-btn
        :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        variant="text"
        color="primary"
        size="small"
        @click="themeStore.toggle()"
      />
    </div>

    <!-- Form -->
    <form class="flex-1 flex flex-col justify-center pb-20" @submit.prevent="submit">
      <h1 class="font-heading text-5xl font-bold text-text-primary leading-[1.1] mb-3">
        <template v-if="isLogin">Sign in.</template>
        <template v-else>Create<br>account.</template>
      </h1>
      <p class="text-text-secondary text-sm mb-12">
        {{ isLogin ? 'Welcome back to your library.' : 'Start cataloguing your collection.' }}
      </p>

      <div
        v-if="error"
        class="mb-8 pl-4 py-1 border-l-2 text-sm"
        style="border-color: rgb(var(--v-theme-error)); color: rgb(var(--v-theme-error))"
      >{{ error }}</div>

      <!-- Email -->
      <div class="border-b border-charcoal-border mb-7 pb-2">
        <label class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1">Email</label>
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
      <div class="border-b border-charcoal-border mb-12 pb-2">
        <label class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1">Password</label>
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
        {{ loading ? '—' : (isLogin ? 'Sign in' : 'Create account') }}
      </button>

      <!-- Toggle -->
      <button
        type="button"
        :disabled="loading"
        class="text-xs text-text-secondary tracking-wide underline underline-offset-4 hover:text-text-primary transition-colors disabled:opacity-40"
        @click="toggleMode"
      >
        {{ isLogin ? 'Need an account?' : 'Already have an account?' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();

const isLogin = ref(true);
const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const API_BASE = import.meta.env.VITE_API_URL || "";

const toggleMode = () => {
  isLogin.value = !isLogin.value;
  error.value = "";
};

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

    authStore.setAuth(data.token, data.email);

    router.push({ name: "home" });
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>
