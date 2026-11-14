<script setup lang="ts">
import { computed, ref, watch, useId } from "vue";
import { platforms, type CourseRecord, type PlatformId } from "../../../packages/contracts/src/index";
import { api } from "../lib/api";
const props = defineProps<{ courses: CourseRecord[]; initialPlatform?: PlatformId; fixedPlatform?: boolean; footerTarget?: string; embedded?: boolean; busy: boolean }>();
const formId = `course-selection-${useId()}`;
const emit = defineEmits<{ changed: []; saved: []; view: [id: string] }>();
const platform = ref<PlatformId>(props.initialPlatform ?? props.courses.find(c => c.status === "pending")?.platform ?? "yuketang");
const choices = ref<string[]>([]), error = ref(""), saving = ref(false);
const items = computed(() => props.courses.filter(c => c.platform === platform.value));
const available = computed(() => items.value.filter(c => props.embedded || c.status !== "removed"));
const removed = computed(() => props.embedded ? [] : items.value.filter(c => c.status === "removed"));
watch(() => JSON.stringify([platform.value, items.value.map(c => [c.id, c.status])]), () => { choices.value = items.value.filter(c => c.status === "enabled").map(c => c.id); }, { immediate: true });
defineExpose({ selection: choices, dirty: computed(() => JSON.stringify([...choices.value].sort()) !== JSON.stringify(items.value.filter(c => c.status === "enabled").map(c => c.id).sort())) });
function courseLabel(key: string) {
  const pair = key.match(/^course:([^:]+):class:([^:]+)$/);
  if (pair) return `课程编号 ${pair[1]} · 教学班编号 ${pair[2]}`;
  const labels: Record<string, string> = { classroom: "教学班编号", resource: "教程编号", class: "班级分组", name: "课程名称" };
  const [type, ...parts] = key.split(":");
  let value = parts.join(":"); try { value = decodeURIComponent(value); } catch {}
  return `${labels[type] || "课程标识"} ${value}`;
}
async function perform(action: () => Promise<unknown>, saved = false) {
  if (saving.value || props.busy) return;
  saving.value = true; error.value = "";
  try { await action(); emit("changed"); if (saved) emit("saved"); } catch(e) { error.value = (e as Error).message; } finally { saving.value = false; }
}
</script>
<template>
  <div class="course-manager" :class="{ 'course-inline': !footerTarget }">
    <label v-if="!fixedPlatform" class="course-platform">平台
      <select v-model="platform" :disabled="saving" aria-label="课程平台">
        <option v-for="(p, id) in platforms" :key="id" :value="id">{{ p.name }}</option>
      </select>
    </label>
    <p v-if="platform === 'unipus'">选择需要保留任务并发送提醒的教程或分组。官网汇总未提供教程关联的作业、考试单独列出；读取汇总后仅保存已选分组的任务。</p>
    <p v-else>勾选需要同步的课程后保存。未选择或已移除的课程不读取任务、不发送提醒，已有记录保留。</p>
    <p v-if="items.some(c => c.status === 'pending')" role="status">有新课程待选择；默认不勾选。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!items.length">尚未读取到课程。请完成平台登录，再同步课程列表。</p>
    <h3 v-if="available.length" class="course-list-title">同步课程 <small>{{ choices.length }} 门已选择</small></h3>
    <form v-if="available.length" :id="formId" @submit.prevent="perform(() => api(`platforms/${platform}/courses/selection`, 'POST', { ids: choices }), true)">
      <div v-for="c in available" :key="c.id" class="course-row">
        <label><input v-model="choices" type="checkbox" :value="c.id" :disabled="saving || busy" /><span>{{ c.name }}<small v-if="c.status === 'pending'">待选择</small><small v-if="c.status === 'removed'">已移除</small><small v-if="items.filter(x => x.name === c.name).length > 1">{{ courseLabel(c.key) }}</small></span></label>
        <div v-if="c.status === 'enabled' && !embedded" class="course-actions">
          <button v-if="!fixedPlatform" type="button" class="glass-secondary" @click="emit('view', c.id)">查看课程</button>
          <button type="button" class="glass-secondary" :disabled="saving || busy" @click="perform(() => api(`courses/${c.id}`, 'PATCH', { enabled: false }))">移除课程</button>
        </div>
      </div>
    </form>
    <template v-if="removed.length">
      <h3 class="course-list-title">已移除 <small>{{ removed.length }} 门</small></h3>
      <div v-for="c in removed" :key="c.id" class="course-row"><span>{{ c.name }}<small v-if="items.filter(x => x.name === c.name).length > 1">{{ courseLabel(c.key) }}</small></span><button class="glass-secondary" :disabled="saving || busy" @click="perform(() => api(`courses/${c.id}`, 'PATCH', { enabled: true }))">添加课程</button></div>
    </template>
    <Teleport defer :to="footerTarget || 'body'" :disabled="!footerTarget">
      <div v-if="available.length && !embedded" class="course-save"><span>{{ choices.length }} 门已选择</span><button type="submit" :form="formId" class="glass-primary" :disabled="saving || busy">{{ saving ? '正在保存…' : '保存课程选择' }}</button></div>
    </Teleport>
  </div>
