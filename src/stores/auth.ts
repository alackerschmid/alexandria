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
  // Only decides whether the admin link is shown — every /api/admin call re-checks the flag
  // server-side. A session stored before this field existed rehydrates false, which is the safe
  // direction: the link reappears on the next login.
  const isAdmin = ref(localStorage.getItem("is_admin") === "1");
  const router = useRouter();

  const isAuthenticated = computed(() => !!token.value);
  const userId = computed(() =>
    token.value ? userIdFromToken(token.value) : null,
  );

  const setAuth = (
    newToken: string,
    newEmail: string,
    newFirstname: string | null = null,
    newIsAdmin = false,
  ) => {
    token.value = newToken;
    email.value = newEmail;
    firstname.value = newFirstname;
    isAdmin.value = newIsAdmin;
    localStorage.setItem("token", newToken);
    localStorage.setItem("email", newEmail);
    if (newFirstname) {
      localStorage.setItem("firstname", newFirstname);
    } else {
      localStorage.removeItem("firstname");
    }
    if (newIsAdmin) {
      localStorage.setItem("is_admin", "1");
    } else {
      localStorage.removeItem("is_admin");
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
    isAdmin.value = false;
    localStorage.removeItem("token");
    localStorage.removeItem("email");
    localStorage.removeItem("firstname");
    localStorage.removeItem("is_admin");
    localStorage.removeItem(WELCOME_SEEN_KEY);
    router.push("/");
  };

  return {
    token,
    email,
    firstname,
    isAdmin,
    isAuthenticated,
    userId,
    setAuth,
    setFirstname,
    setEmail,
    logout,
  };
});
