<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import type { CourseRecord } from "../../../packages/contracts/src/index";
import { SkipBack, SkipForward, Pause, Play, ExternalLink, Download, Square, RefreshCw, Settings2, X } from "lucide-vue-next";
import { api } from "../lib/api";
import StudyChapterList from "./StudyChapterList.vue";
import { useAgreementReading } from "../lib/useAgreementReading";
import { studyDrafts } from "../lib/study-drafts";
import { exportSystemLogs } from '../lib/diagnostics';
import { StudyConfig, STUDY_ACCEPTANCE_TEXT, studyNoticeVersion, studyPlatformNames, initialStudyStatus, type StudyStatus, type StudyPlatform, type StudyPosition, type CourseLearningProgress } from "../../../packages/contracts/src/study";
const props = withDefaults(defineProps<{ mode?: "settings" | "platform"; platform?: StudyPlatform; courses?: CourseRecord[] }>(), { mode: "settings", platform: "chaoxing" });
const name = studyPlatformNames[props.platform];
const version = studyNoticeVersion(props.platform);
const prefix = props.platform === "unipus" ? "study/unipus" : "study";
const controlId = (value: string) => props.platform === "unipus" ? `study-unipus-${value}` : `study-${value}`;
const emit = defineEmits<{ settings: [] }>();
const operation = ref<"play" | "answers" | "keep-open">(props.platform === "unipus" ? "keep-open" : "play"), selectedCourse = ref(localStorage.getItem(`coursewatch-study-course:${props.platform}`) || ""), background = ref(true), closeAfterMinutes = ref(0);
watch(operation, mode => { if (mode === "keep-open" && closeAfterMinutes.value === 0) closeAfterMinutes.value = 30; },{immediate:true});
const availableCourses = computed(() => (props.courses || []).filter(c => c.platform === props.platform && c.status === "enabled" && (props.platform !== "unipus" || c.key.startsWith("resource:"))));
watch(availableCourses, items => { if (!items.some(c => c.id === selectedCourse.value)) selectedCourse.value = items[0]?.id || ""; }, { immediate: true });
const selectedChapter = ref(''), runningChapter = ref('');
const position = ref<StudyPosition | null>(null), chapterChoices = ref<CourseLearningProgress['chapters']>([]), readingPosition = ref(false);
let positionVersion = 0;
async function readPosition() {
  const courseId = selectedCourse.value, version = ++positionVersion;
  position.value = null; chapterChoices.value = [];
  if (!courseId || props.mode !== 'platform') return;
  readingPosition.value = true;
  try {
    const saved = await api(`${prefix}/position?courseId=${encodeURIComponent(courseId)}`);
    if (version === positionVersion) { position.value = saved.position || null; chapterChoices.value = Array.isArray(saved.chapters) ? saved.chapters : []; }
  } catch (e) { if (version === positionVersion) error.value = (e as Error).message; }
  finally { if (version === positionVersion) readingPosition.value = false; }
}
watch(selectedCourse, courseId => {
  localStorage.setItem(`coursewatch-study-course:${props.platform}`, courseId);
  selectedChapter.value = '';
  void readPosition();
});
async function readChapters() {
  await act(async () => {
    if (config.value.active) {
      status.value = await api(`${prefix}/progress`, 'POST');
      if (!runningChapters.value.length) throw new Error('当前官网页面未读取到章节目录，请打开运行窗口检查教程是否加载');
      return;
    }
    const result = await api(`${prefix}/catalog`, 'POST', {courseId:selectedCourse.value}, 100000);
    await readPosition();
    if (result.issues?.length) throw new Error(typeof result.issues[0] === 'string' ? result.issues[0] : result.issues[0].message || '章节读取未完成，请查看课程查询结果');
  });
}
const runningChapters = computed(() => (status.value.progress?.chapters || []).filter(c => c.id));
async function chooseChapter(task?: "video"|"quiz") {
  if (!runningChapter.value) return;
  statusVersion++;
  await act(async () => { status.value = await api(`${prefix}/chapter`, 'POST', {chapterId:runningChapter.value,...(task ? {task} : {})}); runningChapter.value = ''; });
}
async function chooseTask(id: string, task: 'video'|'quiz') {
  if (config.value.active) { runningChapter.value = id; await chooseChapter(task); return; }
  selectedChapter.value = id; operation.value = task === 'quiz' ? 'answers' : 'play';
  if (task === 'quiz' && (!config.value.hasKey || !savedModel.value)) { await openModel(); error.value = '请先保存模型与 Key，再做章节检测'; return; }
  await command('start');
}
const activityLabels = {requesting:'正在请求模型',thinking:'正在思考',answering:'正在生成答案',completed:'本题输出结束',interrupted:'已中断'};
const modelNeeded = computed(() => operation.value === "answers");
const config = ref({ ...StudyConfig.parse({}), hasKey: false, active: false });
watch(() => config.value.active, (active, previous) => { if (previous && !active) void readPosition(); });
const savedConfig = ref("");
const configSnapshot = () => { const { hasKey, active, ...value } = config.value; return JSON.stringify(value); };
const unsaved = computed(() => savedConfig.value !== configSnapshot() || !!apiKey.value);
const status = ref<StudyStatus>(initialStudyStatus());
const currentChapterDetails = computed(() => {
  if (props.platform !== 'unipus') return '';
  const chapter = status.value.progress?.chapters.find(c => c.id === status.value.progress?.chapterId);
  if (!chapter) return '';
  return [chapter.path?.map(part => part.name).join(' / '),chapter.required === true ? '必修' : chapter.required === false ? '非必修' : '必修属性待确认'].filter(Boolean).join(' · ');
});
const workspace = ref<HTMLElement | null>(null), launchPanel = ref<HTMLElement | null>(null), runPanel = ref<HTMLElement | null>(null);
let panelObserver: ResizeObserver | undefined;
watch([launchPanel,runPanel], ([launch,run]) => {
  panelObserver?.disconnect();
  const panel = launch || run;
  if (!panel) return;
  const resize = () => workspace.value?.style.setProperty('--study-panel-height', `${panel.getBoundingClientRect().height}px`);
  panelObserver = new ResizeObserver(resize); panelObserver.observe(panel); resize();
}, {flush:'post'});
const modelOutputScroll = ref<HTMLElement | null>(null);
watch(() => [status.value.modelActivity?.question,status.value.modelActivity?.reasoning,status.value.modelActivity?.answer], async (value, old) => {
  const el = modelOutputScroll.value;
  const follow = !el || value[0] !== old?.[0] || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  await nextTick();
  if (follow && modelOutputScroll.value) modelOutputScroll.value.scrollTop = modelOutputScroll.value.scrollHeight;
});
const apiKey = ref("");
const modelSettings = ref<HTMLDialogElement | null>(null), editingModel = ref(false), models = ref<string[]>([]), manualModel = ref(true), modelFeedback = ref("");
const savedModel = ref("");
async function openModel() { editingModel.value = true; await nextTick(); modelSettings.value?.showModal(); }
function closeModel() { modelSettings.value?.close(); editingModel.value = false; }
async function inspectModel(test = false) {
  await act(async () => {
    const result = await api(`${prefix}/${test ? "model/test" : "models"}`, "POST", { baseURL:config.value.baseURL, ...(apiKey.value ? {apiKey:apiKey.value} : {}), ...(test ? {model:config.value.model} : {}) });
    if (test) modelFeedback.value = result.message;
    else { models.value = result.models; manualModel.value = false; modelFeedback.value = `已读取 ${models.value.length} 个模型，请选择或手动填写`; }
  });
}
watch(() => [config.value.baseURL, apiKey.value], () => { models.value = []; manualModel.value = true; modelFeedback.value = ""; });
watch(() => config.value.model, () => { modelFeedback.value = ""; });
const busy = ref(false), error = ref(""), message = ref("");
const notice = ref<HTMLDialogElement | null>(null), accepted = ref(false);
const skillNotice = ref<HTMLDialogElement | null>(null), skillAccepted = ref(false);
const noticeContent = ref<HTMLElement | null>(null), skillContent = ref<HTMLElement | null>(null);
const { reachedEnd: noticeRead, open: showNotice, check: checkNotice } = useAgreementReading(notice, noticeContent);
const { reachedEnd: skillRead, open: showSkillNotice, check: checkSkillNotice } = useAgreementReading(skillNotice, skillContent);
function openNotice() { accepted.value = false; void showNotice(); }
function toggleSkills(event: Event) {
  const input = event.target as HTMLInputElement;
  input.checked = config.value.localSkills;
  if (config.value.localSkills) config.value.localSkills = false;
  else { skillAccepted.value = false; void showSkillNotice(); }
}
function acceptSkills() { if (skillRead.value && skillAccepted.value) { config.value.localSkills = true; skillNotice.value?.close(); } }
async function clearSkills() { await act(async () => { await api(`${prefix}/skills/delete`, 'POST', {}); message.value = '本地 Skill 已清除'; }); }
let statusVersion = 0;
let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
async function act(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = ""; message.value = "";
  try { await work(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
async function load() {
  await readPosition(); config.value = await api(`${prefix}/settings`); savedModel.value = config.value.model;
  if (config.value.enabled) status.value = await api(`${prefix}/status`);
  savedConfig.value = configSnapshot();
  const draft = props.mode === 'platform' ? studyDrafts.get(props.platform) : undefined;
  if (draft) { const { enabled,noticeVersion,hasKey,active } = config.value; config.value = {...draft.config,enabled,noticeVersion,hasKey,active}; apiKey.value = draft.key; skillAccepted.value = draft.skillsAccepted; }
}
function settingsChanged() { if (props.mode === "platform") void act(load); }
function notifySettingsChanged() { window.dispatchEvent(new Event("coursewatch:study-settings")); }
async function poll() {
  if (disposed) return;
  if (!document.hidden && !busy.value) {
    try {
      const version = statusVersion;
      const saved = await api(`${prefix}/settings`); savedModel.value = saved.model;
      if (props.mode === "platform" && !editingModel.value && !unsaved.value) { config.value = saved; savedConfig.value = configSnapshot(); }
      else { config.value.enabled = saved.enabled; config.value.noticeVersion = saved.noticeVersion; config.value.active = saved.active; }
      if (props.mode === "platform" && saved.enabled) { const latest = await api(`${prefix}/status`) as StudyStatus; if (version === statusVersion && !busy.value) status.value = latest; }
    } catch (e) { error.value = (e as Error).message; }
  }
  if (!disposed) timer = setTimeout(poll, status.value.modelActivity && ["requesting","thinking","answering"].includes(status.value.modelActivity.phase) ? 350 : 2000);
}
function toggle() {
  if (config.value.enabled) void act(async () => { config.value = await api(`${prefix}/disable`, "POST", {}); status.value = await api(`${prefix}/status`); savedConfig.value = configSnapshot(); notifySettingsChanged(); message.value = "试验性功能已关闭，自动学习已停止"; });
  else openNotice();
}
async function enable() {
  if (!noticeRead.value || !accepted.value) return;
  await act(async () => { config.value = await api(`${prefix}/accept`, "POST", { noticeVersion: version, accepted: true }); notice.value?.close(); savedConfig.value = configSnapshot(); notifySettingsChanged(); });
}
async function persistConfig() { const parsed = StudyConfig.safeParse(config.value); if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "请检查模型设置"); config.value = await api(`${prefix}/settings`, "PATCH", { ...parsed.data, ...(config.value.localSkills && skillAccepted.value ? { localSkillsAccepted: true } : {}), ...(apiKey.value ? { apiKey: apiKey.value } : {}) }); apiKey.value = ""; studyDrafts.delete(props.platform); savedModel.value = config.value.model; savedConfig.value = configSnapshot(); notifySettingsChanged(); message.value = config.value.active ? "模型设置已保存，停止并重新启动学习后生效" : "模型设置已保存";
}
async function save() { await act(persistConfig); }
async function saveSubmissionChoice() {
  const previous = JSON.parse(savedConfig.value || '{}');
  if (previous.autoSubmitPractice === config.value.autoSubmitPractice && previous.chapterTests === config.value.chapterTests) return;
  // Starting a task saves these choices only; model/Key drafts still require
  // the model panel's explicit Save action.
  const current = StudyConfig.parse(await api(`${prefix}/settings`));
  const saved = await api(`${prefix}/settings`, 'PATCH', {...current,autoSubmitPractice:config.value.autoSubmitPractice,chapterTests:config.value.chapterTests});
  savedConfig.value = JSON.stringify(StudyConfig.parse(saved));
  savedModel.value = saved.model; config.value.hasKey = saved.hasKey;
  notifySettingsChanged();
}
async function changeRunningTests(event: Event) {
  const input = event.target as HTMLInputElement, enabled = input.checked;
  const previousChoice = config.value.chapterTests;
  config.value.chapterTests = enabled;
  await act(async () => {
    try {
    const current = StudyConfig.parse(await api(`${prefix}/settings`));
    const saved = await api(`${prefix}/settings`, 'PATCH', {...current,chapterTests:enabled});
    config.value.chapterTests = saved.chapterTests;
    const previous = JSON.parse(savedConfig.value);
    savedConfig.value = JSON.stringify({...previous,chapterTests:saved.chapterTests});
    notifySettingsChanged();
    message.value = enabled ? '章节测试已开启，从后续测试开始处理' : '章节测试已关闭，继续播放课程';
    } catch (error) { config.value.chapterTests = previousChoice; throw error; }
  });
}
async function command(action: string) {
  if (busy.value) return;
  statusVersion++;
  await act(async () => { if (action === "start") await saveSubmissionChoice(); status.value = await api(`${prefix}/${action}`, "POST", action === "start" ? { operation: operation.value, ...(props.platform === "chaoxing" && operation.value === "answers" ? {task:"quiz"} : {}), ...(selectedCourse.value ? { courseId: selectedCourse.value } : {}), background: background.value && !!selectedCourse.value, closeAfterMinutes: closeAfterMinutes.value, ...(selectedChapter.value && operation.value !== 'keep-open' ? {chapterId:selectedChapter.value} : {}) } : {}); config.value.active = ["starting", "running", "paused", "stopping"].includes(status.value.phase); if(action === "start") selectedChapter.value = ""; });
}
async function queryProgress() { if (busy.value) return; statusVersion++; await act(async () => { status.value = await api(`${prefix}/progress`, "POST", {}); config.value.active = ["starting", "running", "paused", "stopping"].includes(status.value.phase); }); }
async function showWindow() { await act(async () => { await api(`${prefix}/show`, 'POST', {}); }); }
async function exportLogs() { await act(exportSystemLogs); }
function clock(seconds: number) { const value = Math.floor(seconds); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }
async function clearKey() { await act(async () => { config.value = await api(`${prefix}/key/delete`, "POST", {}); apiKey.value = ""; }); }
const canControl = computed(() => ['running', 'paused'].includes(status.value.phase));
const mediaPercent = (current: number, duration: number) => Math.max(0, Math.min(100, current / duration * 100));
const labels: Record<string, string> = { idle: "未启动", starting: "正在启动", running: "运行中", paused: "已暂停", stopping: "正在停止", stopped: "已停止", failed: "运行失败", completed: "本轮结束" };
onMounted(() => { window.addEventListener("coursewatch:study-settings", settingsChanged); void act(load).finally(() => { if (!disposed) timer = setTimeout(poll, status.value.modelActivity && ["requesting","thinking","answering"].includes(status.value.modelActivity.phase) ? 350 : 2000); }); });
onUnmounted(() => {
  panelObserver?.disconnect();
  if (props.mode === 'platform' && unsaved.value && savedConfig.value) { const {hasKey,active,...value} = config.value; studyDrafts.set(props.platform,{config:JSON.parse(JSON.stringify(value)),key:apiKey.value,skillsAccepted:skillAccepted.value}); } else if (props.mode === 'platform' && savedConfig.value) studyDrafts.delete(props.platform);
  window.removeEventListener("coursewatch:study-settings", settingsChanged); disposed = true; if (timer) clearTimeout(timer); apiKey.value = ""; });
</script>
<template>
  <section class="study-experiment" :class="{ 'study-platform': props.mode === 'platform' }" :aria-label="`${name}自动学习`">
    <div v-if="props.mode === 'platform'" class="study-heading"><div><h3>学习任务</h3><p>{{ name }}<span v-if="savedModel && config.hasKey"> · {{ savedModel }}</span><span v-else> · {{ props.platform === 'unipus' && operation === 'keep-open' ? '保活无需模型' : '未配置模型' }}</span></p></div><button type="button" @click="openModel"><Settings2 :size="16" />模型与设置</button></div>
    <p v-if="props.mode === 'platform'" class="study-note">实验功能仅用于技术实现验证与参考，不得用于其他目的。用于其他目的的后果由使用者依法承担，不代表平台已授权。</p>
    <div v-if="props.mode === 'settings'" class="study-switch-row">
      <div><strong>{{ name }}自动学习</strong><p>仅用于技术实现验证与参考，不得用于其他目的。开启前请阅读用途、风险及免责声明。</p></div>
      <button type="button" class="study-toggle" role="switch" :aria-label="`${name}自动学习`" :aria-checked="config.enabled" :disabled="busy" @click="toggle"><span aria-hidden="true" /></button>
    </div>
    <p v-if="error && !editingModel" class="study-error" role="alert">{{ error }}</p>
    <p v-if="message && !editingModel" role="status">{{ message }}</p>
    <p v-if="props.mode === 'settings' && config.enabled" class="study-note">已开启。请在主窗口选择{{ name }}，直接开始播放或保留页面；配置模型后，进入章节或单元练习才生成答案；学习通播放视频期间不调用模型，未配置时跳过检测。开启开关不会自动启动。</p>
    <button v-if="props.mode === 'settings'" type="button" class="study-notice-link" @click="openNotice">查看用途、风险与免责声明</button>
    <template v-if="props.mode === 'platform'">
      <p v-if="!config.enabled" class="study-note">自动学习尚未开启。<button type="button" @click="emit('settings')">打开功能开关</button></p>
      <div v-if="config.enabled" ref="workspace" class="study-workspace">
      <form v-if="config.enabled && !config.active" ref="launchPanel" class="study-launch" @submit.prevent="command('start')">
        <label>课程<select aria-label="课程" v-model="selectedCourse" :disabled="busy"><option value="">在官方窗口选择</option><option v-for="c in availableCourses" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <fieldset class="study-operations"><legend>学习方式</legend><div class="study-operation-choices"><label v-for="item in [{id:'play',label:'播放课程'},{id:'answers',label:props.platform === 'chaoxing' ? '章节检测' : '生成答案'},{id:'keep-open',label:props.platform === 'unipus' ? '后台保活' : '保留页面'}]" :key="item.id" :class="{selected:operation === item.id}"><input v-model="operation" type="radio" :name="controlId('operation')" :value="item.id" :disabled="busy" />{{ item.label }}</label></div></fieldset>
        <p v-if="operation !== 'keep-open'" class="study-resume">{{ readingPosition ? '正在读取上次位置…' : selectedChapter ? '从所选章节开始' : position ? '继续上次位置 · ' + position.chapter : '从官网默认位置开始' }}<button v-if="selectedChapter" type="button" @click="selectedChapter = ''">恢复默认</button></p>
        <details class="study-launch-options"><summary>运行选项 · {{ background && selectedCourse ? '后台' : '官方窗口' }}{{ closeAfterMinutes ? ` · ${closeAfterMinutes} 分钟后关闭` : '' }}</summary>
          <label>自动关闭（分钟，0 为不设限）<input v-model.number="closeAfterMinutes" type="number" :min="operation === 'keep-open' ? 1 : 0" max="1440" required :disabled="busy" /></label>
          <label class="study-checkbox"><input v-model="background" type="checkbox" :disabled="busy || !selectedCourse" />在后台打开（需要先选择课程）</label>
        </details>
        <p v-if="operation === 'keep-open'" class="study-note">{{ props.platform === 'unipus' ? '无需配置模型，不答题。每 5 分钟保活，到时关闭；普通超时提示自动继续，身份验证需本人处理。实际学时以官网记录为准。' : '只保留页面并定时关闭，不点击、不答题、不模拟活跃。本机倒计时不代表平台学时。' }}</p>
        <p v-if="modelNeeded && (!config.hasKey || !savedModel)" class="study-note">生成答案需要先保存模型与 Key。<button type="button" @click="openModel">配置模型</button></p>
        <div v-if="props.platform === 'chaoxing' && operation === 'play'" class="study-test-option"><label class="study-checkbox"><input v-model="config.chapterTests" type="checkbox" :disabled="busy" />播放时处理章节测试</label><p class="study-note">关闭后跳过章节测试，继续播放课程；视频内弹题仍按原设置处理。</p></div>
        <div v-if="operation !== 'keep-open' && (props.platform !== 'chaoxing' || operation !== 'play' || config.chapterTests)" class="study-submit-option"><label class="study-checkbox"><input v-model="config.autoSubmitPractice" type="checkbox" :disabled="busy" />自动填入并提交章节练习</label><p class="study-note">{{ config.autoSubmitPractice ? '启动后按生成的答案填写并提交；作业仍需手动提交。' : '默认关闭；章节练习只生成答案，由你在官网填写并提交。' }}</p></div>
        <div class="study-launch-footer"><span class="study-note">{{ operation === 'keep-open' ? (props.platform === 'unipus' ? '保活不需要模型' : '按设定时间关闭') : '已完成任务自动跳过' }}</span><div class="study-actions"><button type="submit" class="glass-primary" :disabled="busy || readingPosition || (modelNeeded && (!config.hasKey || !savedModel))">{{ operation === 'keep-open' ? (props.platform === 'unipus' ? '开始保活' : '打开并定时关闭') : operation === 'answers' ? (props.platform === 'chaoxing' ? '做章节检测' : '开始生成答案') : background && selectedCourse ? '后台播放' : '打开学习窗口' }}</button></div></div>
      </form>
      <div v-if="config.enabled && status.phase !== 'idle'" ref="runPanel" class="study-run" :data-phase="status.phase" :aria-busy="busy">
        <div class="study-progress-heading">
          <h4><span class="study-status-dot" aria-hidden="true" />{{ labels[status.phase] }}</h4>
          <button type="button" class="study-refresh" :disabled="busy" @click="queryProgress"><RefreshCw :size="14" aria-hidden="true" />{{ busy ? '正在处理…' : '查询进度' }}</button>
        </div>
        <div class="study-now" aria-label="当前学习">
          <span class="study-eyebrow">当前课程</span><strong>{{ status.courseName || status.progress?.course || '正在读取课程' }}</strong>
          <p class="study-chapter">{{ status.progress?.chapter || '章节名称尚未读取' }}</p>
          <p v-if="currentChapterDetails" class="study-note">{{ currentChapterDetails }}</p>
          <div v-if="props.platform === 'chaoxing' && status.progress?.tasks?.length" class="study-task-status" aria-label="小节任务状态">
            <div v-for="task in status.progress.tasks" :key="task.id"><span>{{ task.name }}{{ task.current ? ' · 当前' : '' }}</span><strong>{{ task.complete === true ? '已完成' : task.complete === false ? '未完成' : '待确认' }}</strong><button v-if="task.kind === 'quiz' && config.active && status.progress.chapterId" type="button" :disabled="busy || !canControl || task.locked || status.operation === 'keep-open'" @click="chooseTask(status.progress.chapterId,'quiz')">进入章节检测</button></div>
          </div>
          <div v-for="(media, index) in status.progress?.media || []" :key="index" class="study-media">
            <progress v-if="media.duration && media.duration > 0" :value="mediaPercent(media.current, media.duration)" max="100" :aria-label="`${media.kind === 'video' ? '视频' : '音频'} ${index + 1} 播放位置`" />
            <div class="study-media-label"><span>{{ media.kind === 'video' ? '视频' : '音频' }} {{ index + 1 }} · {{ media.ended ? '播放结束' : status.phase === 'paused' || media.paused ? '已暂停' : '播放中' }}</span><span>{{ clock(media.current) }} <span class="study-time-divider">/</span> {{ media.duration === null ? '总时长未知' : clock(media.duration) }}</span></div>
          </div>
          <p v-for="(doc, index) in status.progress?.documents || []" :key="index" class="study-document">文档 {{ index + 1 }} · 第 {{ doc.current ?? '未知' }} / {{ doc.total ?? '未知' }} 页</p>
          <div v-if="config.active" class="study-transport" aria-label="章节播放控制">
            <button type="button" class="study-skip" :disabled="busy || !canControl || !status.navigation?.previous || status.operation === 'keep-open'" title="上一节" @click="command('previous')"><SkipBack :size="22" fill="currentColor" aria-hidden="true" /><span>上一节</span></button>
            <button type="button" class="study-play" :disabled="busy || !canControl" @click="command(status.phase === 'paused' ? 'resume' : 'pause')"><Play v-if="status.phase === 'paused'" :size="26" fill="currentColor" aria-hidden="true" /><Pause v-else :size="24" fill="currentColor" aria-hidden="true" /><span>{{ status.phase === 'paused' ? '继续' : '暂停' }}</span></button>
            <button type="button" class="study-skip" :disabled="busy || !canControl || !status.navigation?.next || status.operation === 'keep-open'" title="下一节" @click="command('next')"><SkipForward :size="22" fill="currentColor" aria-hidden="true" /><span>下一节</span></button>
          </div>
        </div>
        <section v-if="status.modelActivity" class="study-model-output" aria-label="模型实时输出">
          <div class="study-progress-heading"><h4>模型输出 <small>{{ status.modelActivity.question }} / {{ status.modelActivity.total }}</small></h4><small role="status">{{ activityLabels[status.modelActivity.phase] }}</small></div>
          <div class="study-output-model"><span>{{ savedModel }}</span></div>
          <div ref="modelOutputScroll" class="study-model-scroll" tabindex="0" aria-label="思考内容与答案">
            <p v-if="!status.modelActivity.reasoning" class="study-note">{{ ['requesting','thinking'].includes(status.modelActivity.phase) ? '等待接口返回思考内容或答案…' : '接口未返回可展示的思考内容。' }}</p>
            <template v-else><h5>思考内容</h5><pre>{{ status.modelActivity.reasoning }}</pre></template>
            <template v-if="status.modelActivity.answer"><h5>答案输出</h5><pre>{{ status.modelActivity.answer }}</pre></template>
          </div>
        </section>
        <p class="study-run-message" role="status">{{ status.message }}</p>
        <p v-if="props.platform === 'unipus' && config.active" class="study-note">后台任务不显示浏览器窗口。打开运行窗口会暂停并重新载入官网页面；继续后转回后台。切换前请先在官网保存手动输入。</p>
        <div v-if="props.platform === 'chaoxing' && config.active && status.operation === 'play'" class="study-test-option"><label class="study-checkbox"><input type="checkbox" :checked="config.chapterTests" :disabled="busy || !canControl" @change="changeRunningTests" />播放时处理章节测试</label><p class="study-note">关闭后停止当前答题并跳过后续测试；已发出的提交会先核实结果。</p></div>
        <div class="study-run-tools">
          <button v-if="status.phase === 'failed'" type="button" :disabled="busy" @click="exportLogs"><Download :size="15" aria-hidden="true" />导出系统日志</button>
          <button v-if="config.active" type="button" :disabled="busy || status.phase === 'stopping'" @click="showWindow"><ExternalLink :size="15" aria-hidden="true" />打开运行窗口</button>
          <button v-if="config.active" type="button" class="study-stop" :disabled="busy || status.phase === 'stopping'" @click="command('stop')"><Square :size="13" aria-hidden="true" />停止</button>
        </div>
        <div class="study-run-meta">
          <small>{{ config.active ? '当前页面读取' : '最后一次读取' }}{{ status.progress ? ' · ' + new Date(status.progress.observedAt).toLocaleTimeString('zh-CN', { hour12: false }) : ' · 暂无进度' }}，平台记录以官网为准。</small>
          <small v-if="status.closeAt">{{ new Date(status.closeAt).toLocaleTimeString('zh-CN', { hour12: false }) }} 自动关闭</small>
        </div>
        <details class="study-run-details">
          <summary>运行详情<span v-if="status.progress?.chapters?.length"> · {{ status.progress.chapters.length }} 个章节</span></summary>
          <div v-if="status.progress" class="study-progress" aria-label="当前页面学习进度">
            <p>当前章节：{{ status.progress.chapterComplete === true ? '已完成' : status.progress.chapterComplete === false ? '未完成' : '待确认' }}</p>

          </div>
          <div v-if="props.platform === 'unipus' && status.timing && status.operation !== 'keep-open'" class="study-progress" aria-label="本机计时">
            <p>媒体推进 {{ clock(status.timing.mediaSeconds) }} · 前台阅读 {{ clock(status.timing.readingSeconds) }}</p>
            <p v-if="status.timing.targetSeconds">本轮目标 {{ clock(status.timing.targetSeconds) }}</p>
            <small>本机计时不能证明本人持续学习。暂停、缓冲、拖动及休眠不计入媒体时长。</small>
          </div>
          <button v-if="status.phase !== 'failed'" type="button" :disabled="busy" @click="exportLogs"><Download :size="15" aria-hidden="true" />导出系统日志</button>
          <p class="study-note">{{ props.platform === 'chaoxing' ? '视频选择弹题穷举选项，明确判错后换下一组；播放视频时不调用模型，进入章节检测栏目后才生成答案，未配置时跳过；自动提交仍由设置控制。验证、未知题型或提交结果不明时暂停。' : '每 5 分钟保活，普通超时提示自动继续；验证或无法识别的任务会暂停。' }}可打开运行窗口处理，再点击继续。</p>
          <p v-if="status.requests" class="study-note">本轮 {{ status.requests }} 次模型请求 · 输入 {{ status.inputTokens }}／输出 {{ status.outputTokens }} Token</p>
          <small v-if="status.heartbeatAt">状态检查 {{ new Date(status.heartbeatAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</small>
          <details v-if="status.logs.length"><summary>运行记录（{{ status.logs.length }}）</summary><ol class="study-logs"><li v-for="(log, i) in status.logs" :key="i">{{ new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false }) }} {{ log.message }}</li></ol></details>
        </details>
        <details v-if="status.answers.length"><summary>答案（{{ status.answers.length }}）</summary><article v-for="(answer, i) in status.answers" :key="answer.id" class="study-answer"><strong>{{ i + 1 }}. {{ answer.mode === 'homework' ? '课程作业 · 手动提交' : answer.mode === 'practice' ? '教程练习' : '章节测验' }}</strong><p>{{ answer.stem }}</p><p>答案：{{ answer.answers.map(value => answer.options?.[Number(value) - 1] ? `${value}（${answer.options[Number(value) - 1]}）` : value).join('；') }}</p><p v-if="answer.explanation">{{ answer.explanation }}</p></article></details>
      </div>
      <aside v-if="selectedCourse || config.active" class="study-directory" aria-label="学习章节"><div class="study-directory-heading"><div><h4>章节目录</h4><small>{{ (config.active ? runningChapters : chapterChoices).length }} 节 · {{ (config.active ? runningChapters : chapterChoices).filter(c => c.complete === true).length }} 节已完成</small></div><button type="button" :disabled="busy || readingPosition" @click="readChapters()">{{ busy ? '读取中…' : (config.active ? runningChapters : chapterChoices).length ? '刷新目录' : '读取目录' }}</button></div><StudyChapterList :show-required="props.platform === 'unipus'" :show-tasks="props.platform === 'chaoxing'" :active="config.active" @task="chooseTask" :chapters="config.active ? runningChapters : chapterChoices" :selected="config.active ? status.progress?.chapterId : selectedChapter" :current="config.active ? status.progress?.chapterId : position?.chapterId" :disabled="busy || readingPosition || (config.active ? (!canControl || status.operation === 'keep-open') : operation === 'keep-open')" @select="id => { if (config.active) { runningChapter = id; chooseChapter(); } else selectedChapter = id; }" /></aside>
      </div>
    </template>
    <dialog v-if="props.mode === 'platform'" ref="modelSettings" class="study-model" :aria-label="name + '模型与设置'" @cancel="editingModel = false">
      <header><div><h3>{{ name }}模型与设置</h3><small>{{ unsaved ? '有未保存的修改，关闭后保留草稿' : '设置已保存' }}</small></div><button type="button" aria-label="关闭模型设置" @click="closeModel"><X :size="18" /></button></header>
      <form :id="controlId('model-form')" class="study-form" @submit.prevent="save">
        <h4 class="study-section-title">模型接口</h4>
        <div class="form-field"><label :for="controlId('base')">API 基础地址</label><input :id="controlId('base')" v-model="config.baseURL" type="url"  :disabled="busy" placeholder="https://api.deepseek.com" /><small>填写兼容 OpenAI 的 API 地址；保留服务商要求的 /v1 等前缀。完整 /chat/completions 地址会自动去掉末尾。更换地址需重新输入 Key。</small></div>
        <div class="form-field"><label :for="controlId('model')">模型名称</label><input v-if="manualModel" :id="controlId('model')" v-model="config.model" maxlength="200" :disabled="busy" placeholder="填写服务商提供的完整模型名称" /><select v-else :id="controlId('model')" v-model="config.model" aria-label="服务商模型列表" :disabled="busy"><option value="" disabled>选择模型</option><option v-if="config.model && !models.includes(config.model)" :value="config.model">{{ config.model }}（手动填写）</option><option v-for="id in models" :key="id" :value="id">{{ id }}</option></select><button v-if="models.length" class="study-model-manual" type="button" @click="manualModel = !manualModel">{{ manualModel ? '从模型列表选择' : '手动填写模型名称' }}</button></div>
        <div class="form-field"><label :for="controlId('key')">API Key</label><input :id="controlId('key')" v-model="apiKey" type="password" maxlength="4096" autocomplete="new-password" :disabled="busy" :placeholder="config.hasKey ? '已保存，留空保留' : '输入 API Key'" /><small>Key 加密保存在本机，不回显。题目会发送到服务商，调用费用由使用者承担。开启本地 Skill 后会附带已有方法摘要，摘要未经成绩验证。</small></div>
        <div class="study-model-check"><button type="button" :disabled="busy" @click="inspectModel()">读取模型列表</button><button type="button" :disabled="busy || !config.model" @click="inspectModel(true)">测试连接</button><small>测试会发送一条短消息，可能产生少量费用。</small></div><p v-if="modelFeedback" role="status" class="study-note">{{ modelFeedback }}</p>
        <label class="study-checkbox"><input v-model="config.images" type="checkbox" :disabled="busy" />同时发送题目截图（需要支持图片的模型，可能包含题目旁的信息）</label>
        <label class="study-checkbox"><input v-model="config.autoSubmitPractice" type="checkbox" :disabled="busy" />自动填入并提交章节练习（默认关闭，作业仍需手动提交）</label>
        <label class="study-checkbox"><input type="checkbox" :checked="config.localSkills" :disabled="busy" @change="toggleSkills" />参考已有本地 Skill（默认关闭，增加输入 token）</label>
        <p class="study-note">{{ config.localSkills ? '开启后读取本机已有的同类题方法供模型参考，不额外生成摘要。方法未经成绩验证。' : '关闭时不读取本地 Skill；已有文件会保留。' }}<button type="button" :disabled="busy || config.active" @click="clearSkills">清除本地 Skill</button></p>
        <details class="study-advanced"><summary>运行选项</summary><div class="study-field-pair">
          <div class="form-field"><label :for="controlId('limit')">每轮最多模型请求数</label><input :id="controlId('limit')" v-model.number="config.questionLimit" type="number" min="1" max="200" required :disabled="busy" /></div>
          <div v-if="props.platform === 'chaoxing'" class="form-field"><label :for="controlId('page-seconds')">文档翻页间隔（秒）</label><input :id="controlId('page-seconds')" v-model.number="config.pageSeconds" type="number" min="2" max="60" required :disabled="busy" /></div>
        </div>
        </details>
        <p v-if="config.active" class="study-note">设置在停止并重新启动后生效。</p>
      </form>
      <footer><p v-if="error" class="study-error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p><div class="study-actions"><button type="button" :disabled="busy || config.active || !config.hasKey" @click="clearKey">清除 Key</button><button type="button" @click="closeModel">关闭</button><button type="submit" :form="controlId('model-form')" class="glass-primary" :disabled="busy">{{ busy ? '正在处理…' : '保存模型设置' }}</button></div></footer>
    </dialog>
    <dialog v-if="props.mode === 'platform'" ref="skillNotice" class="study-notice" :aria-labelledby="controlId('skill-title')" @cancel="skillAccepted = false">
      <h3 :id="controlId('skill-title')">开启{{ name }}本地 Skill</h3>
      <div ref="skillContent" class="study-notice-content" tabindex="0" @scroll="checkSkillNotice">
        <p>读取本机 study-skills 文件夹中已有的同平台、同题型且关键词匹配的方法摘要，供模型参考。答题请求只返回答案，不生成或更新摘要。</p>
        <p>用途：复用解题步骤、适用条件与易错点，减少重复解释。不能保证提高正确率，摘要可能包含错误，也可能被后续任务继续引用；所有方法都未经成绩验证。</p>
        <p>费用：携带已有摘要会增加输入 token，不额外请求模型生成摘要。实际计费以服务商为准，请查看运行详情中的用量。</p>
        <p>数据：摘要保存在本机，使用时会发送到已配置的 API 服务商。摘要可能包含课程知识内容。关闭后不再读取，已有文件保留，可停止学习后清除。不会作为脚本执行，也不会代替人工验证或官网成绩。</p>
      </div>
      <p class="study-read-hint" role="status">{{ skillRead ? '已阅读至协议底部，请勾选确认后继续' : '请滚动至协议底部后再同意' }}</p>
      <label class="study-checkbox"><input v-model="skillAccepted" type="checkbox" />我了解额外 token 费用、数据发送及摘要可能出错</label>
      <div class="study-actions"><button type="button" @click="skillNotice?.close()">取消</button><button type="button" class="glass-primary" :disabled="!skillRead || !skillAccepted" @click="acceptSkills">开启并返回设置</button></div>
    </dialog>
    <dialog v-if="props.mode === 'settings'" ref="notice" class="study-notice" :aria-labelledby="controlId('notice-title')" @cancel="accepted = false">
      <h3 :id="controlId('notice-title')">开启{{ name }}自动学习前</h3>
      <div ref="noticeContent" class="study-notice-content" tabindex="0" @scroll="checkNotice">
        <h4>用途与授权</h4>
        <p><strong>本实验功能仅用于技术实现验证与参考，不得用于其他目的。</strong>不得用于实际课程任务代办、获取成绩或学时、出勤证明、代学代刷、作弊或收费服务。使用者自行将功能用于上述用途或其他超出范围的用途，应依法承担相应后果。</p>
        <p>“技术验证”不是学校或平台的授权，也不是法律豁免。使用本人或明确获授权的账号，仍须遵守法律、学校规定、课程要求及平台条款；未能确认相关自动操作被允许时，不得在真实课程中运行，应使用本地模拟页面或自行控制的测试环境。不得未经授权访问他人账号、规避验证码、人脸识别或访问控制。</p>
        <h4>程序会执行的操作</h4>
        <p v-if="props.platform === 'chaoxing'">开启后仍需单独选择操作并启动。播放课程按正常速度静音播放可识别的视频并翻阅文档；视频弹出的单选、判断及多选题直接穷举选项并提交，不调用模型，明确判错后换下一组，最多 256 种组合。视频弹题会真实提交，不受“自动填入并提交章节练习”或“播放时处理章节测试”开关控制。播放视频期间不调用模型；视频结束并进入章节检测栏目后，配置了模型才生成答案，未配置时跳过检测；章节练习自动填入和提交需在设置中单独开启。课程作业只生成答案，由使用者手动填入和提交；不处理考试。启动前须核对课程、章节及计分、提交次数和独立完成要求。</p>
        <p v-if="props.platform === 'unipus'">开启后选择教程、操作及关闭时间，再单独启动。程序可按 1 倍速静音播放可识别的音视频，调用模型生成练习答案；只有另外勾选自动提交时才填入并提交练习。课程作业仅生成答案，考试和测评不处理。计时只记录实际媒体推进及前台阅读停留，不能证明本人持续学习，也不代表平台认可时长。不伪造完成记录或时长上报，不绕过验证及访问限制。暂未完成真实教程兼容验证，未知页面和提交结果会暂停。</p>
        <h4>学习记录、成绩与账号风险</h4>
        <p>模型可能答错、漏答或误解题意；网页变化、识别错误和网络中断可能造成操作失败、错误提交、任务中断或无法确认结果。提交可能不可撤销，也可能消耗提交次数、改变成绩或学习记录。平台可能要求额外验证、限制账号或作出其他处理。使用者应自行核对官方页面、教师通知和提交结果；不要把本地播放位置、翻页结束、运行结束或进度查询当作平台认可完成或整门课程完成的证明。</p>
        <h4>发送给模型的数据与费用</h4>
        <p>识别到的题干、选项及开启截图后的题目图片会发送到使用者配置的模型接口。截图可能包含题目附近的姓名、班级等信息；不愿向该服务商提供的内容不要开启或处理。Key 加密保存在本机且不回显，模型请求不携带平台 Cookie；本机数据库、浏览器资料和服务商保存的数据仍各有隐私风险。请自行核对接口地址、隐私政策、数据保留规则和计费方式。请求上限不是金额上限，失败请求也可能收费，调用费用由使用者承担。</p>
        <h4>联网搜索与本地保留</h4>
        <p>同一题连续两次返回空答案后，程序自动将题干及选项发送到必应（cn.bing.com）检索，再连同网页标题、链接和摘要交给模型第三次作答。搜索不发送模型 Key、平台会话、截图或本地 Skill，但搜索服务会接收查询和网络元数据。每题最多三次模型作答，失败请求和重做均可能收费。不得发送无权提供的题目、资料或个人信息；不同意该搜索行为时，不要启动模型作答。</p>
        <p>第三次仍为空时，题目、模型名称、原始回复、原因、搜索摘要及用量写入本机 study-model-logs 文件夹，不自动上传，不混入脱敏系统日志，也不会在退出后自动删除。开启本地 Skill 会向模型发送已有方法摘要。关闭功能不清除这些文件；先停止任务，再按 PRIVACY.md 清理。开启时另在本机数据库记录每个平台、每个说明版本的最近确认时间和确认文字；该记录不能证明平台授权或本人持续学习。</p>
        <h4>暂停、停止与运行限制</h4><p>学习通保持页面模式只保留页面。U校园播放和保留页面模式在进入学习页时及之后每 5 分钟模拟鼠标活动，普通超时提示出现时自动点击继续；暂停时停止保活，验证码和身份验证需本人处理。不构造学时上报请求，但官网仍可能因播放、活动及点击产生学时或完成记录。这些记录不能证明本人实际学习，也不能据此申领成绩、学时或出勤。正常速度、原生控件和不伪造上报均不代表平台允许自动化。后台模式仍使用浏览器引擎，定时关闭受休眠及系统调度影响；软件重启不会恢复任务。</p>
        <p>运行期间保留独立浏览器并增加资源占用。遇到验证、登录失效或无法确认的任务时暂停，需本人在官方页面处理。暂停保留窗口；停止、关闭实验开关或退出软件时关闭运行浏览器。关闭学习设置或主窗口不会停止任务。休眠、断网或进程退出可能中断运行；已向平台提交的操作或已发送到模型的数据不能通过停止操作撤回。后台重启不会自动恢复学习任务。</p>
        <h4>测试范围与责任</h4>
        <p>本功能尚未完成所有学校、页面、题型、模型服务及长时间运行的验证。软件按现状提供，不保证正确性、兼容性、适用性、持续可用性或学习效果。请备份重要数据并保留其他核对方式，发现异常立即停止。在适用法律允许的范围内，使用者承担使用风险及依法应承担的后果，软件提供方不承担因此产生的学习记录、成绩、账号限制、数据丢失、接口费用及其他损失责任。</p>
        <p>使用者自行超出技术实现验证与参考范围使用的，应依法承担相应后果，包括平台或学校处理、学习记录及成绩变化、账号限制、接口费用和数据损失；不得据此要求免除其依法应承担的责任。上述约定不排除或限制开发者依法应承担或法律规定不得免除的责任，包括依法不得免责的人身损害责任、因故意或重大过失造成财产损失的责任及其他法定权利。本说明不是学校或平台的授权文件，也不保证操作合规或答案正确。完整条款见随软件提供的 DISCLAIMER.md、TERMS.md 和 PRIVACY.md；本次确认版本：{{ version }}。确认时间按本机时钟保存，无真实身份核验或外部存证。</p>
      </div>
      <p class="study-read-hint" role="status">{{ noticeRead ? '已阅读至协议底部' : '请滚动至协议底部后再同意' }}</p>
      <label v-if="!config.enabled" class="study-checkbox"><input v-model="accepted" type="checkbox" />{{ STUDY_ACCEPTANCE_TEXT }}</label>
      <p v-if="error" class="study-error" role="alert">{{ error }}</p>
      <div class="study-actions"><button type="button" @click="notice?.close()">取消</button><button v-if="!config.enabled" type="button" class="glass-primary" :disabled="busy || !noticeRead || !accepted" @click="enable">确认并开启</button></div>
    </dialog>
  </section>
</template>
<style scoped>
.study-experiment { --study-ink:var(--d-ink,var(--ink,#262c34));--study-muted:var(--d-muted,var(--muted,#687281));--study-line:var(--d-border,var(--line,#8884));--study-card:var(--d-card,var(--panel,#fff));margin-top:24px;padding-top:20px;border-top:1px solid var(--study-line);color:var(--study-ink);text-align:left;min-width:0;font-optical-sizing:auto; }
.study-platform { container-type:inline-size;margin:0 0 24px;padding:0;border:0; }
h3,h4,p { overflow-wrap:anywhere; }
h3 { margin:0;font-size:18px;font-weight:600;letter-spacing:-.02em; }
h4 { margin:0;font-size:15px;font-weight:600; }
p { line-height:1.65; }
.study-heading,.study-directory-heading,.study-progress-heading { display:flex;align-items:center;justify-content:space-between;gap:12px; }
.study-heading { margin-bottom:16px; }
.study-heading p { margin:5px 0 0;font-size:13px;color:var(--study-muted); }
.study-experiment button { display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:8px 13px;border:1px solid var(--study-line);border-radius:10px;background:var(--d-control,rgba(128,128,128,.06));color:inherit;font:inherit;white-space:normal;cursor:pointer; }
.study-experiment button svg { flex-shrink:0; }
.study-experiment button.glass-primary { background:var(--d-accent,#477bd7);color:#fff;border-color:transparent; }
.study-experiment button:disabled { opacity:.5;cursor:default; }
.study-experiment button:not(:disabled):active { transform:scale(.97);transition:transform 80ms ease-out; }
.study-experiment :is(button,input,select,summary):focus-visible { outline:3px solid var(--d-accent,#477bd7);outline-offset:3px; }
.study-note,small { color:var(--study-muted);font-size:13px;line-height:1.65;overflow-wrap:anywhere; }
.study-note button { margin-left:8px; }
.study-error { color:var(--d-danger,#c8463e); }
.study-switch-row { display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;border:1px solid var(--study-line);border-radius:14px;background:var(--study-card); }
.study-switch-row p { margin:5px 0 0;font-size:13px;color:var(--study-muted); }
.study-experiment .study-toggle { position:relative;display:block;flex-shrink:0;width:46px;min-width:46px;height:28px;min-height:28px;padding:0;border:0;border-radius:14px;background:#8887; }
.study-toggle span { position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform 180ms cubic-bezier(.2,.8,.2,1); }
.study-experiment .study-toggle[aria-checked=true] { background:var(--d-accent,#477bd7); }
.study-toggle[aria-checked=true] span { transform:translateX(18px); }
.study-experiment .study-notice-link { background:transparent;border:0;padding-left:0;font-size:13px;color:var(--study-muted); }
.study-workspace { display:grid;gap:16px;align-items:start; }
.study-launch,.study-run,.study-directory { min-width:0;padding:20px;margin:0;border:1px solid var(--study-line);border-radius:14px;background:var(--study-card); }
.study-launch { display:grid;gap:18px; }
.study-launch>label,.study-form .form-field { display:flex;flex-direction:column;align-items:stretch;text-align:left;gap:8px;min-width:0;font-size:14px; }
.study-experiment :is(input:not([type=checkbox]):not([type=radio]),select) { box-sizing:border-box;min-width:0;width:100%;height:44px;padding:0 12px;border:1px solid var(--study-line);border-radius:9px;background:var(--d-control,var(--panel,#fff));color:inherit;font:inherit; }
.study-operations { min-width:0;padding:0;margin:0;border:0; }
.study-operations legend { margin-bottom:8px;padding:0;font-size:14px;line-height:1.5; }
.study-operation-choices { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;border-radius:10px;background:var(--d-control,rgba(128,128,128,.07)); }
.study-operations label { position:relative;display:flex;align-items:center;justify-content:center;min-height:40px;padding:4px;font-size:13px;border-radius:7px;cursor:pointer; }
.study-operations label.selected { background:var(--study-card);box-shadow:0 1px 4px #0002; }
.study-operations input { position:absolute;opacity:0;width:1px;height:1px; }
.study-operations label:has(:focus-visible) { outline:3px solid var(--d-accent,#477bd7); }
.study-resume { margin:0;font-size:13px;line-height:1.65;color:var(--study-muted); }
.study-resume button { min-height:32px;padding:3px 8px;margin-left:8px; }
.study-launch-options { border-top:1px solid var(--study-line);font-size:13px; }
summary { cursor:pointer;line-height:1.5;padding:12px 0;color:var(--study-muted);font-size:13px; }
.study-launch-options>label { display:grid;gap:8px;margin:10px 0; }
.study-checkbox,.study-launch-options>.study-checkbox { display:flex;align-items:flex-start;gap:9px;font-size:14px;line-height:1.65; }
.study-checkbox input { flex-shrink:0;width:17px;height:17px;margin:3px 0 0;accent-color:var(--d-accent,#477bd7); }
.study-actions { display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px; }
.study-actions>span { margin-right:auto;color:var(--study-muted);font-size:12px; }
.study-launch>.study-note { margin:0; }
.study-directory-heading { align-items:flex-start;margin-bottom:12px; }
.study-directory-heading small { display:block;margin-top:4px; }
.study-directory-heading button { min-height:34px;font-size:12px;padding:5px 9px; }
.study-directory>.study-note { margin:12px 0 0;font-size:12px; }
@container (min-width:700px) { .study-workspace { grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch; }.study-launch,.study-run { grid-column:1;align-self:stretch; }.study-launch { display:flex;flex-direction:column; }.study-launch>.study-actions { margin-top:auto; }.study-directory { grid-column:2;grid-row:1;display:flex;flex-direction:column; }.study-directory>.study-note { margin-top:auto;padding-top:12px; }.study-launch + .study-run { grid-column:1 / -1;grid-row:2; } }
.study-task-status { display:grid;gap:8px;margin:12px 0;text-align:left;font-size:13px; }.study-task-status>div { display:flex;align-items:center;gap:10px;flex-wrap:wrap; }.study-task-status strong { font-size:12px;font-weight:500;color:var(--study-muted); }.study-task-status button { min-height:36px;font-size:12px; }
.study-model-output { margin:18px 0;padding:14px;border:1px solid var(--study-line);border-radius:10px;min-width:0; }.study-model-scroll { max-height:280px;overflow:auto;margin-top:10px;overscroll-behavior:contain; }.study-model-output h5 { margin:10px 0 6px;font-size:12px;color:var(--study-muted); }.study-model-output pre { margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,monospace; }.study-model-output .study-progress-heading { align-items:flex-start;flex-wrap:wrap; }
.study-run h4 { display:flex;align-items:center;gap:8px;font-size:13px; }
.study-status-dot { width:7px;height:7px;border-radius:50%;background:#8b939e; }
.study-run[data-phase=running] .study-status-dot { background:#34a967; }.study-run[data-phase=paused] .study-status-dot { background:#c98c26; }.study-run[data-phase=failed] .study-status-dot { background:#d64a42; }
.study-experiment .study-refresh { min-height:32px;padding:5px 7px;font-size:12px;background:transparent;border-color:transparent; }
.study-now { margin-top:24px;min-width:0;text-align:center; }
.study-now>strong { display:block;font-size:20px;font-weight:600;line-height:1.4;letter-spacing:-.02em;overflow-wrap:anywhere; }
.study-chapter { color:var(--study-muted);font-size:13px;margin:7px 0 18px; }
.study-media { margin:20px 0;text-align:left; }.study-media progress { display:block;width:100%;height:4px;accent-color:var(--d-accent,#477bd7);margin-bottom:8px; }
.study-media-label { display:flex;justify-content:space-between;flex-wrap:wrap;gap:5px 12px;font-size:12px;color:var(--study-muted);font-variant-numeric:tabular-nums; }
.study-document { font-size:13px; }.study-transport { display:flex;justify-content:center;gap:12px;margin:22px auto; }
.study-experiment .study-transport button { flex-direction:column;gap:6px;min-width:64px;min-height:64px;border:0;background:transparent;font-size:12px; }
.study-experiment .study-transport .study-play { background:var(--d-control,rgba(128,128,128,.08)); }
.study-run-message { font-size:14px;margin:16px 0; }.study-run-tools { display:flex;gap:8px;flex-wrap:wrap; }
.study-run-tools button { min-height:36px;padding:6px 10px;font-size:12px; }.study-run-meta { display:grid;gap:4px;margin-top:14px; }.study-run-meta small { font-size:12px; }
.study-run-details { border-top:1px solid var(--study-line);margin-top:16px; }.study-progress p,.study-run-details p { font-size:13px; }
.study-logs { font-size:12px;line-height:1.8;padding-left:20px;overflow-wrap:anywhere; }.study-answer { border-top:1px solid var(--study-line);padding-top:12px;font-size:14px;white-space:pre-wrap; }
.study-model,.study-notice { box-sizing:border-box;width:min(620px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0;border:1px solid var(--study-line);border-radius:16px;background:var(--d-surface,var(--panel,#fff));color:var(--study-ink);text-align:left;box-shadow:0 24px 80px #0004;font:inherit;overflow:hidden; }
.study-model[open],.study-notice[open] { display:flex;flex-direction:column; }
.study-model::backdrop,.study-notice::backdrop { background:#0006; }
.study-model header { position:static;z-index:auto;flex-shrink:0;height:auto;min-height:0;background:inherit;backdrop-filter:none;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:20px 24px;border-bottom:1px solid var(--study-line); }
.study-model header h3 { font-size:17px; }.study-model header small { display:block;margin-top:5px; }
.study-model header button { width:36px;min-height:36px;padding:6px;flex-shrink:0; }
.study-form { display:grid;gap:18px;min-height:0;overflow:auto;padding:20px 24px;margin:0;overscroll-behavior:auto; }
.study-form p { margin:0; }.study-experiment .study-model-manual { min-height:28px;padding:0;border:0;background:transparent;align-self:flex-start;font-size:12px;color:var(--study-muted); }.study-field-pair { display:grid;grid-template-columns:1fr 1fr;gap:14px; }.study-model-check { display:flex;flex-wrap:wrap;gap:8px; }.study-model-check small { flex-basis:100%; }
.study-model footer { flex-shrink:0;padding:14px 24px;border-top:1px solid var(--study-line); }.study-model footer p { margin:0 0 10px;font-size:13px; }
.study-read-hint { flex-shrink:0;margin:12px 24px 0;font-size:13px;color:var(--study-muted); }
.study-notice>h3 { padding:22px 24px 14px; }.study-notice-content { min-height:0;overflow:auto;padding:0 24px; }.study-notice-content p { font-size:14px;line-height:1.75; }.study-notice-content h4 { margin-top:20px; }
.study-notice>.study-checkbox,.study-notice>.study-error { margin:16px 24px 0; }.study-notice>.study-actions { flex-shrink:0;padding:16px 24px; }
@media(max-width:560px) { .study-field-pair { grid-template-columns:1fr; }.study-launch,.study-run,.study-directory { padding:16px; }.study-heading { align-items:flex-start; }.study-heading>button { font-size:13px; }.study-actions>span { flex-basis:100%; }.study-launch .study-actions>.glass-primary { width:100%; }.study-model header,.study-form,.study-model footer { padding:16px; }.study-model footer button { flex:1 1 auto; } }
.study-heading { margin-bottom:20px; }.study-heading h3 { font-size:20px;letter-spacing:-.025em; }.study-heading p { font-size:12px;margin-top:4px; }
.study-workspace { gap:20px; }.study-launch,.study-run,.study-directory { padding:22px;border-radius:18px; }
.study-launch { gap:20px; }.study-launch-footer { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:auto;padding-top:4px; }
.study-launch-footer>.study-actions { flex:1; }.study-launch-footer .glass-primary { font-size:14px; }
.study-launch .study-resume { padding:12px 0 0;border-top:1px solid var(--study-line); }
.study-directory { background:var(--study-card); }.study-directory-heading h4 { font-size:14px; }.study-directory-heading small { font-size:12px; }
.study-progress-heading h4 { font-weight:500;letter-spacing:-.01em; }.study-progress-heading h4 small { margin-left:6px;font-size:11px;font-variant-numeric:tabular-nums; }
.study-now { margin-top:22px;text-align:left; }.study-eyebrow { display:block;margin-bottom:7px;font-size:11px;color:var(--study-muted);letter-spacing:.02em; }.study-now>strong { font-size:21px;line-height:1.5;letter-spacing:-.025em; }.study-chapter { margin:5px 0 18px;font-size:13px; }
.study-task-status { gap:8px;padding:14px 0;border-top:1px solid var(--study-line);border-bottom:1px solid var(--study-line); }.study-task-status>div>span { margin-right:auto; }.study-task-status strong { font-size:11px; }.study-experiment .study-task-status button { min-height:28px;padding:3px 0;border:0;background:none;font-size:12px;color:var(--d-accent,#477bd7); }
.study-transport { justify-content:flex-start;gap:8px;margin:18px 0; }.study-experiment .study-transport button { flex-direction:row;gap:7px;min-width:0;min-height:44px;padding:8px 12px;border-radius:12px;font-size:12px; }.study-transport svg { width:17px;height:17px; }.study-experiment .study-transport .study-play { padding:8px 16px;background:var(--d-control,rgba(128,128,128,.08)); }
.study-model-output { margin:24px 0 18px;padding:20px 0 0;border:0;border-top:1px solid var(--study-line);border-radius:0; }.study-model-output h4:before { content:'';display:block;width:6px;height:6px;border-radius:50%;background:var(--d-accent,#477bd7); }.study-output-model { display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:12px 0 10px; }.study-output-model>span { color:var(--study-muted);font-size:12px;overflow-wrap:anywhere; }.study-model-scroll { padding:14px;border-radius:12px;background:var(--d-control,rgba(128,128,128,.05));max-height:300px; }.study-model-output pre { font:13px/1.8 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif; }.study-model-output h5 { font-weight:400;font-size:11px; }
.study-run-message { font-size:13px;margin:14px 0; }.study-run-tools { gap:10px; }.study-experiment .study-run-tools button { font-size:12px;min-height:34px;padding:6px 9px;border-color:transparent;background:transparent; }.study-experiment .study-run-tools .study-stop { color:var(--d-danger,#c8463e);margin-left:auto; }.study-run-meta small { font-size:11px; }.study-run-details { margin-top:18px; }
@container (min-width:700px) { .study-workspace { grid-template-columns:minmax(0,1.3fr) minmax(250px,1fr);align-items:start; }.study-launch,.study-run,.study-directory { align-self:start; }.study-directory { position:sticky;top:0; }.study-launch + .study-run { grid-column:1;grid-row:2; } }
@container (min-width:700px) {
  .study-directory { box-sizing:border-box;height:var(--study-panel-height,auto);min-height:280px;overflow:hidden;position:static; }
  .study-directory :deep(.chapter-list) { display:flex;flex-direction:column;flex:1;min-height:0; }
  .study-directory :deep(.chapter-list ol) { flex:1;min-height:0;max-height:none; }
}
@media(max-width:560px) { .study-launch,.study-run,.study-directory { padding:18px; }.study-launch-footer { align-items:flex-start; }.study-launch-footer>.study-actions { flex-basis:100%; }.study-launch-footer .glass-primary { width:100%; }.study-now>strong { font-size:19px; }.study-experiment .study-transport button { padding:8px; }.study-transport { gap:6px; }.study-model-scroll { padding:12px; } }
@media(prefers-reduced-motion:reduce) { .study-experiment button,.study-toggle span { transition:none!important; }.study-experiment button:active { transform:none!important; } }
@media(prefers-contrast:more) { .study-launch,.study-run,.study-directory,.study-model,.study-notice { border-color:currentColor; } }
</style>
