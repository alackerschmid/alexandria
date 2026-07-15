import { ref } from "vue";
import type { ToastType } from "@/components/AppToast.vue";

/**
 * Local toast state for a page's single AppToast. Replaces the hand-rolled
 * visible/message/type + showToast trio that several pages each defined.
 * Bind in the template as:
 *   <AppToast v-model="visible" :message="message" :type="type" />
 */
export function useToast() {
  const visible = ref(false);
  const message = ref("");
  const type = ref<ToastType>("success");

  function showToast(msg: string, toastType: ToastType = "success") {
    message.value = msg;
    type.value = toastType;
    visible.value = true;
  }

  return { visible, message, type, showToast };
}
