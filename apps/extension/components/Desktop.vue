<script setup lang="ts">
import { APP_VERSION } from "../../../packages/contracts/src/version.js";
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  LayoutGrid,
  Settings2,
  Bell,
  RefreshCw,
  Check,
  ArrowUpRight,
  Plus,
  MoreHorizontal,
  X,
  Search,
  ExternalLink,
  ChevronDown,
  FlaskConical,
  Download,
  Pause,
  Play,
  CalendarDays,
  Link2,
  ShieldCheck,
  Star,
  Pencil,
  Trash2,
  History,
  FileText,
  PanelBottomClose,
} from "lucide-vue-next";
import ReminderEditor from "./ReminderEditor.vue";
import NotificationChannels from './NotificationChannels.vue';
import CourseManager from "./CourseManager.vue";
import PlatformLoginPrompt from "./PlatformLoginPrompt.vue";
import ExperimentalStudy from "./ExperimentalStudy.vue";
import CourseProgress from "./CourseProgress.vue";
import WindowsLifecycle from "./WindowsLifecycle.vue";
import TextLinks from "./TextLinks.vue";
import AppUpdates from './AppUpdates.vue';
import {
  agendaEntries,
  sortAgenda,
  priorityGroup,
  reminderLabel,
  type AgendaEntry,
} from "../../../packages/contracts/src/agenda";
import type { Schedule } from "../../../packages/contracts/src/index";
import { api, auth } from "../lib/api";
import { usePullRefresh } from "../lib/usePullRefresh";
import { desktopPlatform, isDesktop as isNative, sendDesktop as native, type DesktopPreferences } from "../lib/desktop";
import { exportSystemLogs } from '../lib/diagnostics';
import {
  platforms,
  discoversCourses,
  PlatformId as PlatformSchema,
  safePlatformUrl,
  type PlatformId,
  type Task,
  type SourceConfig,
  type CourseRecord,
  taskCourseKey,
} from "../../../packages/contracts/src/index";
const isWindows = desktopPlatform === "windows";
const lifecycle = ref<InstanceType<typeof WindowsLifecycle> | null>(null);
const nativePreferences = ref<DesktopPreferences | null>(null);
const platformParam = new URLSearchParams(location.search).get("platform");
const platformWindow = PlatformSchema.safeParse(platformParam).success
  ? (platformParam as PlatformId)
  : null;
const selected = ref<PlatformId | "all" | "schedule">("all"),
  panel = ref<
    | "none"
    | "courses"
    | "settings"
    | "platform"
    | "platformPicker"
    | "notifications"
    | "history"
    | "logs"
    | "schedule"
    | "reminder"
  >("none");
const schedules = ref<Schedule[]>([]);
const courses = ref<CourseRecord[]>([]);
const selectedCourse = ref<string>(restoredCourse());
function restoredCourse() { return (window as any).__coursewatchInitialState?.selectedCourse ?? ""; }
const promptedCourses = new Set<string>();
const platformCourses = ref<InstanceType<typeof CourseManager> | null>(null);
const shownCourses = computed(() => courses.value.filter(c => c.status === "enabled" && (selected.value === "all" || c.platform === selected.value)));
const pendingCourses = computed(() => courses.value.filter(c => c.status === "pending" && (selected.value === "all" || c.platform === selected.value)));
function viewCourse(id: string) {
  const c = courses.value.find(c => c.id === id);
  if (!c) return;
  choose(c.platform); selectedCourse.value = id;
}
const entryCourse = (t: AgendaEntry) => t.task ? courses.value.find(c => c.platform === t.task!.platform && c.accountId === t.task!.accountId && c.key === taskCourseKey(t.task!)) : undefined;
const now = ref(Date.now());
const tasks = ref<Task[]>([]),
  platformList = ref<any[]>([]),
  health = ref<any>({}),
  notes = ref<any[]>([]),
  history = ref<any[]>([]),
  logs = ref<any[]>([]),
  settings = ref<any>({
    browser: "auto",
    theme: "system",
    accent: "orange",
    sidebarGlass: false,
    intervalMinutes: 15,
    nativeNotifications: false,
    reminderHours: [72, 24, 12, 3, 1],
  });
const settingsSection = ref('general');
const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const mode = settings.value.theme ?? 'system';
  const dark = mode === 'dark' || mode === 'system' && systemAppearance.matches;
  document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  native('appearance', { mode, dark });
}
watch(() => settings.value.theme, applyAppearance, { immediate: true });
const settingsSections = [
  { id: 'general', name: '通用' }, { id: 'reminders', name: '提醒' },
  { id: 'mobile', name: '手机通知' }, { id: 'study', name: '自动学习' }, { id: 'data', name: '数据' },
];
watch(settingsSection, async () => { await nextTick(); document.querySelector('.settings-sheet .sheet-scroll')?.scrollTo({top:0}); });
const keyboardInput = ref(false);
const restored = (window as any).__coursewatchInitialState;
if (
  restored &&
  ["all", ...Object.keys(platforms), "schedule"].includes(restored.selected)
) {
  selected.value = restored.selected;
  if (
    [
      "none",
      "settings",
      "platform",
      "platformPicker",
      "notifications",
      "history",
      "logs",
      "schedule",
      "reminder",
    ].includes(restored.panel)
  )
    panel.value = restored.panel;
}
const busy = ref(false),
  connected = ref(false),
  error = ref(""),
  message = ref(""),
  filter = ref("pending"),
  search = ref(""),
  code = ref(""),
  menu = ref(false),
  settingsDirty = ref(false);
const preparingLogin = ref(false);
const finishingLogin = ref(false);
const workspace = ref<HTMLElement | null>(null);
const pullRefresh = usePullRefresh(
  workspace,
  computed(() => connected.value && !busy.value && panel.value === "none" && !menu.value),
  check,
);
interface PlatformDraft {
  enabled: boolean;
  sources: SourceConfig[];
  source: SourceConfig;
}
const managedId = ref<PlatformId>(
  platformWindow ??
    restored?.managedId ??
    (selected.value === "renwei" ? "renwei" : "ynjy"),
);
const platformDrafts = ref<Partial<Record<PlatformId, PlatformDraft>>>({});
const managed = computed(() =>
  platformList.value.find((p) => p.id === managedId.value),
);
const platformDraft = computed(() => platformDrafts.value[managedId.value]);
const sidebarPlatforms = computed(() =>
  Object.entries(platforms).filter(
    ([id, p]) =>
      platformList.value.find((item) => item.id === id)?.added ?? p.adapted,
  ),
);
const platformMenu = ref<{ id: PlatformId; x: number; y: number } | null>(null);
async function showPlatformMenu(event: MouseEvent | KeyboardEvent, id: PlatformId) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  platformMenu.value = { id,
    x: Math.max(8, Math.min(innerWidth - 190, ("clientX" in event && event.clientX) || box.right)),
    y: Math.max(8, Math.min(innerHeight - 100, ("clientY" in event && event.clientY) || box.top)),
  };
  await nextTick();
  document.querySelector<HTMLElement>(".platform-context-menu button")?.focus();
}
async function removePlatform(id: PlatformId) {
  platformMenu.value = null;
  await act(async () => {
    await api(`platforms/${id}`, "PATCH", { added: false });
    delete platformDrafts.value[id];
    if (selected.value === id) choose("all");
    native("dismissPlatform", { platform: id });
    native("refresh");
  }, "平台已移除，可通过＋重新添加");
}
async function addPlatform(id: PlatformId) {
  if (sidebarPlatforms.value.some(([key]) => key === id)) { choose(id); return; }
  await act(async () => {
    await api(`platforms/${id}`, "PATCH", { added: true });
    panel.value = "none";
    choose(id);
    native("refresh");
  });
}
function ensurePlatformDraft(id: PlatformId) {
  if (platformDrafts.value[id]) return;
  const p = platformList.value.find((p) => p.id === id);
  platformDrafts.value[id] = {
    enabled: p?.enabled ?? false,
    sources: JSON.parse(JSON.stringify(p?.sources ?? [])),
    source: { course: "", url: "", type: "homework" },
  };
}
function openPlatform(id: PlatformId) {
  if (isNative) {
    native("openPlatform", { platform: id });
  } else {
    window.open(
      `/?desktop=1&platform=${id}`,
      `coursewatch-${id}`,
      "popup,width=660,height=700",
    );
  }
  menu.value = false;
}
if (platformWindow) {
  selected.value = platformWindow;
  panel.value = "platform";
}
const platformDirty = computed(() => {
  const draft = platformDraft.value,
    p = managed.value;
  return (
    !!draft &&
    !!p &&
    (draft.enabled !== p.enabled ||
      JSON.stringify(draft.sources) !== JSON.stringify(p.sources) ||
      !!draft.source.course ||
      !!draft.source.url)
  );
});
async function savePlatform() {
  const id = managedId.value;
  const draft = platformDraft.value;
  if (!draft) return;
  const sources = [...draft.sources];
  const newCourse = draft.source.course.trim(),
    newUrl = draft.source.url.trim();
  if (newCourse || newUrl) {
    if (!newCourse || !newUrl) {
      error.value = "请填写课程名称和列表页地址";
      return;
    }
    if (!safePlatformUrl(id, newUrl)) {
      error.value = `请填写 ${platforms[id].host} 的 HTTPS 列表页地址`;
      return;
    }
    if (sources.some((s) => s.url === newUrl)) {
      error.value = "此列表已添加";
      return;
    }
    sources.push({ course: newCourse, url: newUrl, type: draft.source.type });
  }
  await act(async () => {
    await api(`platforms/${id}`, "PATCH", {
      ...(platformCourses.value ? { courseIds: platformCourses.value.selection } : {}),
      sources,
      enabled: newUrl && !draft.sources.length ? true : draft.enabled,
    });
    delete platformDrafts.value[id];
    native("refresh");
    close();
  }, `${platforms[id].short} 设置已保存`);
}
async function startPlatformLogin(id: PlatformId) {
  if (busy.value || preparingLogin.value) return;
  preparingLogin.value = true;
  try {
  await act(
    () => api(`platforms/${id}/login`, "POST", {}),
    `请在 ${platforms[id].short} 官方窗口完成登录`,
  );
  } finally {
    preparingLogin.value = false;
  }
}
async function promptPlatformLogin() {
  const id = current.value?.id;
  if (!id) return;
  // Begin the request before moving focus to a native platform window. Opening
  // that window first can release this renderer and cancel its pending action.
  await startPlatformLogin(id);
  openPlatform(id);
}
async function finishPlatformLogin() {
  if (busy.value || finishingLogin.value) return;
  finishingLogin.value = true;
  native("focusWindow");
  try {
    await act(async () => {
      const result = await api(`platforms/${managedId.value}/login/finish`, "POST", {});
      const draft = platformDrafts.value[managedId.value];
      if (draft && discoversCourses(managedId.value)) draft.enabled = true;
      // Browser shutdown can change the foreground app. Restore this settings
      // window before refreshing the other CourseWatch windows.
      native("focusWindow");
      native("refresh");
      return result;
    }, "登录会话已保存");
  } finally {
    finishingLogin.value = false;
    native("focusWindow");
  }
}
async function coursesChanged() {
  await load(true);
  native("refresh");
}
let timer: ReturnType<typeof setInterval>,
  noticeTimer: ReturnType<typeof setTimeout>;
