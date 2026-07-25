import { defineStore } from "pinia";
import { computed, ref, watch, type WritableComputedRef } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useApi } from "@/composables/useApi";

// The single owner of every persisted user preference (appearance, locale, library display
// defaults). Preferences are strictly per-user: the server row is the source of truth, a
// per-user localStorage bucket is only a cache so the app can paint the right look before the
// profile round-trip finishes, and a logged-out visitor always starts from the defaults.
//
// Values are plain strings, exactly as they were in localStorage before — each consuming store
// (accent, theme, paper, typeface, locale, libraryDefaults) still owns parsing and validating
// its own key, and reads through `get`/`set` here instead of touching localStorage.

const CACHE_PREFIX = "prefs:";
const FLUSH_DELAY = 500;

type Prefs = Record<string, string>;

function readCache(userId: string): Prefs {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Prefs)
      : {};
  } catch {
    return {};
  }
}

export const usePreferencesStore = defineStore("preferences", () => {
  const authStore = useAuthStore();
  const { apiFetch } = useApi();

  const values = ref<Prefs>({});

  // Bumped on every local edit and every user switch. An in-flight server load applies its
  // result only while the revision it started at still holds, so it can't clobber a newer edit.
  let revision = 0;
  let currentUser: string | null = null;
  let currentToken: string | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  // Set by `seed` just before a login flips the token; consumed by the watcher below.
  let pendingSeed: Prefs | null = null;

  function get(key: string): string | null {
    return values.value[key] ?? null;
  }

  function set(key: string, value: string) {
    values.value[key] = value;
    revision++;
    // Logged out, the change lives for this session only — nothing is written anywhere, so
    // the next visitor on this device starts from the defaults again.
    if (!currentUser) return;
    pending = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(persist, FLUSH_DELAY);
  }

  // Both persistence steps, debounced together from `set` — a color-picker drag emits an edit
  // per pointer tick, and serializing the whole blob to localStorage on each one is the
  // expensive half. The cache only has to be current by the time the tab goes away.
  function persist(init: RequestInit = {}) {
    if (!pending) return;
    writeCache();
    void flush(init);
  }

  function writeCache() {
    if (!currentUser) return;
    localStorage.setItem(
      CACHE_PREFIX + currentUser,
      JSON.stringify(values.value),
    );
  }

  // Sends the whole set. On failure the change stays cached locally and `pending` is restored,
  // so the next edit (or the next page hide) heals the server copy.
  async function flush(init: RequestInit = {}) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pending || !currentToken) return;

    const body = JSON.stringify({ preferences: values.value });
    pending = false;
    try {
      const res = await apiFetch(
        "/api/auth/preferences",
        { ...init, method: "PUT", body },
        // The token is passed explicitly (rather than let apiFetch read the auth store)
        // because a flush can run just after logout has already cleared it; `on401: "ignore"`
        // for the same reason. `loadFromServer` needs neither and uses the plain defaults.
        { on401: "ignore", token: currentToken },
      );
      if (!res.ok) {
        pending = true;
        console.warn("Failed to save preferences", res.status);
      }
    } catch (e) {
      pending = true;
      console.warn("Failed to save preferences", e);
    }
  }

  // Only needed for a token restored from localStorage on boot — a login gets the blob on the
  // auth response and goes through `seed` instead.
  async function loadFromServer(seq: number) {
    let serverPrefs: Prefs;
    try {
      const res = await apiFetch("/api/auth/preferences");
      if (!res.ok) return; // keep the cached values; the next login retries
      serverPrefs = ((await res.json()) as { preferences?: Prefs }).preferences ?? {};
    } catch {
      return;
    }
    await applyServerPrefs(serverPrefs, seq);
  }

  async function applyServerPrefs(serverPrefs: Prefs, seq: number) {
    if (revision !== seq) return;

    if (Object.keys(serverPrefs).length > 0) {
      values.value = serverPrefs;
      writeCache();
      return;
    }

    // Nothing stored server-side (a fresh account, or one that has never saved): push up what
    // the per-user cache holds rather than leaving the server copy empty.
    if (Object.keys(values.value).length === 0) return;
    writeCache();
    pending = true;
    await flush();
  }

  // Login and register already return the user's blob, so the token watcher below can apply it
  // straight away instead of spending a round-trip on GET /preferences — which is precisely the
  // case where there is no per-user cache to paint from. Must be called *before* `setAuth`:
  // that's what flips the token, and the watcher runs synchronously off it.
  function seed(prefs: Prefs) {
    pendingSeed = prefs;
  }

  watch(
    () => authStore.token,
    (token) => {
      persist(); // write out anything still pending for the outgoing user
      revision++; // invalidate any in-flight load
      currentToken = token;
      currentUser = authStore.userId;
      const seeded = pendingSeed;
      pendingSeed = null;
      if (!currentUser) {
        values.value = {};
        return;
      }
      values.value = readCache(currentUser);
      if (seeded) void applyServerPrefs(seeded, revision);
      else void loadFromServer(revision);
    },
    { immediate: true },
  );

  // A debounced change made right before the tab goes away would otherwise be lost.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => persist({ keepalive: true }));
  }

  return { get, set, seed };
});

// The read-validate-fallback/write-through wrapper every consuming store needs: one preference
// key surfaced as a writable computed, so a page can `v-model` it and a write flows straight
// into `set`. Call these from inside a store setup (they resolve the preferences store).

export function persistedStr<T extends string>(
  key: string,
  fallback: T,
  isValid?: (v: string) => v is T,
): WritableComputedRef<T> {
  const prefs = usePreferencesStore();
  return computed({
    get() {
      const stored = prefs.get(key);
      return stored !== null && (!isValid || isValid(stored))
        ? (stored as T)
        : fallback;
    },
    set(v) {
      prefs.set(key, v);
    },
  });
}

export function persistedBool(
  key: string,
  fallback: boolean,
): WritableComputedRef<boolean> {
  const prefs = usePreferencesStore();
  return computed({
    get() {
      const stored = prefs.get(key);
      return stored === null ? fallback : stored === "true";
    },
    set(v) {
      prefs.set(key, String(v));
    },
  });
}

export function persistedNum(
  key: string,
  fallback: number,
): WritableComputedRef<number> {
  const prefs = usePreferencesStore();
  return computed({
    get() {
      const parsed = parseInt(prefs.get(key) ?? "", 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    },
    set(v) {
      prefs.set(key, String(v));
    },
  });
}
