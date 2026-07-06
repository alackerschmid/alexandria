import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

export function useDetailRoute() {
  const route = useRoute();
  const router = useRouter();

  const detailIsbn = computed(() =>
    typeof route.query.book === "string" ? route.query.book : null,
  );

  function openDetail(isbn: string) {
    router.push({ query: { ...route.query, book: isbn } });
  }

  // Strip the book param synchronously so the dialog model-value drops to false
  // in the same tick. router.back() is async (popstate) and causes the dialog to
  // briefly re-open while the URL catches up; router.replace() avoids that race.
  function closeDetail() {
    const q = { ...route.query };
    delete q.book;
    router.replace({ query: q });
  }

  return { detailIsbn, openDetail, closeDetail };
}
