<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { api } from '../lib/api';
import { isDesktop, sendDesktop } from '../lib/desktop';
import { APP_VERSION } from '../../../packages/contracts/src/version.js';
import { safeReleasePage, type AppUpdateStatus } from '../../../packages/contracts/src/updates.js';
const props = withDefaults(defineProps<{ status?: AppUpdateStatus; mode?: 'settings' | 'banner' }>(), { mode: 'settings' });
const emit = defineEmits<{ changed: [status: AppUpdateStatus] }>();
const busy = ref(false), error = ref('');
async function change(path: string, method: string, payload: unknown = {}) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { emit('changed', await api(path, method, payload)); }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '操作未完成，请重试'; }
  finally { busy.value = false; }
}
async function setAutomatic(event: Event) {
  const input = event.target as HTMLInputElement;
  await change('updates/settings', 'PATCH', { automatic: input.checked });
  await nextTick();
  input.checked = props.status?.automatic ?? true;
}
function download() {
  const url = props.status?.latest?.url;
  if (!url || !safeReleasePage(url)) { error.value = '更新地址无效，请前往项目 GitHub Releases 查看'; return; }
  if (isDesktop) sendDesktop('openExternal', { url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
</script>
<template>
  <section v-if="mode === 'settings' || status?.latest" class="app-updates" :class="{ 'update-banner': mode === 'banner' }" :aria-label="mode === 'banner' ? '新版本提醒' : '应用更新'">
    <template v-if="mode === 'settings'">
      <h3>应用更新</h3>
      <div class="update-option">
        <label for="automatic-app-updates"><strong>自动检查更新</strong><small>后台启动后检查，此后每天最多检查一次 GitHub Releases。包含项目公开测试版，不自动下载安装包。</small></label>
        <input id="automatic-app-updates" type="checkbox" :checked="status?.automatic ?? true" :disabled="busy" @change="setAutomatic" />
      </div>
      <p>当前版本 {{ status?.currentVersion ?? APP_VERSION }}。检查会连接 GitHub，不发送课程、账号、模型 Key 或个人日程。</p>
      <p v-if="status?.checkedAt" class="update-meta">上次成功检查：{{ new Date(status.checkedAt).toLocaleString('zh-CN') }}</p>
      <p v-if="status?.state === 'current'" role="status">未发现更高版本。</p>
      <p v-if="status?.state === 'idle'" role="status">尚未检查更新。</p>
    </template>
    <div v-if="status?.latest" class="update-available">
      <strong>CourseWatch {{ status.latest.version }} 可用{{ status.latest.prerelease ? '（测试版）' : '' }}</strong>
      <p>前往该版本的 GitHub 页面选择安装包。退出 CourseWatch 后手动安装，升级前备份数据。</p>
      <details v-if="mode === 'settings' && status.latest.notes"><summary>更新说明</summary><pre>{{ status.latest.notes }}</pre></details>
    </div>
    <p v-if="error || status?.error" class="update-error" role="alert">{{ error || status?.error }}</p>
    <div class="update-actions">
      <button v-if="mode === 'settings'" type="button" class="glass-secondary" :disabled="busy || status?.state === 'checking'" @click="change('updates/check', 'POST')">{{ busy || status?.state === 'checking' ? '正在处理…' : '检查更新' }}</button>
      <button v-if="status?.latest" type="button" class="glass-primary" @click="download">查看更新并下载</button>
    </div>
    <p v-if="mode === 'settings'" class="update-meta">发现新版本时在应用内提醒，并沿用已开启的系统通知；不发送邮件或网页推送。同一版本只生成一条通知。手动检查间隔至少一分钟。</p>
  </section>
</template>
<style scoped>
.app-updates { min-width:0;color:var(--d-ink,var(--ink,#262c34));text-align:left; }
.app-updates h3 { margin:0 0 16px; }
.app-updates p { margin:8px 0;font-size:14px;font-weight:400;line-height:1.65;overflow-wrap:anywhere; }
.update-option { display:flex;align-items:center;gap:18px;justify-content:space-between; }
.update-option label { display:block;flex:1;min-width:0; }
.update-option strong,.update-option small { display:block; }
.update-option small,.update-meta { color:var(--d-muted,var(--muted,#687281));font-size:13px;line-height:1.65; }
.update-option input { flex-shrink:0;width:18px;height:18px;accent-color:var(--d-accent); }
.update-actions { display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:14px; }
.update-actions button { min-height:44px;padding:8px 13px;border:1px solid var(--d-border,var(--line,#8884));border-radius:10px;white-space:normal; }
.update-actions .glass-primary { background:var(--d-accent,#ba8150);color:#fff;border-color:transparent; }
.update-actions .glass-secondary { background:var(--d-control,var(--panel,#f3f4f6));color:var(--d-ink,var(--ink,#262c34)); }
.update-available { margin-top:14px; }
.update-available strong { overflow-wrap:anywhere; }
.update-available pre { white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-family:inherit;font-size:13px;line-height:1.7; }
.update-available summary { padding:10px 0;cursor:pointer; }
.update-error { color:var(--d-ink); }
.update-banner { border:1px solid var(--d-border);border-radius:14px;padding:18px 20px;margin-bottom:20px;background:var(--d-card); }
.update-banner .update-available { margin-top:0; }
@media(max-width:560px) { .update-banner { padding:16px; }.update-actions button { flex:1; } }
</style>
