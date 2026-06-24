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
  const defaultPageSize = ref<number>(
    parseInt(localStorage.getItem('defaultPageSize') ?? '24', 10) || 24,
  )

  function setView(v: 'list' | 'tile') {
    defaultView.value = v
    localStorage.setItem('defaultView', v)
  }

  function setStatus(s: ReadStatus) {
    defaultScanStatus.value = s
    localStorage.setItem('defaultScanStatus', s)
  }

  function setPageSize(n: number) {
    defaultPageSize.value = n
    localStorage.setItem('defaultPageSize', String(n))
  }

  return { defaultView, defaultScanStatus, defaultPageSize, setView, setStatus, setPageSize }
})
