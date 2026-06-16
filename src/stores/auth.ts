import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const email = ref<string | null>(localStorage.getItem('email'))
  const router = useRouter()

  const isAuthenticated = computed(() => !!token.value)

  const setAuth = (newToken: string, newEmail: string) => {
    token.value = newToken
    email.value = newEmail
    localStorage.setItem('token', newToken)
    localStorage.setItem('email', newEmail)
  }

  const logout = () => {
    token.value = null
    email.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('email')
    router.push('/login')
  }

  return {
    token,
    email,
    isAuthenticated,
    setAuth,
    logout
  }
})
