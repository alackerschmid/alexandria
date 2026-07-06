import { useAuthStore } from "@/stores/auth";

const BASE = import.meta.env.VITE_API_URL || "";

export function useApi() {
  const authStore = useAuthStore();

  async function apiFetch(
    path: string,
    init: RequestInit = {},
    opts: { on401?: "logout" | "ignore" } = {},
  ): Promise<Response> {
    const { headers, ...rest } = init;
    const res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.token}`,
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
