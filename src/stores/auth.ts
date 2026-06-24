import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const email = ref<string | null>(localStorage.getItem('email'))
  const firstname = ref<string | null>(localStorage.getItem('firstname'))
  const router = useRouter()

  const isAuthenticated = computed(() => !!token.value)

  const setAuth = (newToken: string, newEmail: string, newFirstname: string | null = null) => {
    token.value = newToken
    email.value = newEmail
    firstname.value = newFirstname
    localStorage.setItem('token', newToken)
    localStorage.setItem('email', newEmail)
    if (newFirstname) {
      localStorage.setItem('firstname', newFirstname)
    } else {
      localStorage.removeItem('firstname')
    }
  }

  const setFirstname = (name: string) => {
    firstname.value = name
    localStorage.setItem('firstname', name)
  }

  const setEmail = (e: string) => {
    email.value = e
    localStorage.setItem('email', e)
  }

  const logout = () => {
    token.value = null
    email.value = null
    firstname.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('email')
    localStorage.removeItem('firstname')
    router.push('/')
  }

  return {
    token,
    email,
    firstname,
    isAuthenticated,
    setAuth,
    setFirstname,
    setEmail,
    logout,
  }
})
