/**
 * Runs `fn` over `items` with at most `limit` in flight, preserving input order in the result.
 *
 * Used to overlap the per-row metadata fetches in a Goodreads import batch. The cap matters
 * because Workers only allow 6 simultaneous connections awaiting response headers: firing every
 * row at once wouldn't run faster, but it would burst against the upstream metadata APIs and make
 * the external-subrequest count scale with batch size instead of staying bounded.
 *
 * Rejections propagate — callers that need per-item error handling should catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;

  // Each worker pulls the next unclaimed index until the queue drains. `next++` is atomic here
  // because Workers is single-threaded — the increment can't interleave with another worker's.
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await fn(items[i], i);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
