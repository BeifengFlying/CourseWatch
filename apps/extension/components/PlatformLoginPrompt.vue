<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { platforms, type PlatformId } from "../../../packages/contracts/src/index";
const props = defineProps<{ platform: { id: PlatformId; accountId: string; loginStatus: string; activeLogin?: boolean }; activeLogin?: string | null }>();
const emit = defineEmits<{ login: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const needed = computed(() => platforms[props.platform.id].adapted && props.platform.loginStatus !== "logged_in");
const reason = computed(() => props.platform.loginStatus === "verification_required" ? "平台要求人工验证，请打开官方登录窗口处理。" : props.platform.loginStatus === "auth_required" ? "登录已失效，请重新登录后同步课程和任务。" : "请先登录，以读取课程、任务和进度。");
function key() { return `coursewatch-login-prompt:${props.platform.id}:${props.platform.accountId}`; }
function remembered() { try { return sessionStorage.getItem(key()) === "shown"; } catch { return false; } }
function remember() { try { sessionStorage.setItem(key(), "shown"); } catch {} }
async function prompt() {
  if (!needed.value) { dialog.value?.close(); try { sessionStorage.removeItem(key()); } catch {} return; }
  if (remembered() || props.activeLogin || props.platform.activeLogin) return;
  remember(); await nextTick(); dialog.value?.showModal();
}
function login() { dialog.value?.close(); emit("login"); }
onMounted(prompt);
watch(() => [props.platform.id, props.platform.accountId, props.platform.loginStatus, props.activeLogin], prompt);
</script>
<template>
  <aside v-if="needed" class="platform-login-prompt" role="status">
    <span>{{ reason }}</span><button class="glass-secondary" :disabled="!!activeLogin" @click="login">{{ platform.activeLogin ? '登录窗口已打开' : '登录' + platforms[platform.id].short }}</button>
    <dialog ref="dialog" :aria-label="'登录' + platforms[platform.id].short">
      <h3>登录{{ platforms[platform.id].short }}</h3><p>{{ reason }}</p><p>稍后登录仍可查看本机已保存的数据。</p>
      <div><button class="glass-secondary" @click="dialog?.close()">稍后登录</button><button class="glass-primary" @click="login">打开登录窗口</button></div>
    </dialog>
  </aside>
</template>
<style scoped>
.platform-login-prompt{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px;margin-bottom:16px;border:1px solid var(--d-border,var(--line,#8884));border-radius:12px;color:var(--d-ink,var(--ink));font-size:14px;line-height:1.6}.platform-login-prompt button{min-height:44px;white-space:normal}dialog{width:min(420px,calc(100vw - 32px));box-sizing:border-box;max-height:calc(100dvh - 32px);overflow:auto;padding:24px;border:1px solid var(--d-border,#8885);border-radius:16px;background:var(--d-surface,var(--panel,#fff));color:var(--d-ink,var(--ink,#222));text-align:left}dialog::backdrop{background:#0007}dialog h3{margin:0}dialog>div{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:20px}dialog p{overflow-wrap:anywhere}dialog button{font:inherit}@media(max-width:440px){dialog{padding:18px}dialog button{flex:1}}
</style>
