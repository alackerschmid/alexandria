import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const BASE = import.meta.env.VITE_API_URL || ''

export interface FieldDef {
  id: number
  name: string
  type: string
  required?: boolean
}

export const useFieldDefsStore = defineStore('fieldDefs', () => {
  const defs = ref<FieldDef[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    const authStore = useAuthStore()
    try {
      const res = await fetch(`${BASE}/api/field-definitions`, {
        headers: { Authorization: `Bearer ${authStore.token}` },
      })
      if (res.ok) {
        defs.value = await res.json()
        loaded.value = true
      }
    } catch {}
  }

  function add(def: FieldDef) { defs.value = [...defs.value, def] }
  function remove(id: number) { defs.value = defs.value.filter(d => d.id !== id) }
  function reset() { defs.value = []; loaded.value = false }

  async function update(id: number, changes: { name?: string; type?: string; required?: boolean }) {
    const authStore = useAuthStore()
    try {
      const res = await fetch(`${BASE}/api/field-definitions/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(changes),
      })
      if (res.ok) {
        const updated = await res.json() as FieldDef
        defs.value = defs.value.map(d => d.id === id ? { ...d, ...updated } : d)
        return { ok: true }
      }
      const data = await res.json() as { error?: string }
      return { ok: false, error: data.error }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  }

  return { defs, loaded, load, add, remove, reset, update }
})
