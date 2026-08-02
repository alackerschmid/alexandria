/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

// Composables
import { createRouter, createWebHistory } from "vue-router";
import Landing from "@/pages/landing.vue";
import Home from "@/pages/home.vue";
import Index from "@/pages/index.vue";
import Login from "@/pages/login.vue";
import Scanner from "@/pages/scanner.vue";
import { useAuthStore, WELCOME_SEEN_KEY } from "@/stores/auth";

declare module "vue-router" {
  interface RouteMeta {
    /** Show the persistent mobile bottom tab bar (Home / Scan / Settings) on this route. */
    mobileNav?: boolean;
    /** Redirect unauthenticated users to `/` instead of rendering this route. */
    requiresAuth?: boolean;
    /**
     * Redirect users without the admin flag away from this route. Cosmetic only — the flag is
     * client-side state; `/api/admin/*` is what actually enforces access.
     */
    requiresAdmin?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      component: Landing,
    },
    {
      path: "/home",
      name: "dashboard",
      component: Home,
      meta: { mobileNav: true, requiresAuth: true },
    },
    {
      path: "/library",
      name: "library",
      component: Index,
      meta: { mobileNav: true },
    },
    {
      path: "/scanner",
      name: "scanner",
      component: Scanner,
    },
    {
      path: "/login",
      name: "login",
      component: Login,
    },
    {
      path: "/welcome",
      name: "welcome",
      component: () => import("@/pages/welcome.vue"),
    },
    {
      path: "/series/:id",
      name: "series",
      component: () => import("@/pages/series.vue"),
      meta: { mobileNav: true, requiresAuth: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/pages/settings.vue"),
      meta: { mobileNav: true, requiresAuth: true },
    },
    {
      path: "/import",
      name: "import",
      component: () => import("@/pages/import.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/admin",
      name: "admin",
      component: () => import("@/pages/admin.vue"),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: "/privacy",
      name: "privacy",
      component: () => import("@/pages/privacy.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("@/pages/NotFound.vue"),
    },
  ],
});

router.beforeEach((to) => {
  const authStore = useAuthStore();
  if (authStore.isAuthenticated) {
    if (to.name === "home") return { name: "dashboard" };
    if (to.name === "login") return { name: "dashboard" };
    if (to.name === "welcome" && localStorage.getItem(WELCOME_SEEN_KEY))
      return { name: "dashboard" };
  }
  if (!authStore.isAuthenticated && to.meta.requiresAuth) {
    return { name: "home" };
  }
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    return { name: authStore.isAuthenticated ? "dashboard" : "home" };
  }
});

export default router;
