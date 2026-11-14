<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { sendDesktop as native, type DesktopPreferences } from "../lib/desktop";

const emit = defineEmits<{
  preferences: [value: DesktopPreferences];
  error: [message: string];
  saved: [];
}>();
const preferences = ref<DesktopPreferences | null>(null);
const modal = ref<"startup" | "close" | null>(null);
const background = ref(true), launchAtLogin = ref(false), remember = ref(true);
const busy = ref(false), error = ref("");
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let pendingClose = false;
const inertElements = new Map<HTMLElement, boolean>();
let restoredDraft = (window as any).__coursewatchInitialState?.lifecycle;

function applyPreferences(value: DesktopPreferences) {
  if (!value || typeof value.setupCompleted !== "boolean" || typeof value.backgroundEnabled !== "boolean"
    || typeof value.launchAtLogin !== "boolean" || !["ask", "tray", "quit"].includes(value.closeBehavior)) return;
  preferences.value = value;
  emit("preferences", value);
}
function openPreferences() {
  if (!preferences.value || busy.value) return;
  background.value = preferences.value.backgroundEnabled;
  launchAtLogin.value = preferences.value.launchAtLogin;
  error.value = "";
  modal.value = "startup";
}
function receivedPreferences(event: Event) {
  applyPreferences((event as CustomEvent).detail);
  if (restoredDraft?.modal === "startup" && typeof restoredDraft.background === "boolean" && typeof restoredDraft.launchAtLogin === "boolean") {
    background.value = restoredDraft.background;
    launchAtLogin.value = restoredDraft.launchAtLogin;
    modal.value = "startup";
    restoredDraft = null;
  } else if (preferences.value && !preferences.value.setupCompleted && !modal.value) openPreferences();
}
function requestClose() {
  if (busy.value) { pendingClose = true; return; }
  remember.value = true;
  error.value = "";
  modal.value = "close";
}
function cancel() {
  if (busy.value) return;
  error.value = "";
  if (modal.value === "close") {
    native("cancelClose");
    modal.value = preferences.value && !preferences.value.setupCompleted ? "startup" : null;
  } else modal.value = null;
}
function saveStartup() {
  busy.value = true;
  error.value = "";
  native("saveStartupPreferences", { backgroundEnabled: background.value, launchAtLogin: launchAtLogin.value });
}
function chooseClose(behavior: "tray" | "quit") {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  native("closeChoice", { behavior, remember: remember.value });
}
function saveCloseBehavior(behavior: DesktopPreferences["closeBehavior"]) {
  if (busy.value || !["ask", "tray", "quit"].includes(behavior)) return;
  busy.value = true;
  native("saveCloseBehavior", { behavior });
}
function result(event: Event) {
  const value = (event as CustomEvent).detail;
  if (!value || !["startup", "close", "settings"].includes(value.kind) || typeof value.ok !== "boolean") return;
  busy.value = false;
  if (!value.ok) {
    if (pendingClose) { pendingClose = false; native("cancelClose"); }
    if (preferences.value) emit("preferences", { ...preferences.value });
    const message = value.error || "设置未保存，请重试。";
    if (modal.value) error.value = message;
    else emit("error", message);
    return;
  }
  applyPreferences(value.preferences);
  if (value.kind === "startup" || value.kind === "close") modal.value = null;
  if (pendingClose) { pendingClose = false; requestClose(); }
  if (value.kind !== "close") emit("saved");
}
function keydown(event: KeyboardEvent) {
  if (!modal.value) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
  if (event.key !== "Tab") return;
  const nodes = [...(dialog.value?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])];
  const first = nodes[0], last = nodes.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) {
    event.preventDefault(); first.focus();
  }
}
function restoreFocus() {
  for (const [element, previous] of inertElements) element.inert = previous;
  inertElements.clear();
}
watch(modal, async (value, previous) => {
  if (value && !previous) {
    previousFocus = document.activeElement as HTMLElement;
    for (const element of document.querySelectorAll<HTMLElement>(".object-rail, .glass-workspace, .windows-window-controls, .glass-scrim")) {
      inertElements.set(element, element.inert);
      element.inert = true;
    }
  }
  await nextTick();
  if (value) dialog.value?.focus();
  else { restoreFocus(); previousFocus?.focus(); }
});
onMounted(() => {
  window.addEventListener("coursewatch:preferences", receivedPreferences);
  window.addEventListener("coursewatch:closeRequested", requestClose);
  window.addEventListener("coursewatch:lifecycleResult", result);
  window.addEventListener("keydown", keydown, true);
  native("preferences");
});
onUnmounted(() => {
  restoreFocus();
  window.removeEventListener("coursewatch:preferences", receivedPreferences);
  window.removeEventListener("coursewatch:closeRequested", requestClose);
  window.removeEventListener("coursewatch:lifecycleResult", result);
  window.removeEventListener("keydown", keydown, true);
});
function snapshot() {
  return modal.value === "startup" ? { modal: "startup", background: background.value, launchAtLogin: launchAtLogin.value } : null;
}
defineExpose({ openPreferences, saveCloseBehavior, snapshot, busy });
</script>

