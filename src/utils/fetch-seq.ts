/**
 * Guard for a page-level `load()` that can be re-triggered while a previous call is still in
 * flight (a locale switch, the stats scope pill): each call stamps itself the latest, and the
 * commit site asks "am I still the latest?" before writing into page state. Without it the
 * *slowest* response wins, not the newest — and the two legitimately differ in weight, e.g.
 * `/api/stats?scope=all` scans strictly more rows than `scope=owned`, so the stale request is
 * systematically the one that lands last.
 *
 * Same idea as `fetchSeq` in `useLibraryData` (which keeps its own inline copy because its
 * guard is checked per pagination page, mid-loop). For the simple fetch-then-commit shape:
 *
 *   const nextLoad = createFetchSequencer();
 *   const load = async () => {
 *     const isCurrent = nextLoad();
 *     const data = await fetchEverything();
 *     if (!isCurrent()) return; // a newer load() superseded this one
 *     state.value = data;
 *   };
 */
export function createFetchSequencer(): () => () => boolean {
  let seq = 0;
  return () => {
    const mine = ++seq;
    return () => mine === seq;
  };
}