const current = computed(() =>
  platformList.value.find((p) => p.id === selected.value),
);
const allAgenda = computed(() => agendaEntries(tasks.value, schedules.value));
const taskKind = ref<string>(restored?.taskKind ?? "exam");
const kindOf = (t: AgendaEntry) => t.local ? "schedule" : t.task?.type ?? "other";
const relevant = computed(() =>
  allAgenda.value.filter(
    (t) => (!selectedCourse.value || entryCourse(t)?.id === selectedCourse.value) && (
      selected.value === "all" ||
      (selected.value === "schedule"
        ? t.local
        : t.task?.platform === selected.value)),
  ),
);
const pending = computed(() => relevant.value.filter((t) => !t.done));
const soon = computed(() =>
  pending.value.filter(
    (t) =>
      t.dueAt !== null &&
      t.dueAt >= now.value &&
      t.dueAt - now.value <= 24 * 3600000,
  ),
);
const matched = computed(() =>
  sortAgenda(
    relevant.value.filter(
      (t) =>
        (filter.value === "all" ||
          (filter.value === "pending" && !t.done) ||
          (filter.value === "done" && t.done)) &&
        (!search.value ||
          `${t.title} ${t.subtitle}`
            .toLowerCase()
            .includes(search.value.toLowerCase())),
    ),
    now.value,
  ),
);
const taskKinds = computed(() => {
  const kinds = [
    { id: "exam", name: "考试" },
    { id: "homework", name: "作业" },
    { id: "quiz", name: "测验" },
    { id: "activity", name: "活动" },
    { id: "other", name: "其他任务" },
    { id: "schedule", name: "个人日程" },
  ];
  return kinds.map(kind => ({ ...kind, count: matched.value.filter(t => kindOf(t) === kind.id).length }))
    .filter(kind => ["exam", "homework"].includes(kind.id) || relevant.value.some(t => kindOf(t) === kind.id));
});
const filtered = computed(() => {
  const entries = matched.value.filter(t => selected.value === "schedule" || kindOf(t) === taskKind.value);
  if (selectedCourse.value || selected.value === "schedule") return entries;
  const order = [...new Set(entries.map(t => entryCourse(t)?.id ?? "schedule"))];
  return entries.sort((a, b) => order.indexOf(entryCourse(a)?.id ?? "schedule") - order.indexOf(entryCourse(b)?.id ?? "schedule"));
});
function moveTaskKind(event: KeyboardEvent, direction: number) {
  const parent = (event.currentTarget as HTMLElement).parentElement;
  const kinds = taskKinds.value;
  taskKind.value = kinds[(kinds.findIndex(k => k.id === taskKind.value) + direction + kinds.length) % kinds.length].id;
  nextTick(() => parent?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
}
const title = computed(() =>
  selected.value === "all"
    ? "待办事项"
    : selected.value === "schedule"
      ? "我的日程"
      : platforms[selected.value].name,
);
const groupName = (t: AgendaEntry) =>
  [
    "24 小时内事项",
    "重要事项",
    "后续事项",
    "已过期事项",
    "时间未明确",
    "已完成",
  ][priorityGroup(t, now.value)];
const editing = ref<string | null>(null);
const editingEntry = computed(() =>
  allAgenda.value.find((t) => t.id === editing.value),
);
const notificationPermission = ref("");
const scheduleForm = ref({
  title: "",
  note: "",
  when: "",
  important: false,
  reminderHours: null as number[] | null,
});
const deleteArmed = ref(false);
const scheduleDay = computed({
  get: () => scheduleForm.value.when.split("T")[0] || "",
  set: (value: string) => {
    scheduleForm.value.when = `${value}T${scheduleClock.value || "09:00"}`;
  },
});
const scheduleClock = computed({
  get: () => scheduleForm.value.when.split("T")[1] || "",
  set: (value: string) => {
    scheduleForm.value.when = `${scheduleDay.value}T${value}`;
  },
});
async function removeSchedule() {
  if (!deleteArmed.value) {
    deleteArmed.value = true;
    return;
  }
  await act(async () => {
    await api(`schedules/${editing.value}/delete`, "POST", {});
    panel.value = "none";
    native("refresh");
  }, "日程已删除");
}
function showSchedule(t?: AgendaEntry) {
  message.value = "";
  error.value = "";
  editing.value = t?.id ?? null;
  deleteArmed.value = false;
  const time = t?.dueAt ?? Date.now() + 3600000;
  const d = new Date(time);
  const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  scheduleForm.value = {
    title: t?.title ?? "",
    note: t?.schedule?.note ?? "",
    when,
    important: t?.important ?? false,
    reminderHours: t?.reminderHours ? [...t.reminderHours] : null,
  };
  panel.value = "schedule";
}
async function saveSchedule() {
  const dueAt = new Date(scheduleForm.value.when).getTime();
  if (!Number.isFinite(dueAt) || (!editing.value && dueAt <= Date.now())) {
    error.value = "请选择未来的日程时间";
    return;
  }
  await act(async () => {
    await api(
      editing.value ? `schedules/${editing.value}` : "schedules",
      editing.value ? "PATCH" : "POST",
      {
        title: scheduleForm.value.title,
        note: scheduleForm.value.note,
        important: scheduleForm.value.important,
        dueAt,
        reminderHours: scheduleForm.value.reminderHours,
      },
    );
    panel.value = "none";
    native("refresh");
  }, "日程已保存");
}
async function patchEntry(
  t: AgendaEntry,
  patch: Record<string, unknown>,
  text = "已更新",
) {
  await act(async () => {
    await api(`${t.local ? "schedules" : "tasks"}/${t.id}`, "PATCH", patch);
    native("refresh");
  }, text);
}
async function saveSettings(showNotificationGuide = false) {
  settingsDirty.value = true;
  await act(async () => {
    await api("settings", "PATCH", settings.value);
    settingsDirty.value = false;
    native(
      settings.value.nativeNotifications
        ? showNotificationGuide === true ? "configureNotifications" : "authorizeNotifications"
        : "refresh",
    );
  }, "设置已自动保存");
}
function openReminder(t: AgendaEntry) {
  editing.value = t.id;
  panel.value = "reminder";
}
function notificationStatus(e: Event) {
  notificationPermission.value = (e as CustomEvent).detail;
}
async function focusEntry(e: Event) {
  const id = (e as CustomEvent).detail;
  choose("all");
  filter.value = "all";
  await load();
  const focusedEntry = allAgenda.value.find((t) => t.id === id);
  if (focusedEntry) taskKind.value = kindOf(focusedEntry);
  await nextTick();
  document.getElementById(`entry-${id}`)?.scrollIntoView({ block: "center" });
  const entry = allAgenda.value.find((t) => t.id === id);
  if (entry) {
    editing.value = entry.id;
    panel.value = "reminder";
  }
}
const unread = computed(() => health.value.unreadCount ?? notes.value.filter((n) => !n.read_at).length);
const date = (v: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(v);
const status = (s: string) =>
  ({
    unknown: "未知",
    logged_in: "会话已保存",
    auth_required: "需要登录",
    verification_required: "需要验证",
    not_scanned: "尚未检查",
    complete: "检查完成",
    partial: "部分采集",
    failed: "检查失败",
  })[s] ?? s;
const remaining = (t: AgendaEntry) => {
  if (t.done) return "已完成";
  if (t.dueAt === null)
    return t.task?.deadline.kind === "none" ? "无截止" : "时间未知";
  const d = t.dueAt - now.value;
  if (d < 0) return t.local ? "已到时间" : "已截止";
  return d < 3600000
    ? `${Math.ceil(d / 60000)} 分钟后`
    : d < 86400000
      ? `${Math.ceil(d / 3600000)} 小时后`
      : `${Math.ceil(d / 86400000)} 天后`;
};
watch(
  () => settings.value.sidebarGlass,
  (enabled) => native("sidebarGlass", { enabled: !!enabled }),
);

let shapeObserver: ResizeObserver | undefined;
function updateWindowShape() {
  if (!isWindows) return;
  const shell = document.querySelector('.desktop-shell');
  if (!shell) return;
  const elements = platformWindow
    ? [...shell.querySelectorAll('.windows-platform-titlebar, .glass-scrim')]
    : [...shell.querySelectorAll(':scope > .object-rail, :scope > .glass-workspace')];
  const panes = elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, radius: parseFloat(getComputedStyle(element).borderTopLeftRadius) || 18 };
  });
  if (platformWindow && panes.length === 2) {
    const x = Math.min(...panes.map(p => p.x)), y = Math.min(...panes.map(p => p.y));
    native('windowShape', { viewportWidth: innerWidth, viewportHeight: innerHeight,
      panes: [{ x, y, width: Math.max(...panes.map(p => p.x + p.width)) - x, height: Math.max(...panes.map(p => p.y + p.height)) - y, radius: 18 }] });
  } else if (panes.length === 2) native('windowShape', { viewportWidth: innerWidth, viewportHeight: innerHeight, panes });
}
function inform(s: string) {
  message.value = s;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (message.value = ""), 3500);
}
let loading: Promise<void> | undefined;
function load(fresh: boolean | Event = false): Promise<void> {
  if (loading) return fresh === true ? loading.then(() => load()) : loading;
  loading = loadState().finally(() => { loading = undefined; });
  return loading;
}
async function loadState() {
  if (!auth.get()) {
    connected.value = false;
    return;
  }
  try {
    if (platformWindow) {
      const [h, p, s, courseList] = await Promise.all([
        api("health"),
        api("platforms"),
        api("settings"),
        api("courses"),
      ]);
      health.value = h;
      platformList.value = p.items;
      courses.value = courseList.items;
      ensurePlatformDraft(platformWindow);
      settings.value = s;
      connected.value = true;
      return;
    }
    const [h, p, t, n, hi, l, s, calendar, courseList] = await Promise.all([
      api("health"),
      api("platforms"),
      api("tasks?limit=500"),
      panel.value === "notifications" ? api("notifications") : Promise.resolve(null),
      panel.value === "history" ? api("history") : Promise.resolve(null),
      panel.value === "logs" ? api("logs") : Promise.resolve(null),
      api("settings"),
      api("schedules"),
      api("courses"),
    ]);
    health.value = h;
    platformList.value = p.items;
    if (panel.value === "platform") ensurePlatformDraft(managedId.value);
    tasks.value = t.items;
    schedules.value = calendar.items;
    courses.value = courseList.items;
    if (selectedCourse.value && !shownCourses.value.some(c => c.id === selectedCourse.value)) selectedCourse.value = "";
    if (!platformWindow && panel.value === "none") {
      const pending = courses.value.find(c => c.status === "pending" && platformList.value.some(p => p.id === c.platform && p.loginStatus === "logged_in") && !promptedCourses.has(c.platform));
      if (pending) { promptedCourses.add(pending.platform); panel.value = "courses"; }
    }
    now.value = Date.now();
    if (n) notes.value = n.items;
    if (hi) history.value = hi.items;
    if (l) logs.value = l.items;
    if (!settingsDirty.value) settings.value = s;
    connected.value = true;
  } catch (e) {
    connected.value = false;
    error.value = (e as Error).message;
  }
}
async function act(fn: () => Promise<any>, text = "已保存") {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const r = await fn();
    await load(true);
    if (text) inform(r?.message ?? text);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    native("settled");
  }
}
async function check() {
  await act(
    () =>
      api(
        "monitor/check",
        "POST",
        selected.value === "all" || selected.value === "schedule"
          ? {}
          : { platform: selected.value },
      ),
    "检查已完成",
  );
  native("refresh");
}
async function testNotification(scenario?: "new" | "deadline") {
  await act(async () => {
    const result = await api("notifications/test", "POST", scenario ? { scenario } : {});
    if (!isNative || !result.id) return result;
    native("notifications");
    const until = Date.now() + 18000;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = await api("notifications");
      const row = rows.items.find((row: any) => row.id === result.id);
      if (!row?.delivered_at) continue;
      if (row.error) throw new Error(row.error);
      return { message: `${isWindows ? "Windows" : "macOS"} 已接收测试通知，请在通知中心核对显示` };
    }
    throw new Error(`尚未收到 ${isWindows ? "Windows" : "macOS"} 投递确认，请检查通知权限`);
  }, "");
}
function choose(p: PlatformId | "all" | "schedule") {
  selected.value = p;
  selectedCourse.value = "";
  if (!taskKinds.value.some(k => k.id === taskKind.value)) taskKind.value = "exam";
  panel.value = "none";
  filter.value = "pending";
  search.value = "";
}
async function pair() {
  await act(async () => {
    const r = await api("pair", "POST", { code: code.value.trim() });
    auth.set(r.token);
  }, "已连接");
}
function openTask(t: AgendaEntry) {
  if (t.local) {
    showSchedule(t);
    return;
  }
  if (t.task?.url && safePlatformUrl(t.task.platform, t.task.url))
    window.open(t.task.url, "_blank", "noopener,noreferrer");
}
function openLink(url: string) {
  if (isNative) native("openExternal", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
function urgency(t: AgendaEntry) {
  if (t.done || t.dueAt === null) return "none";
  const hours = (t.dueAt - now.value) / 3600000;
  return hours < 0 ? "overdue" : hours <= 3 ? "red" : hours <= 12 ? "orange" : hours <= 24 ? "yellow" : "none";
}
async function exportTasks() {
  if (isNative) {
    native("export");
    return;
  }
  await act(async () => {
    const data = await api("export");
    const blob = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = blob;
    a.download = "coursewatch-tasks.json";
    a.click();
    URL.revokeObjectURL(blob);
  }, "已导出");
}
function close() {
  if (platformWindow) {
    if (isNative)
      native("closePlatform");
    else window.close();
    return;
  }
  panel.value = "none";
  error.value = "";
}
function escape(e: KeyboardEvent) {
  if (document.querySelector("dialog[open]")) return;
  keyboardInput.value = true;
  if (e.key === "Escape") {
    platformMenu.value = null;
    close();
    menu.value = false;
  }
  if (e.key === "Tab" && panel.value !== "none") {
    const nodes = [
      ...document.querySelectorAll<HTMLElement>(
        ".glass-sheet button:not(:disabled), .glass-sheet input:not(:disabled), .glass-sheet select:not(:disabled), .glass-sheet textarea:not(:disabled), .glass-sheet summary",
      ),
    ].filter((el) => el.getClientRects().length);
    const first = nodes[0],
      last = nodes.at(-1);
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        !document.activeElement?.closest(".glass-sheet"))
    ) {
      e.preventDefault();
      last?.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last ||
        !document.activeElement?.closest(".glass-sheet"))
    ) {
      e.preventDefault();
      first?.focus();
    }
  }
}
let previousFocus: HTMLElement | null = null;
watch(panel, async (value, previous) => {
  native("modalState", { open: value !== "none" });
  if (previous === "none")
    previousFocus = document.activeElement as HTMLElement;
  await nextTick();
  if (value !== "none")
    document.querySelector<HTMLElement>(".glass-sheet")?.focus();
  else previousFocus?.focus();
  if (["notifications", "history", "logs"].includes(value)) await load();
});
function openSettings() {
  keyboardInput.value = true;
  panel.value = "settings";
}
function openMoreMenu() {
  menu.value = true;
  void nextTick(() => document.querySelector<HTMLElement>('.glass-menu [role="menuitem"]')?.focus());
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); menu.value = false; void nextTick(() => document.querySelector<HTMLElement>('[aria-label="更多"]')?.focus()); return; }
  const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}
