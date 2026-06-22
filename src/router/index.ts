/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router'
import Landing from '@/pages/landing.vue'
import Home from '@/pages/home.vue'
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
      component: Landing,
    },
    {
      path: '/home',
      name: 'dashboard',
      component: Home,
    },
    {
      path: '/library',
      name: 'library',
      component: Index,
    },
    {
      path: '/scanner',
      name: 'scanner',
      component: Scanner,
    },
    {
      path: '/login',
      name: 'login',
      component: Login,
    },
    {
      path: '/series/:id',
      name: 'series',
      component: () => import('@/pages/series.vue'),
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/pages/privacy.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/pages/NotFound.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  if (authStore.isAuthenticated) {
    if (to.name === 'home')  return { name: 'dashboard' }
    if (to.name === 'login') return { name: 'dashboard' }
  }
  if (!authStore.isAuthenticated && (to.name === 'dashboard' || to.name === 'series')) {
    return { name: 'home' }
  }
})

export default router
