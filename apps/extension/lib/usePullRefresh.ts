import { computed, onMounted, onUnmounted, ref, watch, type Ref } from "vue";

export function usePullRefresh(
  element: Ref<HTMLElement | null>,
  enabled: Readonly<Ref<boolean>>,
  refresh: () => Promise<void>,
) {
  const distance = ref(0), refreshing = ref(false);
  const threshold = 180;
  const revealDistance = 72;
  let gestureStarted = 0;
  let lastMoved = 0;
  let touchStart: { x: number; y: number } | undefined;
  let cooldownUntil = 0;
  const available = () => enabled.value && !refreshing.value && Date.now() >= cooldownUntil;
  const reset = () => { distance.value = 0; touchStart = undefined; gestureStarted = 0; lastMoved = 0; };
  // A nested course list owns its gesture, even when it has reached its top.
  function ownsGesture(source: EventTarget | null) {
    if (!(source instanceof Element) || !element.value?.contains(source)) return false;
    if (source.closest("button, a, input, textarea, select, [contenteditable=true], [role=slider]")) return false;
    for (let node: Element | null = source; node && node !== element.value; node = node.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return false;
    }
    return true;
  }
  async function release() {
    const shouldRefresh = !!touchStart && available() && distance.value >= threshold && lastMoved - gestureStarted >= 320;
    reset();
    if (!shouldRefresh) return;
    refreshing.value = true;
    try { await refresh(); }
    finally { refreshing.value = false; cooldownUntil = Date.now() + 2000; }
  }
  function start(event: TouchEvent) {
    reset();
    if (!available() || event.touches.length !== 1 || (element.value?.scrollTop ?? 1) > 0 || !ownsGesture(event.target)) return;
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    gestureStarted = Date.now();
  }
  function move(event: TouchEvent) {
    if (!touchStart || !available() || event.touches.length !== 1 || (element.value?.scrollTop ?? 1) > 0) { reset(); return; }
    const dx = event.touches[0].clientX - touchStart.x, dy = event.touches[0].clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy) || dy < 0) { reset(); return; }
    if (dy > 0) {
      event.preventDefault();
      distance.value = Math.min(220, dy * 0.65);
      lastMoved = Date.now();
    }
  }
  const end = () => { void release(); };
  const cancel = () => reset();
  watch(enabled, value => { if (!value) reset(); }, { flush: "sync" });
  let target: HTMLElement | null = null;
  onMounted(() => {
    target = element.value;
    // Wheel events include trackpad momentum and have no reliable release signal.
    // Leave them to scrolling; desktop users can use the toolbar refresh button.
    target?.addEventListener("touchstart", start, { passive: true });
    target?.addEventListener("touchmove", move, { passive: false });
    target?.addEventListener("touchend", end);
    target?.addEventListener("touchcancel", cancel);
  });
  onUnmounted(() => {
    target?.removeEventListener("touchstart", start);
    target?.removeEventListener("touchmove", move);
    target?.removeEventListener("touchend", end);
    target?.removeEventListener("touchcancel", cancel);
  });
  return {
    refreshing,
    visible: computed(() => refreshing.value || distance.value >= revealDistance),
    label: computed(() => refreshing.value ? "正在刷新…" : distance.value >= threshold ? "松开刷新" : "下拉刷新"),
    progress: computed(() => Math.min(1, distance.value / threshold)),
  };
}
