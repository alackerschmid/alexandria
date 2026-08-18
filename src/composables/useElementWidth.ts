import { onScopeDispose, ref, watch, type Ref } from "vue";

// Live content-box width of an element, for layouts that size themselves from the space they
// actually got rather than from a viewport breakpoint. Content box (padding excluded) because
// the caller divides the result into grid columns.
//
// Stays 0 until the element mounts and the observer's first callback fires, and keeps the last
// measurement when the element is swapped out — callers need a fallback for that first frame,
// but not a flash of the wrong column count when a v-if branch changes.
export function useElementWidth(el: Ref<HTMLElement | null>): Ref<number> {
  const width = ref(0);
  let observer: ResizeObserver | null = null;

  watch(
    el,
    (node) => {
      observer?.disconnect();
      observer = null;
      if (!node) return;
      observer = new ResizeObserver(([entry]) => {
        width.value = entry.contentRect.width;
      });
      observer.observe(node);
    },
    { immediate: true },
  );

  onScopeDispose(() => observer?.disconnect());

  return width;
}
