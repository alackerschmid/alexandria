import { watch, nextTick, type Ref } from "vue";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus inside `containerRef` while `isOpen` is true: focuses the first
 * focusable element on open, cycles Tab/Shift+Tab within the container,
 * restores focus to whatever was focused before opening, and calls `onClose`
 * on Escape. For custom (non-<v-dialog>) overlays like bottom sheets, which
 * don't get this behavior for free.
 */
export function useFocusTrap(
  containerRef: Ref<HTMLElement | undefined | null>,
  isOpen: Ref<boolean>,
  onClose: () => void,
) {
  let previouslyFocused: HTMLElement | null = null;

  function getFocusable(): HTMLElement[] {
    if (!containerRef.value) return [];
    return Array.from(
      containerRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    const last = focusable.at(-1);
    const first = focusable[0];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  watch(isOpen, async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      await nextTick();
      const first = getFocusable()[0];
      (first ?? containerRef.value)?.focus();
      document.addEventListener("keydown", onKeydown, true);
    } else {
      document.removeEventListener("keydown", onKeydown, true);
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
  });
}
