import { useAuthStore } from "@/stores/auth";

const BASE = import.meta.env.VITE_API_URL || "";

export function useApi() {
  const authStore = useAuthStore();

  async function apiFetch(
    path: string,
    init: RequestInit = {},
    // `token` overrides the auth store's — for the rare call that has to outlive logout
    // (a pending preference flush) and would otherwise go out unauthenticated.
    opts: { on401?: "logout" | "ignore"; token?: string | null } = {},
  ): Promise<Response> {
    const { headers, ...rest } = init;
    const token = opts.token !== undefined ? opts.token : authStore.token;
    const res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string>),
      },
    });
    if (res.status === 401 && (opts.on401 ?? "logout") === "logout") {
      authStore.logout();
    }
    return res;
  }

  return { apiFetch };
}
