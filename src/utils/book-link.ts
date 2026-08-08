/**
 * The route that opens one book's detail dialog.
 *
 * Home never hosts `BookDetail` itself — per the `book-detail` rule the host owes `RatingDialog`
 * ownership and its flush rule, `useScanStatus` with per-work fan-out, the delete dialog and the
 * edition-switch handler, which is a large contract for a page whose job is to *point at* books.
 * So every book on home is a deep link into `/library`, where `index.vue`'s
 * `[detailEditionIsbn, allBooks]` watcher resolves it once the library has loaded.
 *
 * The param names are `useDetailRoute`'s (`work`, `edition`) and must stay in step with it.
 * `work` is optional — an edition with no work link is still identified by its ISBN alone.
 */
import type { RouteLocationRaw } from "vue-router";

export function libraryDetailLink(
  workId: number | null | undefined,
  isbn: string,
): RouteLocationRaw {
  const query: Record<string, string> = { edition: isbn };
  if (workId != null) query.work = String(workId);
  return { name: "library", query };
}
