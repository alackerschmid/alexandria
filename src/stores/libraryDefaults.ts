import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ReadStatus } from '@/types/book'

export const useLibraryDefaultsStore = defineStore('libraryDefaults', () => {
  const defaultView = ref<'list' | 'tile'>(
    (localStorage.getItem('defaultView') as 'list' | 'tile') || 'list',
  )
  const defaultScanStatus = ref<ReadStatus>(
    (localStorage.getItem('defaultScanStatus') as ReadStatus) || 'unread',
  )

  function setView(v: 'list' | 'tile') {
    defaultView.value = v
    localStorage.setItem('defaultView', v)
  }

  function setStatus(s: ReadStatus) {
    defaultScanStatus.value = s
    localStorage.setItem('defaultScanStatus', s)
  }

  return { defaultView, defaultScanStatus, setView, setStatus }
})
