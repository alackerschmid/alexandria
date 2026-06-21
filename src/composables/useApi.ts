import { useAuthStore } from '@/stores/auth'

const BASE = import.meta.env.VITE_API_URL || ''

export function useApi() {
  const authStore = useAuthStore()

  function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const { headers, ...rest } = init
    return fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.token}`,
        ...(headers as Record<string, string>),
      },
    })
  }

  return { apiFetch }
}
