import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useRouter } from "vue-router";

export const WELCOME_SEEN_KEY = "welcome_seen";

// The JWT's `userId` claim — stable across an email change, unlike the address, so it's what
// per-user client-side storage keys on (see stores/preferences.ts).
function userIdFromToken(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const userId = JSON.parse(json)?.userId;
    return userId == null ? null : String(userId);
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const email = ref<string | null>(localStorage.getItem("email"));
  const firstname = ref<string | null>(localStorage.getItem("firstname"));
  const router = useRouter();

  const isAuthenticated = computed(() => !!token.value);
  const userId = computed(() =>
    token.value ? userIdFromToken(token.value) : null,
  );

  const setAuth = (
    newToken: string,
    newEmail: string,
    newFirstname: string | null = null,
  ) => {
    token.value = newToken;
    email.value = newEmail;
    firstname.value = newFirstname;
    localStorage.setItem("token", newToken);
    localStorage.setItem("email", newEmail);
    if (newFirstname) {
      localStorage.setItem("firstname", newFirstname);
    } else {
      localStorage.removeItem("firstname");
    }
  };

  const setFirstname = (name: string) => {
    firstname.value = name;
    localStorage.setItem("firstname", name);
  };

  const setEmail = (e: string) => {
    email.value = e;
    localStorage.setItem("email", e);
  };

  const logout = () => {
    token.value = null;
    email.value = null;
    firstname.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("email");
    localStorage.removeItem("firstname");
    localStorage.removeItem(WELCOME_SEEN_KEY);
    router.push("/");
  };

  return {
    token,
    email,
    firstname,
    isAuthenticated,
    userId,
    setAuth,
    setFirstname,
    setEmail,
    logout,
  };
});