function pointerInput() {
  keyboardInput.value = false;
}
function dragWindow(event: PointerEvent) {
  if (!isWindows || event.button !== 0 || (panel.value !== "none" && !platformWindow)) return;
  const target = event.target as HTMLElement;
  if (target.closest("button, input, select, textarea, a, [role=button]")) return;
  if (target.closest(".window-toolbar, .windows-platform-titlebar, .rail-top")) native("drag");
}
let nativePageVisible = true;
let toolbarObserver: ResizeObserver | undefined;
function updatePolling() {
  clearInterval(timer);
  if (document.hidden || !nativePageVisible) return;
  void load();
  timer = setInterval(() => {
    now.value = Date.now();
    if (!busy.value) void load();
  }, 15000);
}
function nativeVisibility(event: Event) {
  const visible = (event as CustomEvent).detail !== false;
  if (visible === nativePageVisible) return;
  nativePageVisible = visible;
  updatePolling();
}
onMounted(() => {
  systemAppearance.addEventListener('change', applyAppearance);
  if (restored) {
    if (settingsSections.some(section => section.id === restored.settingsSection)) settingsSection.value = restored.settingsSection;
    filter.value = restored.filter ?? "pending";
    search.value = restored.search ?? "";
    editing.value = restored.editing ?? null;
    if (restored.scheduleForm) scheduleForm.value = restored.scheduleForm;
    if (restored.platformDrafts) platformDrafts.value = restored.platformDrafts;
    if (restored.settings) {
      settings.value = restored.settings;
      settingsDirty.value = !!restored.settingsDirty;
    }
  }
  (window as any).__coursewatchSnapshot = () =>
    JSON.parse(
      JSON.stringify({
        selected: selected.value,
        selectedCourse: selectedCourse.value,
        taskKind: taskKind.value,
        busy: busy.value || !!lifecycle.value?.busy,
        panel: panel.value,
        filter: filter.value,
        search: search.value,
        managedId: managedId.value,
        platformDrafts: platformDrafts.value,
        settings: settings.value,
        settingsSection: settingsSection.value,
        settingsDirty: settingsDirty.value,
        editing: editing.value,
        scheduleForm: scheduleForm.value,
        lifecycle: lifecycle.value?.snapshot(),
      }),
    );
  if (platformWindow) {
    panel.value = "platform";
    selected.value = platformWindow;
  }
  document.documentElement.classList.add("desktop-mode");
  applyAppearance();
  const toolbar = workspace.value?.querySelector(".window-toolbar");
  if (toolbar) {
    toolbarObserver = new ResizeObserver(() => {
      workspace.value?.style.setProperty("--toolbar-height", `${toolbar.getBoundingClientRect().height}px`);
      native("toolbarBounds", { actionsLeft: toolbar.querySelector(".toolbar-end")?.getBoundingClientRect().left });
    });
    toolbarObserver.observe(toolbar);
    const actions = toolbar.querySelector(".toolbar-end");
    if (actions) toolbarObserver.observe(actions);
  }
  updatePolling();
  native("modalState", { open: panel.value !== "none" });
  native("sidebarGlass", { enabled: !!settings.value.sidebarGlass });
  if (isWindows) nextTick(() => {
    shapeObserver = new ResizeObserver(updateWindowShape);
    for (const element of document.querySelectorAll('.desktop-shell, .object-rail, .glass-workspace, .windows-platform-titlebar, .platform-window .glass-scrim')) shapeObserver.observe(element);
    updateWindowShape();
  });
  native("notificationStatus");
  window.addEventListener("coursewatch:notificationStatus", notificationStatus);
  window.addEventListener("coursewatch:task", focusEntry);
  window.addEventListener("keydown", escape);
  window.addEventListener("coursewatch:settings", openSettings);
  window.addEventListener("coursewatch:refresh", load);
  window.addEventListener("pointerdown", pointerInput);
  document.addEventListener("visibilitychange", updatePolling);
  window.addEventListener("coursewatch:visibility", nativeVisibility);
});
onUnmounted(() => {
  shapeObserver?.disconnect();
  systemAppearance.removeEventListener('change', applyAppearance);
  delete document.documentElement.dataset.appearance;
  document.documentElement.style.removeProperty('color-scheme');
  toolbarObserver?.disconnect();
  clearInterval(timer);
  clearTimeout(noticeTimer);
  window.removeEventListener(
    "coursewatch:notificationStatus",
    notificationStatus,
  );
  window.removeEventListener("coursewatch:task", focusEntry);
  window.removeEventListener("keydown", escape);
  window.removeEventListener("coursewatch:settings", openSettings);
  window.removeEventListener("coursewatch:refresh", load);
  window.removeEventListener("pointerdown", pointerInput);
  document.removeEventListener("visibilitychange", updatePolling);
  window.removeEventListener("coursewatch:visibility", nativeVisibility);
  delete (window as any).__coursewatchSnapshot;
});
</script>
<template>
  <div
    class="desktop-shell"
    :data-accent="settings.accent ?? 'orange'"
    :class="{
      'keyboard-input': keyboardInput,
      'platform-window': !!platformWindow,
      'sidebar-glass': !!settings.sidebarGlass,
    }"
    @pointerdown="dragWindow"
  >
    <WindowsLifecycle v-if="isWindows && !platformWindow" ref="lifecycle" @preferences="nativePreferences = $event"
      @error="error = $event" @saved="inform('设置已保存')" />
    <div v-if="isWindows && platformWindow" class="windows-platform-titlebar">{{ platforms[platformWindow].short }}设置</div>
    <div v-if="isWindows" class="windows-window-controls" aria-label="窗口操作" @pointerdown.stop>
      <button type="button" aria-label="最小化窗口" title="最小化窗口" @click="native('minimize')">
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M0 5.5h10" /></svg>
      </button>
      <button type="button" class="windows-close" aria-label="关闭窗口" title="关闭窗口" @click="native('close')">
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="m.5.5 9 9m0-9-9 9" /></svg>
      </button>
    </div>
    <aside v-if="!platformWindow" class="object-rail" :class="{ 'compact-platforms': sidebarPlatforms.length > 2 }">
      <div class="rail-top">
        <img
          src="/coursewatch.png"
          width="52"
          height="52"
          alt="CourseWatch"
        />
      </div>
      <div class="rail-app-divider" aria-hidden="true" />
      <nav aria-label="监控对象">
        <button
          class="object-button all-object"
          :class="{ active: selected === 'all' }"
          title="全部任务"
          aria-label="全部任务"
          @click="choose('all')"
        >
          <LayoutGrid :size="22" />
        </button>
        <button
          class="object-button"
          :class="{ active: selected === 'schedule' }"
          title="我的日程"
          aria-label="我的日程"
          @click="choose('schedule')"
        >
          <CalendarDays :size="24" />
        </button>
        <div class="rail-divider" />
        <button
          v-for="[id, p] in sidebarPlatforms"
          :key="id"
          class="object-button"
          :class="{ active: selected === id }"
          :title="p.name"
          :aria-label="p.name"
          @click="choose(id as PlatformId)"
          @contextmenu.prevent="showPlatformMenu($event, id as PlatformId)"
          @keydown.shift.f10.prevent="showPlatformMenu($event, id as PlatformId)"
        >
          <span :class="['object-icon', id]"
            ><img :src="p.icon" :alt="`${p.short} 网站图标`" /></span
          ><i
            v-if="platformList.find((x) => x.id === id)?.enabled"
            class="object-live"
          /></button
        ><button
          class="add-object"
          title="添加平台"
          aria-label="添加平台"
          @click="panel = 'platformPicker'"
        >
          <Plus :size="20" />
        </button>
      </nav>
      <div class="rail-bottom">
        <button
          class="rail-utility"
          aria-label="通知"
          title="通知"
          @click="panel = 'notifications'"
        >
          <Bell :size="20" /><i v-if="unread" /></button
        ><button
          class="rail-utility"
          aria-label="设置"
          title="设置"
          @click="panel = 'settings'"
        >
          <Settings2 :size="21" />
        </button>
      </div>
    </aside>
    <main v-if="!platformWindow" ref="workspace" class="glass-workspace" :aria-busy="pullRefresh.refreshing.value">
      <div class="window-toolbar" :class="{ 'long-title': title.length > 14 }">
        <div class="toolbar-heading">
          <h1>{{ title }}</h1>
          <small>{{ relevant.length }} 项</small>
        </div>
        <div class="toolbar-end">
          <button v-if="selected !== 'schedule'" class="glass-secondary toolbar-courses" @click="panel = 'courses'" aria-label="管理课程">课程<span v-if="pendingCourses.length"> · {{ pendingCourses.length }} 待选择</span></button>
          <button
            v-if="current"
            class="glass-secondary toolbar-platform-settings"
            title="平台设置"
            aria-label="平台设置"
            @click="openPlatform(current.id)"
          >
            <Settings2 :size="18" /><span>平台设置</span>
          </button>
          <button
            class="glass-primary toolbar-add"
            :disabled="busy || !connected"
            @click="showSchedule()"
            aria-label="添加日程"
            title="添加日程"
          >
            <Plus :size="17" /><span>添加日程</span>
          </button>
          <button
            class="glass-icon"
            :disabled="busy || !connected"
            @click="check"
            title="同步"
            aria-label="同步"
          >
            <RefreshCw :size="18" :class="{ rotating: busy }" />
          </button>

          <span class="desktop-connection"
            ><i :class="{ online: connected }" />{{
              connected
                ? !health.monitoring
                  ? "已暂停"
                  : platformList.some((p) => p.enabled)
                    ? "监控中"
                    : "未开启对象"
                : "未连接"
            }}</span
          >
          <div class="more-wrap">
            <button class="glass-icon" aria-label="更多" aria-haspopup="menu" :aria-expanded="menu" @click="menu = !menu" @keydown.down.prevent="openMoreMenu">
              <MoreHorizontal :size="20" />
            </button>
            <Transition name="popover"
              ><div v-if="menu" class="glass-menu" role="menu" aria-label="更多操作" @keydown="menuKey">
                <button role="menuitem"
                  @click="
                    panel = 'history';
                    menu = false;
                  "
                >
                  <History :size="16" aria-hidden="true" />变化记录</button
                ><button role="menuitem"
                  @click="
                    panel = 'logs';
                    menu = false;
                  "
                >
                  <FileText :size="16" aria-hidden="true" />检查日志</button
                ><button role="menuitem"
                  @click="
                    act(() =>
                      api(
                        `monitor/${health.monitoring ? 'stop' : 'start'}`,
                        'POST',
                        {},
                      ),
                    );
                    menu = false;
                  "
                >
                  <Pause v-if="health.monitoring" :size="16" aria-hidden="true" /><Play v-else :size="16" aria-hidden="true" />{{ health.monitoring ? "暂停监控" : "继续监控" }}</button
                ><button role="menuitem" v-if="isNative"
                  @click="
                    native('hide');
                    menu = false;
                  "
                >
                  <PanelBottomClose :size="16" aria-hidden="true" />{{ isWindows ? "收起到托盘" : "收起到菜单栏" }}
                </button>
              </div></Transition
            >
          </div>
        </div>
      </div>
      <div v-if="pullRefresh.visible.value" class="pull-refresh-slot" role="status" aria-live="polite">
        <span class="pull-refresh-status">
          <RefreshCw :size="16" :class="{ rotating: pullRefresh.refreshing.value }" :style="pullRefresh.refreshing.value ? undefined : { transform: `rotate(${pullRefresh.progress.value * 180}deg)` }" />
          {{ pullRefresh.label.value }}
        </span>
      </div>
      <Transition name="page" mode="out-in"
        ><div class="desktop-content" :key="selected">
          <AppUpdates v-if="connected" mode="banner" :status="health.updates" @changed="value => health.updates = value" />
          <div
            v-if="error && panel === 'none'"
            class="desktop-error"
            role="alert"
          >
            {{ error
            }}<button aria-label="关闭错误" @click="error = ''">
              <X :size="14" />
            </button>
          </div>
          <section v-if="!auth.get()" class="desktop-pair">
            <h2>连接后台</h2>
            <p>输入本机一次性配对码。</p>
            <form @submit.prevent="pair">
              <input
                v-model="code"
                placeholder="配对码"
                aria-label="配对码"
              /><button class="glass-primary" :disabled="busy">连接</button>
            </form>
          </section>
          <template v-else>
            <div class="agenda-summary">
              <span
                ><strong>{{ pending.length }}</strong> 项待处理</span
              >
              <span :class="{ 'summary-urgent': soon.length }"
                ><strong>{{ soon.length }}</strong> 项在 24 小时内到期</span
              >
              <span class="summary-hint">临近截止与重要事项优先</span>
            </div>
            <div
              v-if="!settings.nativeNotifications"
              class="notification-callout"
            >
              <Bell :size="18" /><span
                >{{ isWindows ? '开启系统通知后，最小化或隐藏到系统托盘时仍可接收提醒。' : '开启系统通知后，窗口最小化或关闭时仍可接收提醒。' }}</span
              >
              <button
                :disabled="busy"
                @click="
                  settings.nativeNotifications = true;
                  saveSettings(true);
                "
              >
                开启提醒
              </button>
            </div>
            <PlatformLoginPrompt v-if="current && panel === 'none'" :key="current.id" :platform="current" :active-login="health.activeLogin" @login="promptPlatformLogin" />
            <ExperimentalStudy v-if="selected === 'chaoxing' || selected === 'unipus'" :key="selected" :platform="selected" mode="platform" :courses="shownCourses" @settings="openSettings" />
            <details v-if="selected === 'chaoxing' || selected === 'unipus'" class="glass-task-panel course-progress-panel"><summary>全部课程进度</summary><CourseProgress :key="selected" :platform="selected" :courses="shownCourses" /></details>
            <section class="glass-task-panel">
              <div v-if="selected !== 'schedule'" class="course-filter">
                <label for="course-filter">课程</label>
                <select id="course-filter" v-model="selectedCourse"><option value="">全部已选课程</option><option v-for="c in shownCourses" :key="c.id" :value="c.id">{{ selected === 'all' ? `${platforms[c.platform].short} · ` : '' }}{{ c.name }}</option></select>
                <button v-if="pendingCourses.length" class="glass-secondary" @click="panel = 'courses'">选择课程（{{ pendingCourses.length }}）</button>
              </div>
              <div v-if="selected !== 'schedule'" class="task-kind-tabs" role="tablist" aria-label="任务类型">
                <button v-for="kind in taskKinds" :key="kind.id" type="button" role="tab"
                  :aria-selected="taskKind === kind.id" :tabindex="taskKind === kind.id ? 0 : -1"
                  @click="taskKind = kind.id" @keydown.right.prevent="moveTaskKind($event, 1)" @keydown.left.prevent="moveTaskKind($event, -1)">
                  {{ kind.name }}<small>{{ kind.count }}</small>
                </button>
              </div>
              <div class="desktop-task-toolbar">
                <div
                  class="glass-segments"
                  :data-filter="filter"
                  aria-label="任务筛选"
                >
                  <button
                    v-for="f in [
                      { id: 'pending', name: '待处理' },
                      { id: 'all', name: '全部' },
                      { id: 'done', name: '已完成' },
                    ]"
                    :key="f.id"
                    :aria-pressed="filter === f.id"
                    :class="{ selected: filter === f.id }"
                    @click="filter = f.id"
                  >
                    {{ f.name }}
                  </button>
                </div>
                <label class="glass-search"
                  ><Search :size="17" /><input
                    v-model="search"
                    placeholder="搜索任务或日程"
                    aria-label="搜索任务"
                /></label>
              </div>
              <div v-if="!filtered.length" class="desktop-empty">
                <div class="empty-task-glyph"><Check :size="26" /></div>
                <h2>
                  {{
                    search
                      ? "没有匹配事项"
                      : filter === "pending" && relevant.some(t => selected === 'schedule' || kindOf(t) === taskKind)
                        ? "待办都处理好了"
                        : "暂无事项"
                  }}
                </h2>
                <p>手动添加日程，或连接课程平台同步任务。</p>
                <div class="sheet-actions">
                  <button class="glass-primary" @click="showSchedule()">
                    <Plus :size="16" />新建日程</button
                  ><button
                    class="glass-secondary"
                    @click="current ? openPlatform(current.id) : panel = 'platformPicker'"
                  >
                    {{ current ? '平台设置' : '添加平台' }}
                  </button>
                </div>
              </div>
              <template v-for="(t, index) in filtered" :key="t.id">
                <h2 v-if="!selectedCourse && (index === 0 || entryCourse(t)?.id !== entryCourse(filtered[index - 1])?.id)" class="course-heading">{{ t.task ? `${platforms[t.task.platform].short} · ${entryCourse(t)?.name || t.task.course}` : '个人日程' }}</h2>
                <h3
                  v-if="
                    index === 0 ||
                    entryCourse(t)?.id !== entryCourse(filtered[index - 1])?.id ||
                    groupName(t) !== groupName(filtered[index - 1])
                  "
                  class="agenda-group"
                  :class="{ urgent: priorityGroup(t, now) === 0 }"
                >
                  {{ groupName(t) }}
                </h3>
                <article
                  :id="`entry-${t.id}`"
                  class="desktop-task"
                  :data-urgency="urgency(t)"
                  :class="{
                    completed: t.done,
                    urgent: !t.done && priorityGroup(t, now) === 0,
                  }"
                >
                  <button
                    class="desktop-check"
                    :disabled="
                      busy ||
                      (!!t.task &&
                        ['submitted', 'graded', 'cancelled'].includes(
                          t.task.sourceStatus,
                        ))
                    "
                    :class="{ checked: t.done }"
                    :aria-label="`${t.done ? '取消完成' : '标记完成'} ${t.title}`"
                    @click="
                      patchEntry(
                        t,
                        t.local ? { done: !t.done } : { personalDone: !t.done },
                        t.done ? '已恢复待处理' : '已完成，可在已完成中撤销',
                      )
                    "
                  >
                    <Check v-if="t.done" :size="16" />
                  </button>
                  <div class="desktop-task-body">
                    <component
                      :is="t.task?.url ? 'a' : 'button'"
                      :href="t.task?.url"
                      class="task-name"
                      :disabled="!t.local && !t.task?.url"
                      @click.prevent="openTask(t)"
                    >
                      {{ t.title
                      }}<ArrowUpRight v-if="t.task?.url" :size="15" />
                    </component>
                    <div class="task-course">
                      <TextLinks :text="t.subtitle" @open="openLink" />
                    </div>
                    <small
                      >{{
                        t.dueAt !== null
                          ? `${date(t.dueAt)} ${t.local ? "开始" : "截止"}`
                          : t.task?.deadline.kind === "none"
                            ? "无截止时间"
                            : "截止时间未知"
                      }}<span v-if="t.task?.needsReview">
                        · 来源缺失，待核实</span
                      ></small
                    >
                  </div>
                  <div class="task-trailing">
                    <span
                      class="task-remaining"
                      :class="{ soon: priorityGroup(t, now) === 0 }"
                      >{{ remaining(t) }}</span
                    >
                    <div class="task-quick-actions">
                      <button
                        class="glass-icon"
                        :class="{ 'is-important': t.important }"
                        :disabled="busy"
                        :aria-label="`${t.important ? '取消重要' : '标为重要'} ${t.title}`"
                        :aria-pressed="t.important"
                        :title="t.important ? '取消重要' : '标为重要'"
                        @click="patchEntry(t, { important: !t.important })"
                      >
                        <Star
                          :size="18"
                          :fill="t.important ? 'currentColor' : 'none'"
                        />
                      </button>
                      <button
                        class="glass-icon"
                        :aria-label="`调整提醒 ${t.title}`"
                        title="调整提醒"
                        @click="openReminder(t)"
                      >
                        <Bell :size="18" />
                      </button>
                    </div>
                  </div>
                </article>
              </template>
            </section>
            <div class="desktop-footnote">
              <span>勾选完成 · 星标重要 · 铃铛调整提醒</span
              ><span>本机存储 · {{ APP_VERSION }}</span>
            </div>
          </template>
        </div></Transition
      >
    </main>
    <Transition name="material"
      ><div
        v-if="panel !== 'none'"
        class="glass-scrim"
        :class="{ 'platform-scrim': panel === 'platform' }"
        @click.self="!['settings', 'platform', 'schedule', 'reminder'].includes(panel) && close()"
      >
        <section
          class="glass-sheet"
          :class="{
            'wide-sheet': panel === 'platform',
            'settings-sheet': panel === 'settings',
            'schedule-sheet': panel === 'schedule',
          }"
          role="dialog"
          tabindex="-1"
          :aria-modal="!platformWindow"
          :aria-label="
            {
              settings: '设置',
              courses: '课程',
              platform: '平台管理',
              platformPicker: '添加平台',
              notifications: '通知',
              history: '变化记录',
              logs: '检查日志',
              schedule: '日程',
              reminder: '事项提醒',
            }[panel]
          "
        >
          <header v-if="!platformWindow || !isNative">
            <h2>
              {{
                {
                  settings: "设置",
                  courses: "课程",
                  platform: `${managed ? platforms[managed.id as PlatformId].short : "平台"}设置`,
                  platformPicker: "添加平台",
                  notifications: "通知",
                  history: "变化记录",
                  logs: "检查日志",
                  schedule: editing ? "编辑日程" : "新建日程",
                  reminder: "事项提醒",
                }[panel]
              }}
            </h2>
            <button class="glass-icon" aria-label="关闭面板" @click="close">
              <X :size="17" />
            </button>
          </header>
          <nav v-if="panel === 'settings'" class="settings-navigation" aria-label="设置分类">
            <button v-for="section in settingsSections" :key="section.id" type="button" :aria-pressed="settingsSection === section.id" @click="settingsSection = section.id">{{ section.name }}</button>
          </nav>
          <div class="sheet-scroll">
            <div v-if="error" class="desktop-error" role="alert">
              {{ error }}
            </div>
            <div v-if="panel === 'platformPicker'" class="platform-picker">
              <button
                v-for="(p, id) in platforms"
                :key="id"
                class="platform-choice"
                :disabled="busy || !connected || sidebarPlatforms.some(([key]) => key === id)"
                @click="addPlatform(id)"
              >
                <span :class="['object-icon', id]"
                  ><img :src="p.icon" alt=""
                /></span>
                <span class="platform-choice-copy"
                  ><strong>{{ p.name }}</strong
                  ><small>{{
                    !p.adapted
                      ? "暂未适配"
                      : sidebarPlatforms.some(([key]) => key === id)
                        ? "已添加"
                        : "添加平台"
                  }}</small></span
                >
                <Check v-if="sidebarPlatforms.some(([key]) => key === id)" :size="18" /><Plus v-else :size="18" />
              </button>
            </div>
            <template v-if="panel === 'platform' && managed && platformDraft">
              <div class="sheet-platform">
                <span :class="['object-icon', managed.id]"
                  ><img :src="platforms[managed.id as PlatformId].icon" alt=""
                /></span>
                <div>
                  <h3>{{ managed.name }}</h3>
                  <p>{{ status(managed.loginStatus) }}</p>
                  <small class="platform-host">{{
                    platforms[managed.id as PlatformId].host
                  }}</small>
                </div>
              </div>
              <div class="login-actions">
                <button
                  class="glass-secondary"
                  :disabled="busy || !!health.activeLogin"
                  @click="startPlatformLogin(managed.id)"
                >
                  <ExternalLink :size="16" />{{
                    managed.loginStatus === "logged_in" ? "重新登录" : "登录"
                  }}{{ platforms[managed.id as PlatformId].short }}
                </button>
                <template v-if="managed.activeLogin"
                  ><button
                    class="glass-primary"
                    :disabled="busy"
                    @click="finishPlatformLogin"
                  >
                    {{ finishingLogin ? '正在验证并保存登录…' : '完成登录' }}</button
                  ><button
                    class="glass-secondary"
                    :disabled="busy"
                    @click="
                      act(() => api('login/cancel', 'POST', {}), '登录已取消')
                    "
                  >
                    取消登录
                  </button></template
                >
              </div>
              <div v-if="health.browserMode === 'system' && health.browserAvailable === false" class="platform-unavailable browser-required" role="status">
                <p>未找到所选浏览器。请安装，或在“设置 → 通用”中切换浏览器，再点击登录。</p>
                <div class="sheet-actions">
                  <button class="glass-secondary" @click="openLink('https://www.google.com/chrome/')"><Download :size="16" />下载 Chrome</button>
                  <button class="glass-secondary" @click="openLink('https://www.microsoft.com/edge/download')"><Download :size="16" />下载 Edge</button>
                </div>
              </div>
              <p v-if="preparingLogin" class="reminder-hint" role="status">
                正在打开官方登录窗口…
              </p>
              <p
                v-if="!platforms[managedId].adapted"
                class="platform-unavailable"
              >
                暂未适配：当前可打开官方登录窗口，尚未接入任务同步。
              </p>
              <p
                v-if="health.activeLogin && health.activeLogin !== managedId"
                class="reminder-hint"
              >
                {{ platforms[health.activeLogin as PlatformId].short }}
                的登录窗口仍在打开，请先完成或取消。
              </p>
              <template v-if="platforms[managedId].adapted">
                <div class="form-option-row platform-monitor-row">
                  <label for="platform-enabled">自动监控</label
                  ><label class="native-toggle"
                    ><input
                      id="platform-enabled"
                      type="checkbox"
                      v-model="platformDraft.enabled"
                      :disabled="busy" /><span
                  /></label>
                </div>
                <form v-if="discoversCourses(managedId)" id="platform-editor" @submit.prevent="savePlatform">
                  <p class="reminder-hint">完成登录后先读取课程列表。请在“课程”中选择需要同步的课程，无需填写列表地址。</p>
                  <p class="reminder-hint">{{ managedId === 'yuketang' ? '普通雨课堂：读取课程活动中的作业、习题与考试；没有明确类型的测验保留为习题。' : managedId === 'unipus' ? 'U校园：读取教程书架、作业及考试汇总。汇总未提供教程关联的任务单独列出，请在课程列表中选择对应分组；不推断所属教程或完成状态。' : '学习通：分别读取课程作业和考试列表。' }}没有明确截止时间的任务显示“时间待确认”。全部课程及分页覆盖待真实账号核对。</p>
                </form>
                <template v-else>
                <div class="sheet-section-heading">
                  <h3>监控列表</h3>
                  <small>{{ platformDraft.sources.length }} 个</small>
                </div>
                <div
                  v-for="(source, i) in platformDraft.sources"
                  :key="source.url"
                  class="desktop-source"
                >
                  <div>
                    <strong>{{ source.course }}</strong><small>{{
                      source.url
                    }}</small>
                  </div>
                  <button
                    class="glass-icon"
                    :disabled="busy"
                    :aria-label="`移除列表 ${source.course}`"
                    @click="platformDraft.sources.splice(Number(i), 1)"
                  >
                    <X :size="16" />
                  </button>
                </div>
                <p v-if="!platformDraft.sources.length" class="reminder-hint">
                  尚未添加列表。登录后，复制官方作业或考试列表页地址填入下方。
                </p>
                <form
                  id="platform-editor"
                  class="platform-source-form"
                  @submit.prevent="savePlatform"
                >
                  <div class="form-field-pair">
                    <div class="form-field">
                      <label for="source-course">课程名称</label
                      ><input
                        id="source-course"
                        v-model="platformDraft.source.course"
                        :disabled="busy"
                        placeholder="填写课程名称"
                      />
                    </div>
                    <div class="form-field">
                      <label for="source-type">任务类型</label
                      ><select
                        id="source-type"
                        v-model="platformDraft.source.type"
                        :disabled="busy"
                      >
                        <option value="homework">作业</option>
                        <option value="exam">考试</option>
                        <option value="activity">课堂活动</option>
                      </select>
                    </div>
                  </div>
                  <div class="form-field">
                    <label for="source-url">新列表地址</label
                    ><input
                      id="source-url"
                      v-model="platformDraft.source.url"
                      type="url"
                      :disabled="busy"
                      :placeholder="`https://${platforms[managedId].host}/…`"
                    />
                  </div>
                  <p class="reminder-hint">
                    填写后点击保存，添加首个列表时会开启自动监控。
                  </p>
                </form>
                </template>
                <template v-if="discoversCourses(managedId) && managed.loginStatus === 'logged_in'">
                  <h3 class="sheet-section-heading">课程选择</h3>
                  <CourseManager ref="platformCourses" :courses="courses" :initial-platform="managedId" :fixed-platform="true" :embedded="true" :busy="busy" @changed="coursesChanged" />
                </template>
              </template>
              <details class="desktop-details">
                <summary>登录与采集说明</summary>
                <p>
                  使用独立浏览器目录保存登录。{{
                    platforms[managedId].adapted
                      ? (discoversCourses(managedId) ? "按课程读取任务，尚未验证全部课程和分页；失败时保留旧任务。" : "当前仅检查配置的列表，尚未验证全部分页；失败时保留旧任务。")
                      : "任务同步暂未适配。"
                  }}
                </p>
                <p>{{ managed.message }}</p>
              </details>
            </template>
            <form
              v-if="panel === 'schedule'"
              id="schedule-editor"
              class="schedule-form"
              @submit.prevent="saveSchedule"
            >
              <div class="form-field">
                <label for="schedule-title">日程名称</label
                ><input
                  id="schedule-title"
                  v-model="scheduleForm.title"
                  maxlength="200"
                  required
                  placeholder="输入日程名称"
                  :disabled="busy"
                />
              </div>
              <div class="form-field-pair">
                <div class="form-field">
                  <label for="schedule-day">日期</label
                  ><input
                    id="schedule-day"
                    v-model="scheduleDay"
                    type="date"
                    required
                    :disabled="busy"
                  />
                </div>
                <div class="form-field">
                  <label for="schedule-clock">时间 <span>本机时区</span></label
                  ><input
                    id="schedule-clock"
                    v-model="scheduleClock"
                    type="time"
                    step="60"
                    required
                    :disabled="busy"
                  />
                </div>
              </div>
              <div class="form-field">
                <label for="schedule-note">备注 <span>可选</span></label
                ><textarea
                  id="schedule-note"
                  v-model="scheduleForm.note"
                  maxlength="500"
                  rows="2"
                  placeholder="地点、需要准备的材料"
                  :disabled="busy"
                />
              </div>
              <div class="form-option-row">
                <label for="schedule-important">标为重要</label
                ><label class="native-toggle"
                  ><input
                    id="schedule-important"
                    type="checkbox"
                    v-model="scheduleForm.important"
                    :disabled="busy" /><span
                /></label>
              </div>
              <div class="reminder-options">
                <div class="form-option-row">
                  <label for="schedule-reminders">提醒方式</label
                  ><select
                    id="schedule-reminders"
                    :value="
                      scheduleForm.reminderHours === null ? 'default' : 'custom'
                    "
                    :disabled="busy"
                    @change="
                      scheduleForm.reminderHours =
                        ($event.target as HTMLSelectElement).value === 'default'
                          ? null
                          : [...settings.reminderHours]
                    "
                  >
                    <option value="default">使用默认提醒</option>
                    <option value="custom">单独设置</option>
                  </select>
                </div>
                <p
                  v-if="scheduleForm.reminderHours === null"
                  class="reminder-default-summary"
                >
                  {{
                    settings.reminderHours.length
                      ? `提前 ${reminderLabel(settings.reminderHours)}，到点也提醒`
                      : "仅在到点时提醒"
                  }}
                </p>
                <ReminderEditor
                  v-else
                  v-model="scheduleForm.reminderHours"
                  :disabled="busy"
                />
              </div>
            </form>
            <template v-if="panel === 'reminder' && editingEntry">
              <div class="reminder-entry-heading">
                <h3>{{ editingEntry.title }}</h3>
                <p>
                  {{
                    editingEntry.dueAt !== null
                      ? date(editingEntry.dueAt)
                      : "时间待确认"
                  }}
                </p>
              </div>
              <div class="form-option-row">
                <label for="entry-reminder-mode">提醒方式</label
                ><select
                  id="entry-reminder-mode"
                  :value="
                    editingEntry.reminderHours == null ? 'default' : 'custom'
                  "
                  :disabled="busy"
                  @change="
                    patchEntry(editingEntry, {
                      reminderHours:
                        ($event.target as HTMLSelectElement).value === 'default'
                          ? null
                          : [...settings.reminderHours],
                    })
                  "
                >
                  <option value="default">使用默认提醒</option>
                  <option value="custom">单独设置</option>
                </select>
              </div>
              <p
                v-if="editingEntry.reminderHours == null"
                class="reminder-default-summary"
              >
                {{
                  settings.reminderHours.length
                    ? `提前 ${reminderLabel(settings.reminderHours)}，到点也提醒`
                    : "仅在到点时提醒"
                }}
              </p>
              <ReminderEditor
                v-else
                :model-value="editingEntry.reminderHours"
                :disabled="busy"
                @update:model-value="
                  patchEntry(
                    editingEntry!,
                    { reminderHours: $event },
                    '提醒时间已保存',
                  )
                "
              />
              <p v-if="editingEntry.dueAt === null" class="reminder-hint">
                有明确截止时间后，提醒会自动生效。
              </p>
              <p v-if="!settings.nativeNotifications" class="reminder-hint">
                系统通知尚未开启，提醒保留在应用内通知中。可在设置中开启。
              </p>
              <div class="sheet-actions">
                <button
                  v-if="editingEntry.local"
                  class="glass-secondary"
                  @click="showSchedule(editingEntry)"
                >
                  <Pencil :size="16" />编辑日程</button
                ><button
                  v-if="editingEntry.task?.url"
                  class="glass-primary"
                  @click="openTask(editingEntry)"
                >
                  前往任务<ArrowUpRight :size="16" /></button
                ><button class="glass-secondary" @click="panel = 'settings'">
                  默认提醒设置
                </button>
              </div>
            </template>
            <template v-if="panel === 'settings'">
              <section v-show="settingsSection === 'general'" class="settings-group" aria-label="通用设置">
              <h3>外观</h3>
              <div class="desktop-setting settings-frequency">
                <label for="appearance-mode"><strong>主题</strong></label>
                <select id="appearance-mode" v-model="settings.theme" :disabled="busy" @change="saveSettings()" aria-label="主题">
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>
              <div class="desktop-setting">
                <div>
                  <strong>侧栏磨砂玻璃</strong
                  ><small>关闭后使用不透明深灰色</small>
                </div>
                <label class="native-toggle"
                  ><input
                    type="checkbox"
                    v-model="settings.sidebarGlass"
                    :disabled="busy"
                    aria-label="侧栏磨砂玻璃"
                    @change="saveSettings()" /><span
                /></label>
              </div>
              <div class="desktop-setting">
                <strong>点缀色</strong>
                <div class="accent-picker" role="group" aria-label="点缀色">
                  <button
                    v-for="color in [
                      { id: 'blue', name: '蓝色' },
                      { id: 'purple', name: '紫色' },
                      { id: 'green', name: '绿色' },
                      { id: 'orange', name: '橙色' },
                    ]"
                    :data-color="color.id"
                    :aria-label="color.name"
                    :aria-pressed="settings.accent === color.id"
                    :title="color.name"
                    @click="
                      settings.accent = color.id;
                      saveSettings();
                    "
                  >
                    <Check v-if="settings.accent === color.id" :size="12" />
                  </button>
                </div>
              </div>
              <h3 class="settings-subheading">课程同步</h3>
              <div class="desktop-setting settings-frequency">
                <div><strong>使用的浏览器</strong><small>登录、课程同步与学习使用独立资料目录。切换后从下一次打开窗口生效；未安装时请安装或重新选择。</small></div>
                <select v-model="settings.browser" :disabled="busy" @change="saveSettings()" aria-label="使用的浏览器">
                  <option value="auto">自动选择（优先 Chrome）</option>
                  <option value="chrome">Google Chrome</option>
                  <option value="edge">Microsoft Edge</option>
                </select>
              </div>
              <div class="desktop-setting settings-frequency">
                <div>
                  <strong>检查频率</strong><small>课程另在北京时间整点、半点检查；新课程待选择</small>
                </div>
                <select
                  v-model.number="settings.intervalMinutes"
                  :disabled="busy"
                  @change="saveSettings()"
                  aria-label="检查频率"
                >
                  <option v-for="m in [5, 15, 30, 60]" :value="m">
                    {{ m }} 分钟
                  </option>
                </select>
              </div>
              <template v-if="isWindows">
                <h3 class="settings-subheading">窗口与启动</h3>
                <div class="desktop-setting">
                  <div>
                    <strong>启动与后台</strong>
                    <small>{{ nativePreferences?.backgroundEnabled ? '后台运行已开启' : '后台运行未开启' }} · {{ nativePreferences?.launchAtLogin ? '开机启动已开启' : '开机启动未开启' }}</small>
                  </div>
                  <button class="glass-secondary" :disabled="!nativePreferences || lifecycle?.busy" @click="lifecycle?.openPreferences()">修改设置</button>
                </div>
                <div class="desktop-setting settings-frequency">
                  <strong>关闭窗口时</strong>
                  <select aria-label="关闭窗口时" :value="nativePreferences?.closeBehavior ?? 'ask'" :disabled="!nativePreferences || lifecycle?.busy"
                    @change="lifecycle?.saveCloseBehavior(($event.target as HTMLSelectElement).value as DesktopPreferences['closeBehavior'])">
                    <option value="ask">每次询问</option><option value="tray">隐藏到系统托盘</option><option value="quit">退出 CourseWatch</option>
                  </select>
                </div>
              </template>
              </section>
              <section v-show="settingsSection === 'general'" class="settings-group">
                <AppUpdates :status="health.updates" @changed="value => health.updates = value" />
              </section>
              <section v-show="settingsSection === 'reminders'" class="settings-group" aria-label="提醒设置">
              <h3>系统通知与提醒</h3>
              <div class="desktop-setting">
                <div>
                  <strong>系统通知</strong><small>{{ isWindows ? '隐藏到系统托盘后仍可提醒' : '关闭窗口后仍可提醒' }}</small>
                </div>
                <label class="native-toggle"
                  ><input
                    type="checkbox"
                    v-model="settings.nativeNotifications"
                    :disabled="busy"
                    @change="saveSettings(true)"
                    aria-label="系统通知" /><span
                /></label>
              </div>
              <p v-if="notificationPermission" class="reminder-hint">
                {{ notificationPermission
                }}<button
                  class="text-action"
                  @click="native('notificationSettings')"
                >
                  打开系统通知设置
                </button>
              </p>
              <p v-if="settings.nativeNotifications" class="reminder-hint">
                {{ isWindows ? "在 Windows 通知设置中允许 CourseWatch 发送通知，并开启通知横幅和通知中心。请勿打扰可能阻止横幅显示。" : "在系统通知设置中，将样式选为“提醒”、通知分组选为“关闭”，通知会常驻并可逐条关闭。专注模式可能延迟通知。" }}
              </p>
              <div class="desktop-setting stacked">
                <strong>默认提前提醒</strong>
                <p class="reminder-hint">
                  课程截止、个人日程均使用这些时间；单个事项可通过铃铛单独设置。
                </p>
                <ReminderEditor
                  :model-value="settings.reminderHours"
                  :disabled="busy"
                  @update:model-value="
                    settings.reminderHours = $event;
                    saveSettings();
                  "
                />
              </div>
              <div class="sheet-actions">
                <button
                  class="glass-secondary"
                  :disabled="busy"
                  @click="testNotification()"
                >
                  测试系统通知</button
                ><button class="glass-secondary" :disabled="busy" @click="testNotification('new')">模拟新作业通知</button
                ><button class="glass-secondary" :disabled="busy" @click="testNotification('deadline')">模拟截止通知</button
                >
              </div>
              </section>
              <section v-show="settingsSection === 'mobile'" class="settings-group settings-mobile" aria-label="手机通知"><NotificationChannels /></section>
              <section v-show="settingsSection === 'data'" class="settings-group" aria-label="数据设置">
              <h3>数据与备份</h3>
              <div class="sheet-actions">
                <button
                  class="glass-secondary"
                  :disabled="busy"
                  @click="exportTasks"
                >
                  <Download :size="14" />导出任务</button
                ><button
                  class="glass-secondary"
                  :disabled="busy"
                  @click="act(() => api('backup', 'POST', {}), '已备份')"
                >
                  备份
                </button>
              </div>
              <details class="desktop-details">
                <summary>本地实验</summary>
                <p>以下操作只生成带 [模拟] 标记的本机任务。</p>
                <div class="experiment-actions">
                  <button
                    v-for="s in [
                      { id: 'baseline', name: '基线' },
                      { id: 'new', name: '新增' },
                      { id: 'change', name: '截止变化' },
                      { id: 'failure', name: '失败' },
                      { id: 'empty', name: '空快照' },
                    ]"
                    class="glass-secondary"
                    :disabled="busy"
                    @click="
                      act(
                        () => api('experiment', 'POST', { scenario: s.id }),
                        '模拟快照已处理',
                      )
                    "
                  >
                    {{ s.name }}</button><button
                    class="glass-secondary"
                    :disabled="busy"
                    @click="
                      act(
                        () => api('experiment/clear', 'POST', {}),
                        '模拟任务已清除',
                      )
                    "
                  >
                    清除模拟任务
                  </button>
                </div>
              </details>
              </section>
              <section v-show="settingsSection === 'study'" class="settings-group settings-study" aria-label="自动学习设置">
                <h3>自动学习</h3><ExperimentalStudy /><ExperimentalStudy platform="unipus" />
              </section>
              <p class="desktop-disclaimer">
                {{ APP_VERSION }} · 测试版
              </p></template
            >
            <CourseManager v-if="panel === 'courses'" :courses="courses" :initial-platform="current?.id" footer-target="#course-selection-footer" :busy="busy" @changed="load" @saved="close" @view="viewCourse" />
            <template v-if="panel === 'notifications'"
              ><div class="sheet-actions" v-if="notes.length">
                <button
                  class="glass-secondary"
                  @click="
                    act(() => api('notifications/read', 'POST', {}), '已读')
                  "
                >
                  全部已读
                </button>
              </div>
              <div v-if="!notes.length" class="sheet-empty">暂无通知</div>
              <article v-for="n in notes" class="sheet-event">
                <h3>{{ n.title }}<i v-if="!n.read_at" /></h3>
                <p><TextLinks :text="n.body" @open="openLink" /></p>
                <small
                  >{{ date(n.at)
                  }}<span v-if="n.error"> · {{ n.error }}</span></small
                >
              </article></template
            >
            <template v-if="panel === 'history'"
              ><div v-if="!history.length" class="sheet-empty">
                暂无变化记录
              </div>
              <article v-for="h in history" class="sheet-event">
                <h3>{{ h.title }}</h3>
                <p>
                  {{
                    h.kind === "discovered"
                      ? "首次发现"
                      : h.data.fields.includes("deadline")
                        ? "截止时间变更"
                        : "任务信息变更"
                  }}
                </p>
                <p v-if="h.data.fields.includes('deadline')">
                  {{
                    h.data.before.deadline.kind === "known"
                      ? date(h.data.before.deadline.value)
                      : "未知"
                  }}
                  →
                  {{
                    h.data.after.deadline.kind === "known"
                      ? date(h.data.after.deadline.value)
                      : "未知"
                  }}
                </p>
                <small>{{ date(h.at) }}</small>
              </article></template
            >
            <template v-if="panel === 'logs'"
              ><div class="study-actions"><button type="button" class="glass-secondary" :disabled="busy" @click="act(exportSystemLogs)"><Download :size="16" />导出系统日志</button></div>
              <p class="sheet-description">含系统信息与错误诊断，不含登录凭据及课程内容。</p>
              <div v-if="!logs.length" class="sheet-empty">暂无检查记录</div>
              <article v-for="l in logs" class="sheet-event">
                <h3>
                  {{ platforms[l.platform as PlatformId].short }} ·
                  {{ status(l.outcome) }}
                </h3>
                <p v-for="i in l.data.issues">{{ i }}</p>
                <p v-for="p in l.data.partitions">
                  {{ p.count }} 条 · {{ p.issues.join("；") }}
                </p>
                <small>{{ date(l.at) }}</small>
              </article></template
            >
          </div>
          <footer v-if="panel === 'settings'" class="form-footer settings-footer">
            <span class="reminder-hint" role="status">{{ settingsDirty ? (busy ? '正在保存…' : '设置尚未保存') : '通用与提醒设置自动保存' }}</span>
            <button v-if="settingsDirty && !busy" type="button" class="glass-secondary" @click="saveSettings()">重新保存</button>
            <button type="button" class="glass-secondary" @click="close">完成</button>
          </footer>
          <footer v-if="panel === 'courses'" id="course-selection-footer" class="form-footer course-selection-footer" />
          <footer
            v-if="panel === 'platform' && platforms[managedId].adapted"
            class="form-footer"
          >
            <span class="reminder-hint">{{
              platformDirty || platformCourses?.dirty ? "有未保存的修改" : "设置已保存"
            }}</span>
            <div class="form-footer-actions">
              <button class="glass-secondary" :disabled="busy" @click="close">
                取消</button
              ><button
                class="glass-primary"
                type="submit"
                form="platform-editor"
                :disabled="busy"
              >
                保存设置
              </button>
            </div>
          </footer>
          <footer v-if="panel === 'schedule'" class="form-footer">
            <button
              v-if="editing"
              type="button"
              class="glass-icon danger-button"
              :class="{ 'confirm-delete': deleteArmed }"
              :disabled="busy"
              :aria-label="deleteArmed ? '确认删除此日程' : '删除日程'"
              @click="removeSchedule"
            >
              <Trash2 :size="18" /><span v-if="deleteArmed">确认删除</span>
            </button>
            <div class="form-footer-actions">
              <button
                type="button"
                class="glass-secondary"
                :disabled="busy"
                @click="close"
              >
                取消</button
              ><button
                type="submit"
                form="schedule-editor"
                class="glass-primary"
                :disabled="busy"
              >
                {{ editing ? "保存日程" : "添加日程" }}
              </button>
            </div>
          </footer>
        </section>
      </div> </Transition
    ><Transition name="notice"
      ><div v-if="message" class="desktop-toast" role="status">
        <Check :size="14" />{{ message }}
      </div></Transition
    >
    <div v-if="platformMenu" class="platform-context-dismiss" @pointerdown.self="platformMenu = null" @contextmenu.prevent="platformMenu = null">
      <div class="glass-menu platform-context-menu" role="menu" :aria-label="`${platforms[platformMenu.id].short}平台操作`" :style="{ left: `${platformMenu.x}px`, top: `${platformMenu.y}px` }">
        <button role="menuitem" :disabled="busy" @click="removePlatform(platformMenu.id)"><Trash2 :size="16" />移除平台</button>
      </div>
    </div>
  </div>
</template>
