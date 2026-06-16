/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router'
import Index from '@/pages/index.vue'
import Login from '@/pages/login.vue'
import Scanner from '@/pages/scanner.vue'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Index,
      meta: { requiresAuth: true }
    },
    {
      path: '/scanner',
      name: 'scanner',
      component: Scanner,
      meta: { requiresAuth: true }
    },
    {
      path: '/login',
      name: 'login',
      component: Login,
    },
  ],
})

router.beforeEach((to, from) => {
  const authStore = useAuthStore()
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login' }
  } else if (to.name === 'login' && authStore.isAuthenticated) {
    return { name: 'home' }
  }
})

export default router
