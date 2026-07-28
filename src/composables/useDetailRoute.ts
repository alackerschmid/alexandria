import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

export function useDetailRoute() {
  const route = useRoute();
  const router = useRouter();

  const detailWorkId = computed(() =>
    typeof route.query.work === "string" ? Number(route.query.work) : null,
  );
  const detailEditionIsbn = computed(() =>
    typeof route.query.edition === "string" ? route.query.edition : null,
  );
  // Optional — only callers whose isbn-to-scan lookup isn't otherwise derivable (e.g. a
  // non-representative edition on the series page) need to round-trip a scan id through the
  // URL so it survives a cold reload/deep link, not just an in-session switch.
  const detailScanId = computed(() =>
    typeof route.query.scan === "string" ? Number(route.query.scan) : null,
  );
  // Card vs full is view state rather than identity, but it still has to survive the URL: a
  // reload (or a shared link) otherwise drops the reader back into the card they had already
  // expanded past. `full` is the only value ever written — anything else reads as card.
  const detailView = computed<"card" | "full">(() =>
    route.query.view === "full" ? "full" : "card",
  );

  // workId is optional — an edition not yet linked to a work has no id to encode, so the
  // isbn alone still identifies it. Callers resolve the actual Book from `edition`; `work`
  // is carried along only for a more descriptive/shareable URL.
  //
  // `view` deliberately rides along in the query spread rather than being reset: switching to
  // another edition of the same work must stay in full mode. Opening an *unrelated* book from
  // full mode carries it too, and `BookDetail`'s work-change watcher is what puts that back to
  // card — which is also the only path that spends a second `replace`.
  function openDetail(
    workId: number | null | undefined,
    isbn: string,
    scanId?: number | null,
  ) {
    const q: Record<string, string> = { ...route.query } as Record<
      string,
      string
    >;
    if (workId != null) q.work = String(workId);
    else delete q.work;
    if (scanId != null) q.scan = String(scanId);
    else delete q.scan;
    q.edition = isbn;
    router.push({ query: q });
  }

  // Strip the params synchronously so the dialog model-value drops to false
  // in the same tick. router.back() is async (popstate) and causes the dialog to
  // briefly re-open while the URL catches up; router.replace() avoids that race.
  function closeDetail() {
    const q = { ...route.query };
    delete q.work;
    delete q.edition;
    delete q.scan;
    delete q.view;
    router.replace({ query: q });
  }

  // `replace`, not `push`: expanding a card isn't a step the browser Back button should have to
  // undo one at a time — Back still leaves the detail entirely, exactly as it did before the
  // view was routed.
  function setDetailView(view: "card" | "full") {
    if (detailView.value === view) return;
    const q = { ...route.query };
    if (view === "full") q.view = "full";
    else delete q.view;
    router.replace({ query: q });
  }

  return {
    detailWorkId,
    detailEditionIsbn,
    detailScanId,
    detailView,
    openDetail,
    closeDetail,
    setDetailView,
  };
}
