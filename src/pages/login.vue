<template>
  <div class="h-screen bg-charcoal flex items-center justify-center px-6">
    <v-form class="w-full max-w-xs" @submit.prevent="submit">
      <div class="mb-10 text-center">
        <span class="text-orange-neon text-xs font-semibold tracking-widest uppercase">Bookscan</span>
      </div>

      <h1 class="text-2xl font-semibold text-text-primary mb-8 leading-tight">
        {{ isLogin ? "Sign in" : "Create account" }}
      </h1>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        rounded="sm"
        class="mb-6"
      >
        {{ error }}
      </v-alert>

      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        class="mb-3"
        bg-color="charcoal-light"
        rounded="sm"
        :disabled="loading"
        required
      />

      <v-text-field
        v-model="password"
        label="Password"
        type="password"
        class="mb-8"
        bg-color="charcoal-light"
        rounded="sm"
        :disabled="loading"
        required
      />

      <v-btn
        color="primary"
        size="large"
        rounded="sm"
        class="w-full mb-3"
        type="submit"
        :loading="loading"
      >
        {{ isLogin ? "Sign in" : "Sign up" }}
      </v-btn>

      <v-btn
        variant="text"
        color="primary"
        class="w-full"
        type="button"
        size="small"
        :disabled="loading"
        @click="toggleMode"
      >
        {{ isLogin ? "Need an account?" : "Already have an account?" }}
      </v-btn>
    </v-form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const authStore = useAuthStore();

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

    if (!isLogin.value) {
      // If register success, automatically login
      const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok)
        throw new Error(loginData.error || "Login failed after registration");
      authStore.setAuth(loginData.token, loginData.email);
    } else {
      authStore.setAuth(data.token, data.email);
    }

    router.push({ name: "home" });
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>
