import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useAuthStore } from "@/stores/auth";

const BASE = import.meta.env.VITE_API_URL || "";

export interface FieldDef {
  id: number;
  name: string;
  type: string;
  required?: boolean;
  /** Only meaningful for `type === 'select'` — the fixed value set the book-level field picks from. */
  options?: string[];
}

export const useFieldDefsStore = defineStore("fieldDefs", () => {
  const defs = ref<FieldDef[]>([]);
  const loaded = ref(false);
  // Distinct tag values per tag-field id, populated lazily for autocomplete.
  const tagValues = ref<Record<number, string[]>>({});

  function authHeaders() {
    const authStore = useAuthStore();
    return {
      Authorization: `Bearer ${authStore.token}`,
      "Content-Type": "application/json",
    };
  }

  async function load() {
    if (loaded.value) return;
    const authStore = useAuthStore();
    try {
      const res = await fetch(`${BASE}/api/field-definitions`, {
        headers: { Authorization: `Bearer ${authStore.token}` },
      });
      if (res.ok) {
        defs.value = await res.json();
        loaded.value = true;
      }
    } catch {}
  }

  async function loadTagValues(id: number) {
    try {
      const res = await fetch(`${BASE}/api/field-definitions/${id}/values`, {
        headers: authHeaders(),
      });
      if (res.ok)
        tagValues.value = { ...tagValues.value, [id]: await res.json() };
    } catch {}
  }

  function addTagValueLocal(id: number, value: string) {
    const current = tagValues.value[id] ?? [];
    if (current.includes(value)) return;
    tagValues.value = {
      ...tagValues.value,
      [id]: [...current, value].sort((a, b) => a.localeCompare(b)),
    };
  }

  async function deleteTagValueEverywhere(id: number, value: string) {
    try {
      const res = await fetch(
        `${BASE}/api/field-definitions/${id}/values?value=${encodeURIComponent(value)}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      if (!res.ok) return { ok: false };
      tagValues.value = {
        ...tagValues.value,
        [id]: (tagValues.value[id] ?? []).filter((v) => v !== value),
      };
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  function add(def: FieldDef) {
    defs.value = [...defs.value, def];
  }
  function remove(id: number) {
    defs.value = defs.value.filter((d) => d.id !== id);
    const { [id]: _, ...rest } = tagValues.value;
    tagValues.value = rest;
  }
  function reset() {
    defs.value = [];
    loaded.value = false;
    tagValues.value = {};
  }

  // The store instance outlives login/logout in the same tab, and load() early-returns once
  // `loaded` is set — without this, the previous account's field definitions and tag values
  // survive an account switch and render in the next user's edit form. Same pattern as the
  // token watcher in stores/preferences.ts.
  const authStore = useAuthStore();
  watch(
    () => authStore.token,
    () => reset(),
  );

  async function update(
    id: number,
    changes: {
      name?: string;
      type?: string;
      required?: boolean;
      options?: string[];
    },
  ) {
    const authStore = useAuthStore();
    try {
      const res = await fetch(`${BASE}/api/field-definitions/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${authStore.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(changes),
      });
      if (res.ok) {
        const updated = (await res.json()) as FieldDef;
        defs.value = defs.value.map((d) =>
          d.id === id ? { ...d, ...updated } : d,
        );
        return { ok: true };
      }
      const data = (await res.json()) as { error?: string };
      return { ok: false, error: data.error };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  return {
    defs,
    loaded,
    tagValues,
    load,
    loadTagValues,
    addTagValueLocal,
    deleteTagValueEverywhere,
    add,
    remove,
    reset,
    update,
  };
});
