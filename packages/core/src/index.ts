import { randomUUID, createHash } from "node:crypto";
import {
  ScanResult,
  type Task,
  type Settings,
  type Schedule,
  type CourseRecord,
  type PlatformId,
  taskCourseKey,
  PlatformId as PlatformSchema,
  discoversCourses,
  platforms,
} from "../../contracts/src/index.js";
import { Store } from "../../storage/src/index.js";
import { taskNotice } from "./task-notice.js";
import { defaultMobileNotifications, type MobileNotificationConfig, type PushDevice } from '../../contracts/src/mobile-notifications.js';
export const defaultSettings: Settings = {
  browser: "auto",
  sidebarGlass: false,
  theme: "system",
  accent: "orange",
  intervalMinutes: 15,
  nativeNotifications: false,
  reminderHours: [72, 24, 12, 3, 1],
};
const fields = [
  "title",
  "course",
  "type",
  "sourceStatus",
  "deadline",
  "startTime",
  "publishTime",
  "url",
] as const;
const equivalent = (a: any, b: any) =>
  a && b && a.kind && b.kind
    ? a.kind === b.kind && (a.kind !== "known" || a.value === b.value)
    : JSON.stringify(a) === JSON.stringify(b);
export class Engine {
  constructor(public store: Store) {
    // Retired integrations keep their records and credentials, but cannot notify.
    const retired = this.store.all<{id: string; data: string}>("SELECT id,data FROM tasks")
      .filter(r => !PlatformSchema.safeParse(JSON.parse(r.data).platform).success).map(r => r.id);
    retired.push(...this.store.all<{id: string; data: string}>("SELECT id,data FROM schedules")
      .filter(r => { const source = JSON.parse(r.data).activity?.platform; return source && !PlatformSchema.safeParse(source).success; }).map(r => r.id));
    this.store.db.transaction(() => {
      for (const id of retired) {
        this.silenceTask(id, "平台已停用");
        this.store.run("UPDATE outbox SET read_at=COALESCE(read_at,?),error='平台已停用' WHERE task_id=?", Date.now(), id);
      }
      for (const row of this.store.all<{id:number; dedupe:string}>("SELECT id,dedupe FROM outbox WHERE task_id IS NULL")) {
        const platform = row.dedupe.match(/^(?:auth|baseline-summary):([^:]+):/)?.[1];
        if (platform && !PlatformSchema.safeParse(platform).success)
          this.store.run("UPDATE outbox SET delivered_at=COALESCE(delivered_at,?),read_at=COALESCE(read_at,?),error='平台已停用' WHERE id=?", Date.now(), Date.now(), row.id);
      }
    })();
    for (const t of this.tasks()) this.rememberCourse(t.platform, t.accountId, taskCourseKey(t), t.course || "未命名课程");
    // Existing installations also wait for a course choice before sending queued alerts.
    for (const t of this.tasks()) {
      if (!this.courseEnabled(t) || this.initiallyExpired(t)) this.silenceTask(t.id, "课程未选择或首次读取时已截止");
    }
    if (!this.store.get("notificationPlatformsV1", false)) {
      const tasks = new Map(this.tasks().map(t => [t.id, t]));
      for (const r of this.store.all<{id:number; task_id:string; title:string; body:string; dedupe:string}>("SELECT id,task_id,title,body,dedupe FROM outbox WHERE kind!='test'")) {
        const platform = tasks.get(r.task_id)?.platform ?? (Object.keys(platforms) as PlatformId[]).find(p => r.dedupe.startsWith(`baseline-summary:${p}:`) || r.dedupe.startsWith(`auth:${p}:`));
        if (!platform || r.body.startsWith("平台：")) continue;
        this.store.run("UPDATE outbox SET title=?,body=? WHERE id=?", `${platforms[platform].short} · ${r.title}`, `平台：${platforms[platform].name}\n${r.body}`, r.id);
      }
      this.store.set("notificationPlatformsV1", true);
    }
  }
  courses() {
    return this.store.all<{ data: string }>("SELECT data FROM courses").map(r => JSON.parse(r.data) as CourseRecord).filter(c => PlatformSchema.safeParse(c.platform).success);
  }
  rememberCourse(platform: PlatformId, accountId: string, key: string, name: string) {
    const id = createHash("sha256").update(JSON.stringify([platform, accountId, key])).digest("hex");
    const previous = this.courses().find(c => c.id === id);
    const course: CourseRecord = { ...previous, id, platform, accountId, key, name, status: previous?.status ?? (discoversCourses(platform) ? "pending" : "enabled") };
    this.store.run("INSERT OR REPLACE INTO courses VALUES(?,?)", id, JSON.stringify(course));
    return course;
  }
  courseEnabled(t: Task) {
    const c = this.courses().find(c => c.platform === t.platform && c.accountId === t.accountId && c.key === taskCourseKey(t));
    return c ? c.status === "enabled" : !discoversCourses(t.platform);
  }
  visibleTasks() { return this.tasks().filter(t => this.courseEnabled(t)); }
  silenceTask(id: string, reason: string) {
    this.store.run("UPDATE notification_deliveries SET status='cancelled',error=? WHERE status='pending' AND outbox_id IN (SELECT id FROM outbox WHERE task_id=?)", reason, id);
    this.store.run("DELETE FROM reminders WHERE task_id=?", id);
    this.store.run("UPDATE outbox SET delivered_at=?,read_at=COALESCE(read_at,?),error=? WHERE task_id=? AND delivered_at IS NULL", Date.now(), Date.now(), reason, id);
  }
  selectCourses(platform: PlatformId, accountId: string, ids: string[], now = Date.now(), changedIds?: string[]) {
    const courses = this.courses().filter(c => c.platform === platform && c.accountId === accountId);
    if (ids.some(id => !courses.some(c => c.id === id))) return false;
    this.store.db.transaction(() => {
      for (const c of courses) {
        if (changedIds && !changedIds.includes(c.id)) continue;
        const status = ids.includes(c.id) ? "enabled" : "removed";
        if (status === c.status) continue;
        c.status = status;
        if (status === "enabled") c.selectedAt = now;
        this.store.run("UPDATE courses SET data=? WHERE id=?", JSON.stringify(c), c.id);
        for (const t of this.tasks().filter(t => t.platform === platform && t.accountId === accountId && taskCourseKey(t) === c.key)) {
          this.silenceTask(t.id, "课程选择已更新");
          if (status === "enabled") this.plan(t, now);
        }
      }
    })();
    return true;
  }
  initiallyExpired(t: Task) {
    const course = this.courses().find(c => c.platform === t.platform && c.accountId === t.accountId && c.key === taskCourseKey(t));
    return t.deadline.kind === "known" && t.deadline.value <= Math.max(t.firstObservedAt, course?.selectedAt ?? 0);
  }
  settings() {
    const saved = this.store.get<Partial<Settings> & { appearance?: string }>("settings", defaultSettings);
    const { appearance, ...current } = saved;
    const previousTheme = ["system", "light", "dark"].includes(appearance ?? "")
      ? appearance as Settings["theme"] : defaultSettings.theme;
    return {
      ...defaultSettings,
      ...current,
      theme: saved.theme ?? previousTheme,
    };
  }
  tasks() {
    return this.store
      .all<{ data: string }>("SELECT data FROM tasks")
      .map((r) => JSON.parse(r.data) as Task)
      .filter(t => PlatformSchema.safeParse(t.platform).success);
  }
  enqueue(
    key: string,
    title: string,
    body: string,
    taskId: string | null,
    kind: string,
    now = Date.now(),
  ) {
    this.store.db.transaction(() => {
      const inserted = this.store.run(
        "INSERT OR IGNORE INTO outbox(dedupe,at,title,body,task_id,kind) VALUES(?,?,?,?,?,?)",
        key, now, title, body, taskId, kind,
      );
      if (!inserted.changes || kind === 'test' || kind === 'update') return;
      const config = this.store.get<MobileNotificationConfig>('mobileNotifications', defaultMobileNotifications);
      const add = (channel: string, target: string) => this.store.run(
        'INSERT OR IGNORE INTO notification_deliveries(outbox_id,channel,target) VALUES(?,?,?)',
        inserted.lastInsertRowid, channel, target,
      );
      if (config.email.enabled) add('email', 'email');
      if (config.web.enabled)
        for (const device of this.store.get<PushDevice[]>('pushDevices', [])) add('web', device.id);
    })();
  }
  schedules() {
    return this.store
      .all<{ data: string }>("SELECT data FROM schedules")
      .map((r) => JSON.parse(r.data) as Schedule)
      .filter(s => { const source = (s as Schedule & {activity?: {platform: string}}).activity?.platform; return !source || PlatformSchema.safeParse(source).success; });
  }
  saveSchedule(s: Schedule) {
    this.store.db.transaction(() => {
      this.cancelPendingDeadlines(s.id, "日程已更新，旧提醒已作废");
      this.store.run(
        "INSERT OR REPLACE INTO schedules VALUES(?,?)",
        s.id,
        JSON.stringify(s),
      );
      this.planSchedule(s);
    })();
  }
  planSchedule(s: Schedule) {
    this.store.run("DELETE FROM reminders WHERE task_id=?", s.id);
    if (s.done) {
      this.cancelPendingDeadlines(s.id, "日程已完成");
      return;
    }
    for (const h of new Set([
      ...(s.reminderHours ?? this.settings().reminderHours),
      0,
    ])) {
      this.store.run(
        "INSERT OR IGNORE INTO reminders VALUES(?,?,?,?,?)",
        `${s.id}:schedule:${s.version}:rule:${h}`,
        s.id,
        s.dueAt - h * 3600000,
        s.version,
        h,
      );
    }
  }
  deleteSchedule(id: string) {
    if (!this.schedules().some((s) => s.id === id)) return false;
    this.store.db.transaction(() => {
      this.cancelPendingDeadlines(id, "日程已删除");
      this.store.run("DELETE FROM reminders WHERE task_id=?", id);
      this.store.run("DELETE FROM schedules WHERE id=?", id);
    })();
    return true;
  }
  updateTask(
    id: string,
    patch: Partial<Pick<Task, "personalDone" | "important" | "reminderHours">>,
  ) {
    const t = this.tasks().find((t) => t.id === id);
    if (!t) return false;
    this.store.db.transaction(() => {
      if (patch.reminderHours !== undefined)
        this.cancelPendingDeadlines(id, "提醒时间已调整");
      Object.assign(t, patch);
      this.store.run(
        "UPDATE tasks SET data=? WHERE id=?",
        JSON.stringify(t),
        id,
      );
      this.plan(t);
    })();
    return true;
  }
  plan(t: Task, _now = Date.now()) {
    this.store.run("DELETE FROM reminders WHERE task_id=?", t.id);
    if (
      t.personalDone ||
      !this.courseEnabled(t) ||
      this.initiallyExpired(t) ||
      ["submitted", "graded", "cancelled"].includes(t.sourceStatus) ||
      t.deadline.kind !== "known"
    ) {
      this.cancelPendingDeadlines(
        t.id,
        "任务已完成或没有明确截止，停止待发送提醒",
      );
      return;
    }
    const hours = [
      ...new Set([...(t.reminderHours ?? this.settings().reminderHours), 0]),
    ];
    for (const h of hours) {
      const id = `${t.id}:ddl:${t.deadlineVersion}:rule:${h}:v1:system`;
      this.store.run(
        "INSERT OR IGNORE INTO reminders VALUES(?,?,?,?,?)",
        id,
        t.id,
        t.deadline.value - h * 3600000,
        t.deadlineVersion,
        h,
      );
    }
  }
  cancelPendingDeadlines(taskId: string, reason: string) {
    this.store.run("UPDATE notification_deliveries SET status='cancelled',error=? WHERE status='pending' AND outbox_id IN (SELECT id FROM outbox WHERE task_id=? AND kind='deadline')", reason, taskId);
    this.store.run(
      "UPDATE outbox SET delivered_at=?,error=? WHERE task_id=? AND kind='deadline' AND delivered_at IS NULL",
      Date.now(),
      reason,
      taskId,
    );
  }
  apply(input: unknown, now = Date.now()) {
    const scan = ScanResult.parse(input);
    let added = 0,
      changed = 0;
    this.store.db.transaction(() => {
      for (const c of scan.courses ?? []) this.rememberCourse(scan.platform, scan.accountId, c.key, c.name);
      const prior = this.store
        .all<{ data: string }>(
          "SELECT data FROM tasks WHERE platform=? AND account_id=?",
          scan.platform,
          scan.accountId,
        )
        .map((r) => JSON.parse(r.data) as Task)
      .filter(t => PlatformSchema.safeParse(t.platform).success);
      const baselineKey = `baseline:${scan.platform}:${scan.accountId}`;
      const baselines = this.store.get<string[]>(baselineKey, []);
      const seen = new Set<string>();
      for (const p of scan.partitions) {
        if (p.outcome === "failed") continue;
        const isBaseline = !baselines.includes(p.key);
        const localSeen = new Set<string>();
        for (const source of p.items) {
          const key = JSON.stringify([source.namespace, source.sourceId]);
          if (localSeen.has(key) || seen.has(key)) continue;
          localSeen.add(key);
          seen.add(key);
          const old = prior.find(
            (t) => JSON.stringify([t.namespace, t.sourceId]) === key,
          );
          const next: Task = {
            ...source,
            id: old?.id ?? randomUUID(),
            platform: scan.platform,
            accountId: scan.accountId,
            firstObservedAt: old?.firstObservedAt ?? now,
            lastSeenAt: now,
            updatedAt: old?.updatedAt ?? now,
            deadlineVersion: old?.deadlineVersion ?? 1,
            personalDone: old?.personalDone ?? false,
            important: old?.important ?? false,
            reminderHours: old?.reminderHours ?? null,
            needsReview: false,
          };
          this.rememberCourse(scan.platform, scan.accountId, taskCourseKey(next), next.course || "未命名课程");
          // A partial field must never erase a previously verified value.
          if (old) {
            for (const f of ["deadline", "startTime", "publishTime"] as const)
              if (source[f].kind === "unknown" && old[f].kind !== "unknown")
                next[f] = old[f];
            if (source.sourceStatus === "unknown")
              next.sourceStatus = old.sourceStatus;
          }
          const diff = old
            ? fields.filter((f) => !equivalent(old[f], next[f]))
            : [];
          if (!old || diff.length) {
            next.updatedAt = now;
            if (old && diff.includes("deadline")) {
              next.deadlineVersion++;
              this.cancelPendingDeadlines(
                next.id,
                "截止时间已变更，旧提醒已作废",
              );
            }
            this.store.run(
              "INSERT INTO history(task_id,at,kind,data) VALUES(?,?,?,?)",
              next.id,
              now,
              old ? "changed" : "discovered",
              JSON.stringify({
                fields: diff,
                before: old
                  ? Object.fromEntries(diff.map((f) => [f, old[f]]))
                  : null,
                after: old
                  ? Object.fromEntries(diff.map((f) => [f, next[f]]))
                  : source,
              }),
            );
            if (old) {
              changed++;
              if (this.courseEnabled(next) && !this.initiallyExpired(next)) {
              const notice = taskNotice(next, "change");
              this.enqueue(
                `${next.id}:change:${createHash("sha256")
                  .update(JSON.stringify([now, diff, next]))
                  .digest("hex")}`,
                notice.title,
                notice.body,
                next.id,
                "change",
                now,
              );
              }
            } else {
              added++;
              if (!isBaseline && this.courseEnabled(next) && !this.initiallyExpired(next)) {
                const notice = taskNotice(next, "new");
                this.enqueue(
                  `${next.id}:new`,
                  notice.title,
                  notice.body,
                  next.id,
                  "new",
                  now,
                );
              }
            }
          }
          this.store.run(
            "INSERT OR REPLACE INTO tasks VALUES(?,?,?,?,?)",
            next.id,
            next.platform,
            next.accountId,
            key,
            JSON.stringify(next),
          );
          this.plan(next, now);
        }
        // First valid observations establish a baseline for this configured source only.
        if ((p.items.length || p.emptyConfirmed) && isBaseline)
          baselines.push(p.key);
      }
      if (scan.outcome === "complete" && scan.discoveryComplete) {
        for (const t of prior) {
          if (!seen.has(JSON.stringify([t.namespace, t.sourceId]))) {
            t.needsReview = true;
            this.store.run(
              "UPDATE tasks SET data=? WHERE id=?",
              JSON.stringify(t),
              t.id,
            );
          }
        }
      }
      this.store.set(baselineKey, baselines);
      this.store.run(
        "INSERT INTO scans(platform,at,outcome,data) VALUES(?,?,?,?)",
        scan.platform,
        now,
        scan.outcome,
        JSON.stringify({
          issues: scan.issues,
          discoveryComplete: scan.discoveryComplete,
          partitions: scan.partitions.map((p) => ({
            ...p,
            items: undefined,
            count: p.items.length,
          })),
          added,
          changed,
        }),
      );
      if (added && !prior.length)
        this.enqueue(
          `baseline-summary:${scan.platform}:${scan.accountId}`,
          `${platforms[scan.platform].short} · 首次同步已建立`,
          `平台：${platforms[scan.platform].name}\n发现 ${added} 项任务；首次发现时间不代表平台发布时间。`,
          null,
          "baseline",
          now,
        );
      if (["auth_required", "verification_required"].includes(scan.outcome))
        this.enqueue(
          `auth:${scan.platform}:${scan.accountId}:${Math.floor(now / 86400000)}`,
          `${platforms[scan.platform].short} · 需要重新登录`,
          `平台：${platforms[scan.platform].name}\n已有任务已保留，请在平台管理中重新登录。`,
          null,
          "auth",
          now,
        );
      // Bound operational records; task history stays intact.
      this.store.run(
        "DELETE FROM scans WHERE id NOT IN (SELECT id FROM scans ORDER BY id DESC LIMIT 1000)",
      );
    })();
    return { added, changed, outcome: scan.outcome };
  }
  markDone(id: string, done: boolean) {
    return this.updateTask(id, { personalDone: done });
  }
  reminders(now = Date.now()) {
    this.store.db.transaction(() => {
      const tasksById = new Map(this.tasks().map((t) => [t.id, t]));
      const schedulesById = new Map(this.schedules().map((s) => [s.id, s]));
      const rows = this.store.all<{
        id: string;
        task_id: string;
        due_at: number;
        rule_hours: number;
      }>("SELECT * FROM reminders WHERE due_at<=? ORDER BY due_at DESC", now);
      const handled = new Set<string>();
      for (const r of rows) {
        if (!handled.has(r.task_id)) {
          const schedule = schedulesById.get(r.task_id);
          if (schedule && !schedule.done)
            this.enqueue(
              r.id,
              r.rule_hours === 0 ? "日程时间到了" : "日程即将开始",
              schedule.title,
              schedule.id,
              "deadline",
              now,
            );
          const t = tasksById.get(r.task_id);
          if (
            t &&
            this.courseEnabled(t) &&
            !this.initiallyExpired(t) &&
            !t.personalDone &&
            !["submitted", "graded", "cancelled"].includes(t.sourceStatus)
          ) {
            const notice = taskNotice(t, r.rule_hours === 0 ? "deadline" : "reminder");
            this.enqueue(
              r.id,
              notice.title,
              notice.body,
              t.id,
              "deadline",
              now,
            );
          }
          handled.add(r.task_id);
        }
        this.store.run("DELETE FROM reminders WHERE id=?", r.id);
      }
    })();
  }
}
