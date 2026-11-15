<script setup lang="ts">
import { APP_VERSION } from "../../../packages/contracts/src/version.js";
import { ref, computed, onMounted, onUnmounted } from "vue";
import { NConfigProvider, NMessageProvider } from "naive-ui";
import {
  Menu,
  LayoutDashboard,
  ListChecks,
  Link2,
  Bell,
  History,
  Settings2,
  ScrollText,
  ArrowUpRight,
  RefreshCw,
  Search,
  Check,
  ChevronRight,
  Pause,
  Play,
  FlaskConical,
  CalendarDays,
  Sun,
  Moon,
  Download,
  ExternalLink,
  X,
  Clock3,
  Plus,
  ShieldCheck,
} from "lucide-vue-next";
import { api, auth } from "../lib/api";
import NotificationChannels from './NotificationChannels.vue';
import { exportSystemLogs } from '../lib/diagnostics';
import CourseManager from "./CourseManager.vue";
import PlatformLoginPrompt from "./PlatformLoginPrompt.vue";
import ExperimentalStudy from "./ExperimentalStudy.vue";
import CourseProgress from "./CourseProgress.vue";
import AppUpdates from './AppUpdates.vue';
import {
  platforms,
  discoversCourses,
  safePlatformUrl,
  type Task,
  type PlatformId,
  type CourseRecord,
  taskCourseKey,
} from "../../../packages/contracts/src/index";
const mobileMenu = ref(false);
const courses = ref<CourseRecord[]>([]);
const courseFilter = ref("");
const promptedCourses = new Set<string>();
function viewCourse(id: string) { courseFilter.value = id; platformFilter.value = "all"; view.value = "tasks"; }
const settingsDirty = ref(false);
const view = ref("overview"),
  connected = ref(false),
  paired = ref(!!auth.get()),
  code = ref(""),
  busy = ref(false),
  toast = ref(""),
  error = ref("");
const health = ref<any>({}),
  platformList = ref<any[]>([]),
  tasks = ref<Task[]>([]),
  totalTasks = ref(0),
  notifications = ref<any[]>([]),
  history = ref<any[]>([]),
  logs = ref<any[]>([]);
const settings = ref<any>({
  browser: "auto",
  intervalMinutes: 15,
  nativeNotifications: false,
  reminderHours: [72, 24, 12, 3, 1],
});
const search = ref(""),
  filter = ref("all"),
  platformFilter = ref("all"),
  showDemo = ref(true),
  dark = ref(localStorage.getItem("coursewatch-theme") === "dark");
const newSources = ref<
  Record<string, { url: string; course: string; type: string }>
>({
  ynjy: { url: "", course: "", type: "homework" },
  renwei: { url: "", course: "", type: "homework" },
  yuketang: { url: "", course: "", type: "homework" },
  chaoxing: { url: "", course: "", type: "homework" },
  unipus: { url: "", course: "", type: "homework" },
});
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const nav = [
  { id: "overview", name: "总览", icon: LayoutDashboard },
  { id: "tasks", name: "全部任务", icon: ListChecks },
  { id: "calendar", name: "截止日历", icon: CalendarDays },
  { id: "notifications", name: "通知中心", icon: Bell },
  { id: "history", name: "变化记录", icon: History },
  { id: "platforms", name: "平台管理", icon: Link2 },
  { id: "logs", name: "检查日志", icon: ScrollText },
  { id: "settings", name: "设置", icon: Settings2 },
];
const title = computed(
  () => nav.find((n) => n.id === view.value)?.name ?? "总览",
);
const baseTasks = computed(() =>
  tasks.value.filter(
    (t) => showDemo.value || t.namespace !== "local-experiment",
  ),
);
const pending = computed(() =>
  baseTasks.value.filter(
    (t) =>
      !t.personalDone &&
      !["submitted", "graded", "cancelled"].includes(t.sourceStatus),
  ),
);
const dueSoon = computed(() =>
  pending.value.filter(
    (t) =>
      t.deadline.kind === "known" &&
      t.deadline.value > Date.now() &&
      t.deadline.value < Date.now() + 72 * 3600000,
  ),
);
const overdue = computed(() =>
  pending.value.filter(
    (t) => t.deadline.kind === "known" && t.deadline.value < Date.now(),
  ),
);
const filtered = computed(() =>
  baseTasks.value
    .filter(
      (t) =>
        (!courseFilter.value || courses.value.some(c => c.id === courseFilter.value && c.platform === t.platform && c.accountId === t.accountId && c.key === taskCourseKey(t))) &&
        (platformFilter.value === "all" ||
          platformFilter.value === t.platform) &&
        (!search.value ||
          `${t.title} ${t.course}`
            .toLowerCase()
            .includes(search.value.toLowerCase())) &&
        (filter.value === "all" ||
          (filter.value === "pending" && pending.value.includes(t)) ||
          (filter.value === "homework" && t.type === "homework") ||
          (filter.value === "exam" && t.type === "exam") ||
          (filter.value === "done" &&
            (t.personalDone ||
              ["submitted", "graded"].includes(t.sourceStatus)))),
    )
    .slice(0, view.value === "overview" ? 6 : 500),
);
const unread = computed(
  () => notifications.value.filter((n) => !n.read_at).length,
);
const date = (n: number | undefined | null) =>
  n
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Shanghai",
      }).format(n)
    : "尚未检查";