</template>
<style scoped>
.course-manager { display: grid; gap: 16px; min-width: 0; }
.course-manager p { margin: 0; line-height: 1.7; color: var(--d-muted); }
.course-platform { display: grid; gap: 8px; }
select { width: 100%; min-width: 0; height: var(--d-control-height,44px); border: 1px solid #a8adb780; border-radius: 9px; background: var(--d-control); color: var(--d-ink); padding: 0 10px; font: inherit; }
.course-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid #a8adb740; overflow-wrap: anywhere; }
.course-row label { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.course-row input { width: 18px; height: 18px; flex-shrink: 0; }
.course-row span { min-width: 0; }
.course-row small { display: block; margin-top: 5px; color: var(--d-muted); font-size: 12px; }
.course-actions { display: flex; gap: 8px; flex-shrink: 0; }
.course-save { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding-top: 12px; color: var(--d-ink); }
.course-save span { color: var(--d-muted); font-size: 13px; flex-shrink: 0; }
@media(max-width: 560px) { .course-row { align-items: flex-start; flex-wrap: wrap; } .course-actions { width: 100%; justify-content: flex-end; } .course-save button { width: 100%; } }

.course-manager { color: var(--d-ink, #262c34); font-optical-sizing: auto; }
.course-inline form { max-height: min(46dvh, 420px); overflow: auto; overscroll-behavior: auto; }
.course-manager form { padding: 0 16px 16px; background: var(--d-card, #fff); border: 1px solid var(--d-border, #adb6c544); border-radius: 14px; }
.course-list-title { display: flex; align-items: baseline; gap: 8px; margin: 4px 0 -4px; font-size: 14px; font-weight: 600; }
.course-list-title small { color: var(--d-muted, #687281); font-size: 12px; font-weight: 400; }
.course-platform select { height: 44px; background: var(--d-card, #fff); }
.course-row { min-height: 44px; }
.course-row input { accent-color: var(--d-blue, #477bd7); }
.course-manager .glass-primary,.course-save .glass-primary { background: var(--d-accent, #477bd7); color: #fff; border: 1px solid transparent; }
.course-manager .glass-secondary { background: var(--d-control, var(--panel, #fff)); color: var(--d-ink, var(--ink, #262c34)); }
.course-manager button:not(:disabled):active { transform: scale(.97); transition: transform 80ms ease-out; }
.course-manager :is(button,input,select):focus-visible { outline: 3px solid var(--d-blue, #477bd7); outline-offset: 3px; }
@media(prefers-reduced-motion: reduce) { .course-manager button { transform: none !important; transition: none !important; } }
@media(prefers-contrast: more) { .course-manager form, .course-platform select { border-color: currentColor; } }
</style>
