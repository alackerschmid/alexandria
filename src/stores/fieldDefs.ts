import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const BASE = import.meta.env.VITE_API_URL || ''

export interface FieldDef {
  id: number
  name: string
  type: string
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

  return { defs, loaded, load, add, remove, reset }
})