<template>
  <div v-if="modal" class="lifecycle-scrim">
    <section ref="dialog" class="lifecycle-sheet" role="dialog" aria-modal="true"
      aria-labelledby="lifecycle-title" aria-describedby="lifecycle-description" tabindex="-1" :aria-busy="busy">
      <div class="lifecycle-body">
        <img class="lifecycle-icon" src="/coursewatch.png" width="48" height="48" alt="" />
        <h2 id="lifecycle-title">{{ modal === 'startup' ? '启动与后台' : '关闭 CourseWatch？' }}</h2>
        <p id="lifecycle-description">{{ modal === 'startup'
          ? '选择关闭窗口后的运行方式，以及是否在登录 Windows 时启动 CourseWatch。'
          : '隐藏到系统托盘后，CourseWatch 继续检查任务和发送提醒。退出 CourseWatch 会停止后台和提醒。' }}</p>
        <div v-if="modal === 'startup'" class="lifecycle-options">
          <div class="lifecycle-option">
            <div><strong>后台运行</strong><small>关闭窗口后保留在系统托盘，继续提醒。</small></div>
            <label class="native-toggle"><input v-model="background" type="checkbox" aria-label="后台运行" :disabled="busy" /><span /></label>
          </div>
          <div class="lifecycle-option">
            <div><strong>开机启动</strong><small>{{ background ? '登录 Windows 后在系统托盘启动。' : '登录 Windows 后打开 CourseWatch 窗口。' }}</small></div>
            <label class="native-toggle"><input v-model="launchAtLogin" type="checkbox" aria-label="开机启动" :disabled="busy" /><span /></label>
          </div>
        </div>
        <label v-else class="lifecycle-remember"><input v-model="remember" type="checkbox" :disabled="busy" />记住我的选择</label>
        <p class="lifecycle-hint">{{ modal === 'startup' ? '可在“设置 → 通用 → 启动与后台”中修改。' : '可在“设置 → 通用 → 关闭窗口时”中修改。' }}</p>
        <p v-if="error" class="lifecycle-error" role="alert">{{ error }}</p>
      </div>
      <footer class="lifecycle-footer">
        <button class="glass-secondary" :disabled="busy" @click="cancel">{{ modal === 'startup' && !preferences?.setupCompleted ? '稍后设置' : '取消' }}</button>
        <template v-if="modal === 'startup'">
          <button class="glass-primary" :disabled="busy" @click="saveStartup">{{ busy ? '正在保存…' : '保存设置' }}</button>
        </template>
        <template v-else>
          <button class="glass-secondary" :disabled="busy" @click="chooseClose(preferences?.backgroundEnabled ? 'quit' : 'tray')">{{ preferences?.backgroundEnabled ? '退出 CourseWatch' : '隐藏到系统托盘' }}</button>
          <button class="glass-primary" :disabled="busy" @click="chooseClose(preferences?.backgroundEnabled ? 'tray' : 'quit')">{{ preferences?.backgroundEnabled ? '隐藏到系统托盘' : '退出 CourseWatch' }}</button>
        </template>
      </footer>
    </section>
  </div>
</template>
