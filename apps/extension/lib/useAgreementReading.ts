import { nextTick, onUnmounted, ref, type Ref } from 'vue';

// Reading state belongs to one presentation of one agreement.
export function useAgreementReading(dialog: Ref<HTMLDialogElement | null>, content: Ref<HTMLElement | null>) {
  const reachedEnd = ref(false);
  let observer: ResizeObserver | undefined;
  function check() {
    const el = content.value;
    if (dialog.value?.open && el && el.clientHeight > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) reachedEnd.value = true;
  }
  async function open() {
    reachedEnd.value = false;
    observer?.disconnect();
    dialog.value?.showModal();
    if (content.value) content.value.scrollTop = 0;
    await nextTick();
    if (!dialog.value?.open || !content.value) return;
    observer = new ResizeObserver(check);
    observer.observe(content.value);
    check();
  }
  onUnmounted(() => observer?.disconnect());
  return { reachedEnd, open, check };
}