const left = (t: Task) => {
  if (t.personalDone) return "个人已完成";
  if (t.deadline.kind === "none") return "无截止时间";
  if (t.deadline.kind !== "known") return "截止时间待确认";
  const d = t.deadline.value - Date.now();
  return d < 0
    ? "已到截止时间"
    : d < 3600000
      ? `剩余 ${Math.max(1, Math.ceil(d / 60000))} 分钟`
      : d < 86400000
        ? `剩余 ${Math.ceil(d / 3600000)} 小时`
        : `剩余 ${Math.ceil(d / 86400000)} 天`;
};
const status = (s: string) =>
  ({
    pending: "未提交",
    in_progress: "进行中",
    submitted: "已提交",
    graded: "已批阅",
    cancelled: "已撤回",
    unknown: "提交状态未知",
  })[s] ?? s;
const outcome = (s: string) =>
  ({
    complete: "完整成功",
    partial: "部分成功",
    failed: "检查失败",
    auth_required: "需要登录",
    verification_required: "需要人工验证",
    not_scanned: "尚未检查",
  })[s] ?? s;
function notify(s: string) {
  toast.value = s;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 4500);
}
async function refresh() {
  if (!auth.get()) {
    paired.value = false;
    return;
  }
  try {
    const [h, p, t, n, hi, l, s, c] = await Promise.all([
      api("health"),
      api("platforms"),
      api("tasks?limit=500"),
      api("notifications"),
      api("history"),
      api("logs"),
      api("settings"),
      api("courses"),
    ]);
    health.value = h;
    platformList.value = p.items;
    tasks.value = t.items;
    courses.value = c.items;
    const pendingCourse = courses.value.find(c => c.status === "pending" && !promptedCourses.has(c.platform));
    if (pendingCourse) { promptedCourses.add(pendingCourse.platform); view.value = "platforms"; }
    totalTasks.value = t.total;
    notifications.value = n.items;
    history.value = hi.items;
    logs.value = l.items;
    if (!busy.value && !settingsDirty.value) settings.value = s;
    connected.value = true;
    paired.value = true;
    error.value = "";
  } catch (e) {
    connected.value = false;
    paired.value = !!auth.get();
    error.value = (e as Error).message;
  }
}
async function action(fn: () => Promise<any>, message = "已保存") {
  busy.value = true;
  error.value = "";
  try {
    const r = await fn();
    if (message) notify(r?.message ?? message);
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function pair() {
  await action(async () => {
    const result = await api("pair", "POST", { code: code.value.trim() });
    auth.set(result.token);
    paired.value = true;
  }, "已与本机后台配对");
}
async function addSource(p: any) {
  const s = newSources.value[p.id];
  if (!s.url || !s.course) {
    error.value = "请填写课程名和官方列表页地址";
    return;
  }
  await action(async () => {
    await api(`platforms/${p.id}`, "PATCH", { sources: [...p.sources, s] });
    newSources.value[p.id] = { url: "", course: "", type: "homework" };
  }, "监控页面已添加");
}
async function removeSource(p: any, index: number) {
  await action(
    () =>
      api(`platforms/${p.id}`, "PATCH", {
        sources: p.sources.filter((_: unknown, i: number) => i !== index),
      }),
    "监控页面已移除，历史任务保留",
  );
}
async function experiment(s: string) {
  await action(
    () => api("experiment", "POST", { scenario: s }),
    "模拟快照已处理，可查看任务、变化记录和通知",
  );
}
function external(t: Task) {
  if (t.url && safePlatformUrl(t.platform, t.url))
    window.open(t.url, "_blank", "noopener,noreferrer");
}
async function download() {
  await action(async () => {
    const data = await api("export");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "coursewatch-tasks.json";
    a.click();
    URL.revokeObjectURL(url);
  }, "任务已导出，未包含登录凭据");
}
function toggleTheme() {
  dark.value = !dark.value;
  localStorage.setItem("coursewatch-theme", dark.value ? "dark" : "light");
}
onMounted(() => {
  refresh();
  refreshTimer = setInterval(() => {
    if (!document.hidden && !busy.value) refresh();
  }, 15000);
});
onUnmounted(() => {
  clearInterval(refreshTimer);
  clearTimeout(toastTimer);
});
</script>
<template>
  <NConfigProvider
    ><NMessageProvider
      ><div class="app" :class="{ dark }">
        <aside class="sidebar" :class="{ 'menu-open': mobileMenu }">
          <a class="brand" href="#" @click.prevent="view = 'overview'"
            ><span class="brand-icon"><img src="/coursewatch.png" width="34" height="34" alt="" /></span
            ><span>CourseWatch</span></a
          >
          <button
            class="mobile-menu icon-button"
            @click="mobileMenu = !mobileMenu"
            :aria-expanded="mobileMenu"
            aria-label="导航菜单"
          >
            <Menu :size="21" />
          </button>
          <nav>
            <button
              v-for="n in nav"
              :key="n.id"
              :class="{ selected: view === n.id }"
              @click="
                view = n.id;
                mobileMenu = false;
              "
            >
              <component :is="n.icon" :size="18" /><span>{{ n.name }}</span
              ><b v-if="n.id === 'notifications' && unread" class="count">{{
                unread
              }}</b>
            </button>
          </nav>
          <div class="sidebar-bottom">
            <div class="version">
              <span class="dot" /> {{ APP_VERSION }} · 实验版
              <button @click="toggleTheme" aria-label="切换深浅主题">
                <Sun v-if="dark" :size="16" /><Moon v-else :size="16" />
              </button>
            </div>
          </div>
        </aside>
        <div class="workspace">
          <header>
            <div class="breadcrumb">
              <strong>CourseWatch</strong>
            </div>
            <div class="header-right">
              <span class="connection" :class="{ offline: !connected }"
                ><i />{{
                  connected
                    ? health.monitoring
                      ? "后台已连接"
                      : "监控已暂停"
                    : "后台未连接"
                }}</span
              ><button
                class="icon-button"
                aria-label="通知中心"
                @click="view = 'notifications'"
              >
                <Bell :size="19" /><i v-if="unread" class="notice-dot" />
              </button>
            </div>
          </header>
          <main>
            <AppUpdates v-if="connected" mode="banner" :status="health.updates" @changed="value => health.updates = value" />
            <div v-if="error" class="error" role="alert">
              {{ error
              }}<button @click="error = ''" aria-label="关闭错误">
                <X :size="16" />
              </button>
            </div>
            <section v-if="!paired" class="pairing">
              <span class="pair-logo"><img src="/coursewatch.png" width="56" height="56" alt="CourseWatch" /></span>
              <h1>连接本机后台</h1>
              <p>输入配对码以连接这台电脑上的 CourseWatch。</p>
              <form @submit.prevent="pair">
                <label for="code">本机一次性配对码</label>
                <div class="pair-row">
                  <input
                    id="code"
                    v-model="code"
                    placeholder="输入后台显示的 10 位配对码"
                    autocomplete="off"
                    maxlength="30"
                  /><button class="primary" :disabled="busy || !code">
                    连接后台 <ArrowUpRight :size="16" />
                  </button>
                </div>
              </form>
              <div class="setup-hint">
                首次运行：<code>npm run background</code
                ><br />配对码位于启动终端或本机数据目录的 pairing-code.txt。
              </div>
              <div class="experiment-note">
                <FlaskConical :size="17" /> 首版实验：人卫 /
                云南省高等学校计算机等级考试系统，真实采集覆盖仍需核对。
              </div>
            </section>
            <template v-else>
              <div class="page-heading">
                <h1>{{ title }}</h1>
                <button
                  v-if="!['settings', 'platforms'].includes(view)"
                  class="primary"
                  :disabled="busy || !connected"
                  @click="
                    action(
                      () => api('monitor/check', 'POST', {}),
                      '检查完成，请查看各平台结果',
                    )
                  "
                >
                  <RefreshCw :size="16" :class="{ spin: busy }" />立即检查
                </button>
              </div>
              <div v-if="!connected" class="warning">
                连接已中断，以下为上次读取的缓存。后台状态尚未确认。<button
                  class="text-button"
                  @click="refresh"
                >
                  重新连接
                </button>
              </div>
              <div v-if="view === 'overview'" class="summary-grid">
                <article>
                  <span>待处理任务 <ListChecks :size="18" /></span
                  ><strong>{{ pending.length }}<small>项</small></strong>
                </article>
                <article>
                  <span>72 小时内截止 <Clock3 :size="18" /></span
                  ><strong>{{ dueSoon.length }}<small>项</small></strong>
                </article>
                <article>
                  <span>已到截止时间 <CalendarDays :size="18" /></span
                  ><strong :class="{ red: overdue.length }"
                    >{{ overdue.length }}<small>项</small></strong
                  >
                </article>
                <article>
                  <span>监控平台 <Link2 :size="18" /></span
                  ><strong
                    >{{ platformList.filter((p) => p.enabled).length
                    }}<small>/ {{ platformList.length }}</small></strong
                  >
                </article>
              </div>
              <div
                v-if="['overview', 'tasks'].includes(view)"
                :class="{ 'overview-grid': view === 'overview' }"
              >
                <section class="panel task-panel">
                  <div class="panel-title">
                    <div>
                      <h2>
                        任务
                        <span class="number-badge">{{ baseTasks.length }}</span>
                      </h2>
                    </div>
                    <button
                      v-if="view === 'overview'"
                      class="text-button"
                      @click="view = 'tasks'"
                    >
                      全部任务 <ChevronRight :size="15" />
                    </button>
                  </div>
                  <div class="task-tools">
                    <div class="tabs">
                      <button
                        v-for="f in [
                          { id: 'all', name: '全部' },
                          { id: 'pending', name: '待处理' },
                          { id: 'homework', name: '作业' },
                          { id: 'exam', name: '考试' },
                          { id: 'done', name: '已完成' },
                        ]"
                        :class="{ active: filter === f.id }"
                        @click="filter = f.id"
                      >
                        {{ f.name }}
                      </button>
                    </div>
                    <label class="search"
                      ><Search :size="15" /><input
                        v-model="search"
                        placeholder="搜索任务或课程"
                        aria-label="搜索任务或课程"
                    /></label>
                  </div>
                  <div v-if="view === 'tasks'" class="filter-row">
                    <select v-model="courseFilter" aria-label="课程筛选"><option value="">全部已选课程</option><option v-for="c in courses.filter(c => c.status === 'enabled')" :key="c.id" :value="c.id">{{ platforms[c.platform].short }} · {{ c.name }}</option></select>
                    <select v-model="platformFilter" aria-label="平台筛选">
                      <option value="all">所有平台</option>
                      <option value="ynjy">云南省高等学校计算机等级考试系统</option>
                      <option value="renwei">人卫</option><option value="yuketang">雨课堂</option><option value="chaoxing">学习通</option><option value="unipus">U校园 AI 版</option></select
                    ><label
                      ><input type="checkbox" v-model="showDemo" />
                      显示模拟任务</label
                    ><small v-if="totalTasks > tasks.length"
                      >当前载入前 {{ tasks.length }} /
                      {{ totalTasks }} 项</small
                    >
                  </div>
                  <div v-if="!filtered.length" class="empty">
                    <span><ListChecks :size="30" /></span>
                    <h3>
                      {{ tasks.length ? "没有匹配的任务" : "暂无任务" }}
                    </h3>
                    <p>
                      {{
                        tasks.length
                          ? "试试调整筛选或搜索条件。"
                          : "请在平台管理中添加监控列表。"
                      }}
                    </p>
                    <button
                      v-if="!tasks.length"
                      class="secondary"
                      @click="view = 'platforms'"
                    >
                      连接教学平台 <ArrowUpRight :size="15" />
                    </button>
                  </div>
                  <article
                    v-for="t in filtered"
                    :key="t.id"
                    class="task-row"
                    :class="{ done: t.personalDone }"
                  >
                    <button
                      class="task-check"
                      :class="{ checked: t.personalDone }"
                      :aria-label="`${t.personalDone ? '取消' : '标记'}个人完成：${t.title}`"
                      :disabled="busy"
                      @click="
                        action(
                          () =>
                            api(`tasks/${t.id}`, 'PATCH', {
                              personalDone: !t.personalDone,
                            }),
                          '个人标记已更新，不影响平台提交状态',
                        )
                      "
                    >
                      <Check v-if="t.personalDone" :size="14" />
                    </button>
                    <div class="task-main">
                      <div class="task-meta">
                        <span :class="['platform-tag', t.platform]">{{
                          t.namespace === "local-experiment"
                            ? "模拟"
                            : platforms[t.platform].short
                        }}</span><span>{{ t.course }}</span
                        ><span
                          >·
                          {{
                            t.type === "exam"
                              ? "考试"
                              : t.type === "homework"
                                ? "作业"
                                : "课堂活动"
                          }}</span
                        >
                      </div>
                      <h3>
                        <button @click="external(t)" :disabled="!t.url">
                          {{ t.title }} <ArrowUpRight v-if="t.url" :size="14" />
                        </button>
                      </h3>
                      <p>
                        {{ status(t.sourceStatus)
                        }}<span v-if="t.needsReview" class="red">
                          · 来源缺失，待核实</span
                        ><span v-if="t.deadline.kind === 'known'">
                          · {{ date(t.deadline.value) }} 截止</span
                        >
                      </p>
                    </div>
                    <span
                      class="deadline-label"
                      :class="{
                        urgent:
                          t.deadline.kind === 'known' &&
                          t.deadline.value - Date.now() < 86400000 &&
                          !t.personalDone,
                      }"
                      >{{ left(t) }}</span
                    >
                  </article>
                  <div class="panel-footer">
                    <ShieldCheck :size="14" />个人标记不会提交作业。
                  </div>
                </section>
                <aside v-if="view === 'overview'" class="right-column">
                  <section class="panel platform-summary">
                    <div class="panel-title">
                      <h2>平台状态</h2>
                      <button class="text-button" @click="view = 'platforms'">
                        管理 <ChevronRight :size="14" />
                      </button>
                    </div>
                    <div v-for="p in platformList" class="mini-platform">
                      <span :class="['platform-avatar', p.id]">{{
                        platforms[p.id as PlatformId].short.slice(0, 1)
                      }}</span>
                      <div>
                        <strong>{{
                          platforms[p.id as PlatformId].short
                        }}</strong><small>{{
                          p.enabled ? outcome(p.lastOutcome) : "未开启监控"
                        }}</small>
                      </div>
                      <span
                        class="state-dot"
                        :class="{
                          good: p.lastOutcome === 'complete',
                          warn: p.lastOutcome === 'partial',
                        }"
                      />
                    </div>
                    <div class="coverage-note">
                      首版仅检查已配置列表。分页与完整教学班覆盖待验证。
                    </div>
                  </section>
                </aside>
              </div>
              <PlatformLoginPrompt v-if="view === 'platforms' && platformList.find(p => p.added && p.adapted && p.loginStatus !== 'logged_in')" :platform="platformList.find(p => p.added && p.adapted && p.loginStatus !== 'logged_in')" :active-login="health.activeLogin" @login="action(() => api(`platforms/${platformList.find(p => p.added && p.adapted && p.loginStatus !== 'logged_in').id}/login`, 'POST', {}), '请在官方窗口完成登录')" />
              <section v-if="view === 'platforms'" class="panel"><h2>课程</h2><CourseManager :courses="courses" :busy="busy" @changed="refresh" @view="viewCourse" /></section>
              <ExperimentalStudy v-if="view === 'platforms'" mode="platform" class="panel" :courses="courses" @settings="view = 'settings'" /><ExperimentalStudy v-if="view === 'platforms'" platform="unipus" mode="platform" class="panel" :courses="courses" @settings="view = 'settings'" />
              <section v-if="view === 'platforms'" class="panel"><h2>学习通课程进度</h2><CourseProgress platform="chaoxing" :courses="courses" /></section>
              <section v-if="view === 'platforms'" class="panel"><h2>U校园课程进度</h2><CourseProgress platform="unipus" :courses="courses" /></section>
              <section v-if="view === 'platforms'" class="platform-list">
                <article
                  v-for="p in platformList"
                  class="panel platform-config"
                >
                  <template>
                  <div class="platform-top">
                    <span :class="['platform-avatar', p.id]">{{
                      platforms[p.id as PlatformId].short.slice(0, 1)
                    }}</span>
                    <div>
                      <h2>{{ p.name }}</h2>
                      <p>
                        {{
                          p.loginStatus === "logged_in"
                            ? "会话已保存"
                            : "未登录"
                        }}
                      </p>
                    </div>
                    <label class="switch-label"
                      ><input
                        type="checkbox"
                        :checked="p.enabled"
                        :disabled="busy"
                        @change="
                          action(() =>
                            api(`platforms/${p.id}`, 'PATCH', {
                              enabled: ($event.target as HTMLInputElement)
                                .checked,
                            }),
                          )
                        "
                      />启用监控</label
                    >
                  </div>
                  <div class="platform-status">
                    <span>{{ outcome(p.lastOutcome) }}</span><span
                      >上次检查：{{ date(p.lastScanAt) }}</span
                    ><span>最近有数据：{{ date(p.lastSuccessAt) }}</span>
                  </div>
                  <p class="platform-message">{{ p.message }}</p>
                  <div class="button-row">
                    <button
                      class="secondary"
                      :disabled="busy || !!health.activeLogin"
                      @click="
                        action(
                          () => api(`platforms/${p.id}/login`, 'POST', {}),
                          '已打开官方登录窗口；登录成功后点击完成登录并保存',
                        )
                      "
                    >
                      <ExternalLink :size="15" />{{
                        p.loginStatus === "logged_in"
                          ? "重新登录"
                          : "打开官方登录"
                      }}</button
                    ><button
                      v-if="p.activeLogin"
                      class="primary"
                      :disabled="busy"
                      @click="
                        action(
                          () =>
                            api(`platforms/${p.id}/login/finish`, 'POST', {}),
                          '会话已加密保存在本机，登录浏览器已回收',
                        )
                      "
                    >
                      完成登录并保存</button
                    ><button
                      v-if="p.activeLogin"
                      class="secondary"
                      @click="
                        action(
                          () => api('login/cancel', 'POST', {}),
                          '登录窗口已关闭',
                        )
                      "
                    >
                      取消登录</button
                    ><button
                      class="secondary"
                      :disabled="busy"
                      @click="
                        action(
                          () =>
                            api('monitor/check', 'POST', { platform: p.id }),
                          '检查完成，请查看结果与日志',
                        )
                      "
                    >
                      <RefreshCw :size="15" />检查此平台
                    </button>
                  </div>
                  <p v-if="discoversCourses(p.id)" class="coverage-note">完成登录后先读取课程列表。请在“课程”中选择需要同步的课程，无需填写列表地址。全部课程及分页覆盖待真实账号核对。</p>
                  <template v-else>
                  <div class="source-heading">
                    <h3>监控列表页</h3>
                    <span>{{ p.sources.length }} 个已配置</span>
                  </div>
                  <div v-for="(s, i) in p.sources" class="source-row">
                    <div>
                      <strong
                        >{{ s.course }} ·
                        {{ s.type === "exam" ? "考试" : "作业" }}</strong
                      ><small>{{ s.url }}</small>
                    </div>
                    <button
                      class="icon-button"
                      :disabled="busy"
                      @click="removeSource(p, Number(i))"
                      aria-label="移除监控页面"
                    >
                      <X :size="16" />
                    </button>
                  </div>
                  <form class="source-form" @submit.prevent="addSource(p)">
                    <input
                      v-model="newSources[p.id].course"
                      placeholder="课程名"
                      aria-label="课程名"
                    /><select
                      v-model="newSources[p.id].type"
                      aria-label="任务类型"
                    >
                      <option value="homework">作业</option>
                      <option value="exam">考试</option>
                      <option value="activity">课堂活动</option></select
                    ><input
                      class="url-input"
                      v-model="newSources[p.id].url"
                      :placeholder="
                        p.id === 'ynjy'
                          ? 'https://jsjks.ynjy.cn/classrooms/…/program_homework'
                          : 'https://tk.ipmph.com/exam/a/exam/examTask'
                      "
                      aria-label="官方列表页地址"
                    /><button class="secondary" :disabled="busy">
                      <Plus :size="16" />添加
                    </button>
                  </form>
                  </template>
                  <details class="coverage-note">
                    <summary>采集说明</summary>
                    <p>{{ p.collection }}</p>
                    {{ discoversCourses(p.id) ? "课程列表自动读取。" : "登录后复制你要监控的列表页地址。" }}使用独立账号会话；切换平台账号请建立新的本机数据目录，避免混合身份。当前适配器为
                    {{ p.adapterVersion }}，请逐项核对采集结果。
                  </details>
                  </template>
                </article>
              </section>
              <section v-if="view === 'calendar'" class="panel">
                <div class="panel-title">
                  <h2>按截止日期排列</h2>
                  <span class="muted"
                    >仅包含已确认的截止时间 · 首版议程视图</span
                  >
                </div>
                <div
                  v-for="t in baseTasks.filter(
                    (t) => t.deadline.kind === 'known',
                  )"
                  class="agenda-row"
                >
                  <time>{{
                    t.deadline.kind === "known" ? date(t.deadline.value) : ""
                  }}</time>
                  <div>
                    <h3>{{ t.title }}</h3>
                    <small>{{ t.course }} · {{ status(t.sourceStatus) }}</small>
                  </div>
                  <span class="deadline-label">{{ left(t) }}</span>
                </div>
                <div
                  v-if="!baseTasks.some((t) => t.deadline.kind === 'known')"
                  class="empty"
                >
                  <CalendarDays :size="30" />
                  <h3>暂无截止日期</h3>
                  <p>未知截止时间的任务会留在任务列表中。</p>
                </div>
              </section>
              <section v-if="view === 'notifications'" class="panel">
                <div class="panel-title">
                  <h2>
                    通知中心 <span class="number-badge">{{ unread }}</span>
                  </h2>
                  <button
                    class="secondary"
                    @click="
                      action(
                        () => api('notifications/read', 'POST', {}),
                        '已标记为已读',
                      )
                    "
                  >
                    全部已读
                  </button>
                </div>
                <article v-for="n in notifications" class="event-row">
                  <span class="event-icon"><Bell :size="18" /></span>
                  <div>
                    <h3>
                      {{ n.title }} <i v-if="!n.read_at" class="inline-dot" />
                    </h3>
                    <p>{{ n.body }}</p>
                    <small
                      >{{ date(n.at) }}
                      <span v-if="n.error"> · {{ n.error }}</span></small
                    >
                  </div>
                </article>
                <div v-if="!notifications.length" class="empty">
                  <Bell :size="30" />
                  <h3>暂无通知</h3>
                  <p>任务变化和截止提醒会保存在这里。</p>
                </div>
              </section>
              <section v-if="view === 'history'" class="panel">
                <div class="panel-title">
                  <h2>任务变化记录</h2>
                  <span class="muted">最近 200 条</span>
                </div>
                <article v-for="h in history" class="event-row">
                  <span class="event-icon"><History :size="18" /></span>
                  <div>
                    <h3>{{ h.title }}</h3>
                    <p>
                      {{
                        h.kind === "discovered"
                          ? "首次发现"
                          : `字段更新：${h.data.fields.map((f: string) => ({ deadline: "截止时间", title: "标题", sourceStatus: "提交状态", startTime: "开始时间", course: "课程" })[f] ?? f).join("、")}`
                      }}
                    </p>
                    <p
                      v-if="h.data.fields?.includes('deadline')"
                      class="change-detail"
                    >
                      {{
                        h.data.before.deadline.kind === "known"
                          ? date(h.data.before.deadline.value)
                          : "未知"
                      }}
                      →
                      {{
                        h.data.after.deadline.kind === "known"
                          ? date(h.data.after.deadline.value)
                          : "无明确截止"
                      }}
                    </p>
                    <small>{{ date(h.at) }}</small>
                  </div>
                </article>
                <div v-if="!history.length" class="empty">
                  <History :size="30" />
                  <h3>暂无变化记录</h3>
                  <p>首次发现与字段变化会在这里留下记录。</p>
                </div>
              </section>
              <section v-if="view === 'logs'" class="panel">
                <div class="panel-title">
                  <h2>检查日志</h2>
                  <span class="muted">保留最近 1,000 轮 · 当前显示 100 轮</span>
                  <button type="button" class="btn" :disabled="busy" @click="action(exportSystemLogs, '已发起日志导出')"><Download :size="16" />导出系统日志</button>
                </div>
                <article v-for="l in logs" class="log-row">
                  <div>
                    <strong>{{
                      platforms[l.platform as PlatformId].short
                    }}</strong><span
                      class="log-outcome"
                      :class="{ red: l.outcome === 'failed' }"
                      >{{ outcome(l.outcome) }}</span
                    ><time>{{ date(l.at) }}</time>
                  </div>
                  <p v-for="i in l.data.issues">{{ i }}</p>
                  <p v-for="p in l.data.partitions">
                    {{ p.count }} 条 · {{ outcome(p.outcome) }} ·
                    {{ p.issues.join("；") }}
                  </p>
                  <small
                    >新增 {{ l.data.added }} · 更新 {{ l.data.changed }} ·
                    {{
                      l.data.discoveryComplete
                        ? "分区枚举完整"
                        : "分区枚举未完成"
                    }}</small
                  >
                </article>
                <div v-if="!logs.length" class="empty">
                  <ScrollText :size="30" />
                  <h3>尚未执行检查</h3>
                  <p>配置平台后即可开始首次检查。</p>
                </div>
              </section>
              <div v-if="view === 'settings'" class="settings-grid">
                <section class="panel settings-panel">
                  <div class="panel-title"><h2>监控与提醒</h2></div>
                  <div class="setting-row">
                    <div>
                      <strong>后台监控</strong>
                      <p>暂停扫描期间，已保存任务仍会按规则提醒</p>
                    </div>
                    <button
                      class="secondary"
                      :disabled="busy"
                      @click="
                        action(() =>
                          api(
                            `monitor/${health.monitoring ? 'stop' : 'start'}`,
                            'POST',
                            {},
                          ),
                        )
                      "
                    >
                      <Pause v-if="health.monitoring" :size="15" /><Play
                        v-else
                        :size="15"
                      />{{ health.monitoring ? "暂停扫描" : "恢复扫描" }}
                    </button>
                  </div>
                  <div class="setting-row">
                    <div>
                      <strong>默认检查频率</strong>
                      <p>平台独立调度，失败后退避；课程另在北京时间整点、半点检查</p>
                    </div>
                    <select
                      v-model.number="settings.intervalMinutes"
                      aria-label="检查频率"
                    >
                      <option v-for="m in [5, 15, 30, 60]" :value="m">
                        每 {{ m }} 分钟
                      </option>
                    </select>
                  </div>
                  <div class="setting-row">
                    <div>
                      <strong>系统通知</strong>
                      <p>独立于浏览器；请先测试系统权限</p>
                    </div>
                    <input
                      type="checkbox"
                      v-model="settings.nativeNotifications"
                      aria-label="启用系统通知"
                    />
                  </div>
                  <div class="setting-row">
                    <div><strong>使用的浏览器</strong><p>使用独立资料目录；保存后从下一次打开窗口生效</p></div>
                    <select v-model="settings.browser" aria-label="使用的浏览器">
                      <option value="auto">自动选择（优先 Chrome）</option>
                      <option value="chrome">Google Chrome</option>
                      <option value="edge">Microsoft Edge</option>
                    </select>
                  </div>
                  <div class="setting-row reminder-setting">
                    <div>
                      <strong>截止前提醒</strong>
                      <p>错过多个窗口时，每项任务合并为一条</p>
                    </div>
                    <div class="reminder-options">
                      <label v-for="h in [72, 24, 12, 3, 1]"
                        ><input
                          type="checkbox"
                          :value="h"
                          v-model="settings.reminderHours"
                        />{{ h }} 小时</label
                      >
                    </div>
                  </div>
                  <div class="button-row">
                    <button
                      class="primary"
                      :disabled="busy"
                      @click="
                        action(async () => {
                          const r = await api('settings', 'PATCH', settings);
                          settingsDirty = false;
                          return r;
                        })
                      "
                    >
                      保存设置</button
                    ><button
                      class="secondary"
                      :disabled="busy"
                      @click="
                        action(() => api('notifications/test', 'POST', {}), '')
                      "
                    >
                      发送测试通知
                    </button>
                  </div>
                </section>
                <section class="panel settings-panel"><AppUpdates :status="health.updates" @changed="value => health.updates = value" /></section>
                <section class="panel settings-panel"><NotificationChannels /></section>
                <section class="panel settings-panel"><ExperimentalStudy /><ExperimentalStudy platform="unipus" /></section>
                <section class="panel settings-panel">
                  <div class="panel-title">
                    <h2>数据</h2>
                    <ShieldCheck :size="18" />
                  </div>
                  <p class="settings-description">
                    任务与记录保存在本机，导出和备份不包含登录会话。
                  </p>
                  <div class="button-row">
                    <button
                      class="secondary"
                      :disabled="busy"
                      @click="download"
                    >
                      <Download :size="16" />导出任务</button
                    ><button
                      class="secondary"
                      :disabled="busy"
                      @click="action(() => api('backup', 'POST', {}))"
                    >
                      创建数据库备份
                    </button>
                  </div>
                  <div class="setting-row">
                    <div>
                      <strong>外观</strong>
                      <p>浅色或深色</p>
                    </div>
                    <button class="secondary" @click="toggleTheme">
                      {{ dark ? "切换浅色" : "切换深色" }}
                    </button>
                  </div>
                  <p class="coverage-note">
                    {{ APP_VERSION }} 实验版。平台采集与系统通知请在实际使用中核对。
                  </p>
                </section>
                <details class="panel settings-panel experiment-panel">
                  <summary>本地实验</summary>
                  <div class="panel-title">
                    <h2><FlaskConical :size="19" /> 本地模拟实验</h2>
                    <span class="experiment-badge">模拟数据</span>
                  </div>
                  <p class="settings-description">
                    按顺序验证基线、新任务、截止变化、失败保留和缺失待核实。仅写入带
                    [模拟] 标记的本地任务，不访问教学平台。
                  </p>
                  <div class="button-row">
                    <button
                      v-for="s in [
                        { id: 'baseline', name: '1. 建立基线' },
                        { id: 'new', name: '2. 新增任务' },
                        { id: 'change', name: '3. 修改截止' },
                        { id: 'failure', name: '4. 网络失败' },
                        { id: 'empty', name: '5. 完整空快照' },
                      ]"
                      class="secondary"
                      :disabled="busy"
                      @click="experiment(s.id)"
                    >
                      {{ s.name }}</button><button
                      class="secondary"
                      :disabled="busy"
                      @click="
                        action(
                          () => api('experiment/clear', 'POST', {}),
                          '模拟任务已清除',
                        )
                      "
                    >
                      清除模拟任务
                    </button>
                  </div>
                </details>
              </div>
            </template>
          </main>
        </div>
        <Transition name="toast"
          ><div v-if="toast" class="toast" role="status">
            <Check :size="17" />{{ toast }}
          </div></Transition
        >
      </div></NMessageProvider
    ></NConfigProvider
  >
</template>
