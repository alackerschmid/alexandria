import type { Book } from '@/types/book'

/** A book's stored value for a custom field definition, or null when unset. */
export function bookCustomValue(book: Book, defId: number): string | null {
  return book.custom_field_values?.find(v => v.field_def_id === defId)?.value ?? null
}
