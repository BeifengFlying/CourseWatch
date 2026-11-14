import { z } from "zod";
export const platforms = {
  ynjy: {
    name: "云南省高等学校计算机等级考试系统",
    short: "云南省高等学校计算机等级考试系统",
    icon: "/platforms/ynjy.png",
    loginUrl: "https://jsjks.ynjy.cn/",
    host: "jsjks.ynjy.cn",
    hosts: ["jsjks.ynjy.cn"],
    adapted: true,
  },
  renwei: {
    name: "人卫医学教育题库",
    short: "人卫",
    icon: "/platforms/renwei.png",
    loginUrl: "https://tk.ipmph.com/exam/a/adminlogin",
    host: "tk.ipmph.com",
    hosts: ["tk.ipmph.com"],
    adapted: true,
  },
  yuketang: {
    name: "雨课堂",
    short: "雨课堂",
    icon: "/platforms/yuketang.png",
    loginUrl: "https://www.yuketang.cn/web",
    host: "www.yuketang.cn",
    hosts: ["www.yuketang.cn", "yuketang.cn", "sso.yuketang.cn"],
    adapted: true,
  },
  chaoxing: {
    name: "超星学习通",
    short: "超星",
    icon: "/platforms/chaoxing.png",
    loginUrl: "https://passport2.chaoxing.com/login",
    host: "passport2.chaoxing.com",
    hosts: [
      "passport2.chaoxing.com",
      "i.chaoxing.com",
      "i.mooc.chaoxing.com",
      "mooc2-ans.chaoxing.com",
      "mooc1-api.chaoxing.com",
      "mooc1.chaoxing.com",
    ],
    adapted: true,
  },
  unipus: {
    name: "U校园 AI 版", short: "U校园", icon: "/platforms/unipus.png",
    loginUrl: "https://uai.unipus.cn/", host: "uai.unipus.cn",
    hosts: ["uai.unipus.cn", "sso.unipus.cn", "itest.unipus.cn"], adapted: true,
  },
} as const;
export const PlatformId = z.enum(["ynjy", "renwei", "yuketang", "chaoxing", "unipus"]);
export type PlatformId = z.infer<typeof PlatformId>;
export const TimeValue = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("known"),
    value: z.number().int().nonnegative(),
    raw: z.string().max(120),
    timezone: z.literal("Asia/Shanghai"),
  }),
  z.object({
    kind: z.enum(["unknown", "none"]),
    raw: z.string().max(120).optional(),
  }),
]);
export const SourceTask = z.object({
  courseKey: z.string().min(1).max(300).optional(),
  sourceId: z.string().min(1).max(300),
  namespace: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  course: z.string().max(300),
  type: z.enum(["homework", "exam", "quiz", "activity", "other"]),
  sourceStatus: z.enum([
    "pending",
    "in_progress",
    "submitted",
    "graded",
    "cancelled",
    "unknown",
  ]),
  deadline: TimeValue,
  startTime: TimeValue,
  publishTime: TimeValue,
  url: z.string().url().max(2000).optional(),
});
export type SourceTask = z.infer<typeof SourceTask>;
export const Partition = z.object({
  key: z.string(),
  outcome: z.enum(["complete", "partial", "failed"]),
  paginationComplete: z.boolean(),
  emptyConfirmed: z.boolean(),
  items: z.array(SourceTask).max(2000),
  issues: z.array(z.string().max(400)).max(30),
});
export const ScanResult = z
  .object({
    courses: z.array(z.object({ key: z.string().min(1).max(300), name: z.string().min(1).max(300) })).max(2000).optional(),
    platform: PlatformId,
    accountId: z.string().uuid(),
    outcome: z.enum([
      "complete",
      "partial",
      "failed",
      "auth_required",
      "verification_required",
    ]),
    discoveryComplete: z.boolean(),
    partitions: z.array(Partition).max(100),
    issues: z.array(z.string().max(400)).max(30),
  })
  .superRefine((s, ctx) => {
    if (
      s.outcome === "complete" &&
      (!s.discoveryComplete ||
        !s.partitions.length ||
        s.partitions.some(
          (p) =>
            p.outcome !== "complete" ||
            !p.paginationComplete ||
            (!p.items.length && !p.emptyConfirmed),
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "完整扫描缺少分区、分页或合法空列表证据",
      });
    if (s.partitions.some((p) => p.outcome === "failed" && p.items.length))
      ctx.addIssue({ code: "custom", message: "失败分区不可提交任务" });
    if (
      ["failed", "auth_required", "verification_required"].includes(
        s.outcome,
      ) &&
      s.partitions.some((p) => p.items.length)
    )
      ctx.addIssue({ code: "custom", message: "失败扫描不可提交任务" });
  });
export type ScanResult = z.infer<typeof ScanResult>;
export const SourceConfig = z.object({
  url: z.string().url().max(2000),
  course: z.string().min(1).max(160),
  type: z.enum(["homework", "exam", "activity"]),
});
export type SourceConfig = z.infer<typeof SourceConfig>;
export const ReminderHours = z
  .array(
    z
      .number()
      .finite()
      .min(1 / 60)
      .max(8760),
  )
  .max(12);
export const ScheduleInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).default(""),
  dueAt: z.number().int().positive(),
  important: z.boolean().default(false),
  reminderHours: ReminderHours.nullable().default(null),
});
export interface Schedule extends z.infer<typeof ScheduleInput> {
  id: string;
  done: boolean;
  version: number;
  updatedAt: number;
}
export const Settings = z.object({
  browser: z.enum(["auto", "chrome", "edge"]).default("auto"),
  sidebarGlass: z.boolean().default(false),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  accent: z.enum(["blue", "purple", "green", "orange"]).default("orange"),
  intervalMinutes: z.union([
    z.literal(5),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]),
  nativeNotifications: z.boolean(),
  reminderHours: ReminderHours,
});
export type Settings = z.infer<typeof Settings>;
export function safePlatformUrl(platform: PlatformId, value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      (platforms[platform].hosts as readonly string[]).includes(u.hostname) &&
      !u.username &&
      !u.password &&
      u.port === ""
    );
  } catch {
    return false;
  }
}
function decodedPlatformPath(value: string) {
  const url = new URL(value);
  let path = url.pathname + url.hash;
  // Reject malformed or excessively nested escapes instead of guessing how
  // the platform server or client-side router will interpret them.
  for (let depth = 0; path.includes("%") && depth < 4; depth++)
    path = decodeURIComponent(path);
  if (path.includes("%")) throw new Error("路径编码无效");
  return path;
}
export function safePlatformReadUrl(platform: PlatformId, value: string) {
  if (!safePlatformUrl(platform, value)) return false;
  try {
    return !/logout|delete|submit|save|remove|edit|answer|startExam|doHomeWork|selectWorkQuestion|doExam/i.test(
      decodedPlatformPath(value),
    );
  } catch {
    return false;
  }
}
export function safeMonitorUrl(platform: PlatformId, value: string) {
  if (!safePlatformReadUrl(platform, value)) return false;
  return !/login/i.test(decodedPlatformPath(value));
}
export interface Task extends SourceTask {
  id: string;
  platform: PlatformId;
  accountId: string;
  firstObservedAt: number;
  lastSeenAt: number;
  updatedAt: number;
  deadlineVersion: number;
  personalDone: boolean;
  important?: boolean;
  reminderHours?: number[] | null;
  needsReview: boolean;
}

export interface CourseRecord {
  id: string;
  key: string;
  name: string;
  platform: PlatformId;
  accountId: string;
  status: "pending" | "enabled" | "removed";
  selectedAt?: number;
}
export function taskCourseKey(t: Pick<SourceTask, "courseKey" | "namespace" | "course">) {
  return t.courseKey ?? t.namespace.match(/^(classroom:[^:]+|course:[^:]+:class:[^:]+)/)?.[1] ?? `name:${t.course || t.namespace}`;
}

export function discoversCourses(id: PlatformId) {
  return id === "yuketang" || id === "chaoxing" || id === "unipus";
}
